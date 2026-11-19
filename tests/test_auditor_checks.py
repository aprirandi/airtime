"""Auditor checks: each rule on a fake site, one passing case and the ways it fails."""

from dataclasses import replace

import pytest

from airtime.agents.auditor import checks as c
from airtime.agents.auditor.htmlparse import jsonld_items, parse_page, types_of
from airtime.agents.auditor.registry import BY_ID, REGISTRY
from airtime.agents.auditor.snapshot import collect
from auditor_site import (HOME, LOREM, ORIGIN, ROBOTS, FakeSite, good_routes, home_handler, html, jsonr, page,
                          text, not_found_handler)


@pytest.fixture
def acfg(cfg):
    return replace(cfg, domain="shop.test", audit_url=ORIGIN, platform="")


def snap_of(cfg, **changes):
    routes = good_routes()
    for path, route in changes.items():
        if route is None:
            routes.pop(path.replace("__", "/"), None)
        else:
            routes[path.replace("__", "/")] = route
    return collect(FakeSite(routes), cfg)


def outcome(check_id, cfg, routes=None):
    site = FakeSite(routes if routes is not None else good_routes())
    return BY_ID[check_id].run(collect(site, cfg))


def routes_with(**changes):
    routes = good_routes()
    routes.update(changes)
    return routes


def test_a_good_site_passes_every_check(acfg):
    snap = collect(FakeSite(), acfg)
    results = {d.id: d.run(snap) for d in REGISTRY if d.run}
    bad = {k: (v.result, v.percent, v.evidence) for k, v in results.items() if v.result != "pass"}
    assert not bad
    assert len(results) == 24


# ---- parsing ----------------------------------------------------------------------------------

def test_parser_reads_text_headings_meta_and_jsonld():
    p = parse_page('<html lang="en"><head><meta name="robots" content="noindex"><link rel="canonical" href="/x">'
                   '<script type="application/ld+json">{"@graph":[{"@type":"Store"},{"@type":["Organization","X"]}]}</script>'
                   '<script>var a = 1;</script><style>p{}</style></head><body><h1>Hi <b>there</b></h1><h3>Sub</h3>'
                   '<p>Visible text</p><a href="/a">Link <i>text</i></a><input type="password"></body></html>')
    assert p.lang == "en" and p.headings == [(1, "Hi there"), (3, "Sub")]
    assert "Visible text" in p.text and "var a" not in p.text and "p{}" not in p.text
    assert p.meta_content("robots") == "noindex" and p.link_href("canonical") == "/x"
    assert p.anchors == [("/a", "Link text")] and p.has_password_input
    items, invalid = jsonld_items(p)
    assert [types_of(i) for i in items] == [[], ["Store"], ["Organization", "X"]] and invalid == 0


def test_parser_flags_invalid_jsonld_and_script_redirects():
    p = parse_page('<script type="application/ld+json">{not json</script><script>window.location.href="/x"</script>')
    assert jsonld_items(p) == ([], 1) and p.script_redirect


# ---- group 1 ----------------------------------------------------------------------------------

def test_robots_txt(acfg):
    assert outcome("robots_txt", acfg).result == "pass"
    routes = good_routes(); routes.pop("/robots.txt")
    assert outcome("robots_txt", acfg, routes).result == "fail"
    assert outcome("robots_txt", acfg, routes_with(**{"/robots.txt": text("# nothing here")})).result == "fail"


def test_ai_crawlers_blocked_by_robots_and_by_firewall(acfg):
    blocked_rule = routes_with(**{"/robots.txt": text(ROBOTS + "User-agent: PerplexityBot\nDisallow: /\n")})
    o = outcome("ai_crawlers_allowed", acfg, blocked_rule)
    assert (o.result, o.percent) == ("partial", 75) and "PerplexityBot (robots.txt)" in o.evidence

    def firewall(headers, ua):
        return html("denied", 403) if "Claude-User" in ua else home_handler(headers, ua)

    o = outcome("ai_crawlers_allowed", acfg, routes_with(**{"/": firewall}))
    assert (o.result, o.percent) == ("partial", 75) and "Claude-User (HTTP 403)" in o.evidence
    allblocked = routes_with(**{"/robots.txt": text("User-agent: *\nDisallow: /\n")})
    assert outcome("ai_crawlers_allowed", acfg, allblocked).result == "fail"


