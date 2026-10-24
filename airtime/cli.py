"""Command line: `python -m airtime <command>`."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from airtime import db
from airtime.config import REPO_ROOT, load_store_config
from airtime.core.agent import RunContext, RunFailed
from airtime.providers.base import ProviderError

SEED_DIR = REPO_ROOT / "data" / "seed"


def _today(tz: str) -> str:
    return datetime.now(ZoneInfo(tz)).date().isoformat()


def _context(conn, cfg, date, *, ask=True, work=True) -> RunContext:
    from airtime.providers import make_provider
    store_id = db.upsert_store(conn, cfg)
    return RunContext(
        conn=conn, store=cfg, store_id=store_id, run_date=date,
        ask_provider=make_provider(cfg.provider, "ask") if ask else None,
        work_provider=make_provider(cfg.provider, "work") if work else None,
    )


def cmd_seed(args) -> int:
    from airtime.importer import seed_baseline
    cfg = load_store_config(args.store)
    conn = db.connect(args.db)
    store_id = db.upsert_store(conn, cfg)
    for path in sorted(SEED_DIR.glob(f"{args.store}_baseline_*.json")):
        seed_baseline(conn, store_id, path)
        print(f"seeded baseline {path.name}")
    return 0


def cmd_plan(args) -> int:
    cfg = load_store_config(args.store)
    p = cfg.provider
    n_q = len(cfg.questions) if cfg.question_mode == "fixed" else cfg.target_question_count
    core = n_q * cfg.attempts_per_day
    daily = cfg.daily_count * cfg.daily_attempts
    asks = core + daily
    print(f"{cfg.name}: {n_q} core questions x {cfg.attempts_per_day} tries = {core}, plus "
          f"{cfg.daily_count} new questions a day x {cfg.daily_attempts} = {daily}: "
          f"{asks} asks on {p.ask_model} (budget {p.max_ask_calls_per_run})")
    print(f"work calls on {p.work_model}: up to 2 to write today's questions + {asks} extractions + "
          f"up to {asks} re-tries + up to 2 summary (budget {p.max_work_calls_per_run})")
    print(f"web search grounding: {'on' if p.use_search else 'off'}; "
          f"min {p.min_seconds_between_calls}s between calls")
    return 0 if asks <= p.max_ask_calls_per_run else 1


def cmd_run(args) -> int:
    from airtime.agents.visibility.agent import shift_flow
    from airtime.export import export_site
    cfg = load_store_config(args.store)
    conn = db.connect(args.db)
    from airtime.export import AGENT, DOCS_DIR
    from airtime.live import LiveWriter
    try:
        ctx = _context(conn, cfg, args.date or _today(cfg.timezone))
        ctx.progress = LiveWriter(DOCS_DIR / "data" / "live.json", agent_name=AGENT["name"],
                                  store_slug=cfg.slug, run_date=ctx.run_date)
        shift_flow().run(ctx)
    except (RunFailed, ProviderError) as exc:
        print(f"RUN FAILED: {exc}", file=sys.stderr)
        export_site(conn)
        return 2
    for entry in ctx.log:
        print(f"step {entry['step']} [{entry['kind']}] {entry['name']}: {entry['status']}")
    print(ctx.data["write_summary"]["text"])
    export_site(conn)
    return 0


def cmd_import(args) -> int:
    from airtime.importer import import_file
    from airtime.export import export_site
    cfg = load_store_config(args.store)
    conn = db.connect(args.db)
    try:
        done = import_file(Path(args.file), lambda d: _context(conn, cfg, d, ask=False))
    except (RunFailed, ProviderError) as exc:
        print(f"IMPORT FAILED: {exc}", file=sys.stderr)
        return 2
    for ctx in done:
        provider, channel = ctx.data["_scope"]
        print(f"{ctx.run_date} {provider}/{channel}: {ctx.data['write_summary']['text']}")
    export_site(conn)
    return 0


def cmd_export(args) -> int:
    from airtime.export import export_site
    paths = export_site(db.connect(args.db))
    print(f"wrote {len(paths)} data files to docs/data/")
    return 0


def cmd_recheck(args) -> int:
    from airtime.agents.visibility.recheck import recheck_run
    from airtime.export import export_site
    cfg = load_store_config(args.store)
    conn = db.connect(args.db)
    try:
        ctx = _context(conn, cfg, "", ask=False)
        result = recheck_run(ctx, args.run_id)
    except (RunFailed, ProviderError) as exc:
        print(f"RECHECK FAILED: {exc}", file=sys.stderr)
        return 2
    print(result)
    export_site(conn)
    return 0


def cmd_compare(args) -> int:
    from airtime.channels import compare_sources, render_markdown
    cfg = load_store_config(args.store)
    conn = db.connect(args.db)
    store_id = db.upsert_store(conn, cfg)
    a, b = tuple(args.a.split(":")), tuple(args.b.split(":"))
    result = compare_sources(conn, store_id, a, b)
    md = render_markdown(result, cfg.name)
    print(md)
    if not result["ok"]:
        return 1
    out = REPO_ROOT / "reports" / "comparisons"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{cfg.slug}-{a[0]}-{a[1]}-vs-{b[0]}-{b[1]}.md").write_text(md + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="airtime")
    parser.add_argument("--db", default=str(db.DEFAULT_DB_PATH))
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed", help="register the store and load its manual baseline")
    s.add_argument("--store", required=True)
    s.set_defaults(fn=cmd_seed)
    s = sub.add_parser("plan", help="show planned API calls against the configured budget")
    s.add_argument("--store", required=True)
    s.set_defaults(fn=cmd_plan)
    s = sub.add_parser("run", help="run the Visibility agent once (daily job)")
    s.add_argument("--store", required=True)
    s.add_argument("--date", help="run date, default today in the store's timezone")
    s.set_defaults(fn=cmd_run)
    s = sub.add_parser("import", help="import answers pasted from apps (CSV or JSON)")
    s.add_argument("--store", required=True)
    s.add_argument("file")
    s.set_defaults(fn=cmd_import)
    s = sub.add_parser("export", help="rewrite the report data in docs/data/")
    s.set_defaults(fn=cmd_export)
    s = sub.add_parser("recheck", help="re-run steps 4-7 on a run's needs_review answers")
    s.add_argument("--store", required=True)
    s.add_argument("--run-id", type=int, required=True)
    s.set_defaults(fn=cmd_recheck)
    s = sub.add_parser("compare", help="compare two sources, e.g. gemini:api vs gemini:app_pasted")
    s.add_argument("--store", required=True)
    s.add_argument("--a", default="gemini:api")
    s.add_argument("--b", default="gemini:app_pasted")
    s.set_defaults(fn=cmd_compare)
    args = parser.parse_args(argv)
    return args.fn(args)
