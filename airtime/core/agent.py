"""Minimal agent framework.

An Agent is an ordered list of Steps. Each Step is marked CODE (counts and checks) or AI
(reads and writes language). Running an agent records every step's outcome in the `runs`
table, so any number in a report can be traced back to the run that produced it.

A Flow runs several agents in order on one shared context and then an optional master
check. Today the flow holds only the Visibility agent; Auditor, Planner, Fixer and
Reporter agents are added later by appending them to the flow.
"""

from __future__ import annotations

import json
import sqlite3
import time
import traceback
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from airtime.config import StoreConfig
from airtime.providers.base import Provider, utc_now


class StepKind(str, Enum):
    CODE = "CODE"
    AI = "AI"


class RunFailed(Exception):
    """A step failed in a way that must stop the run loudly."""


@dataclass
class RunContext:
    conn: sqlite3.Connection
    store: StoreConfig
    store_id: int
    run_date: str
    ask_provider: Provider | None = None
    work_provider: Provider | None = None
    run_id: int | None = None
    data: dict[str, Any] = field(default_factory=dict)  # step outputs, by step name
    log: list[dict] = field(default_factory=list)
    sleep: Callable[[float], None] = time.sleep  # injected in tests
    progress: Callable[[dict], None] | None = None  # live progress listener (see airtime/live.py)

    def report(self, **event) -> None:
        """Tell the live listener what is happening; never lets a listener error stop the run."""
        if self.progress:
            try:
                self.progress(event)
            except Exception:  # noqa: BLE001 - progress is best effort
                pass


@dataclass(frozen=True)
class Step:
    number: int
    name: str
    kind: StepKind
    fn: Callable[[RunContext], dict | None]


class Agent:
    name = "agent"

    def steps(self) -> list[Step]:
        raise NotImplementedError

    def run(self, ctx: RunContext) -> RunContext:
        cur = ctx.conn.execute(
            "INSERT INTO runs (agent, store_id, run_date, started_at, status) VALUES (?, ?, ?, ?, 'running')",
            (self.name, ctx.store_id, ctx.run_date, utc_now()),
        )
        ctx.run_id = cur.lastrowid
        ctx.conn.commit()
        try:
            steps = self.steps()
            ctx.report(type="run_start", agent=self.name, run_id=ctx.run_id,
                       steps=[{"step": s.number, "name": s.name, "kind": s.kind.value} for s in steps])
            for step in steps:
                entry = {"step": step.number, "name": step.name, "kind": step.kind.value,
                         "started_at": utc_now()}
                ctx.log.append(entry)
                ctx.report(type="step_start", entry=entry)
                try:
                    result = step.fn(ctx) or {}
                except Exception as exc:
                    entry.update(status="failed", error=f"{type(exc).__name__}: {exc}")
                    ctx.report(type="step_done", entry=entry)
                    raise
                ctx.data[step.name] = result
                entry.update(status="ok", finished_at=utc_now(), result=_jsonable(result))
                self._save(ctx, "running")
                ctx.report(type="step_done", entry=entry)
        except Exception as exc:
            self._save(ctx, "failed", error="".join(traceback.format_exception_only(exc)).strip())
            ctx.report(type="run_done", status="failed")
            raise
        self._save(ctx, "ok")
        ctx.report(type="run_done", status="ok")
        return ctx

    def _save(self, ctx: RunContext, status: str, error: str | None = None) -> None:
        finished = utc_now() if status != "running" else None
        ctx.conn.execute(
            "UPDATE runs SET status = ?, steps = ?, finished_at = ?, error = ? WHERE id = ?",
            (status, json.dumps(ctx.log), finished, error, ctx.run_id),
        )
        ctx.conn.commit()


class Flow:
    """Run agents in order on one context, then an optional master check."""

    def __init__(self, agents: list[Agent],
                 master_check: Callable[[RunContext], list[str]] | None = None):
        self.agents = agents
        self.master_check = master_check

    def run(self, ctx: RunContext) -> RunContext:
        for agent in self.agents:
            agent.run(ctx)
        if self.master_check:
            problems = self.master_check(ctx)
            if problems:
                raise RunFailed("master check failed: " + "; ".join(problems))
        return ctx


def _jsonable(value: Any) -> Any:
    """Keep the stored step log small and JSON-safe: summarise lists, drop objects."""
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value] if len(value) <= 20 else f"<{len(value)} items>"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
