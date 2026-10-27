"""Export everything the web report needs as JSON in docs/data/.

The web app (web/, built into docs/) only reads these files. Every number in it comes from
here, and every per-day file lists the stored answers and verified quotes behind its counts.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from airtime.agents.visibility.compare import compare_days, mention_range, scope_label
from airtime.agents.visibility.topics import topic_stats, topics_for
from airtime.config import REPO_ROOT, load_store_config
from airtime.live import write_json
from airtime.providers.base import utc_now

DOCS_DIR = REPO_ROOT / "docs"
SCHEDULE = {"cron": "17 20 * * *", "utc_hour": 20, "utc_minute": 17}  # keep in sync with daily.yml

AGENT = {
    "name": "Asker & Analyst",
    "role": "On each shift the Asker asks AI assistants the questions your buyers ask. The Analyst "
            "reads every answer, checks each quote word for word and counts which shops are "
            "recommended. The Master checks each hand-off.",
    "role_id": "Setiap shift Asker menanyakan ke asisten AI pertanyaan yang biasa diajukan pembeli Anda. "
               "Analyst membaca setiap jawaban, mengecek setiap kutipan kata per kata, dan menghitung toko "
               "mana yang direkomendasikan. Master mengecek setiap serah-terima.",
}

# The team in the order of the "Airtime at work" flow. Asker, Analyst and the Master's hand-off
# checks work today; the others are listed so the site shows where each one will sit.
TEAM = [
    {"id": "auditor", "name": "Auditor", "title": "Site auditor", "title_id": "Auditor situs", "status": "planned",
     "job": "Will check the store's own website for what AI assistants can and cannot read.",
     "job_id": "Akan mengecek website toko: apa yang bisa dan tidak bisa dibaca asisten AI.",
     "inputs": ["Store website"], "outputs": ["Audit report"],
     "inputs_id": ["Website toko"], "outputs_id": ["Laporan audit"]},
    {"id": "asker", "name": "Asker", "title": "Asks the AI assistants", "title_id": "Bertanya ke asisten AI",
     "status": "active", "steps": [1, 2, 3],
     "job": "Keeps the same core questions for the trend and writes new ones aimed at the topics where the store is named least, learning from what was asked before. Checks them and asks each one to Gemini. Every answer is stored, empty ones too.",
     "job_id": "Memakai pertanyaan inti yang sama untuk tren, dan menulis pertanyaan baru yang diarahkan ke topik di mana toko paling jarang disebut, belajar dari pertanyaan sebelumnya. Mengeceknya lalu menanyakan masing-masing ke Gemini. Setiap jawaban disimpan, termasuk yang kosong.",
     "inputs": ["Store topics", "Results per topic", "Recent questions"], "outputs": ["Answer table"],
     "inputs_id": ["Topik toko", "Hasil per topik", "Pertanyaan terakhir"], "outputs_id": ["Tabel jawaban"]},
    {"id": "analyst", "name": "Analyst", "title": "Reads and counts", "title_id": "Membaca dan menghitung",
     "status": "active", "steps": [4, 5, 6, 7],
     "job": "Reads every answer, checks each quote word for word, counts the store against its competitors, compares with the last shift and writes the owner summary.",
     "job_id": "Membaca setiap jawaban, mengecek setiap kutipan kata per kata, menghitung toko dibanding kompetitor, membandingkan dengan shift lalu, dan menulis ringkasan untuk pemilik.",
     "inputs": ["Answer table"], "outputs": ["Count results", "Owner summary"],
     "inputs_id": ["Tabel jawaban"], "outputs_id": ["Hasil hitungan", "Ringkasan pemilik"]},
    {"id": "planner", "name": "Planner", "title": "Planner", "title_id": "Perencana", "status": "planned",
     "job": "Will turn the gaps into a short list of tasks, each with its evidence.",
     "job_id": "Akan mengubah celah yang ditemukan menjadi daftar tugas singkat, masing-masing dengan buktinya.",
     "inputs": ["Count results", "Audit report"], "outputs": ["Task list"],
     "inputs_id": ["Hasil hitungan", "Laporan audit"], "outputs_id": ["Daftar tugas"]},
    {"id": "owner", "name": "Owner", "title": "Approves the changes", "title_id": "Menyetujui perubahan",
     "status": "human",
     "job": "The store owner reviews the tasks and evidence. Nothing changes on the site without approval.",
     "job_id": "Pemilik toko meninjau tugas dan buktinya. Tidak ada yang berubah di website tanpa persetujuan.",
     "inputs": ["Task list"], "outputs": ["Approved changes"],
     "inputs_id": ["Daftar tugas"], "outputs_id": ["Perubahan disetujui"]},
    {"id": "fixer", "name": "Fixer", "title": "Fixer", "title_id": "Pelaksana", "status": "planned",
     "job": "Will prepare and publish the approved changes, with a backup to restore.",
     "job_id": "Akan menyiapkan dan menerbitkan perubahan yang disetujui, dengan backup untuk dipulihkan.",
     "inputs": ["Approved changes"], "outputs": ["Published change"],
     "inputs_id": ["Perubahan disetujui"], "outputs_id": ["Perubahan terbit"]},
    {"id": "reporter", "name": "Reporter", "title": "Reporter", "title_id": "Pelapor", "status": "planned",
     "job": "Will compare before and after, add AI visits from analytics, and report to the owner, zeros included.",
     "job_id": "Akan membandingkan sebelum dan sesudah, menambahkan kunjungan dari AI lewat analytics, dan melapor ke pemilik, termasuk hasil nol.",
     "inputs": ["Count results", "Analytics"], "outputs": ["Owner report"],
     "inputs_id": ["Hasil hitungan", "Analytics"], "outputs_id": ["Laporan pemilik"]},
    {"id": "master", "name": "Master", "title": "Checks every hand-off", "title_id": "Mengecek setiap serah-terima",
     "status": "active",
     "job": "Checks each agent's output before the next one uses it. Today: the Asker's answers are complete, and the Analyst's numbers match the answers.",
     "job_id": "Mengecek hasil setiap agent sebelum dipakai agent berikutnya. Saat ini: jawaban dari Asker lengkap, dan angka Analyst cocok dengan jawabannya.",
     "inputs": ["Each agent's output"], "outputs": ["Pass or send back"],
     "inputs_id": ["Hasil setiap agent"], "outputs_id": ["Lolos atau dikembalikan"]},
]

STEP_AGENT = {"write_questions": "asker", "validate_questions": "asker", "ask_questions": "asker",
              "import_answers": "import", "extract_mentions": "analyst", "verify_and_count": "analyst",
              "compare_previous": "analyst", "write_summary": "analyst"}


def is_shift(agent: str) -> bool:
    """A daily shift run: the old single 'visibility' agent, or the Asker + Analyst flow."""
    return agent == "visibility" or "asker" in agent.split(",")


def _loads(value, default):
    return json.loads(value) if value else default


def _n(count, word: str, plural: str | None = None) -> str:
    return f"{count} {word if count == 1 else (plural or word + 's')}"


def describe_step(step: dict, store_name: str, lang: str = "en") -> str:
    """One plain sentence about what a step did, from its stored result ("en" or "id")."""
    if step["name"].startswith("master_"):
        return _describe_master(step, lang)
    text = _describe_id(step, store_name) if lang == "id" else _describe(step, store_name)
    if step["name"].startswith("recheck_"):
        return ("Cek ulang: " if lang == "id" else "Re-check: ") + text[0].lower() + text[1:]
    return text


def _describe_master(step: dict, lang: str) -> str:
    r = step.get("result") or {}
    problems = r.get("problems") or []
    id_ = lang == "id"
    if step["name"] == "master_answers_complete":
        if problems:
            return ("Master mengembalikan hasil Asker: " if id_ else "Master sent the Asker's work back: ") + "; ".join(problems)
        return (f"Master mengecek hasil Asker: {r.get('recorded')} dari {r.get('planned')} jawaban tercatat untuk {r.get('questions')} pertanyaan. Lolos."
                if id_ else
                f"Master checked the Asker's work: {r.get('recorded')} of {r.get('planned')} answers recorded for {r.get('questions')} questions. Passed.")
    if step["name"] == "master_numbers_match":
        if problems:
            return ("Master mengembalikan hasil Analyst: " if id_ else "Master sent the Analyst's work back: ") + "; ".join(problems)
        return (f"Master mengecek hasil Analyst: {r.get('fields_checked')} angka cocok dengan jawaban, {r.get('quotes_checked')} kutipan masih persis sama. Lolos."
                if id_ else
                f"Master checked the Analyst's work: {r.get('fields_checked')} numbers match the answers, {r.get('quotes_checked')} quotes still verbatim. Passed.")
    return "Master check." if not problems else "; ".join(problems)


def _describe(step: dict, store_name: str) -> str:
    r = step.get("result") or {}
    name = step["name"].removeprefix("recheck_")
    if step.get("status") == "failed":
        return f"Stopped here: {step.get('error', 'unknown error')}"
    if name == "write_questions":
        if "core" not in r:  # runs from before daily questions existed
            if r.get("action") == "reused":
                return f"Used the same {r.get('count')} buyer questions as before."
            return f"Wrote {r.get('count')} buyer questions ({r.get('source')})."
        core, daily = r["core"], r.get("daily") or {}
        text = (f"Kept the same {core.get('count')} core questions" if core.get("action") == "reused"
                else f"Set up {core.get('count')} core questions")
        if daily.get("action") == "created" and daily.get("mode") == "explore":
            topics = ", ".join(t["topic"] for t in daily.get("topics") or [])
            return text + f" and wrote {daily.get('count')} new ones for the topics where {store_name} is named least: {topics}."
        if daily.get("action") in ("created", "reused"):
            return text + f" and {'wrote' if daily['action'] == 'created' else 'reused'} {daily.get('count')} new ones for today."
        if daily.get("action") == "failed":
            return text + "; could not write new ones today, so only the core questions are asked."
        return text + "."
    if name == "validate_questions":
        n = r.get("naming_area") or 0
        return (f"Checked the {r.get('count')} questions: no empty or duplicate ones, "
                f"{n} {'names' if n == 1 else 'name'} a store area.")
    if name == "ask_questions":
        text = f"Asked {r.get('asked')} questions: {r.get('ok')} answered, {r.get('no_answer')} no answer."
        if r.get("retries"):
            text += f" Retried {_n(r['retries'], 'time')} after errors."
        return text
    if name == "import_answers":
        return f"Imported {r.get('imported')} pasted answers ({r.get('empty')} empty)."
    if name == "extract_mentions":
        return f"Read {_n(r.get('extracted') or 0, 'answer')} and listed every shop named."
    if name == "verify_and_count":
        return (f"Checked every quote word for word: {r.get('ok')} answers counted, "
                f"{r.get('needs_review')} set aside for review. {store_name} named in "
                f"{r.get('our_mentions')} of {r.get('ok')}.")
    if name == "compare_previous":
        lines = r.get("lines") or []
        return lines[1] if len(lines) > 1 else (lines[0] if lines else "Compared with the previous run.")
    if name == "write_summary":
        if r.get("source") == "ai":
            return "Wrote the summary; code checked every number in it against the counts."
        return "Wrote the summary from the counts (the AI draft did not pass the number check)."
    return name.replace("_", " ").capitalize() + "."


def _describe_id(step: dict, store_name: str) -> str:
    r = step.get("result") or {}
    name = step["name"].removeprefix("recheck_")
    if step.get("status") == "failed":
        return f"Berhenti di sini: {step.get('error', 'error tidak diketahui')}"
    if name == "write_questions":
        if "core" not in r:
            if r.get("action") == "reused":
                return f"Memakai {r.get('count')} pertanyaan pembeli yang sama seperti sebelumnya."
            return f"Menyiapkan {r.get('count')} pertanyaan pembeli ({r.get('source')})."
        core, daily = r["core"], r.get("daily") or {}
        text = (f"Memakai {core.get('count')} pertanyaan inti yang sama" if core.get("action") == "reused"
                else f"Menyiapkan {core.get('count')} pertanyaan inti")
        if daily.get("action") == "created" and daily.get("mode") == "explore":
            topics = ", ".join(t["topic"] for t in daily.get("topics") or [])
            return text + f" dan menulis {daily.get('count')} pertanyaan baru untuk topik di mana {store_name} paling jarang disebut: {topics}."
        if daily.get("action") in ("created", "reused"):
            verb = "menulis" if daily["action"] == "created" else "memakai lagi"
            return text + f" dan {verb} {daily.get('count')} pertanyaan baru untuk hari ini."
        if daily.get("action") == "failed":
            return text + "; gagal menulis pertanyaan baru hari ini, jadi hanya pertanyaan inti yang diajukan."
        return text + "."
    if name == "validate_questions":
        return (f"Mengecek {r.get('count')} pertanyaan: tidak ada yang kosong atau dobel, "
                f"{r.get('naming_area') or 0} menyebut area toko.")
    if name == "ask_questions":
        text = (f"Mengajukan {r.get('asked')} pertanyaan: {r.get('ok')} dijawab, "
                f"{r.get('no_answer')} tanpa jawaban.")
        if r.get("retries"):
            text += f" Mencoba ulang {r['retries']} kali setelah error."
        return text
    if name == "import_answers":
        return f"Mengimpor {r.get('imported')} jawaban yang di-paste ({r.get('empty')} kosong)."
    if name == "extract_mentions":
        return f"Membaca {r.get('extracted') or 0} jawaban dan mencatat setiap toko yang disebut."
    if name == "verify_and_count":
        return (f"Mengecek setiap kutipan kata per kata: {r.get('ok')} jawaban dihitung, "
                f"{r.get('needs_review')} disisihkan untuk dicek. {store_name} disebut di "
                f"{r.get('our_mentions')} dari {r.get('ok')}.")
    if name == "compare_previous":
        lines = r.get("lines") or []
        if lines and lines[0].startswith("First run"):
            return "Shift pertama: belum ada pembanding."
        return "Membandingkan dengan shift sebelumnya."
    if name == "write_summary":
        if r.get("source") == "ai":
            return "Menulis ringkasan; code mengecek setiap angkanya dengan hasil hitungan."
        return "Menulis ringkasan dari hasil hitungan (draf AI tidak lolos cek angka)."
    return name.replace("_", " ").capitalize() + "."


def _run_json(conn, run, store_name: str, topics=()) -> dict:
    steps = _loads(run["steps"], [])
    for s in steps:
        s.setdefault("agent", STEP_AGENT.get(s["name"].removeprefix("recheck_"), "analyst"))
        s["description"] = describe_step(s, store_name)
        s["description_id"] = describe_step(s, store_name, "id")
    quotes = conn.execute(
        "SELECT COUNT(*) FROM mentions m JOIN answers a ON a.id = m.answer_id WHERE a.run_id = ?",
        (run["id"],)).fetchone()[0]
    questions = [dict(q) for q in conn.execute(
        """SELECT q.text, q.kind, q.names_area, q.reason, COUNT(a.id) AS asked,
                  SUM(a.status = 'ok') AS counted,
                  SUM(a.status = 'ok' AND EXISTS (SELECT 1 FROM mentions m WHERE m.answer_id = a.id AND m.is_ours)) AS ours
           FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.run_id = ?
           GROUP BY q.id ORDER BY q.kind, q.id""", (run["id"],))]
    for q in questions:
        q["reason"] = _loads(q["reason"], None)
        q["topics"] = topics_for(q["text"], topics)
    return {"id": run["id"], "agent": run["agent"], "kind": "shift" if is_shift(run["agent"]) else "import",
            "run_date": run["run_date"],
            "started_at": run["started_at"], "finished_at": run["finished_at"],
            "status": run["status"], "error": run["error"], "steps": steps,
            "quotes_verified": quotes, "questions": questions}


def _summary_json(row) -> dict:
    d = dict(row)
    d["label"] = scope_label(d["provider"], d["channel"])
    d["competitors"] = _loads(d["competitors"], [])
    d["our_answer_ids"] = _loads(d["our_answer_ids"], [])
    return d


def _answers_json(conn, run_id: int) -> list[dict]:
    out = []
    rows = conn.execute(
        """SELECT a.*, q.text AS question, q.names_area, q.kind FROM answers a
           JOIN questions q ON q.id = a.question_id WHERE a.run_id = ? ORDER BY q.kind, q.id, a.attempt""",
        (run_id,)).fetchall()
    for a in rows:
        raw = _loads(a["raw"], {}) or {}
        mentions = [dict(m) for m in conn.execute(
            "SELECT store_name, store_key, is_ours, position, rank, tone, quote FROM mentions"
            " WHERE answer_id = ? ORDER BY position", (a["id"],))]
        out.append({
            "id": a["id"], "question": a["question"], "names_area": bool(a["names_area"]), "kind": a["kind"] or "core",
            "attempt": a["attempt"], "asked_at": a["asked_at"], "provider": a["provider"],
            "channel": a["channel"], "model": a["model"], "status": a["status"], "error": a["error"],
            "our_tone": a["our_tone"], "text": a["text"], "sources": _loads(a["sources"], []),
            "retries": raw.get("retries", []) if isinstance(raw, dict) else [],
            "used_search": bool(isinstance(raw, dict) and raw.get("used_search")),
            "mentions": mentions,
        })
    return out


def export_site(conn, out_dir: Path = DOCS_DIR) -> list[Path]:
    data_dir = out_dir / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)
    (data_dir / "runs").mkdir(parents=True)
    (out_dir / ".nojekyll").touch()
    written: list[Path] = []
    stores = []
    for store in conn.execute("SELECT * FROM stores ORDER BY name").fetchall():
        rows = conn.execute("SELECT * FROM daily_summary WHERE store_id = ? ORDER BY date, provider, channel",
                            (store["id"],)).fetchall()
        runs = conn.execute("SELECT * FROM runs WHERE store_id = ? ORDER BY started_at DESC",
                            (store["id"],)).fetchall()
        try:
            cfg = load_store_config(store["slug"])
        except FileNotFoundError:
            cfg = None
        topics = cfg.topics if cfg else ()
        run_items = [_run_json(conn, r, store["name"], topics) for r in runs]
        series = [_summary_json(r) for r in rows]
        by_scope: dict[tuple, list] = {}
        for s in series:
            by_scope.setdefault((s["provider"], s["channel"]), []).append(s)
        ranges = {f"{p}:{c}": mention_range(v) for (p, c), v in by_scope.items()}

        for run in runs:
            summary = next((s for s in series if s["run_id"] == run["id"]), None)
            prev = None
            if summary:
                earlier = [s for s in by_scope[(summary["provider"], summary["channel"])]
                           if s["date"] < summary["date"]]
                prev = earlier[-1] if earlier else None
            detail = {
                "store": {"slug": store["slug"], "name": store["name"]},
                "run": _run_json(conn, run, store["name"], topics),
                "summary": summary,
                "comparison": compare_days(summary, prev, store["name"]) if summary else [],
                "comparison_id": compare_days(summary, prev, store["name"], "id") if summary else [],
                "answers": _answers_json(conn, run["id"]),
            }
            path = data_dir / "runs" / f"{run['id']}.json"
            path.write_text(json.dumps(detail, indent=1))
            written.append(path)

        api_runs = [r for r in run_items if r["kind"] == "shift" and r["status"] == "ok"]
        totals = conn.execute(
            """SELECT COUNT(*) AS asked,
                      SUM(a.status != 'no_answer') AS answered,
                      SUM(a.extracted_at IS NOT NULL) AS read
               FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.store_id = ?""",
            (store["id"],)).fetchone()
        setup = None
        topic_rows: list[dict] = []
        if cfg:
            setup = {"ask_model": cfg.provider.ask_model, "work_model": cfg.provider.work_model,
                     "use_search": cfg.provider.use_search, "attempts_per_day": cfg.attempts_per_day,
                     "daily_count": cfg.daily_count, "daily_attempts": cfg.daily_attempts,
                     "questions": list(cfg.questions), "provider": cfg.provider.name,
                     "daily_mode": cfg.daily_mode, "weekdays": list(cfg.weekdays),
                     "explore_window_days": cfg.explore_window_days}
            if api_runs and cfg.topics:
                # Results per topic up to and including the latest shift, from the AI that shift asked.
                last = api_runs[0]
                scope = next(((x["provider"], x["channel"]) for x in series if x["run_id"] == last["id"]), (None, None))
                before = conn.execute("SELECT date(?, '+1 day')", (last["run_date"],)).fetchone()[0]
                for t in topic_stats(conn, store["id"], cfg.topics, before=before, days=cfg.explore_window_days,
                                     provider=scope[0], channel=scope[1]):
                    t["question_count"] = len(t.pop("questions"))
                    t["terms"] = list(next(x.terms for x in cfg.topics if x.name == t["topic"]))
                    topic_rows.append(t)
        stores.append({
            "slug": store["slug"], "name": store["name"], "domain": store["domain"], "setup": setup,
            "areas": _loads(store["areas"], []), "categories": _loads(store["categories"], []),
            "series": series, "ranges": ranges, "runs": run_items, "topics": topic_rows,
            "totals": {
                "days_on_duty": len({r["run_date"] for r in api_runs}),
                "first_day": min((r["run_date"] for r in api_runs), default=None),
                "questions_asked": totals["asked"] or 0,
                "answers_read": totals["read"] or 0,
                "quotes_verified": sum(r["quotes_verified"] for r in run_items),
                "shops_seen": conn.execute(
                    """SELECT COUNT(DISTINCT m.store_key) FROM mentions m JOIN answers a ON a.id = m.answer_id
                       JOIN runs r ON r.id = a.run_id WHERE r.store_id = ?""", (store["id"],)).fetchone()[0],
            },
        })
    weekdays = sorted({d for st in stores for d in ((st["setup"] or {}).get("weekdays") or [])},
                      key=lambda d: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].index(d))
    site = {"generated_at": utc_now(), "schedule": {**SCHEDULE, "weekdays": weekdays or None}, "agent": AGENT, "team": TEAM, "stores": stores}
    path = data_dir / "site.json"
    path.write_text(json.dumps(site, indent=1))
    written.append(path)
    last = next((r for r in conn.execute("SELECT * FROM runs ORDER BY started_at DESC") if is_shift(r["agent"])), None)
    live = {"status": "idle", "updated_at": utc_now(), "current": None, "progress": None, "steps": [],
            "last_run_id": last["id"] if last else None, "last_run_status": last["status"] if last else None,
            "last_finished_at": last["finished_at"] if last else None,
            "last_event": "Off shift. Waiting for the next one.",
            "last_event_id": "Sedang tidak bertugas. Menunggu shift berikutnya."}
    write_json(data_dir / "live.json", live)
    written.append(data_dir / "live.json")
    return written
