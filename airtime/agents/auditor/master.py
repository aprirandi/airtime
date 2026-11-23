"""Master check after the Auditor (CODE): every check has a stored result, and the stored score is right."""

from __future__ import annotations

import json

from airtime.agents.auditor.registry import REGISTRY
from airtime.core.agent import MasterCheck, RunContext


def audit_complete(ctx: RunContext) -> tuple[list[str], dict]:
    from airtime.agents.auditor.score import score_rows  # local import: score needs the registry too

    audit = ctx.conn.execute("SELECT * FROM audits WHERE run_id = ?", (ctx.run_id,)).fetchone()
    if audit is None:
        return ["no audit was stored"], {"checks": 0}
    stored = ctx.conn.execute("SELECT * FROM audit_checks WHERE audit_id = ?", (audit["id"],)).fetchall()
    problems: list[str] = []
    ids = {r["check_id"] for r in stored}
    missing = [d.id for d in REGISTRY if d.id not in ids]
    if missing:
        problems.append(f"{len(missing)} checks have no stored result: {', '.join(missing[:5])}")
    crashed = [r["check_id"] for r in stored if json.loads(r["details"] or "{}").get("error")]
    if crashed:
        problems.append(f"{len(crashed)} checks could not run: {', '.join(crashed[:5])}")
    blank = [r["check_id"] for r in stored
             if r["scored"] and r["result"] in ("fail", "partial") and not (r["evidence"] or "").strip()]
    if blank:
        problems.append(f"{len(blank)} failed checks have no evidence: {', '.join(blank[:5])}")
    rows = [{"group": r["grp"], "tier": r["tier"], "result": r["result"], "percent": r["percent"],
             "scored": bool(r["scored"]), "controlled_by": r["controlled_by"], "check_id": r["check_id"]}
            for r in stored]
    expected = score_rows(rows)["score"]
    if expected != audit["score"]:
        problems.append(f"stored score {audit['score']} but the stored checks give {expected}")
    if "external_scan" in ctx.data:   # the second opinion ran, so its result (or why it failed) must be stored
        ext = ctx.conn.execute("SELECT status, error FROM external_reports WHERE audit_id = ?", (audit["id"],)).fetchone()
        if ext is None:
            problems.append("the Is Agentic step ran but nothing was stored")
        elif ext["status"] != "ok" and not ext["error"]:
            problems.append("the Is Agentic report is unavailable and no reason was stored")
    return problems, {"checks": len(stored), "score": audit["score"]}


AUDIT_CHECKS = [MasterCheck(after="auditor", name="audit_complete", fn=audit_complete)]
