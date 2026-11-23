"""The Fixer: turns each gap the Auditor found into a fix the owner can follow.

Version 0 prepares and sorts; it does not change the website. For every gap it decides who has to move next:
- the owner, when the fix needs a decision or a fact only they have (the questions are listed);
- the Fixer, when it can prepare the change itself;
- the platform, when the platform controls the check and the owner cannot change it.
Nothing here publishes anything. Publishing needs the owner's approval and access to the website.

Steps (all CODE):
  1 read_audit   take the Auditor's list of gaps, most important first
  2 plan_fixes   decide the status of each fix and what the owner is asked
  3 save_fixes   store them for the dashboard
"""

from __future__ import annotations

import json

from airtime.agents.auditor.registry import BY_ID
from airtime.agents.auditor.score import gaps, limited_gaps
from airtime.agents.fixer.texts import CLIENT, QUESTIONS, STATUS_TEXT
from airtime.core.agent import Agent, RunContext, Step, StepKind
from airtime.providers.base import utc_now

TIER_ORDER = {"essential": 0, "recommended": 1, "bonus": 2}


def plan_fix(row: dict, platform: str, position: int) -> dict:
    """One fix from one gap row. Pure: the same row always gives the same fix."""
    cid = row["check_id"]
    title_en, title_id, why_en, why_id = CLIENT[cid]
    limited = bool(row.get("controlled_by"))
    questions = QUESTIONS.get(cid, [])
    if limited:
        status = "platform_held"
    elif questions:
        status = "needs_owner"
    else:
        status = "not_started"
    name = platform.capitalize() if platform else ""
    say_en, say_id = STATUS_TEXT[status]
    return {"check_id": cid, "position": position, "status": status, "tier": row["tier"],
            "title": title_en, "title_id": title_id, "why": why_en, "why_id": why_id,
            "summary": say_en.format(platform=name), "summary_id": say_id.format(platform=name),
            "questions": [{"en": en, "id": idn} for en, idn in questions] if status == "needs_owner" else []}


def plan_all(rows: list[dict], platform: str) -> list[dict]:
    """Fixes the owner can act on come first, then the ones the platform holds back."""
    ordered = gaps(rows) + limited_gaps(rows)
    return [plan_fix(r, platform, i) for i, r in enumerate(ordered, 1)]


class FixerAgent(Agent):
    name = "fixer"
    title = "Fixer"

    def steps(self) -> list[Step]:
        return [Step(1, "read_audit", StepKind.CODE, self._read),
                Step(2, "plan_fixes", StepKind.CODE, self._plan),
                Step(3, "save_fixes", StepKind.CODE, self._save)]

    def _read(self, ctx: RunContext) -> dict:
        rows = ctx.data["_rows"]
        ctx.data["_fix_rows"] = rows
        return {"gaps": len(gaps(rows)), "held_back": len(limited_gaps(rows)),
                "platform": ctx.store.platform or "unknown"}

    def _plan(self, ctx: RunContext) -> dict:
        fixes = plan_all(ctx.data["_fix_rows"], ctx.store.platform)
        ctx.data["_fixes"] = fixes
        count = lambda s: sum(f["status"] == s for f in fixes)  # noqa: E731
        return {"fixes": len(fixes), "needs_owner": count("needs_owner"), "not_started": count("not_started"),
                "platform_held": count("platform_held"), "draft_ready": count("draft_ready")}

    def _save(self, ctx: RunContext) -> dict:
        audit_id = ctx.data["_audit_id"]
        for f in ctx.data["_fixes"]:
            ctx.conn.execute(
                """INSERT INTO fixes (audit_id, check_id, position, status, tier, title, title_id, why, why_id,
                                      summary, summary_id, questions, draft, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)""",
                (audit_id, f["check_id"], f["position"], f["status"], f["tier"], f["title"], f["title_id"], f["why"],
                 f["why_id"], f["summary"], f["summary_id"], json.dumps(f["questions"], ensure_ascii=False), utc_now()))
        ctx.conn.commit()
        return {"saved": len(ctx.data["_fixes"]), "audit_id": audit_id}