def test_sitemap(acfg):
    assert outcome("sitemap", acfg).result == "pass"
    unlisted = routes_with(**{"/robots.txt": text("User-agent: *\nAllow: /\n")})
    o = outcome("sitemap", acfg, unlisted)
    assert (o.result, o.percent) == ("partial", 50)
    routes = unlisted; routes.pop("/sitemap.xml")
    assert outcome("sitemap", acfg, routes).result == "fail"
    assert outcome("sitemap", acfg, routes_with(**{"/sitemap.xml": text("<html>nope</html>")})).result == "fail"


def test_raw_html_content_scores_each_rule(acfg):
    thin = routes_with(**{"/": html(page("<h4>Hi</h4><p>short</p>"))})
    o = outcome("raw_html_content", acfg, thin)
    assert o.result == "partial" and o.percent == 25     # only the ratio rule passes
    assert "an H1 heading" in o.evidence and "headings in order" in o.evidence
    skipped = routes_with(**{"/": html(page(f"<h1>A</h1><h4>B</h4><p>{LOREM}</p>"))})
    o = outcome("raw_html_content", acfg, skipped)
    assert (o.result, o.percent) == ("partial", 75)
    assert outcome("raw_html_content", acfg, routes_with(**{"/": html("gone", 500)})).result == "fail"


def test_redirects(acfg):
    long_chain = routes_with(**{"/": (302, {"location": "/a"}, ""), "/a": (302, {"location": "/b"}, ""),
                                "/b": (302, {"location": "/c"}, ""), "/c": (302, {"location": "/d"}, ""),
                                "/d": home_handler})
    o = outcome("redirects_clean", acfg, long_chain)
    assert (o.result, o.percent) == ("partial", 50) and o.details["hops"] == 4
    one_hop = routes_with(**{"/": (301, {"location": "/home"}, ""), "/home": home_handler})
    assert outcome("redirects_clean", acfg, one_hop).result == "pass"
    stub = routes_with(**{"/": html(page("<p>Redirecting</p>", head='<meta http-equiv="refresh" content="0;url=/x">'))})
    assert outcome("redirects_clean", acfg, stub).result == "fail"


def test_public_no_login(acfg):
    assert outcome("public_no_login", acfg).result == "pass"
    gated = routes_with(**{"/": (302, {"location": "/password"}, ""), "/password": html(page("<input type=password>"))})
    assert outcome("public_no_login", acfg, gated).result == "fail"
    bad_product = routes_with(**{"/products/card": html("gone", 500)})
    assert outcome("public_no_login", acfg, bad_product).result == "partial"


def test_not_noindex(acfg):
    assert outcome("not_noindex", acfg).result == "pass"
    meta = routes_with(**{"/": html(page(LOREM, head='<meta name="robots" content="noindex, nofollow">'))})
    assert outcome("not_noindex", acfg, meta).result == "fail"
    header = routes_with(**{"/": html(HOME, **{"X-Robots-Tag": "noindex"})})
    assert outcome("not_noindex", acfg, header).result == "fail"


def test_not_found_pages(acfg):
    assert outcome("not_found_markdown", acfg).result == "pass"
    html_only = routes_with(**{"/__airtime-404-probe": html("<h1>Not found</h1>", 404)})
    assert (outcome("not_found_markdown", acfg, html_only).result,
            outcome("not_found_markdown", acfg, html_only).percent) == ("partial", 50)
    soft = routes_with(**{"/__airtime-404-probe": html("<h1>Oops</h1>", 200)})
    o = outcome("not_found_markdown", acfg, soft)
    assert o.result == "fail" and "HTTP 200" in o.evidence


# ---- group 2 ----------------------------------------------------------------------------------

