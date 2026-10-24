"""Step 3 (CODE): ask every question N times and store every answer, empty or not."""

from __future__ import annotations

import json
import time
from typing import Callable

from airtime.core.agent import RunContext, RunFailed
from airtime.providers.base import Provider, ProviderError, call_with_backoff, utc_now


def ask_once(provider: Provider, question: str, *, max_retries: int, base_delay: float,
             sleep: Callable[[float], None] = time.sleep) -> dict:
    """Ask one question. Never raises for provider problems: returns a no_answer record instead."""
    asked_at = utc_now()
    retries: list[dict] = []  # every failed attempt is kept, so quota use can be explained

    def note(exc, delay):
        retries.append({"at": utc_now(), "error": str(exc)[:300], "wait_seconds": delay})

    try:
        ans = call_with_backoff(lambda: provider.ask(question), max_retries=max_retries,
                                base_delay=base_delay, sleep=sleep, on_retry=note)
    except ProviderError as exc:  # includes RateLimitError after retries and BudgetExceeded
        return {"asked_at": asked_at, "text": "", "sources": [], "raw": None,
                "model": provider.model, "status": "no_answer", "retries": retries,
                "error": f"{type(exc).__name__}: {exc}", "used_search": False}
    text = (ans.text or "").strip()
    return {"asked_at": ans.timestamp or asked_at, "text": text, "sources": ans.sources,
            "raw": ans.raw, "model": ans.model or provider.model, "retries": retries,
            "status": "ok" if text else "no_answer",
            "error": None if text else "empty answer", "used_search": ans.used_search}


def step_ask_questions(ctx: RunContext) -> dict:
    provider = ctx.ask_provider
    if provider is None:
        raise RunFailed("no provider to ask")
    questions = ctx.data["_questions"]
    attempts = ctx.store.attempts_per_day
    planned = len(questions) * attempts
    if planned > provider.calls_left:
        raise RunFailed(f"{planned} asks planned but the call budget allows {provider.calls_left}; "
                        "lower attempts_per_day or raise max_ask_calls_per_run (check AI Studio limits)")
    pcfg = ctx.store.provider
    counts = {"ok": 0, "no_answer": 0, "retries": 0}
    # Attempt-major order spreads repeats of the same question across the run.
    for attempt in range(1, attempts + 1):
        for q in questions:
            rec = ask_once(provider, q["text"], max_retries=pcfg.max_retries,
                           base_delay=pcfg.backoff_base_seconds, sleep=ctx.sleep)
            raw = {"response": rec["raw"], "used_search": rec["used_search"],
                   "retries": rec["retries"]}
            if rec["raw"] is None and not rec["retries"]:
                raw = None
            ctx.conn.execute(
                """INSERT INTO answers (run_id, question_id, provider, channel, model, attempt,
                       asked_at, text, sources, raw, status, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ctx.run_id, q["id"], provider.name, provider.channel, rec["model"], attempt,
                 rec["asked_at"], rec["text"], json.dumps(rec["sources"]),
                 json.dumps(raw) if raw is not None else None, rec["status"], rec["error"]),
            )
            ctx.conn.commit()
            # A failed or over-budget ask is still stored, as no_answer; nothing is dropped.
            counts[rec["status"]] += 1
            counts["retries"] += len(rec["retries"])
            ctx.report(type="answer", done=counts["ok"] + counts["no_answer"], planned=planned,
                       ok=counts["ok"], no_answer=counts["no_answer"], question=q["text"],
                       attempt=attempt, status=rec["status"])
    return {"asked": planned, **counts, "calls_made": provider.calls_made}
