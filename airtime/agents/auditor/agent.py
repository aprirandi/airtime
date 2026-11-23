"""The Auditor agent: reads a store's own website and reports how ready it is for AI agents.

Steps (all CODE; no AI is used yet, the fix texts are written in advance for each check):
  1 fetch_pages   request the pages the checks need
  2 run_checks    apply every check's rule to what was fetched
  3 score_audit   turn the results into a score (essential, recommended, bonus) and group scores
  4 list_gaps     list what the owner can fix, most important first
  5 save_audit    store the audit and every check result with its evidence
  6 external_scan (only when the store turns it on) read Is Agentic's report as a second opinion
The Master then checks that every check has a stored result and that the stored score is right.
"""

from __future__ import annotations

import json

from airtime.agents.auditor import snapshot as snap_mod
from airtime.agents.auditor.checks import Outcome
from airtime.agents.auditor.http import Fetcher
from airtime.agents.auditor.isagentic import ExternalError, IsAgenticClient
from airtime.agents.auditor.master import AUDIT_CHECKS
from airtime.agents.auditor.registry import REGISTRY, CheckDef
from airtime.agents.auditor.score import coverage, gaps, limited_gaps, score_rows
from airtime.core.agent import Agent, Flow, RunContext, RunFailed, Step, StepKind
from airtime.providers.base import utc_now

ENGINE = "airtime-auditor/2"   # 2: checks a platform controls now count in the score (scores of /1 and /2 are not comparable)


def build_row(d: CheckDef, outcome: Outcome | None, platform: str) -> dict:
    """One stored result. A platform-controlled check is scored like any other; `controlled_by` marks that the owner cannot fix it."""
    if d.group == 4:
        return _row(d, "na", 0, d.na_reason[0] if d.na_reason else "", {}, "", False)
    if d.run is None:
        return _row(d, "planned", 0, "", {}, "", False)
    controlled = platform if platform in d.platform_controlled else ""
    scored = outcome.result != "na"
    return _row(d, outcome.result, outcome.percent, outcome.evidence, outcome.details, controlled, scored)


def _row(d: CheckDef, result: str, percent: int, evidence: str, details: dict, controlled: str, scored: bool) -> dict:
    return {"check_id": d.id, "group": d.group, "tier": d.tier, "source": d.source, "result": result,
            "percent": percent, "scored": scored, "controlled_by": controlled, "evidence": evidence,
            "details": details}


def run_one(d: CheckDef, snapshot) -> Outcome:
    try:
        return d.run(snapshot)
    except Exception as exc:  # noqa: BLE001 - a crashing check is our bug: record it, never blame the site
        return Outcome("na", 0, "The check could not run.", {"error": f"{type(exc).__name__}: {exc}"[:200]})


