"""Files the TypeScript engine (engine/) is checked against, so the two engines cannot drift apart.

    python -m airtime.agents.auditor.golden

writes engine/src/registry.generated.json (the registry as data: the TypeScript engine reads the same names,
fix texts, platform rules and verify commands) and engine/test/golden.json (scoring and prompt cases with the
Python engine's answers). A Python test fails when either file is out of date; the TypeScript tests fail when
the TypeScript engine gives a different answer from the one stored here.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from airtime.agents.auditor.prompts import all_prompt, fix_prompt
from airtime.agents.auditor.registry import REGISTRY, TIERS
from airtime.agents.auditor.report import registry_json
from airtime.agents.auditor.score import coverage, gaps, limited_gaps, score_rows

ROOT = Path(__file__).resolve().parents[3] / "engine"
REGISTRY_FILE = ROOT / "src" / "registry.generated.json"
GOLDEN_FILE = ROOT / "test" / "golden.json"

BUILT = [d for d in REGISTRY if d.run]


def _random_rows(rng: random.Random) -> list[dict]:
    rows = []
    for d in rng.sample(REGISTRY, rng.randint(1, len(REGISTRY))):
        result = "na" if d.group == 4 else "planned" if d.run is None else rng.choice(["pass", "partial", "fail", "na"])
        percent = 100 if result == "pass" else rng.choice([10, 25, 33, 50, 67, 75, 90]) if result == "partial" else 0
        controlled = rng.choice(["", "", "", "shopify"]) if d.run else ""
        scored = result in ("pass", "partial", "fail") and d.group != 4
        rows.append({"check_id": d.id, "group": d.group, "tier": d.tier, "result": result, "percent": percent,
                     "scored": scored, "controlled_by": controlled, "evidence": f"evidence for {d.id}"})
    return rows


def score_cases(n: int = 80) -> list[dict]:
    rng = random.Random(23112026)
    out = []
    for _ in range(n):
        rows = _random_rows(rng)
        out.append({"rows": rows, "score": score_rows(rows), "gaps": [g["check_id"] for g in gaps(rows)],
                    "limited": [g["check_id"] for g in limited_gaps(rows)], "coverage": coverage(rows)})
    return out


def prompt_cases() -> list[dict]:
    out = []
    rng = random.Random(7)
    for platform in ("", "shopify", "wix"):
        for lang in ("en", "id"):
            picks = rng.sample(BUILT, 4)
            gap_rows = [{"check_id": d.id, "tier": d.tier, "evidence": f"found a problem with {d.id}"} for d in picks]
            site = "https://shop.test"
            out.append({
                "platform": platform, "lang": lang, "site": site, "scanned": "2026-11-23", "gaps": gap_rows,
                "all": all_prompt(gap_rows, site, platform, lang, "2026-11-23"),
                "none": all_prompt([], site, platform, lang, "2026-11-23"),
                "single": [fix_prompt(g["check_id"], g, site, platform, lang) for g in gap_rows],
            })
    return out


def build() -> tuple[str, str]:
    registry = json.dumps(registry_json(), indent=1, ensure_ascii=False) + "\n"
    golden = json.dumps({"tiers": list(TIERS), "score": score_cases(), "prompts": prompt_cases()},
                        separators=(",", ":"), ensure_ascii=False) + "\n"
    return registry, golden


def main() -> None:
    registry, golden = build()
    REGISTRY_FILE.write_text(registry)
    GOLDEN_FILE.write_text(golden)
    print(f"wrote {REGISTRY_FILE.relative_to(ROOT.parent)} and {GOLDEN_FILE.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
