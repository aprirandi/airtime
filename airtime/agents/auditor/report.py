"""What the website reads from the Auditor: the latest audit of a store, and the history of its score."""

from __future__ import annotations

import json

from airtime.agents.auditor.prompts import all_prompt, fix_prompt
from airtime.agents.auditor.isagentic import MAPPED
from airtime.agents.auditor.registry import BY_ID, GROUPS, REGISTRY
from airtime.agents.auditor.score import gaps, limited_gaps


def _loads(value, default):
    return json.loads(value) if value else default


_OURS_TO_THEIRS = {ours: theirs for theirs, ours in MAPPED.items()}


def _external_json(conn, audit_id: int, checks: list[dict]) -> dict | None:
    """Is Agentic's report beside ours. Their score is their own number and is never mixed into ours."""
    r = conn.execute("SELECT * FROM external_reports WHERE audit_id = ? AND source = 'is-agentic'", (audit_id,)).fetchone()
    if r is None:
        return None
    issues = _loads(r["issues"], [])
    out = {"source": "is-agentic", "status": r["status"], "error": r["error"], "fetched_at": r["fetched_at"],
           "report_url": r["report_url"], "score": r["score"], "label": r["score_label"],
           "scanned_at": r["scanned_at"], "eligible_checks": r["eligible_checks"],
           "breakdown": _loads(r["breakdown"], {}), "issues": issues, "agreement": None}
    if r["status"] != "ok":
        return out
    listed = {i["maps_to"]: i for i in issues if i["maps_to"]}
    compared = agree = 0
    for c in checks:
        theirs = _OURS_TO_THEIRS.get(c["id"])
        if theirs is None or c["result"] in ("na", "planned"):
            continue
        issue = listed.get(c["id"])
        if c["tier"] == "bonus" and issue is None:
            continue   # their report never lists a bonus check that was missed, so silence says nothing
        c["external"] = {"id": theirs, "result": issue["result"] if issue else "not_listed",
                         "details": issue["details"] if issue else ""}
        ours_bad = c["result"] in ("fail", "partial")
        compared += 1
        agree += ours_bad == bool(issue)
    out["agreement"] = {"compared": compared, "agree": agree}
    return out


def fixes_json(conn, audit_id: int) -> list[dict]:
    """What the owner sees about each fix. The prepared change itself (`draft`) is never exported."""
    return [{"check_id": f["check_id"], "position": f["position"], "status": f["status"], "tier": f["tier"],
             "title": f["title"], "title_id": f["title_id"], "why": f["why"], "why_id": f["why_id"],
             "summary": f["summary"], "summary_id": f["summary_id"], "questions": _loads(f["questions"], [])}
            for f in conn.execute("SELECT * FROM fixes WHERE audit_id = ? ORDER BY position", (audit_id,))]


def audit_json(conn, store_id: int) -> dict | None:
    latest = conn.execute("SELECT * FROM audits WHERE store_id = ? ORDER BY scanned_at DESC, id DESC LIMIT 1",
                          (store_id,)).fetchone()
    if latest is None:
        return None
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM audit_checks WHERE audit_id = ? ORDER BY id", (latest["id"],))]
    order = {d.id: i for i, d in enumerate(REGISTRY)}
    rows.sort(key=lambda r: order.get(r["check_id"], 999))
    checks = []
    for r in rows:
        d = BY_ID.get(r["check_id"])
        if d is None:   # a check removed from the registry since this audit
            continue
        platform = latest["platform"] or ""
        controlled = d.platform_controlled.get(r["controlled_by"]) if r["controlled_by"] else None
        hint = d.platform_fix.get(platform)
        checks.append({
            "id": r["check_id"], "group": r["grp"], "tier": r["tier"], "source": r["source"],
            "result": r["result"], "percent": r["percent"], "scored": bool(r["scored"]),
            "name": d.name, "name_id": d.name_id, "evidence": r["evidence"],
            "fix": d.fix, "fix_id": d.fix_id,
            "platform_fix": hint[0] if hint else "", "platform_fix_id": hint[1] if hint else "",
            "controlled_by": r["controlled_by"],
            "controlled_note": controlled[0] if controlled else "", "controlled_note_id": controlled[1] if controlled else "",
            "details": _loads(r["details"], {}), "prompt": "", "prompt_id": "", "external": None,
        })
    as_rows = [{"check_id": c["id"], "group": c["group"], "tier": c["tier"], "result": c["result"],
                "percent": c["percent"], "scored": c["scored"], "controlled_by": c["controlled_by"]} for c in checks]
    ordered_gaps, limited = gaps(as_rows), limited_gaps(as_rows)
    by_id = {c["id"]: c for c in checks}
    gap_rows = [{"check_id": g["check_id"], "tier": g["tier"], "evidence": by_id[g["check_id"]]["evidence"],
                 "details": by_id[g["check_id"]]["details"]} for g in ordered_gaps]
    site, platform = latest["target"], latest["platform"] or ""
    for g in gap_rows:   # a prompt only for gaps the owner can act on
        for lang, key in (("en", "prompt"), ("id", "prompt_id")):
            by_id[g["check_id"]][key] = fix_prompt(g["check_id"], g, site, platform, lang)
    scanned = latest["scanned_at"][:10]
    history = [{"scanned_at": h["scanned_at"], "score": h["score"], "engine": h["engine"]} for h in conn.execute(
        "SELECT scanned_at, score, engine FROM audits WHERE store_id = ? ORDER BY scanned_at, id", (store_id,))]
    external = _external_json(conn, latest["id"], checks)
    return {
        "id": latest["id"], "run_id": latest["run_id"], "scanned_at": latest["scanned_at"],
        "target": latest["target"], "platform": latest["platform"] or "", "engine": latest["engine"],
        "score": latest["score"], "label": latest["score_label"],
        "breakdown": _loads(latest["breakdown"], {}), "groups": _loads(latest["groups"], {}),
        "group_names": {str(k): {"en": v[0], "id": v[1]} for k, v in GROUPS.items()},
        "coverage": _loads(latest["coverage"], {}), "checks": checks,
        "gaps": [g["check_id"] for g in ordered_gaps], "limited_gaps": [g["check_id"] for g in limited],
        "history": history,
        "prompt_all": all_prompt(gap_rows, site, platform, "en", scanned),
        "prompt_all_id": all_prompt(gap_rows, site, platform, "id", scanned), "external": external,
        "fixes": fixes_json(conn, latest["id"]),
    }


def registry_json() -> dict:
    """The whole check registry for the website's Checks page. Same for every store: the page picks the store's platform."""
    checks = []
    for d in REGISTRY:
        checks.append({
            "id": d.id, "group": d.group, "tier": d.tier, "source": d.source,
            "status": "built" if d.run else ("na" if d.group == 4 else "planned"),
            "name": d.name, "name_id": d.name_id, "fix": d.fix, "fix_id": d.fix_id,
            "na_reason": d.na_reason[0] if d.na_reason else "", "na_reason_id": d.na_reason[1] if d.na_reason else "",
            "controlled": {p: {"en": v[0], "id": v[1]} for p, v in d.platform_controlled.items()},
            "platform_fix": {p: {"en": v[0], "id": v[1]} for p, v in d.platform_fix.items()},
            "verify": {"command": d.verify[0], "en": d.verify[1], "id": d.verify[2]} if d.verify else None,
            "external_id": _OURS_TO_THEIRS.get(d.id, ""),
            "ask": {"en": d.ask[0], "id": d.ask[1]} if d.ask else None,
        })
    return {"groups": {str(k): {"en": v[0], "id": v[1]} for k, v in GROUPS.items()}, "checks": checks}
