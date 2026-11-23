"""Master check after the Fixer (CODE): every gap has one fix, and each fix says who moves next."""

from __future__ import annotations

import json

from airtime.agents.fixer.texts import STATUSES
from airtime.core.agent import MasterCheck, RunContext


def fixes_complete(ctx: RunContext) -> tuple[list[str], dict]:
    from airtime.agents.auditor.score import gaps, limited_gaps  # local import: the auditor imports this package

    audit_id = ctx.data.get("_audit_id")
    stored = ctx.conn.execute("SELECT * FROM fixes WHERE audit_id = ? ORDER BY position", (audit_id,)).fetchall()
    rows = ctx.data["_rows"]
    expected = [r["check_id"] for r in gaps(rows) + limited_gaps(rows)]
    problems: list[str] = []
    have = [f["check_id"] for f in stored]
    if have != expected:
        problems.append(f"the fixes {have} do not match the gaps {expected}")
    bad = [f["check_id"] for f in stored if f["status"] not in STATUSES]
    if bad:
        problems.append(f"unknown status on: {', '.join(bad)}")
    silent = [f["check_id"] for f in stored if f["status"] == "needs_owner" and not json.loads(f["questions"] or "[]")]
    if silent:
        problems.append(f"waiting on the owner with no question: {', '.join(silent)}")
    for f in stored:
        if f["status"] == "draft_ready":
            draft = json.loads(f["draft"] or "null")
            if not draft or not draft.get("confirm"):
                problems.append(f"draft ready with nothing to confirm: {f['check_id']}")
    return problems, {"fixes": len(stored)}


FIX_CHECKS = [MasterCheck(after="fixer", name="fixes_complete", fn=fixes_complete)]
