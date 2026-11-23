"""Run the Python and the TypeScript engine on the same live sites and compare every check.

    python tests/live_parity.py https://example.com [https://other.example shopify] ...

Both engines visit the site a moment apart, so a site that changes in between can differ without either being
wrong; the report shows both answers so a human can tell. Used by .github/workflows/engine-parity.yml.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from airtime.agents.auditor import snapshot as snap_mod  # noqa: E402
from airtime.agents.auditor.agent import build_row, run_one  # noqa: E402
from airtime.agents.auditor.http import HttpFetcher  # noqa: E402
from airtime.agents.auditor.registry import REGISTRY  # noqa: E402
from airtime.agents.auditor.score import score_rows  # noqa: E402
from airtime.config import load_store_config  # noqa: E402

ENGINE_DIR = Path(__file__).resolve().parent.parent / "engine"


def python_engine(url: str, platform: str) -> dict:
    cfg = replace(load_store_config("handworks"), audit_url=url, platform=platform, audit_product_url="")
    started = time.time()
    snap = snap_mod.collect(HttpFetcher(delay=0), cfg)
    rows = [build_row(d, run_one(d, snap) if d.run and d.group != 4 else None, platform) for d in REGISTRY]
    return {"score": score_rows(rows)["score"], "took_ms": round((time.time() - started) * 1000),
            "requests": len(snap.fetches), "rows": {r["check_id"]: r for r in rows}}


def ts_engine(url: str, platform: str) -> dict:
    proc = subprocess.run(["npx", "tsx", "scripts/scan.ts", url, platform], cwd=ENGINE_DIR, capture_output=True, text=True, timeout=180)
    data = json.loads(proc.stdout.strip().splitlines()[-1])
    if "error" in data:
        return data
    return {"score": data["score"], "took_ms": data["took_ms"], "requests": len(data["fetches"]),
            "rows": {c["id"]: c for c in data["checks"]}}


def compare(url: str, platform: str) -> int:
    print(f"\n=== {url} (platform: {platform or 'unknown'})")
    try:
        py = python_engine(url, platform)
    except ValueError as exc:
        py = {"error": str(exc)}
    ts = ts_engine(url, platform)
    if "error" in py or "error" in ts:
        print(f"  python: {py.get('error', 'ok')}\n  typescript: {ts.get('error', 'ok')}")
        return 0 if ("error" in py) == ("error" in ts) else 1
    print(f"  score      python {py['score']}   typescript {ts['score']}")
    print(f"  requests   python {py['requests']}   typescript {ts['requests']}")
    print(f"  time       python {py['took_ms']} ms   typescript {ts['took_ms']} ms")
    different = 0
    for cid, p in py["rows"].items():
        t = ts["rows"][cid]
        same = (p["result"], p["percent"], p["evidence"]) == (t["result"], t["percent"], t["evidence"])
        if not same:
            different += 1
            print(f"  DIFFERENT {cid}\n    python:     {p['result']} {p['percent']}  {p['evidence']}\n"
                  f"    typescript: {t['result']} {t['percent']}  {t['evidence']}")
    print(f"  {len(py['rows']) - different} of {len(py['rows'])} checks identical")
    return different


def main(argv: list[str]) -> int:
    pairs, i = [], 0
    while i < len(argv):
        url = argv[i]
        platform = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("http") else ""
        pairs.append((url, platform))
        i += 2 if platform else 1
    total = sum(compare(u, p) for u, p in pairs)
    print(f"\n{total} checks differ across {len(pairs)} sites")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
