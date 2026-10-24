"""Re-run steps 4-7 on a past run's needs_review answers, e.g. after a verification rule is fixed.

The stored answer texts are not asked again; only extraction and checks are repeated.
Each recheck is appended to the run's step log so the change stays traceable.
"""

from __future__ import annotations

import json

from airtime.agents.visibility.compare import step_compare
from airtime.agents.visibility.summary import step_write_summary
from airtime.agents.visibility.verify import step_extract_mentions, step_verify_and_count
from airtime.core.agent import RunContext, RunFailed, StepKind, _jsonable
from airtime.providers.base import utc_now


def recheck_run(ctx: RunContext, run_id: int) -> dict:
    run = ctx.conn.execute("SELECT * FROM runs WHERE id = ? AND store_id = ?",
                           (run_id, ctx.store_id)).fetchone()
    if run is None:
        raise RunFailed(f"no run {run_id} for this store")
    scope = ctx.conn.execute(
        "SELECT provider, channel FROM answers WHERE run_id = ? LIMIT 1", (run_id,)).fetchone()
    ids = [r["id"] for r in ctx.conn.execute(
        "SELECT id FROM answers WHERE run_id = ? AND status = 'needs_review'", (run_id,))]
    if not ids:
        return {"rechecked": 0}
    ctx.run_id, ctx.run_date = run_id, run["run_date"]
    ctx.data["_scope"] = (scope["provider"], scope["channel"])
    # Re-open only the answers that were set aside; their earlier reason stays in the step log.
    for i in ids:
        ctx.conn.execute(
            "UPDATE answers SET status = 'ok', error = NULL, extracted_at = NULL WHERE id = ?", (i,))
    ctx.conn.commit()
    log = json.loads(run["steps"])
    for number, name, kind, fn in ((4, "extract_mentions", StepKind.AI, step_extract_mentions),
                                   (5, "verify_and_count", StepKind.CODE, step_verify_and_count),
                                   (6, "compare_previous", StepKind.CODE, step_compare),
                                   (7, "write_summary", StepKind.AI, step_write_summary)):
        result = fn(ctx) or {}
        ctx.data[name] = result
        log.append({"step": number, "name": f"recheck_{name}", "kind": kind.value,
                    "status": "ok", "finished_at": utc_now(), "answer_ids": ids,
                    "result": _jsonable(result)})
    ctx.conn.execute("UPDATE runs SET steps = ? WHERE id = ?", (json.dumps(log), run_id))
    ctx.conn.commit()
    return {"rechecked": len(ids), "answer_ids": ids, **ctx.data["verify_and_count"]}
