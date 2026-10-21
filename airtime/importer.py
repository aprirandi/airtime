"""Import answers pasted by hand from consumer apps (ChatGPT, Claude, Gemini app).

Accepted files: CSV with a header row, or JSON (a list of objects). Fields:
  question   required, the question exactly as asked
  provider   required, e.g. chatgpt | claude | gemini
  text       the full answer as pasted; leave empty if the app gave no answer
  asked_at   required, ISO date or datetime (YYYY-MM-DD[THH:MM])
  attempt    optional, default 1
  channel    optional, default app_pasted
  sources    optional, URLs separated by spaces
Imported answers go through steps 4-7 exactly like API answers.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

from airtime.agents.visibility.agent import ImportedAnswersAgent
from airtime.agents.visibility.questions import names_area
from airtime.core.agent import RunContext, RunFailed
from airtime.db import find_or_add_question
from airtime.providers.base import utc_now

REQUIRED = ("question", "provider", "asked_at")


def read_rows(path: Path) -> list[dict]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text())
        if not isinstance(data, list):
            raise RunFailed("JSON import must be a list of objects")
        return [dict(r) for r in data]
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def clean_rows(rows: list[dict]) -> list[dict]:
    """Validate and normalise rows. Fails loudly on any bad row rather than skipping it."""
    out, problems = [], []
    for i, r in enumerate(rows, 1):
        missing = [k for k in REQUIRED if not str(r.get(k) or "").strip()]
        if missing:
            problems.append(f"row {i}: missing {missing}")
            continue
        try:
            attempt = int(r.get("attempt") or 1)
        except ValueError:
            problems.append(f"row {i}: attempt is not a number")
            continue
        sources = r.get("sources") or []
        if isinstance(sources, str):
            sources = sources.split()
        out.append({
            "question": str(r["question"]).strip(),
            "provider": str(r["provider"]).strip().lower(),
            "channel": str(r.get("channel") or "app_pasted").strip(),
            "asked_at": str(r["asked_at"]).strip(),
            "date": str(r["asked_at"]).strip()[:10],
            "attempt": attempt,
            "text": str(r.get("text") or "").strip(),
            "sources": sources,
        })
    if problems:
        raise RunFailed("import file has bad rows: " + "; ".join(problems))
    return out


def group_rows(rows: list[dict]) -> dict[tuple[str, str, str], list[dict]]:
    """One run per (provider, channel, date), so each is counted and compared on its own."""
    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["provider"], r["channel"], r["date"])].append(r)
    return dict(groups)


def make_loader(rows: list[dict]):
    def load(ctx: RunContext) -> dict:
        now = utc_now()
        for r in rows:
            qid = find_or_add_question(ctx.conn, ctx.store_id, r["question"],
                                       names_area(r["question"], ctx.store.areas), now, "import")
            ctx.conn.execute(
                """INSERT INTO answers (run_id, question_id, provider, channel, model, attempt,
                       asked_at, text, sources, raw, status, error)
                   VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)""",
                (ctx.run_id, qid, r["provider"], r["channel"], r["attempt"], r["asked_at"],
                 r["text"], json.dumps(r["sources"]), json.dumps({"imported": r}),
                 "ok" if r["text"] else "no_answer", None if r["text"] else "empty answer"),
            )
        ctx.conn.commit()
        return {"imported": len(rows), "empty": sum(not r["text"] for r in rows)}
    return load


def import_file(path: Path, make_ctx) -> list[RunContext]:
    """`make_ctx(run_date)` returns a fresh RunContext (with a work provider for steps 4 and 7)."""
    rows = clean_rows(read_rows(path))
    done = []
    for (provider, channel, date), group in sorted(group_rows(rows).items()):
        ctx = make_ctx(date)
        ImportedAnswersAgent(make_loader(group), provider, channel).run(ctx)
        done.append(ctx)
    return done


def seed_baseline(conn, store_id: int, path: Path) -> None:
    """Store a manual baseline that exists only as totals (no per-answer texts)."""
    b = json.loads(path.read_text())
    s = b["summary"]
    conn.execute(
        """INSERT INTO daily_summary (store_id, date, provider, channel, run_id, asked, no_answer,
               needs_review, our_mentions, total_answers, top_competitor, top_competitor_mentions,
               area_mentions, area_answers, area_rate, no_area_mentions, no_area_answers,
               no_area_rate, web_search_answers, competitors, our_answer_ids, text, text_source, note)
           VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?, 'manual', ?)
           ON CONFLICT (store_id, date, provider, channel) DO NOTHING""",
        (store_id, b["date"], b["provider"], b["channel"], s["asked"], s["no_answer"],
         s["our_mentions"], s["total_answers"], s["top_competitor"], s["top_competitor_mentions"],
         s["area_mentions"], s["area_answers"], s["area_mentions"] / s["area_answers"],
         s["no_area_mentions"], s["no_area_answers"], s["no_area_mentions"] / s["no_area_answers"],
         json.dumps([{"name": s["top_competitor"], "mentions": s["top_competitor_mentions"]}]),
         b["text"], b["note"]),
    )
    conn.commit()
