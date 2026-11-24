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

from types import SimpleNamespace

from airtime.agents.auditor.htmlparse import parse_page
from airtime.agents.auditor.prompts import all_prompt, fix_prompt
from airtime.agents.auditor.registry import REGISTRY, TIERS
from airtime.agents.auditor.report import registry_json
from airtime.agents.auditor.score import coverage, gaps, limited_gaps, score_rows

ROOT = Path(__file__).resolve().parents[3] / "engine"
REGISTRY_FILE = ROOT / "src" / "registry.generated.json"
GOLDEN_FILE = ROOT / "test" / "golden.json"
FIXER_FILE = ROOT / "src" / "fixer.generated.json"

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


# What the checks store for a gap on a site, so the prompts can say what is on this site.
SAMPLE_DETAILS = {
    "raw_html_content": {"text_chars": 412, "ratio": 0.0161, "headings": [1, 4, 2],
                         "outline": [[1, "Handworks"], [4, "Cards \u2014 caf\u00e9 & gifts"], [2, "Journals"]]},
    "jsonld_organization": {"org_name": "Handworks", "org_type": "OnlineStore", "present": ["name", "url", "logo"]},
    "organization_completeness": {"org_name": "", "org_type": "Organization", "present": ["name", "url"],
                                  "missing": ["contactPoint", "address"]},
    "content_signals": {"signals": {"ai-train": "no"}, "robots_lines": 40,
                        "robots_head": ["User-agent: *", "Disallow: /admin", "Sitemap: https://shop.test/sitemap.xml"]},
    "ai_crawlers_allowed": {"blocked": ["ChatGPT-User (robots.txt)", "PerplexityBot (HTTP 403)"]},
    "not_noindex": {"sources": ["meta tag", "X-Robots-Tag header"]},
    "trust_pages": {"pages": {"about": {"status": "ok", "url": "https://shop.test/pages/about", "chars": 900},
                              "contact": {"status": "thin", "url": "https://shop.test/pages/contact", "chars": 120},
                              "privacy": {"status": "missing", "url": "", "chars": 0}}},
}
SAMPLE_DETAILS_NO_ORG = {"jsonld_organization": {"jsonld_types": ["Product", "WebSite"], "invalid_blocks": 0},
                         "raw_html_content": {"text_chars": 0, "ratio": 0.0, "headings": [], "outline": []}}


def prompt_cases() -> list[dict]:
    out = []
    rng = random.Random(7)
    for platform in ("", "shopify", "wix"):
        for lang in ("en", "id"):
            picks = rng.sample(BUILT, 4)
            gap_rows = [{"check_id": d.id, "tier": d.tier, "evidence": f"found a problem with {d.id}",
                         "details": SAMPLE_DETAILS.get(d.id, {})} for d in picks]
            site = "https://shop.test"
            out.append({
                "platform": platform, "lang": lang, "site": site, "scanned": "2026-11-23", "gaps": gap_rows,
                "all": all_prompt(gap_rows, site, platform, lang, "2026-11-23"),
                "none": all_prompt([], site, platform, lang, "2026-11-23"),
                "single": [fix_prompt(g["check_id"], g, site, platform, lang) for g in gap_rows],
            })
    # every built check at once: with the details above, with none, and with the other shapes a check can store
    for label, details in (("all with details", SAMPLE_DETAILS), ("all with no details", {}), ("all without an organization", SAMPLE_DETAILS_NO_ORG)):
        for lang in ("en", "id"):
            gap_rows = [{"check_id": d.id, "tier": d.tier, "evidence": f"found a problem with {d.id}",
                         "details": details.get(d.id, {})} for d in BUILT]
            out.append({
                "label": label, "platform": "shopify", "lang": lang, "site": "https://shop.test", "scanned": "2026-11-23",
                "gaps": gap_rows, "all": all_prompt(gap_rows, "https://shop.test", "shopify", lang, "2026-11-23"),
                "none": all_prompt([], "https://shop.test", "shopify", lang, "2026-11-23"),
                "single": [fix_prompt(g["check_id"], g, "https://shop.test", "shopify", lang) for g in gap_rows],
            })
    return out


def fixer_texts() -> str:
    """The Fixer's plain-language texts as data, so the website check says the same words."""
    from airtime.agents.fixer.texts import CLIENT, QUESTIONS, STATUS_TEXT, STATUSES
    return json.dumps({"client": CLIENT, "questions": QUESTIONS, "status_text": STATUS_TEXT, "statuses": list(STATUSES)},
                      indent=1, ensure_ascii=False) + "\n"


def _page(html: str | None):
    return None if html is None else (SimpleNamespace(), parse_page(html))


def _doc(body: str, head: str = "") -> str:
    return f"<!doctype html><html><head>{head}</head><body>{body}</body></html>"


