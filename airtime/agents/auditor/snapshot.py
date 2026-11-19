"""Step 1 of the Auditor: fetch what the checks need from a store's public website.

Everything the checks read is collected here once, as a `Snapshot`, so the checks themselves are pure
functions of stored responses and can be tested without a network. Only public pages are requested,
with a plain GET, roughly 30 to 40 requests in all. Links found on the site are followed only on the same site.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass, field

from airtime.agents.auditor.htmlparse import Page, parse_page
from airtime.agents.auditor.http import Fetcher, Response
from airtime.config import StoreConfig

# Product tokens of the AI crawlers both scanners test. Real crawlers send longer strings; a site that
# blocks by product token blocks these too.
AI_USER_AGENTS = {
    "ChatGPT-User": "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "OAI-SearchBot": "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    "Claude-User": "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
    "PerplexityBot": "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
}
WELL_KNOWN = {
    "mcp_server_card": "/.well-known/mcp/server-card.json",
    "agent_skills_index": "/.well-known/agent-skills/index.json",
    "ard_manifest": "/.well-known/ai-catalog.json",
    "auth_md": "/auth.md",
    "oidc": "/.well-known/openid-configuration",
    "oauth_server": "/.well-known/oauth-authorization-server",
    "oauth_resource": "/.well-known/oauth-protected-resource",
}
NOT_FOUND_PATH = "/__airtime-404-probe"
TRUST_LINK = {"about": re.compile(r"about", re.I), "contact": re.compile(r"contact", re.I),
              "privacy": re.compile(r"privacy", re.I)}
TRUST_FALLBACKS = {
    "about": ["/pages/about-us", "/pages/about", "/about", "/about-us"],
    "contact": ["/pages/contact", "/contact", "/contact-us", "/pages/contact-us"],
    "privacy": ["/policies/privacy-policy", "/privacy", "/privacy-policy", "/pages/privacy-policy"],
}
MARKDOWN = {"Accept": "text/markdown"}
HTML = {"Accept": "text/html"}
MAX_LLMS_LINKS = 5
LOC = re.compile(r"<loc>\s*([^<\s][^<]*?)\s*</loc>", re.I)


@dataclass
class Snapshot:
    base: str                                   # origin the probes were sent to, e.g. https://www.x.com
    platform: str
    home: Response
    home_page: Page
    home_markdown: Response
    home_html: Response
    ua_probes: dict[str, Response]
    robots: Response
    sitemap: Response | None
    sitemap_url: str
    sitemap_listed: bool
    product_url: str
    product: Response | None
    product_page: Page | None
    not_found: Response
    not_found_markdown: Response
    llms: Response
    llms_links: list[Response]
    agents: Response
    well_known: dict[str, Response]
    trust: dict[str, tuple[Response, Page] | None]
    fetches: list[Response] = field(default_factory=list)


def origin_of(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def _host(url: str) -> str:
    h = (urllib.parse.urlsplit(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def same_site(url: str, base: str) -> bool:
    return _host(url) == _host(base)


def collect(fetch: Fetcher, cfg: StoreConfig) -> Snapshot:
    """Fetch everything. Raises ValueError if the homepage cannot be reached at all."""
    seen: list[Response] = []

    def get(url: str, **kw) -> Response:
        resp = fetch(url, **kw)
        seen.append(resp)
        return resp

    start = cfg.base_url.rstrip("/") + "/"
    home = get(start)
    if home.status == 0:
        raise ValueError(f"could not reach {start}: {home.error or 'no response'}")
    base = origin_of(home.final_url or start)

    def at(path: str, **kw) -> Response:
        return get(base + path, **kw)

    home_page = parse_page(home.text)
    home_markdown = get(base + "/", headers=MARKDOWN)
    home_html = get(base + "/", headers=HTML)
    ua_probes = {name: get(base + "/", user_agent=ua) for name, ua in AI_USER_AGENTS.items()}

    robots = at("/robots.txt")
    listed = [m for m in re.findall(r"(?im)^\s*sitemap\s*:\s*(\S+)", robots.text if robots.ok else "")
              if same_site(m, base)]
    sitemap_url = listed[0] if listed else base + "/sitemap.xml"
    sitemap = get(sitemap_url)
    sitemap_listed = bool(listed)

    product_url, product, product_page = _find_product(get, cfg, base, sitemap)

    not_found = at(NOT_FOUND_PATH)
    not_found_md = at(NOT_FOUND_PATH, headers=MARKDOWN)
    llms = at("/llms.txt")
    llms_links = _probe_llms_links(get, llms, base)
    agents = at("/agents.md")
    well_known = {key: at(path) for key, path in WELL_KNOWN.items()}
    trust = _find_trust_pages(get, home_page, home.final_url or start, base)

    return Snapshot(base=base, platform=cfg.platform, home=home, home_page=home_page,
                    home_markdown=home_markdown, home_html=home_html, ua_probes=ua_probes, robots=robots,
                    sitemap=sitemap, sitemap_url=sitemap_url, sitemap_listed=sitemap_listed,
                    product_url=product_url, product=product, product_page=product_page,
                    not_found=not_found, not_found_markdown=not_found_md, llms=llms, llms_links=llms_links,
                    agents=agents, well_known=well_known, trust=trust, fetches=seen)


def sitemap_locs(text: str) -> list[str]:
    return LOC.findall(text)


def is_sitemap_index(text: str) -> bool:
    return bool(re.search(r"<sitemapindex", text, re.I))


def _find_product(get, cfg: StoreConfig, base: str, sitemap: Response | None):
    """A product page to read prices from: the configured one, else the first product in the sitemap."""
    url = cfg.audit_product_url
    if not url and sitemap is not None and sitemap.ok:
        locs = [u for u in sitemap_locs(sitemap.text) if same_site(u, base)]
        if is_sitemap_index(sitemap.text):
            children = [u for u in locs if "product" in u.lower()]
            if children:
                child = get(children[0])
                locs = [u for u in sitemap_locs(child.text) if same_site(u, base)] if child.ok else []
            else:
                locs = []
        url = next((u for u in locs if "/product" in u.lower()), "")
    if not url:
        return "", None, None
    resp = get(url)
    return url, resp, parse_page(resp.text) if resp.ok else None


def _probe_llms_links(get, llms: Response, base: str) -> list[Response]:
    if not llms.ok:
        return []
    out: list[Response] = []
    for _, target in re.findall(r"\[([^\]]*)\]\((\S+?)\)", llms.text):
        target = urllib.parse.urljoin(base + "/", target)
        if same_site(target, base) and len(out) < MAX_LLMS_LINKS:
            out.append(get(target))
    return out


def _find_trust_pages(get, home_page: Page, home_url: str, base: str):
    """About, Contact and Privacy: footer links first, then the usual paths. A page counts only with real content."""
    found: dict[str, tuple[Response, Page] | None] = {}
    for kind, pattern in TRUST_LINK.items():
        candidates: list[str] = []
        for href, text in home_page.anchors:
            target = urllib.parse.urljoin(home_url, href)
            if same_site(target, base) and (pattern.search(href) or pattern.search(text)):
                if target not in candidates:
                    candidates.append(target)
        candidates = candidates[:2] + [base + p for p in TRUST_FALLBACKS[kind][:2]]
        found[kind] = None
        tried: set[str] = set()
        for url in candidates:
            if url in tried:
                continue
            tried.add(url)
            resp = get(url)
            if resp.ok:
                found[kind] = (resp, parse_page(resp.text))
                break
    return found
