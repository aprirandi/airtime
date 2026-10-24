"""Minimal agent framework.

An Agent is an ordered list of Steps. Each Step is marked CODE (counts and checks) or AI
(reads and writes language). Running an agent records every step's outcome in the `runs`
table, so any number in a report can be traced back to the run that produced it.

A Flow runs several agents in order on one shared run (a shift). At each hand-off the
Master runs code checks on the output before the next agent may use it. Today the flow is
Asker -> Analyst; Auditor, Planner, Fixer and Reporter are added later by appending them.
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
    """A named worker with an ordered list of steps. Several agents share one run (a shift)."""

    name = "agent"
    title = "Agent"

    def steps(self) -> list[Step]:
        raise NotImplementedError

    def run(self, ctx: RunContext) -> RunContext:
        if ctx.run_id is None:  # running on its own, outside a Flow
            _open_run(ctx, self.name)
        steps = self.steps()
        ctx.report(type="agent_start", agent=self.name, run_id=ctx.run_id,
                   steps=[{"step": s.number, "name": s.name, "kind": s.kind.value, "agent": self.name}
                          for s in steps])
        for step in steps:
            entry = {"step": step.number, "name": step.name, "kind": step.kind.value,
                     "agent": self.name, "started_at": utc_now()}
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
            _save(ctx, "running")
            ctx.report(type="step_done", entry=entry)
        return ctx


@dataclass(frozen=True)
class MasterCheck:
    """A code check the Master runs on one agent's output before the next agent may use it.

    `fn` returns (problems, facts). Any problem stops the shift loudly.
    """
    after: str            # agent name whose output is checked
    name: str             # short id, e.g. "answers_complete"
    fn: Callable[[RunContext], tuple[list[str], dict]]


class Flow:
    """Run agents in order on one shared run, with Master checks at the hand-offs."""

    def __init__(self, agents: list[Agent], checks: list[MasterCheck] | None = None):
        self.agents = agents
        self.checks = checks or []

    def run(self, ctx: RunContext) -> RunContext:
        if ctx.run_id is None:
            _open_run(ctx, ",".join(a.name for a in self.agents))
        ctx.report(type="run_start", run_id=ctx.run_id, agents=[a.name for a in self.agents],
                   steps=[{"step": s.number, "name": s.name, "kind": s.kind.value, "agent": a.name}
                          for a in self.agents for s in a.steps()])
        try:
            for agent in self.agents:
                agent.run(ctx)
                for check in (c for c in self.checks if c.after == agent.name):
                    self._master(ctx, check)
        except Exception as exc:
            _save(ctx, "failed", error="".join(traceback.format_exception_only(exc)).strip())
            ctx.report(type="run_done", status="failed")
            raise
        _save(ctx, "ok")
        ctx.report(type="run_done", status="ok")
        return ctx

    def _master(self, ctx: RunContext, check: MasterCheck) -> None:
        entry = {"step": "M", "name": f"master_{check.name}", "kind": StepKind.CODE.value,
                 "agent": "master", "checks": check.after, "started_at": utc_now()}
        ctx.log.append(entry)
        ctx.report(type="step_start", entry=entry)
        problems, facts = check.fn(ctx)
        entry.update(status="failed" if problems else "ok", finished_at=utc_now(),
                     result=_jsonable({**facts, "problems": problems}))
        if problems:
            entry["error"] = "; ".join(problems)
        _save(ctx, "running")
        ctx.report(type="step_done", entry=entry)
        if problems:
            raise RunFailed(f"master check '{check.name}' failed: " + "; ".join(problems))


def _open_run(ctx: RunContext, agents: str) -> None:
    cur = ctx.conn.execute(
        "INSERT INTO runs (agent, store_id, run_date, started_at, status) VALUES (?, ?, ?, ?, 'running')",
        (agents, ctx.store_id, ctx.run_date, utc_now()),
    )
    ctx.run_id = cur.lastrowid
    ctx.conn.commit()


def _save(ctx: RunContext, status: str, error: str | None = None) -> None:
    finished = utc_now() if status != "running" else None
    ctx.conn.execute(
        "UPDATE runs SET status = ?, steps = ?, finished_at = ?, error = ? WHERE id = ?",
        (status, json.dumps(ctx.log), finished, error, ctx.run_id),
    )
    ctx.conn.commit()


def _jsonable(value: Any) -> Any:
    """Keep the stored step log small and JSON-safe: summarise lists, drop objects."""
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value] if len(value) <= 20 else f"<{len(value)} items>"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
