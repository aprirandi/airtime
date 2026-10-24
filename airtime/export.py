"""Export everything the web report needs as JSON in docs/data/.

The web app (web/, built into docs/) only reads these files. Every number in it comes from
here, and every per-day file lists the stored answers and verified quotes behind its counts.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from airtime.agents.visibility.compare import compare_days, mention_range, scope_label
from airtime.config import REPO_ROOT
from airtime.providers.base import utc_now

DOCS_DIR = REPO_ROOT / "docs"
SCHEDULE = {"cron": "17 20 * * *", "utc_hour": 20, "utc_minute": 17}  # keep in sync with daily.yml

AGENT = {
    "name": "Visibility Agent",
    "role": "Every morning I ask AI assistants the questions your buyers ask, note which shops "
            "they recommend, and check every quote before I count it.",
}


def _loads(value, default):
    return json.loads(value) if value else default


def _n(count, word: str, plural: str | None = None) -> str:
    return f"{count} {word if count == 1 else (plural or word + 's')}"


def describe_step(step: dict, store_name: str) -> str:
    """One plain sentence about what a step did, from its stored result."""
    text = _describe(step, store_name)
    return ("Re-check: " + text[0].lower() + text[1:]) if step["name"].startswith("recheck_") else text


def _describe(step: dict, store_name: str) -> str:
    r = step.get("result") or {}
    name = step["name"].removeprefix("recheck_")
    if step.get("status") == "failed":
        return f"Stopped here: {step.get('error', 'unknown error')}"
    if name == "write_questions":
        if r.get("action") == "reused":
            return f"Used the same {r.get('count')} buyer questions as before."
        return f"Wrote {r.get('count')} buyer questions ({r.get('source')})."
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


def _run_json(conn, run, store_name: str) -> dict:
    steps = _loads(run["steps"], [])
    for s in steps:
        s["description"] = describe_step(s, store_name)
    quotes = conn.execute(
        "SELECT COUNT(*) FROM mentions m JOIN answers a ON a.id = m.answer_id WHERE a.run_id = ?",
        (run["id"],)).fetchone()[0]
    return {"id": run["id"], "agent": run["agent"], "run_date": run["run_date"],
            "started_at": run["started_at"], "finished_at": run["finished_at"],
            "status": run["status"], "error": run["error"], "steps": steps,
            "quotes_verified": quotes}


def _summary_json(row) -> dict:
    d = dict(row)
    d["label"] = scope_label(d["provider"], d["channel"])
    d["competitors"] = _loads(d["competitors"], [])
    d["our_answer_ids"] = _loads(d["our_answer_ids"], [])
    return d


def _answers_json(conn, run_id: int) -> list[dict]:
    out = []
    rows = conn.execute(
        """SELECT a.*, q.text AS question, q.names_area FROM answers a
           JOIN questions q ON q.id = a.question_id WHERE a.run_id = ? ORDER BY q.id, a.attempt""",
        (run_id,)).fetchall()
    for a in rows:
        raw = _loads(a["raw"], {}) or {}
        mentions = [dict(m) for m in conn.execute(
            "SELECT store_name, store_key, is_ours, position, rank, tone, quote FROM mentions"
            " WHERE answer_id = ? ORDER BY position", (a["id"],))]
        out.append({
            "id": a["id"], "question": a["question"], "names_area": bool(a["names_area"]),
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
        run_items = [_run_json(conn, r, store["name"]) for r in runs]
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
                "run": _run_json(conn, run, store["name"]),
                "summary": summary,
                "comparison": compare_days(summary, prev, store["name"]) if summary else [],
                "answers": _answers_json(conn, run["id"]),
            }
            path = data_dir / "runs" / f"{run['id']}.json"
            path.write_text(json.dumps(detail, indent=1))
            written.append(path)

        api_runs = [r for r in run_items if r["agent"] == "visibility" and r["status"] == "ok"]
        totals = conn.execute(
            """SELECT COUNT(*) AS asked,
                      SUM(a.status != 'no_answer') AS answered,
                      SUM(a.extracted_at IS NOT NULL) AS read
               FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.store_id = ?""",
            (store["id"],)).fetchone()
        stores.append({
            "slug": store["slug"], "name": store["name"], "domain": store["domain"],
            "areas": _loads(store["areas"], []), "categories": _loads(store["categories"], []),
            "series": series, "ranges": ranges, "runs": run_items,
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
    site = {"generated_at": utc_now(), "schedule": SCHEDULE, "agent": AGENT, "stores": stores}
    path = data_dir / "site.json"
    path.write_text(json.dumps(site, indent=1))
    written.append(path)
    return written
