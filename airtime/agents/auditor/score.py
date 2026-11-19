"""Step 3 of the Auditor: turn check results into a score.

The structure follows Is Agentic's: essential checks are worth up to 80 points, recommended up to 20,
and bonus checks add up to 5 more without ever lowering the score. A partial check earns its
percentage. Checks that do not apply, are planned, or that the platform controls (so the owner cannot
fix them) are left out. Group scores need no weights: each is the share of points earned within the group.

These weights are provisional. They are meant to be tuned once Handworks has before-and-after data
from the Asker (plans/auditor.md), so the numbers here are for ordering gaps, not for claims.
"""

from __future__ import annotations

from airtime.agents.auditor.registry import TIERS

POOLS = {"essential": 80.0, "recommended": 20.0}
BONUS_CAP = 5.0
STRONG, NEEDS_WORK = 80, 60
SCORED_RESULTS = ("pass", "partial", "fail")


def fraction(row: dict) -> float:
    if row["result"] == "pass":
        return 1.0
    return row["percent"] / 100 if row["result"] == "partial" else 0.0


def _scored(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["scored"] and r["result"] in SCORED_RESULTS]


def label_for(score: float | None) -> str:
    if score is None:
        return "none"
    return "strong" if score >= STRONG else "needs_work" if score >= NEEDS_WORK else "blockers"


def score_rows(rows: list[dict]) -> dict:
    scored = _scored(rows)
    tiers: dict[str, dict] = {}
    base_earned = base_available = 0.0
    for tier in TIERS:
        mine = [r for r in scored if r["tier"] == tier]
        total = len(mine)
        frac = sum(fraction(r) for r in mine)
        entry = {"total": total, "passing": sum(r["result"] == "pass" for r in mine),
                 "partial": sum(r["result"] == "partial" for r in mine),
                 "failed": sum(r["result"] == "fail" for r in mine)}
        if tier == "bonus":
            entry["points"] = round(BONUS_CAP * frac / total, 1) if total else 0.0
            entry["positive"] = entry["passing"] + entry["partial"]
        else:
            entry["available"] = POOLS[tier] if total else 0.0
            entry["earned"] = round(POOLS[tier] * frac / total, 1) if total else 0.0
            base_earned += POOLS[tier] * frac / total if total else 0.0
            base_available += POOLS[tier] if total else 0.0
        tiers[tier] = entry
    score = None
    if base_available:
        score = round(min(100.0, 100 * base_earned / base_available + tiers["bonus"]["points"]), 1)

    groups: dict[str, dict] = {}
    for g in (1, 2, 3):
        in_group = [r for r in rows if r["group"] == g]
        mine = [r for r in scored if r["group"] == g]
        groups[str(g)] = {
            "percent": round(100 * sum(fraction(r) for r in mine) / len(mine)) if mine else None,
            "scored": len(mine), "passing": sum(r["result"] == "pass" for r in mine),
            "partial": sum(r["result"] == "partial" for r in mine),
            "failed": sum(r["result"] == "fail" for r in mine),
            "platform_controlled": sum(1 for r in in_group if r["controlled_by"] and r["result"] in SCORED_RESULTS),
            "planned": sum(r["result"] == "planned" for r in in_group),
        }
    return {"score": score, "label": label_for(score), "tiers": tiers, "groups": groups}


def gaps(rows: list[dict]) -> list[dict]:
    """The gaps the owner can act on, most important first: essential before recommended before bonus."""
    order = {t: i for i, t in enumerate(TIERS)}
    found = [r for r in _scored(rows) if r["result"] in ("fail", "partial")]
    return sorted(found, key=lambda r: (order[r["tier"]], r["group"], r["percent"], r["check_id"]))


def coverage(rows: list[dict]) -> dict:
    return {"implemented": sum(r["result"] in (*SCORED_RESULTS, "na") and r["group"] != 4 for r in rows),
            "planned": [r["check_id"] for r in rows if r["result"] == "planned"],
            "not_applicable": [r["check_id"] for r in rows if r["group"] == 4],
            "platform_controlled": [r["check_id"] for r in rows if r["controlled_by"]]}
