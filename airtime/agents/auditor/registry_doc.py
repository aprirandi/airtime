"""Writes plans/check-registry.md from the registry, so the document can never drift from the code.

    python -m airtime.agents.auditor.registry_doc > plans/check-registry.md

A test fails when the file is out of date.
"""

from __future__ import annotations

from airtime.agents.auditor.registry import GROUPS, REGISTRY, CheckDef

SOURCE = {"is_agentic": "Is Agentic", "cloudflare": "Cloudflare", "both": "Both"}

RULES = """\
## Design rules

1. **The registry is the only list of checks.** The score, the gaps, the dashboard, the fix prompts and this
   document are all built from it. Nothing else keeps its own list.
2. **Every check is code.** An HTTP request and a rule. No AI decides pass or fail.
3. **A check is `built` or `planned`.** Planned checks are listed so coverage is honest, and are never scored.
4. **Group 4 is never scored.** It is for API products and agent payments, so a store sees "not applicable".
5. **A platform can control a check.** The check is scored like any other, because the score says how ready the
   site is for AI agents, and an agent is affected whoever can change the cause. It is listed as held back by the
   platform and gets no fix prompt, because the owner cannot change it. The reason is stored.
6. **A platform can have a fix hint.** The hint says where on that platform the owner makes the change. It only
   appears in the fix prompt and the dashboard. It never changes a result.
7. **An unknown platform changes nothing.** Every check is scored, every gap gets a fix prompt, and no platform hints are shown.
   The score is the same on every platform; only who can fix a gap differs.
8. **A built check needs a way to verify it by hand** (a `curl` command and the result to expect), because a fix
   prompt without a check is a guess.

### Adding a check
Add one row to `REGISTRY` (id, group, tier, source, names, fix in English and Indonesian), write its function in
`checks.py`, add its `VERIFY` entry, and write a test. The tests refuse a built check with no verify entry.

### Adding a platform
Fill `platform_controlled` and `platform_fix` on the checks it affects, then set `platform` in the store's
config. No other code changes.
"""


def _row(d: CheckDef) -> str:
    status = "built" if d.run else ("n/a" if d.group == 4 else "planned")
    return f"| `{d.id}` | {d.name} | {d.tier} | {SOURCE[d.source]} | {status} |"


def _platform_rows() -> dict[str, tuple[list[CheckDef], list[CheckDef]]]:
    out: dict[str, tuple[list[CheckDef], list[CheckDef]]] = {}
    for d in REGISTRY:
        for p in d.platform_controlled:
            out.setdefault(p, ([], []))[0].append(d)
        for p in d.platform_fix:
            out.setdefault(p, ([], []))[1].append(d)
    return out


def registry_markdown() -> str:
    built = [d for d in REGISTRY if d.run]
    out = ["# Check registry and platform rules", "",
           "Generated from `airtime/agents/auditor/registry.py`. Do not edit by hand: run "
           "`python -m airtime.agents.auditor.registry_doc > plans/check-registry.md`.", "",
           f"**{len(REGISTRY)} checks**: {len(built)} built, "
           f"{sum(1 for d in REGISTRY if not d.run and d.group != 4)} planned, "
           f"{sum(1 for d in REGISTRY if d.group == 4)} not for stores.", "",
           "Tiers: **essential** (up to 80 points), **recommended** (up to 20), **bonus** (up to +5, never lowers "
           "the score). Source is the scanner the check comes from. A check both scanners run is reported once.", ""]
    for g, (name, _) in GROUPS.items():
        rows = [d for d in REGISTRY if d.group == g]
        out += [f"## Group {g}: {name}", "", "| Check | Name | Tier | Source | Status |", "|---|---|---|---|---|",
                *[_row(d) for d in rows], ""]
    out += [RULES, "## Platform rules", ""]
    for platform, (controlled, hinted) in sorted(_platform_rows().items()):
        out += [f"### {platform.capitalize()}", "",
                f"**Controlled by the platform ({len(controlled)}).** Scored, but the owner cannot fix them, so no fix prompt:", "",
                "| Check | Why the owner cannot fix it |", "|---|---|",
                *[f"| `{d.id}` | {d.platform_controlled[platform][0]} |" for d in controlled], "",
                f"**Where the owner makes the change ({len(hinted)}).** Shown in the fix prompt:", "",
                "| Check | Hint |", "|---|---|",
                *[f"| `{d.id}` | {d.platform_fix[platform][0]} |" for d in hinted], ""]
    asking = [d for d in REGISTRY if d.ask]
    out += ["## Fixes that need the owner", "",
            "The fix prompt for these tells the assistant to ask the owner first, and never to invent the answer.", "",
            "| Check | Ask the owner first |", "|---|---|", *[f"| `{d.id}` | {d.ask[0]} |" for d in asking], ""]
    out += ["## How to verify a built check by hand", "", "| Check | Command | Expect |", "|---|---|---|",
            *[f"| `{d.id}` | `{d.verify[0]}` | {d.verify[1]} |" for d in built], ""]
    return "\n".join(out)


if __name__ == "__main__":
    print(registry_markdown(), end="")
