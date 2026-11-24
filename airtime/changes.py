"""Before and after: what the Asker saw before a fix went live, and what it sees after.

Version 0 has no write access to the store (the owner or a developer applies the fix), so the owner tells us the
day it went live. At that moment we keep the "before" so it cannot be reconstructed later to flatter the result.
The "after" is read from the Asker's shifts that came after that day.

Fair comparison: only the core questions are used, because they are the same every day (the daily questions change).
Shifts where the AI gave no usable answer count for nothing. Nothing here says a fix caused a change: AI answers move
from day to day, so the result is a range of shifts, never one day, and a verdict only after enough shifts.
"""

from __future__ import annotations

import json
from datetime import date as Date

from airtime.providers.base import utc_now

SCOPE = ("gemini", "api")        # the Asker's daily source, the one the dashboard trends
WINDOW = 7                       # shifts kept as "before"
MIN_AFTER = 5                    # shifts with answers needed after the change before the result is shown as a result


def _shifts(conn, store_id: int, *, before: str | None = None, after: str | None = None) -> list[dict]:
    """Shifts that have core answers, oldest first, for one day boundary."""
    sql = ("SELECT date, core_mentions, core_answers FROM daily_summary WHERE store_id = ? AND provider = ? "
           "AND channel = ? AND core_answers > 0")
    args: list = [store_id, *SCOPE]
    if before:
        sql += " AND date < ?"
        args.append(before)
    if after:
        sql += " AND date > ?"
        args.append(after)
    return [dict(r) for r in conn.execute(sql + " ORDER BY date", args)]


def _tally(rows: list[dict]) -> dict:
    mentions = sum(r["core_mentions"] for r in rows)
    answers = sum(r["core_answers"] for r in rows)
    return {"shifts": len(rows), "mentions": mentions, "answers": answers,
            "pct": round(100 * mentions / answers, 1) if answers else None,
            "from": rows[0]["date"] if rows else None, "to": rows[-1]["date"] if rows else None}


def before_snapshot(conn, store_id: int, applied_on: str) -> dict:
    audit = conn.execute("SELECT id, scanned_at, score FROM audits WHERE store_id = ? AND substr(scanned_at, 1, 10) <= ? "
                         "ORDER BY scanned_at DESC, id DESC LIMIT 1", (store_id, applied_on)).fetchone()
    return {"asker": _tally(_shifts(conn, store_id, before=applied_on)[-WINDOW:]),
            "audit": {"audit_id": audit["id"], "scanned_at": audit["scanned_at"], "score": audit["score"]} if audit else None}


def record_change(conn, store_id: int, check_id: str, applied_on: str, note: str = "", today: str | None = None) -> dict:
    from airtime.agents.auditor.registry import BY_ID
    if check_id not in BY_ID:
        raise ValueError(f"unknown check: {check_id}")
    when = Date.fromisoformat(applied_on).isoformat()
    if today and when > today:
        raise ValueError(f"{when} is in the future: record a change after it went live")
    before = before_snapshot(conn, store_id, when)
    conn.execute("""INSERT INTO changes (store_id, check_id, applied_on, note, before, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (store_id, check_id, applied_on) DO NOTHING""",
                 (store_id, check_id, when, note.strip()[:300], json.dumps(before), utc_now()))
    conn.commit()
    return before


def compare_change(conn, change) -> dict:
    """The change with its stored "before", the "after" so far, and whether there is enough to call it a result."""
    before = json.loads(change["before"])
    after = _tally(_shifts(conn, change["store_id"], after=change["applied_on"]))
    audit_after = conn.execute("SELECT scanned_at, score FROM audits WHERE store_id = ? AND substr(scanned_at, 1, 10) > ? "
                               "ORDER BY scanned_at, id LIMIT 1", (change["store_id"], change["applied_on"])).fetchone()
    enough = after["shifts"] >= MIN_AFTER
    result = None
    if enough and before["asker"]["pct"] is not None and after["pct"] is not None:
        diff = round(after["pct"] - before["asker"]["pct"], 1)
        result = "up" if diff > 0 else "down" if diff < 0 else "same"
    return {"check_id": change["check_id"], "applied_on": change["applied_on"], "note": change["note"],
            "before": before["asker"], "score_before": (before["audit"] or {}).get("score"),
            "after": after, "score_after": audit_after["score"] if audit_after else None,
            "needed": MIN_AFTER, "enough": enough, "result": result}


def changes_json(conn, store_id: int) -> list[dict]:
    from airtime.agents.fixer.texts import CLIENT
    out = []
    for c in conn.execute("SELECT * FROM changes WHERE store_id = ? ORDER BY applied_on DESC, id DESC", (store_id,)):
        item = compare_change(conn, c)
        title = CLIENT.get(c["check_id"])
        item["title"], item["title_id"] = (title[0], title[1]) if title else (c["check_id"], c["check_id"])
        out.append(item)
    return out