# Pages a business keeps its facts on, as the real ones write them: no line breaks between a label and its value.
FIXER_SITES = [
    ("two stores, suburb before the street, store list repeated", "https://www.handworks.example",
     _doc("<h1>Handworks</h1>", '<meta name="description" content="Handworks has been the premier destination for stationery, gifts and lifestyle essentials for 30+ years.">'
          '<script type="application/ld+json">{"@type":"OnlineStore","name":"Handworks"}</script>'),
     _doc("<h1>About us</h1><p>We are a family run paper shop in Prahran, selling cards and journals. Everything is chosen by people who love paper.</p>"),
     _doc("<h1>Contact</h1><p>Popular Searches: Lamy Jellycat Our Store 244 Chapel St VIC 3181 ph (03)9533 8566 Prahran 80 Church Street VIC 3186 "
          "ph (03) 95931286 Brighton</p><p>Our Store Prahran 244 Chapel St VIC 3181 ph (03)9533 8566 Brighton 80 Church Street VIC 3186 ph (03) 95931286 "
          "Email handworkschapel@gmail.com or Handworkschapel@gmail.com</p>")),
    ("suburb after the street, +61 and a 1300 number", "https://shop.example",
     _doc("<h1>Shop</h1><p>Call 1300 123 456 or +61 3 9123 4567</p>"), None,
     _doc("<h1>Contact us</h1><p>Visit us at 123 Smith St Richmond VIC 3121 or call (03) 9123 4567. Email hello@shop.example any time. Open Mon 9 am to 5 pm.</p>")),
    ("a label is not a suburb", "https://label.example", _doc("<h1>Label</h1>"), None,
     _doc("<h1>Contact</h1><p>Our Store 244 Chapel St VIC 3181 ph (03)9533 8566</p>")),
    ("two-word suburb with a prefix", "https://south.example", _doc("<h1>South</h1>"), None,
     _doc("<h1>Contact</h1><p>Visit South Yarra 12/34 Toorak Road VIC 3141 or write to us@south.example</p>")),
    ("email only, no address", "https://mail.example", _doc("<h1>Mail</h1>"), None,
     _doc("<h1>Contact</h1><p>Email hello@mail.example or sentry@sentry.io or logo@2x.png</p>")),
    ("nothing to read", "https://empty.example", _doc("<h1>Empty</h1><p>Come and say hello.</p>"), None,
     _doc("<h1>Contact</h1><p>Come and say hello.</p>")),
    ("description from the About page, headings dropped", "https://about.example", _doc("<h1>About</h1>"),
     _doc("<h1>About us</h1><h2>Our story</h2><p>Short one. We are a family run paper shop, selling handmade cards and journals. Everything is chosen by people who love paper. Third.</p>"), None),
    ("a menu that runs into the sentence is not a description", "https://menu.example", _doc("<h1>Menu</h1>"),
     _doc("<h1>About</h1><p>Renosites Skip to content Renosites Labs: 3 apps in development Melbourne, AU \u00b7 37.81\u00b0 S \u00b7 --:--:-- -- /what-we-do /approach /about Get in touch [ 01 ] Technology company \u00b7 Melbourne Renosites is a technology company.</p>"), None),
    ("a clean sentence after a noisy one is used", "https://mix.example", _doc("<h1>Mix</h1>"),
     _doc("<h1>About</h1><p>Home | Shop | Contact \u00a9 2026 Mix Pty Ltd and all of its friends and neighbours. We design and build calm, fast websites for small businesses across Melbourne and beyond.</p>"), None),
    ("site name from og:site_name, other state", "https://og.example", _doc("<h1>X</h1>", '<meta property="og:site_name" content="  Og   Shop ">'), None,
     _doc("<h1>Contact</h1><p>Unit 5, 10 Beach Parade QLD 4217 Phone 0755 551 234</p>")),
]


def fixer_cases() -> list[dict]:
    from airtime.agents.fixer.drafts import draft_for, site_name
    out = []
    for name, base, home, about, contact in FIXER_SITES:
        snap = SimpleNamespace(base=base, home_page=parse_page(home),
                               trust={"about": _page(about), "contact": _page(contact), "privacy": None})
        nm = site_name(snap)
        out.append({"name": name, "base": base, "home": home, "about": about, "contact": contact, "site_name": nm,
                    "organization_completeness": draft_for("organization_completeness", snap, nm),
                    "jsonld_organization": draft_for("jsonld_organization", snap, nm)})
    return out


def plan_cases(n: int = 25) -> list[dict]:
    from airtime.agents.fixer.agent import plan_all
    rng = random.Random(24112026)
    out = []
    for _ in range(n):
        rows = _random_rows(rng)
        platform = rng.choice(["", "shopify", "wordpress"])
        out.append({"rows": rows, "platform": platform, "fixes": [{k: v for k, v in f.items() if k != "draft"}
                                                                  for f in plan_all(rows, platform)]})
    return out


def build() -> tuple[str, str]:
    registry = json.dumps(registry_json(), indent=1, ensure_ascii=False) + "\n"
    golden = json.dumps({"tiers": list(TIERS), "score": score_cases(), "prompts": prompt_cases(),
                         "fixer": fixer_cases(), "plans": plan_cases()},
                        separators=(",", ":"), ensure_ascii=False) + "\n"
    return registry, golden


def main() -> None:
    registry, golden = build()
    REGISTRY_FILE.write_text(registry)
    GOLDEN_FILE.write_text(golden)
    FIXER_FILE.write_text(fixer_texts())
    print(f"wrote {REGISTRY_FILE.relative_to(ROOT.parent)} and {GOLDEN_FILE.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