class AuditorAgent(Agent):
    name = "auditor"
    title = "Auditor"

    def __init__(self, fetch: Fetcher, external: IsAgenticClient | None = None):
        self.fetch = fetch
        self.external = external

    def steps(self) -> list[Step]:
        steps = [
            Step(1, "fetch_pages", StepKind.CODE, self._fetch),
            Step(2, "run_checks", StepKind.CODE, self._run),
            Step(3, "score_audit", StepKind.CODE, self._score),
            Step(4, "list_gaps", StepKind.CODE, self._gaps),
            Step(5, "save_audit", StepKind.CODE, self._save),
        ]
        if self.external is not None:
            steps.append(Step(6, "external_scan", StepKind.CODE, self._external))
        return steps

    def _fetch(self, ctx: RunContext) -> dict:
        try:
            snapshot = snap_mod.collect(self.fetch, ctx.store)
        except ValueError as exc:
            raise RunFailed(str(exc)) from exc
        ctx.data["_snapshot"] = snapshot
        failed = [r for r in snapshot.fetches if r.status == 0]
        return {"target": snapshot.base, "requests": len(snapshot.fetches), "unreachable": len(failed),
                "platform": ctx.store.platform or "unknown",
                "product_page": snapshot.product_url or None}

    def _run(self, ctx: RunContext) -> dict:
        snapshot = ctx.data["_snapshot"]
        rows = [build_row(d, run_one(d, snapshot) if d.run and d.group != 4 else None, ctx.store.platform)
                for d in REGISTRY]
        ctx.data["_rows"] = rows
        count = lambda r: sum(x["result"] == r for x in rows)  # noqa: E731
        return {"checks": sum(x["group"] != 4 and x["result"] != "planned" for x in rows),
                "passed": count("pass"), "partial": count("partial"), "failed": count("fail"),
                "not_applicable": count("na"), "planned": count("planned"),
                "errors": [x["check_id"] for x in rows if x["details"].get("error")]}

    def _score(self, ctx: RunContext) -> dict:
        result = score_rows(ctx.data["_rows"])
        ctx.data["_score"] = result
        return {"score": result["score"], "label": result["label"], "groups":
                {g: v["percent"] for g, v in result["groups"].items()}}

    def _gaps(self, ctx: RunContext) -> dict:
        found, limited = gaps(ctx.data["_rows"]), limited_gaps(ctx.data["_rows"])
        ctx.data["_gaps"] = found
        return {"gaps": len(found), "limited": len(limited), "first": [g["check_id"] for g in found[:5]]}

    def _save(self, ctx: RunContext) -> dict:
        snapshot, rows, result = ctx.data["_snapshot"], ctx.data["_rows"], ctx.data["_score"]
        cur = ctx.conn.execute(
            """INSERT INTO audits (run_id, store_id, scanned_at, target, platform, engine, score, score_label,
                                   breakdown, groups, coverage, fetches)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ctx.run_id, ctx.store_id, utc_now(), snapshot.base, ctx.store.platform, ENGINE,
             result["score"], result["label"], json.dumps(result["tiers"]), json.dumps(result["groups"]),
             json.dumps(coverage(rows)), json.dumps([r.summary() for r in snapshot.fetches])))
        audit_id = cur.lastrowid
        for r in rows:
            ctx.conn.execute(
                """INSERT INTO audit_checks (audit_id, check_id, grp, tier, source, result, percent, scored,
                                             controlled_by, evidence, details)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (audit_id, r["check_id"], r["group"], r["tier"], r["source"], r["result"], r["percent"],
                 int(r["scored"]), r["controlled_by"], r["evidence"], json.dumps(r["details"])))
        ctx.conn.commit()
        ctx.data["_audit_id"] = audit_id
        return {"audit_id": audit_id, "rows": len(rows)}

    def _external(self, ctx: RunContext) -> dict:
        """Never fails the audit: when Is Agentic cannot be read, the reason is stored and the step reports it."""
        target = ctx.data["_snapshot"].base
        client = self.external
        client.requests = 0
        try:
            report, error = client.fetch(target), ""
        except ExternalError as exc:
            report, error = None, str(exc)[:300]
        ctx.conn.execute(
            """INSERT INTO external_reports (audit_id, source, status, error, fetched_at, target, requests, report_url,
                                              score, score_label, scanned_at, eligible_checks, breakdown, issues)
               VALUES (?, 'is-agentic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ctx.data["_audit_id"], "ok" if report else "unavailable", error, utc_now(), target, client.requests,
             report["report_url"] if report else "", report["score"] if report else None,
             report["label"] if report else "", report["scanned_at"] if report else "",
             report["eligible_checks"] if report else None, json.dumps(report["breakdown"] if report else {}),
             json.dumps(report["issues"] if report else [])))
        ctx.conn.commit()
        if report is None:
            return {"status": "unavailable", "reason": error, "requests": client.requests}
        kinds = [i["kind"] for i in report["issues"]]
        return {"status": "ok", "score": report["score"], "issues": len(kinds), "mapped": kinds.count("mapped"),
                "extra": kinds.count("extra"), "api_product": kinds.count("api_product"),
                "requests": client.requests}


def audit_flow(fetch: Fetcher, external: IsAgenticClient | None = None, fixer: bool = True) -> Flow:
    """The Auditor, then the Fixer, with the Master checking each hand-off."""
    from airtime.agents.fixer.agent import FixerAgent
    from airtime.agents.fixer.master import FIX_CHECKS
    if not fixer:
        return Flow([AuditorAgent(fetch, external)], AUDIT_CHECKS)
    return Flow([AuditorAgent(fetch, external), FixerAgent()], AUDIT_CHECKS + FIX_CHECKS)
