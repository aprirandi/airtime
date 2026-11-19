"""What the website reads from the Auditor: the latest audit of a store, and the history of its score."""

from __future__ import annotations

import json

from airtime.agents.auditor.registry import BY_ID, GROUPS, REGISTRY
from airtime.agents.auditor.score import gaps


def _loads(value, default):
    return json.loads(value) if value else default


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
            "details": _loads(r["details"], {}),
        })
    ordered_gaps = gaps([{"check_id": c["id"], "group": c["group"], "tier": c["tier"], "result": c["result"],
                          "percent": c["percent"], "scored": c["scored"]} for c in checks])
    history = [{"scanned_at": h["scanned_at"], "score": h["score"], "engine": h["engine"]} for h in conn.execute(
        "SELECT scanned_at, score, engine FROM audits WHERE store_id = ? ORDER BY scanned_at, id", (store_id,))]
    return {
        "id": latest["id"], "run_id": latest["run_id"], "scanned_at": latest["scanned_at"],
        "target": latest["target"], "platform": latest["platform"] or "", "engine": latest["engine"],
        "score": latest["score"], "label": latest["score_label"],
        "breakdown": _loads(latest["breakdown"], {}), "groups": _loads(latest["groups"], {}),
        "group_names": {str(k): {"en": v[0], "id": v[1]} for k, v in GROUPS.items()},
        "coverage": _loads(latest["coverage"], {}), "checks": checks,
        "gaps": [g["check_id"] for g in ordered_gaps], "history": history,
    }