def home_with(ld=None, head="", body=LOREM):
    import json
    scripts = f'<script type="application/ld+json">{json.dumps(ld)}</script>' if ld is not None else ""
    return html(page(f"<h1>Shop</h1><p>{body}</p>", head=head + scripts))


def test_organization_checks(acfg):
    none = routes_with(**{"/": home_with()})
    assert outcome("jsonld_organization", acfg, none).result == "fail"
    assert outcome("organization_completeness", acfg, none).result == "fail"
    bare = routes_with(**{"/": home_with({"@type": "Organization", "name": "Shop"})})
    assert (outcome("jsonld_organization", acfg, bare).result, outcome("jsonld_organization", acfg, bare).percent) \
        == ("partial", 50)
    o = outcome("organization_completeness", acfg, routes_with(**{"/": home_with(
        {"@type": "Store", "name": "Shop", "address": "1 High St, Melbourne"})}))
    assert (o.result, o.percent) == ("partial", 50) and "contactPoint" in o.evidence


def test_metadata_complete(acfg):
    o = outcome("metadata_complete", acfg, routes_with(**{"/": home_with(head='<link rel="canonical" href="/">')}))
    assert (o.result, o.percent) == ("partial", 50) and "og:image" in o.evidence and "og:type" in o.evidence


def test_pricing_structured(acfg):
    o = outcome("pricing_structured", acfg)
    assert o.result == "pass" and o.details == {"price": "12.50", "currency": "AUD"}
    no_price = routes_with(**{"/products/card": html(page(f"<h1>Card</h1><p>{LOREM}</p>", head=(
        '<script type="application/ld+json">{"@type":"Product","name":"Card"}</script>')))})
    assert outcome("pricing_structured", acfg, no_price).percent == 50
    no_product = routes_with(**{"/products/card": html(page("<h1>Card</h1>"))})
    assert outcome("pricing_structured", acfg, no_product).result == "fail"
    routes = good_routes(); routes.pop("/sitemap.xml")
    assert outcome("pricing_structured", acfg, routes).result == "na"
    variants = routes_with(**{"/products/card": html(page("<h1>Card</h1>", head=(
        '<script type="application/ld+json">{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":'
        '{"price":"9","priceCurrency":"AUD"}}]}</script>')))})
    assert outcome("pricing_structured", acfg, variants).result == "pass"


def test_trust_pages(acfg):
    routes = good_routes(); routes.pop("/policies/privacy-policy")
    o = outcome("trust_pages", acfg, routes)
    assert (o.result, o.percent) == ("partial", 67) and "privacy: not found" in o.evidence
    short = routes_with(**{"/pages/about-us": html(page("<p>Hi</p>"))})
    assert "about: only" in outcome("trust_pages", acfg, short).evidence
    # no footer links: the usual paths are tried, and all three exist on the fake site
    bare_home = routes_with(**{"/": html(page(f"<h1>Shop</h1><p>{LOREM}</p>"))})
    assert outcome("trust_pages", acfg, bare_home).result == "pass"


# ---- group 3 ----------------------------------------------------------------------------------

def test_markdown_negotiation(acfg):
    only_html = routes_with(**{"/": html(HOME)})
    o = outcome("markdown_negotiation", acfg, only_html)
    assert o.result == "fail" and "text/html" in o.evidence

    def no_vary(headers, ua):
        if "text/markdown" in headers.get("Accept", ""):
            return text("# Shop\n\nWelcome to the shop.", "text/markdown")
        return html(HOME)

    o = outcome("markdown_negotiation", acfg, routes_with(**{"/": no_vary}))
    assert (o.result, o.percent) == ("partial", 50) and "Vary: Accept" in o.evidence


