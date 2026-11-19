"""Step 2 of the Auditor: the checks. Each one reads a Snapshot and returns an Outcome.

All rules are plain code (HTTP status, headers, parsed HTML, JSON): no AI decides pass or fail. A
check returns one of pass, partial (with a percentage), fail, or na (does not apply to this site).
The rules follow what Is Agentic and Cloudflare's scanner test; the thresholds that those tools
publish (500 characters of text, a 5% content ratio, 20 characters in an error message) are used as is.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass, field
from urllib.robotparser import RobotFileParser

from airtime.agents.auditor.htmlparse import jsonld_items, types_of
from airtime.agents.auditor.snapshot import AI_USER_AGENTS, Snapshot
from airtime.agents.auditor.http import Response

MIN_TEXT = 500            # characters of visible text a page needs in its raw HTML
MIN_RATIO = 0.05          # visible text as a share of the HTML
MIN_ERROR_BODY = 20       # characters in a Markdown 404 message
MAX_HOPS_OK = 3
LOGIN_PATHS = {"/login", "/signin", "/sign-in", "/account/login", "/password", "/users/sign_in"}
USEFUL_RELS = {"api-catalog", "service-doc", "service-desc", "describedby", "status", "llms-txt", "mcp"}
ORG_TYPES = {"organization", "corporation", "localbusiness", "store", "onlinestore", "onlinebusiness"}
CONTENT_SIGNAL_KEYS = ("ai-train", "search", "ai-input")


@dataclass(frozen=True)
class Outcome:
    result: str            # pass | partial | fail | na
    percent: int           # 100 for pass, 1-99 for partial, 0 for fail and na
    evidence: str          # one plain sentence: what was found
    details: dict = field(default_factory=dict)


def passed(evidence: str, **details) -> Outcome:
    return Outcome("pass", 100, evidence, details)


def failed(evidence: str, **details) -> Outcome:
    return Outcome("fail", 0, evidence, details)


def partial(percent: int, evidence: str, **details) -> Outcome:
    return Outcome("partial", max(1, min(99, percent)), evidence, details)


def na(evidence: str, **details) -> Outcome:
    return Outcome("na", 0, evidence, details)


def graded(percent: int, evidence: str, **details) -> Outcome:
    """100 is a pass, 0 a fail, anything between is partial credit."""
    if percent >= 100:
        return passed(evidence, **details)
    return partial(percent, evidence, **details) if percent > 0 else failed(evidence, **details)


def _json(resp: Response):
    if not resp.ok:
        return None
    try:
        return json.loads(resp.text)
    except (json.JSONDecodeError, ValueError):
        return None


def _robots(snap: Snapshot) -> RobotFileParser | None:
    if not snap.robots.ok:
        return None
    parser = RobotFileParser()
    parser.parse(snap.robots.text.splitlines())
    parser.modified()  # without this can_fetch() answers False for everything
    return parser


def _org(snap: Snapshot) -> dict | None:
    items, _ = jsonld_items(snap.home_page)
    for item in items:
        for t in types_of(item):
            low = t.lower()
            if low in ORG_TYPES or low.endswith("store") or low.endswith("business"):
                return item
    return None


def _filled(value) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


# ---- Group 1: access and content ---------------------------------------------------------------

def robots_txt(snap: Snapshot) -> Outcome:
    r = snap.robots
    if not r.ok:
        return failed(f"/robots.txt returned HTTP {r.status or 'no response'}.")
    if not re.search(r"(?im)^\s*user-agent\s*:", r.text):
        return failed("/robots.txt exists but has no User-agent rules.")
    return passed("/robots.txt exists and has crawl rules.")


def ai_crawlers_allowed(snap: Snapshot) -> Outcome:
    parser = _robots(snap)
    blocked: list[str] = []
    for name, probe in snap.ua_probes.items():
        if parser is not None and not parser.can_fetch(name, snap.base + "/"):
            blocked.append(f"{name} (robots.txt)")
        elif not probe.ok:
            blocked.append(f"{name} (HTTP {probe.status or 'no response'})")
    n = len(AI_USER_AGENTS)
    if not blocked:
        return passed(f"The homepage is open to all {n} AI crawlers tested.", crawlers=list(AI_USER_AGENTS))
    return graded(round(100 * (n - len(blocked)) / n),
                  f"Blocked for {len(blocked)} of {n} AI crawlers: {', '.join(blocked)}.", blocked=blocked)


def sitemap(snap: Snapshot) -> Outcome:
    r = snap.sitemap
    if r is None or not r.ok:
        return failed(f"No sitemap at {snap.sitemap_url} (HTTP {r.status if r else 'none'}).")
    from airtime.agents.auditor.snapshot import is_sitemap_index, sitemap_locs
    entries = len(sitemap_locs(r.text))
    if not (entries and (is_sitemap_index(r.text) or re.search(r"<urlset", r.text, re.I))):
        return failed(f"{snap.sitemap_url} is not a valid sitemap.")
    if not snap.sitemap_listed:
        return partial(50, f"A valid sitemap with {entries} entries exists, but robots.txt does not list it.",
                       entries=entries)
    return passed(f"A valid sitemap with {entries} entries, listed in robots.txt.", entries=entries)


def raw_html_content(snap: Snapshot) -> Outcome:
    home, page = snap.home, snap.home_page
    if not home.ok:
        return failed(f"The homepage returned HTTP {home.status}.")
    levels = [lvl for lvl, _ in page.headings]
    sequential = bool(levels) and levels[0] == 1 and all(b <= a + 1 for a, b in zip(levels, levels[1:]))
    rules = {
        f"at least {MIN_TEXT} characters of text ({len(page.text)} found)": len(page.text) >= MIN_TEXT,
        "an H1 heading": 1 in levels,
        "headings in order starting at H1" + ("" if sequential or not levels else f" (first is H{levels[0]})"):
            sequential,
        f"text is at least {MIN_RATIO:.0%} of the HTML ({page.content_ratio:.1%})":
            page.content_ratio >= MIN_RATIO,
    }
    missing = [name for name, ok in rules.items() if not ok]
    percent = round(100 * (len(rules) - len(missing)) / len(rules))
    if not missing:
        return passed(f"The raw HTML has {len(page.text)} characters of text, an H1 and ordered headings.")
    return graded(percent, "Missing in the raw HTML: " + "; ".join(missing) + ".",
                  text_chars=len(page.text), ratio=round(page.content_ratio, 4), headings=levels[:12])


def redirects_clean(snap: Snapshot) -> Outcome:
    home, page = snap.home, snap.home_page
    stub = len(page.text) < 300 and (bool(page.meta_content("refresh")) or page.script_redirect)
    if stub:
        return failed("The homepage is a meta-refresh or JavaScript redirect stub, not a real redirect.")
    hops = len(home.chain)
    if hops > MAX_HOPS_OK:
        return partial(50, f"{hops} redirects before the homepage; {MAX_HOPS_OK} or fewer is clean.", hops=hops)
    return passed(f"{hops} redirect{'s' if hops != 1 else ''} before the homepage, no meta-refresh or script redirects.",
                  hops=hops)


def public_no_login(snap: Snapshot) -> Outcome:
    home, page = snap.home, snap.home_page
    path = urllib.parse.urlsplit(home.final_url or "/").path.rstrip("/") or "/"
    if not home.ok:
        return failed(f"The homepage returned HTTP {home.status}.")
    if path in LOGIN_PATHS or (page.has_password_input and len(page.text) < 300):
        return failed(f"The homepage is behind a login or store password ({path}).")
    if snap.product is not None and not snap.product.ok:
        return partial(50, f"The homepage is public, but the product page returned HTTP {snap.product.status}.")
    return passed("The homepage" + (" and a product page are" if snap.product is not None else " is")
                  + " readable without signing in.")


def not_noindex(snap: Snapshot) -> Outcome:
    robots_meta = " ".join(snap.home_page.meta_content(n) for n in ("robots", "googlebot", "bingbot")).lower()
    header = snap.home.header("x-robots-tag").lower()
    if "noindex" in robots_meta or "noindex" in header:
        return failed("The homepage tells search engines not to index it (noindex).")
    return passed("No noindex in the homepage's meta tags or headers.")


def not_found_markdown(snap: Snapshot) -> Outcome:
    nf, md = snap.not_found, snap.not_found_markdown
    if nf.status not in (404, 410):
        return failed(f"A page that does not exist returns HTTP {nf.status or 'no response'}, not 404.")
    body = md.text.strip()
    if md.content_type == "text/markdown" and len(body) >= MIN_ERROR_BODY and re.search(r"\]\(|https?://", body):
        return passed("A missing page returns 404 with a Markdown error message that links onward.")
    return partial(50, "A missing page correctly returns 404, but there is no Markdown error body "
                       "when the request asks for text/markdown.")


# ---- Group 2: trust and identity ---------------------------------------------------------------

def jsonld_organization(snap: Snapshot) -> Outcome:
    _, invalid = jsonld_items(snap.home_page)
    org = _org(snap)
    if org is None:
        return failed("No Organization or store entity in the homepage JSON-LD"
                      + (f" ({invalid} block(s) were not valid JSON)." if invalid else "."))
    if not _filled(org.get("description")):
        return partial(50, "An Organization entity is present but has no description.")
    return passed("An Organization entity with a description is present in the JSON-LD.")


def organization_completeness(snap: Snapshot) -> Outcome:
    org = _org(snap)
    if org is None:
        return failed("No Organization entity to check for contact details and address.")
    have = {"contactPoint": _filled(org.get("contactPoint")), "address": _filled(org.get("address"))}
    missing = [k for k, ok in have.items() if not ok]
    if not missing:
        return passed("The Organization has a contactPoint and an address.")
    return graded(50 * sum(have.values()), "The Organization is missing: " + ", ".join(missing) + ".")


def metadata_complete(snap: Snapshot) -> Outcome:
    page = snap.home_page
    have = {"canonical URL": bool(page.link_href("canonical")), "lang attribute": bool(page.lang),
            "og:image": bool(page.meta_content("og:image")), "og:type": bool(page.meta_content("og:type"))}
    missing = [k for k, ok in have.items() if not ok]
    if not missing:
        return passed("Canonical URL, lang, og:image and og:type are all present.")
    return graded(round(100 * (len(have) - len(missing)) / len(have)), "Missing: " + ", ".join(missing) + ".")


def _price_of(snap: Snapshot):
    items, _ = jsonld_items(snap.product_page) if snap.product_page else ([], 0)
    product = None
    for item in items:
        if {t.lower() for t in types_of(item)} & {"product", "productgroup"}:
            product = product or item
            offers = item.get("offers") or [v.get("offers") for v in item.get("hasVariant", []) if isinstance(v, dict)]
            for offer in (offers if isinstance(offers, list) else [offers]):
                offer = offer[0] if isinstance(offer, list) and offer else offer
                if isinstance(offer, dict):
                    price = offer.get("price") or offer.get("lowPrice")
                    if price not in (None, "") and offer.get("priceCurrency"):
                        return product, price, offer["priceCurrency"]
    return product, None, None


def pricing_structured(snap: Snapshot) -> Outcome:
    if snap.product is None or snap.product_page is None:
        return na("No product page was found to read prices from.")
    product, price, currency = _price_of(snap)
    if product is None:
        return failed(f"No Product JSON-LD on {snap.product_url}.")
    if price is None:
        return partial(50, f"Product JSON-LD on {snap.product_url} has no price and currency.")
    return passed(f"{snap.product_url} shows its price in structured data ({price} {currency}).",
                  price=str(price), currency=currency)


def trust_pages(snap: Snapshot) -> Outcome:
    parts, ok_count = [], 0
    for kind in ("about", "contact", "privacy"):
        found = snap.trust.get(kind)
        if found is None:
            parts.append(f"{kind}: not found")
        elif len(found[1].text) < MIN_TEXT:
            parts.append(f"{kind}: only {len(found[1].text)} characters")
        else:
            ok_count += 1
            parts.append(f"{kind}: ok")
    return graded(round(100 * ok_count / 3), "; ".join(parts) + ".")


# ---- Group 3: agent discovery ------------------------------------------------------------------

def markdown_negotiation(snap: Snapshot) -> Outcome:
    md, html = snap.home_markdown, snap.home_html
    is_md = md.content_type == "text/markdown"
    non_empty = len(md.text.strip()) >= MIN_ERROR_BODY
    vary = "accept" in md.header("vary").lower()
    html_kept = html.content_type == "text/html"
    if is_md and non_empty and vary and html_kept:
        return passed("The homepage returns Markdown for Accept: text/markdown, with Vary: Accept, and HTML otherwise.",
                      tokens=md.header("x-markdown-tokens"))
    if is_md and non_empty:
        gaps = ([] if vary else ["Vary: Accept"]) + ([] if html_kept else ["HTML for browsers"])
        return partial(50, "Markdown is returned but these are missing: " + ", ".join(gaps) + ".")
    return failed(f"Accept: text/markdown returned {md.content_type or 'no content type'}"
                  f"{' (HTTP ' + str(md.status) + ')' if md.status != 200 else ''}, not Markdown.")


def llms_txt(snap: Snapshot) -> Outcome:
    r = snap.llms
    if not r.ok:
        return failed(f"/llms.txt returned HTTP {r.status or 'no response'}.")
    links = re.findall(r"\[[^\]]*\]\(\S+?\)", r.text)
    if not links:
        return partial(50, "/llms.txt exists but has no Markdown links.")
    probes = snap.llms_links
    if not probes:
        return passed(f"/llms.txt exists with {len(links)} Markdown links (none on this site to test).")
    resolved = sum(p.ok for p in probes)
    if resolved == len(probes):
        return passed(f"/llms.txt has {len(links)} links; all {len(probes)} probed resolve.")
    return graded(round(100 * resolved / len(probes)),
                  f"/llms.txt has {len(links)} links; {len(probes) - resolved} of {len(probes)} probed do not resolve.")


def agents_md(snap: Snapshot) -> Outcome:
    r = snap.agents
    if not r.ok:
        return failed(f"/agents.md returned HTTP {r.status or 'no response'}.")
    if r.content_type not in ("text/markdown", "text/plain", "text/x-markdown") or len(r.text.strip()) < 100:
        return partial(50, "/agents.md exists but is not served as Markdown or text, or is very short.")
    return passed("/agents.md exists and is served as " + r.content_type + ".")


def content_signals(snap: Snapshot) -> Outcome:
    if not snap.robots.ok:
        return failed("No robots.txt to hold Content-Signal directives.")
    found: dict[str, str] = {}
    for line in re.findall(r"(?im)^\s*content-signal\s*:\s*(.+)$", snap.robots.text):
        for pair in line.split(","):
            key, _, value = pair.partition("=")
            if key.strip().lower() in CONTENT_SIGNAL_KEYS and value.strip().lower() in ("yes", "no"):
                found[key.strip().lower()] = value.strip().lower()
    if len(found) == len(CONTENT_SIGNAL_KEYS):
        return passed("robots.txt declares ai-train, search and ai-input preferences.", signals=found)
    return graded(round(100 * len(found) / len(CONTENT_SIGNAL_KEYS)),
                  "robots.txt has no Content-Signal directive." if not found else
                  "robots.txt declares only: " + ", ".join(found) + ".", signals=found)


def parse_link_header(value: str) -> list[dict]:
    """RFC 8288 Link header: a list of {target, rels, type}."""
    out = []
    for target, params in re.findall(r"<([^>]*)>([^<]*)", value or ""):
        rel = re.search(r'rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))', params, re.I)
        typ = re.search(r'type\s*=\s*(?:"([^"]*)"|([^\s;,]+))', params, re.I)
        rels = ((rel.group(1) or rel.group(2)) if rel else "").lower().split()
        out.append({"target": target, "rels": rels, "type": ((typ.group(1) or typ.group(2)) if typ else "").lower()})
    return out


def link_headers(snap: Snapshot) -> Outcome:
    links = parse_link_header(snap.home.header("link"))
    if not links:
        return failed("The homepage sends no Link headers.")
    useful = [l for l in links if USEFUL_RELS & set(l["rels"])
              or ("alternate" in l["rels"] and l["type"] == "text/markdown")]
    if useful:
        return passed(f"{len(useful)} of {len(links)} Link headers point agents to useful resources.",
                      rels=sorted({r for l in useful for r in l["rels"]}))
    seen = sorted({r for l in links for r in l["rels"]})[:6]
    return failed(f"{len(links)} Link headers, none with a relation useful to agents (found: {', '.join(seen) or 'none'}).")


def mcp_server_card(snap: Snapshot) -> Outcome:
    r = snap.well_known["mcp_server_card"]
    data = _json(r)
    if not isinstance(data, dict):
        return failed(f"No MCP server card at {_path(r)} (HTTP {r.status or 'no response'}).")
    info = data.get("serverInfo")
    if isinstance(info, dict) and info.get("name") and info.get("version"):
        return passed("An MCP server card with serverInfo (name, version) is published.")
    return partial(50, "A JSON file exists at the server-card path but serverInfo has no name and version.")


def agent_skills_index(snap: Snapshot) -> Outcome:
    r = snap.well_known["agent_skills_index"]
    data = _json(r)
    skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(skills, list) or not skills:
        return failed(f"No agent skills index at {_path(r)} (HTTP {r.status or 'no response'}).")
    needed = ("name", "type", "description", "url", "sha256")
    if "$schema" in data and all(isinstance(s, dict) and all(s.get(k) for k in needed) for s in skills):
        return passed(f"An agent skills index lists {len(skills)} skills with digests.")
    return partial(50, "A skills index exists but lacks $schema or fields (name, type, description, url, sha256).")


def ard_manifest(snap: Snapshot) -> Outcome:
    r = snap.well_known["ard_manifest"]
    data = _json(r)
    if not isinstance(data, dict):
        return failed(f"No ARD manifest at {_path(r)} (HTTP {r.status or 'no response'}).")
    if data.get("specVersion") and isinstance(data.get("host"), dict) and isinstance(data.get("entries"), list):
        return passed(f"An ARD manifest lists {len(data['entries'])} entries.")
    return partial(50, "A JSON file exists at the ARD path but lacks specVersion, host or entries.")


def auth_md(snap: Snapshot) -> Outcome:
    r = snap.well_known["auth_md"]
    if r.ok and len(r.text.strip()) >= 50:
        return passed("/auth.md is published with agent registration instructions.")
    return failed(f"/auth.md returned HTTP {r.status or 'no response'}.")


def oauth_discovery(snap: Snapshot) -> Outcome:
    for key in ("oidc", "oauth_server"):
        data = _json(snap.well_known[key])
        if isinstance(data, dict) and data.get("issuer"):
            return passed("OAuth or OpenID Connect discovery metadata is published.")
    return failed("No OAuth or OpenID Connect discovery metadata.")


def oauth_protected_resource(snap: Snapshot) -> Outcome:
    data = _json(snap.well_known["oauth_resource"])
    if isinstance(data, dict) and data.get("resource"):
        return passed("OAuth protected-resource metadata (RFC 9728) is published.")
    return failed("No OAuth protected-resource metadata.")


def _path(r: Response) -> str:
    return urllib.parse.urlsplit(r.url).path or r.url
