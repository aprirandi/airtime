"""Master checks (CODE) at each hand-off. A failed check stops the shift loudly."""

from __future__ import annotations

from airtime.agents.visibility.ask import tries_for
from airtime.agents.visibility.verify import count_answers, load_facts, quote_in_text
from airtime.core.agent import MasterCheck, RunContext

SUMMARY_FIELDS = ("asked", "no_answer", "needs_review", "our_mentions", "total_answers",
                  "top_competitor_mentions", "area_mentions", "area_answers",
                  "no_area_mentions", "no_area_answers")


def answers_complete(ctx: RunContext) -> tuple[list[str], dict]:
    """Asker -> Analyst: every planned ask has a stored answer row, for every question."""
    questions = ctx.data.get("_questions") or []
    planned = sum(tries_for(q, ctx.store) for q in questions) if questions else None
    rows = ctx.conn.execute(
        "SELECT question_id, status FROM answers WHERE run_id = ?", (ctx.run_id,)).fetchall()
    problems = []
    if planned is not None and len(rows) != planned:
        problems.append(f"{len(rows)} answers stored but {planned} asks were planned")
    missing = {q["id"] for q in questions} - {r["question_id"] for r in rows}
    if missing:
        problems.append(f"{len(missing)} questions have no stored answer")
    bad = [r for r in rows if r["status"] not in ("ok", "no_answer")]
    if bad:
        problems.append(f"{len(bad)} answers have an unexpected status")
    facts = {"recorded": len(rows), "planned": planned if planned is not None else len(rows),
             "questions": len({r["question_id"] for r in rows}),
             "answered": sum(r["status"] == "ok" for r in rows),
             "no_answer": sum(r["status"] == "no_answer" for r in rows)}
    return problems, facts


def numbers_match(ctx: RunContext) -> tuple[list[str], dict]:
    """Analyst -> owner/next agents: stored counts match the answers, every quote is still verbatim."""
    problems = []
    row = ctx.conn.execute("SELECT * FROM daily_summary WHERE run_id = ?", (ctx.run_id,)).fetchone()
    if row is None:
        return ["no daily counts were stored"], {"quotes_checked": 0}
    counts = count_answers(load_facts(ctx.conn, ctx.run_id))
    for field in SUMMARY_FIELDS:
        if getattr(counts, field) != row[field]:
            problems.append(f"{field}: stored {row[field]}, answers give {getattr(counts, field)}")
    quotes = ctx.conn.execute(
        """SELECT m.quote, a.text FROM mentions m JOIN answers a ON a.id = m.answer_id
           WHERE a.run_id = ?""", (ctx.run_id,)).fetchall()
    broken = sum(not quote_in_text(q["quote"], q["text"]) for q in quotes)
    if broken:
        problems.append(f"{broken} stored quotes are not verbatim in their answer")
    return problems, {"quotes_checked": len(quotes), "fields_checked": len(SUMMARY_FIELDS),
                      "our_mentions": row["our_mentions"], "total_answers": row["total_answers"]}


CHECKS = [
    MasterCheck(after="asker", name="answers_complete", fn=answers_complete),
    MasterCheck(after="analyst", name="numbers_match", fn=numbers_match),
]
IMPORT_CHECKS = [
    MasterCheck(after="import", name="answers_complete", fn=answers_complete),
    MasterCheck(after="analyst", name="numbers_match", fn=numbers_match),
]