def test_llms_and_agents_files(acfg):
    routes = good_routes(); routes.pop("/llms.txt"); routes.pop("/agents.md")
    assert outcome("llms_txt", acfg, routes).result == "fail"
    assert outcome("agents_md", acfg, routes).result == "fail"
    broken = routes_with(**{"/llms.txt": text("- [Gone](/gone)\n- [Card](/products/card)")})
    o = outcome("llms_txt", acfg, broken)
    assert (o.result, o.percent) == ("partial", 50)
    assert outcome("llms_txt", acfg, routes_with(**{"/llms.txt": text("# no links")})).percent == 50
    assert outcome("agents_md", acfg, routes_with(**{"/agents.md": text("tiny", "text/markdown")})).percent == 50


def test_content_signals(acfg):
    assert outcome("content_signals", acfg).result == "pass"
    one = routes_with(**{"/robots.txt": text("User-agent: *\nContent-Signal: ai-train=no\n")})
    o = outcome("content_signals", acfg, one)
    assert (o.result, o.percent) == ("partial", 33)
    assert outcome("content_signals", acfg, routes_with(**{"/robots.txt": text("User-agent: *\n")})).result == "fail"


def test_link_headers(acfg):
    assert outcome("link_headers", acfg).result == "pass"
    none = outcome("link_headers", acfg, routes_with(**{"/": html(HOME)}))
    assert none.result == "fail" and "no Link headers" in none.evidence
    boring = routes_with(**{"/": html(HOME, Link='<https://cdn.test>; rel="preconnect", </a.css>; rel=preload')})
    o = outcome("link_headers", acfg, boring)
    assert o.result == "fail" and "preconnect" in o.evidence
    useful = routes_with(**{"/": html(HOME, Link='</.well-known/api-catalog>; rel="api-catalog"')})
    assert outcome("link_headers", acfg, useful).result == "pass"
    md = routes_with(**{"/": html(HOME, Link='</index.md>; rel="alternate"; type="text/markdown"')})
    assert outcome("link_headers", acfg, md).result == "pass"
    assert c.parse_link_header('<a>; rel="x y"; type=text/plain, <b>') == [
        {"target": "a", "rels": ["x", "y"], "type": "text/plain"}, {"target": "b", "rels": [], "type": ""}]


@pytest.mark.parametrize("check_id,path,bad", [
    ("mcp_server_card", "/.well-known/mcp/server-card.json", {"serverInfo": {"name": "x"}}),
    ("agent_skills_index", "/.well-known/agent-skills/index.json", {"skills": [{"name": "x"}]}),
    ("ard_manifest", "/.well-known/ai-catalog.json", {"specVersion": "1"}),
])
def test_well_known_files(acfg, check_id, path, bad):
    assert outcome(check_id, acfg).result == "pass"
    assert outcome(check_id, acfg, routes_with(**{path: jsonr(bad)})).percent == 50
    routes = good_routes(); routes.pop(path)
    assert outcome(check_id, acfg, routes).result == "fail"
    assert outcome(check_id, acfg, routes_with(**{path: text("not json", "application/json")})).result == "fail"


def test_auth_and_oauth(acfg):
    routes = good_routes()
    for path in ("/auth.md", "/.well-known/openid-configuration", "/.well-known/oauth-protected-resource"):
        routes.pop(path)
    assert outcome("auth_md", acfg, routes).result == "fail"
    assert outcome("oauth_discovery", acfg, routes).result == "fail"
    assert outcome("oauth_protected_resource", acfg, routes).result == "fail"
    only_server = routes_with(**{"/.well-known/oauth-authorization-server": jsonr({"issuer": "x"})})
    assert outcome("oauth_discovery", acfg, only_server).result == "pass"


def test_homepage_unreachable_stops_the_snapshot(acfg):
    class Down:
        def __call__(self, url, **kw):
            from airtime.agents.auditor.http import Response
            return Response(url, error="ConnectionRefusedError")

    with pytest.raises(ValueError, match="could not reach"):
        collect(Down(), acfg)


def test_links_off_the_site_are_not_followed(acfg):
    routes = routes_with(**{"/llms.txt": text("- [Evil](https://evil.test/x)\n- [Card](/products/card)")})
    site = FakeSite(routes)
    collect(site, acfg)
    assert not any(u.startswith("https://evil.test") for u, _, _ in site.requests)
