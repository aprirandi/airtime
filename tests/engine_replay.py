"""Recorded visits to fake sites, with the Python engine's answers, for the TypeScript engine to be checked against.

    python tests/engine_replay.py

writes engine/test/replay.json. Each scenario is a site (routes from tests/auditor_site.py, changed in some way),
every request the Python engine made to it with the response it got, and what it concluded: the result of every
check, the score and the gaps. The TypeScript tests replay the same responses and must reach the same conclusions.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from auditor_site import HOME, LOREM, ORG, ORIGIN, PRODUCT, FakeSite, good_routes, html, jsonr, page, text  # noqa: E402

from airtime.agents.auditor import snapshot as snap_mod  # noqa: E402
from airtime.agents.auditor.agent import build_row, run_one  # noqa: E402
from airtime.agents.auditor.prompts import all_prompt  # noqa: E402
from airtime.agents.auditor.registry import REGISTRY  # noqa: E402
from airtime.agents.auditor.score import coverage, gaps, limited_gaps, score_rows  # noqa: E402
from airtime.config import load_store_config  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "engine" / "test" / "replay.json"


def ld(obj) -> str:
    return f'<script type="application/ld+json">{json.dumps(obj)}</script>'


def home_with(head: str = "", body: str | None = None, **kw):
    inner = body if body is not None else f"<h1>Shop</h1><p>{LOREM}</p><h2>Cards</h2><p>Cards.</p>" \
        '<a href="/pages/about-us">About us</a> <a href="/pages/contact">Contact</a> ' \
        '<a href="/policies/privacy-policy">Privacy policy</a>'
    return html(page(inner, head=head), **kw)


def scenarios() -> list[tuple[str, str, str, dict]]:
    """(name, platform, product_url, routes)"""
    out = []

    def add(name, mutate=None, platform="shopify", product_url=""):
        routes = good_routes()
        if mutate:
            mutate(routes)
        out.append((name, platform, product_url, routes))

    add("good site on shopify")
    add("good site, platform unknown", platform="")
    add("plain home, no markdown or link header", lambda r: r.update({"/": html(HOME)}))
    add("robots blocks one crawler", lambda r: r.update({"/robots.txt": text(
        "User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://shop.test/sitemap.xml\n")}))
    add("robots blocks everything with a wildcard", lambda r: r.update({"/robots.txt": text("User-agent: *\nDisallow: /*\n")}))
    add("robots blocks everything", lambda r: r.update({"/robots.txt": text("User-agent: *\nDisallow: /\n")}))
    add("robots allows one crawler inside a blocked site", lambda r: r.update({"/robots.txt": text(
        "User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nUser-agent: Claude-User\nAllow: /\n")}))
    add("robots with comments and mixed case", lambda r: r.update({"/robots.txt": text(
        "# hello\nUSER-AGENT: perplexitybot # comment\nDISALLOW: /\n\nuser-agent: *\nallow: /\ncontent-signal: ai-train=no, SEARCH=Yes\n")}))
    add("robots with crlf line endings", lambda r: r.update({"/robots.txt": text(
        "User-agent: *\r\nAllow: /\r\nContent-Signal: ai-train=no, search=yes, ai-input=yes\r\nSitemap: https://shop.test/sitemap.xml\r\n")}))
    add("no robots, sitemap or llms", lambda r: [r.pop(k) for k in ("/robots.txt", "/sitemap.xml", "/llms.txt", "/agents.md")])
    add("sitemap not listed in robots", lambda r: r.update({"/robots.txt": text("User-agent: *\nAllow: /\n")}))
    add("sitemap is not a sitemap", lambda r: r.update({"/sitemap.xml": text("<html>nope</html>", "text/html")}))
    add("robots is not robots", lambda r: r.update({"/robots.txt": text("<html>Not robots</html>", "text/html")}))
    add("noindex in meta and header", lambda r: r.update({"/": home_with(head='<meta name="robots" content="NOINDEX, follow">',
                                                                      **{"X-Robots-Tag": "noindex"})}))
    add("home behind a login path", lambda r: r.update({"/": (302, {"location": "/account/login"}, ""),
                                                          "/account/login": html(page("<h1>Sign in</h1><input type='password'>"))}))
    add("long redirect chain", lambda r: r.update({
        "/": (301, {"location": "/a"}, ""), "/a": (301, {"location": "/b"}, ""), "/b": (301, {"location": "/c"}, ""),
        "/c": (302, {"location": "/d"}, ""), "/d": (302, {"location": "/home"}, ""), "/home": html(HOME)}))
    add("home is a meta refresh stub", lambda r: r.update({"/": html(page(
        "<p>Redirecting</p>", head='<meta http-equiv="refresh" content="0; url=/home">'))}))
    add("home is a script redirect stub", lambda r: r.update({"/": html(page(
        "<p>Redirecting</p><script>window.location = '/home'</script>"))}))
    add("thin home with a skipped heading", lambda r: r.update({"/": home_with(body="<h1>Shop</h1><h4>Cards</h4><p>Short.</p>")}))
    add("home with no headings and entities", lambda r: r.update({"/": home_with(
        body="<p>Tom &amp; Jerry &nbsp; &lt;b&gt; " + ("caf&eacute; " * 120) + "</p>")}))
    add("home with emoji text", lambda r: r.update({"/": home_with(
        body="<h1>Shop \U0001F389</h1><p>" + ("\U0001F600 gifts " * 80) + "</p>")}))
    add("home with unclosed and nested tags", lambda r: r.update({"/": home_with(
        body="<h1>Shop<p>one<p>two <a href='/pages/about-us'>About<a href='/pages/contact'>Contact</h1>" + "<div>" + LOREM * 2)}))
    add("home with script, style and noscript", lambda r: r.update({"/": home_with(
        head="<style>body{}</style>", body="<h1>Shop</h1><script>var x = '<h2>nope</h2>';</script><noscript>Enable JS</noscript>"
                                           f"<template><p>hidden</p></template><p>{LOREM}</p>")}))
    add("no JSON-LD", lambda r: r.update({"/": home_with()}))
    add("organization without description", lambda r: r.update({"/": home_with(head=ld({"@type": "Organization", "name": "S"}))}))
    add("organization with empty contact", lambda r: r.update({"/": home_with(head=ld({
        "@type": "Organization", "description": "d", "contactPoint": [], "address": {"streetAddress": "1 St"}}))}))
    add("store type as a list", lambda r: r.update({"/": home_with(head=ld({"@type": ["Thing", "OnlineStore"], "description": "d"}))}))
    add("invalid JSON-LD", lambda r: r.update({"/": home_with(head='<script type="application/ld+json">{nope}</script>')}))
    add("type given as an object", lambda r: r.update({"/": home_with(head=ld({"@type": {"a": 1}, "name": "x"}))}))
    add("home metadata missing", lambda r: r.update({"/": html("<html><body><h1>Shop</h1><p>" + LOREM + "</p></body></html>")}))
    add("product without price", lambda r: r.update({"/products/card": html(page(
        f"<h1>Card</h1><p>{LOREM}</p>", head=ld({"@type": "Product", "name": "Card", "offers": {"priceCurrency": "AUD"}})))}))
    add("product with variants", lambda r: r.update({"/products/card": html(page(
        f"<h1>Card</h1><p>{LOREM}</p>", head=ld({"@type": "ProductGroup", "hasVariant": [
            {"@type": "Product", "offers": {"lowPrice": "9.5", "priceCurrency": "AUD"}}]})))}))
    add("product page is missing", lambda r: r.update({"/products/card": html("<h1>gone</h1>", 404)}))
    add("product without structured data", lambda r: r.update({"/products/card": html(page(f"<h1>Card</h1><p>{LOREM}</p>"))}))
    add("configured product url", lambda r: r.update({"/special": html(page(f"<h1>S</h1><p>{LOREM}</p>", head=ld(PRODUCT)))}),
        product_url=ORIGIN + "/special")
    add("no product in sitemap", lambda r: r.update({"/sitemap.xml": text("<urlset><url><loc>https://shop.test/pages/x</loc></url></urlset>", "application/xml")}))
    add("thin trust pages", lambda r: r.update({"/pages/about-us": html(page("<h1>About</h1><p>Short</p>")),
                                                "/pages/contact": html("<h1>gone</h1>", 404)}))
    add("trust pages at fallback paths", lambda r: r.update({
        "/": home_with(body=f"<h1>Shop</h1><p>{LOREM}</p>"), "/about": html(page(f"<p>{LOREM}</p>")),
        "/contact": html(page(f"<p>{LOREM}</p>")), "/privacy": html(page(f"<p>{LOREM}</p>"))}))
    add("llms.txt without links", lambda r: r.update({"/llms.txt": text("# Shop\n\nNothing to see.\n")}))
    add("llms.txt with broken and offsite links", lambda r: r.update({"/llms.txt": text(
        "[a](/missing) [b](https://other.test/x) [c](/products/card) [d](/pages/about-us) [e](/nope) [f](/nope2) [g](/nope3)\n")}))
    add("agents.md as html and short", lambda r: r.update({"/agents.md": html("<p>short</p>")}))
    add("markdown without vary", lambda r: r.update({"/": lambda h, ua: (
        text("# Shop\n\nWelcome to the shop. See the sitemap.", "text/markdown") if "text/markdown" in h.get("Accept", "")
        else html(HOME))}))
    add("markdown but html for everyone", lambda r: r.update({"/": lambda h, ua: text(
        "# Shop\n\nWelcome to the shop. Plenty to read here.", "text/markdown", vary="Accept")}))
    add("404 pages return 200", lambda r: r.update({"/__airtime-404-probe": html("<h1>Shop</h1>")}))
    add("404 markdown without links", lambda r: r.update({"/__airtime-404-probe": lambda h, ua: (
        text("# Not found\n\nThis page does not exist at all.", "text/markdown", 404) if "markdown" in h.get("Accept", "")
        else html("<h1>x</h1>", 404))}))
    add("link headers without useful rels", lambda r: r.update({"/": lambda h, ua: html(HOME, Link='</style.css>; rel="stylesheet", </a>; rel=preload')}))
    add("link header with markdown alternate", lambda r: r.update({"/": lambda h, ua: html(
        HOME, Link='</index.md>; rel="alternate"; type="text/markdown"')}))
    add("content signals partial", lambda r: r.update({"/robots.txt": text(
        "User-agent: *\nAllow: /\nContent-Signal: ai-train=no\nSitemap: https://shop.test/sitemap.xml\n")}))
    add("well-known files malformed", lambda r: r.update({
        "/.well-known/mcp/server-card.json": jsonr({"serverInfo": {"name": "x"}}),
        "/.well-known/agent-skills/index.json": jsonr({"skills": [{"name": "x"}]}),
        "/.well-known/ai-catalog.json": jsonr({"specVersion": "1"}),
        "/auth.md": text("tiny"), "/.well-known/openid-configuration": text("not json"),
        "/.well-known/oauth-protected-resource": jsonr({"issuer": "x"})}))
    add("well-known files absent", lambda r: [r.pop(k) for k in list(r) if k.startswith("/.well-known") or k == "/auth.md"])
    add("oauth server discovery only", lambda r: (r.pop("/.well-known/openid-configuration"),
                                                  r.update({"/.well-known/oauth-authorization-server": jsonr({"issuer": "x"})})))
    add("everything server-error", lambda r: [r.update({k: text("boom", status=500)}) for k in list(r) if k != "/"])
    return out


BODIES: dict[str, str] = {}


def body_key(body: bytes) -> str:
    key = hashlib.sha1(body).hexdigest()[:12]
    BODIES[key] = base64.b64encode(body).decode()
    return key


def record(routes, base_url: str, platform: str, product_url: str) -> dict:
    cfg = replace(load_store_config("handworks"), audit_url=base_url, platform=platform, audit_product_url=product_url)
    fake = FakeSite(routes)
    calls: dict[tuple, dict] = {}

    def fetch(url, *, headers=None, user_agent=None):
        resp = fake(url, headers=headers, user_agent=user_agent)
        key = (url, (headers or {}).get("Accept", ""), user_agent or "")
        calls[key] = {"url": url, "accept": key[1], "ua": key[2], "status": resp.status, "final_url": resp.final_url,
                      "headers": resp.headers, "body": body_key(resp.body),
                      "chain": [[s, u] for s, u in resp.chain], "error": resp.error, "truncated": resp.truncated}
        return resp

    snap = snap_mod.collect(fetch, cfg)
    rows = [build_row(d, run_one(d, snap) if d.run and d.group != 4 else None, platform) for d in REGISTRY]
    result = score_rows(rows)
    expected_rows = [{"check_id": r["check_id"], "result": r["result"], "percent": r["percent"], "scored": r["scored"],
                      "controlled_by": r["controlled_by"], "evidence": r["evidence"],
                      "details": {k: v for k, v in r["details"].items()}} for r in rows]
    gap_rows = [{"check_id": g["check_id"], "tier": g["tier"], "evidence": g["evidence"]} for g in gaps(rows)]
    return {
        "base_url": base_url, "platform": platform, "product_url": product_url,
        "calls": sorted(calls.values(), key=lambda c: (c["url"], c["accept"], c["ua"])),
        "expected": {"base": snap.base, "rows": expected_rows, "score": result,
                     "gaps": [g["check_id"] for g in gaps(rows)], "limited": [g["check_id"] for g in limited_gaps(rows)],
                     "coverage": coverage(rows),
                     "prompt_all": all_prompt(gap_rows, snap.base, platform, "en", "2026-11-23")},
    }


def build() -> str:
    BODIES.clear()
    out = []
    for name, platform, product_url, routes in scenarios():
        item = record(routes, ORIGIN, platform, product_url)
        out.append({"name": name, **item})
    return json.dumps({"bodies": BODIES, "scenarios": out}, separators=(",", ":"), ensure_ascii=False, default=str) + "\n"


if __name__ == "__main__":
    OUT.write_text(build())
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
