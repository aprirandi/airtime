"""A fake website for the Auditor tests: routes in, `Response` objects out, no network."""

from __future__ import annotations

import json

from airtime.agents.auditor.http import REDIRECTS, Response

ORIGIN = "https://shop.test"
LOREM = ("Handmade cards, wrapping paper and journals for every occasion, chosen by people who love paper. "
         "Visit the shop to see the full range of notebooks, pens and gifts, or order online. ") * 4


def page(body: str, head: str = "", lang: str = "en") -> str:
    return f"<!doctype html><html lang=\"{lang}\"><head>{head}</head><body>{body}</body></html>"


ORG = {"@context": "https://schema.org", "@graph": [{
    "@type": "Organization", "name": "Shop", "description": "A paper shop",
    "contactPoint": {"@type": "ContactPoint", "email": "hi@shop.test", "contactType": "customer service"},
    "address": {"@type": "PostalAddress", "addressLocality": "Melbourne", "streetAddress": "1 High St"}}]}
PRODUCT = {"@context": "https://schema.org", "@type": "Product", "name": "Card",
           "offers": {"@type": "Offer", "price": "12.50", "priceCurrency": "AUD"}}

HOME = page(
    f"<h1>Shop</h1><p>{LOREM}</p><h2>Cards</h2><p>Cards.</p>"
    "<a href=\"/pages/about-us\">About us</a> <a href=\"/pages/contact\">Contact</a> "
    "<a href=\"/policies/privacy-policy\">Privacy policy</a>",
    head=("<link rel=\"canonical\" href=\"https://shop.test/\">"
          "<meta property=\"og:image\" content=\"https://shop.test/i.png\"><meta property=\"og:type\" content=\"website\">"
          f"<script type=\"application/ld+json\">{json.dumps(ORG)}</script>"))
TRUST = page(f"<h1>Page</h1><p>{LOREM}</p>")
SITEMAP_INDEX = ('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.test/sitemap_products_1.xml</loc>'
                 "</sitemap></sitemapindex>")
SITEMAP_PRODUCTS = "<urlset><url><loc>https://shop.test/products/card</loc></url></urlset>"
ROBOTS = ("User-agent: *\nAllow: /\nContent-Signal: ai-train=no, search=yes, ai-input=no\n"
          "Sitemap: https://shop.test/sitemap.xml\n")


def text(body: str, ctype: str = "text/plain; charset=utf-8", status: int = 200, **headers):
    return (status, {"content-type": ctype, **{k.lower(): v for k, v in headers.items()}}, body)


def html(body: str, status: int = 200, **headers):
    return text(body, "text/html; charset=utf-8", status, **headers)


def jsonr(obj, status: int = 200):
    return text(json.dumps(obj), "application/json", status)


def home_handler(headers: dict, ua: str):
    if "text/markdown" in headers.get("Accept", ""):
        return text("# Shop\n\nWelcome to the shop. See the [sitemap](/sitemap.xml).", "text/markdown; charset=utf-8",
                    vary="Accept")
    return html(HOME, Link='</.well-known/api-catalog>; rel="api-catalog"')


def not_found_handler(headers: dict, ua: str):
    if "text/markdown" in headers.get("Accept", ""):
        return text("# Not found\n\nThis page does not exist. See the [sitemap](https://shop.test/sitemap.xml).",
                    "text/markdown", 404)
    return html("<h1>Not found</h1>", 404)


def good_routes() -> dict:
    return {
        "/": home_handler,
        "/robots.txt": text(ROBOTS),
        "/sitemap.xml": text(SITEMAP_INDEX, "application/xml"),
        "/sitemap_products_1.xml": text(SITEMAP_PRODUCTS, "application/xml"),
        "/products/card": html(page(f"<h1>Card</h1><p>{LOREM}</p>",
                                    head=f"<script type=\"application/ld+json\">{json.dumps(PRODUCT)}</script>")),
        "/__airtime-404-probe": not_found_handler,
        "/llms.txt": text("# Shop\n\n- [About](/pages/about-us)\n- [Card](/products/card)\n"),
        "/agents.md": text("# Shop agent guide\n\n" + LOREM, "text/markdown"),
        "/.well-known/mcp/server-card.json": jsonr({"serverInfo": {"name": "shop", "version": "1.0"}}),
        "/.well-known/agent-skills/index.json": jsonr({"$schema": "https://example.test/schema", "skills": [
            {"name": "shop", "type": "skill-md", "description": "d", "url": "/s", "sha256": "abc"}]}),
        "/.well-known/ai-catalog.json": jsonr({"specVersion": "1", "host": {"name": "shop"}, "entries": [{}]}),
        "/auth.md": text("# Agent registration\n\n" + LOREM, "text/markdown"),
        "/.well-known/openid-configuration": jsonr({"issuer": "https://shop.test"}),
        "/.well-known/oauth-protected-resource": jsonr({"resource": "https://shop.test"}),
        "/pages/about-us": html(TRUST), "/pages/contact": html(TRUST), "/policies/privacy-policy": html(TRUST),
    }


class FakeSite:
    """Callable with the same signature as HttpFetcher. Redirects are followed and recorded."""

    def __init__(self, routes: dict | None = None, origin: str = ORIGIN):
        self.routes = good_routes() if routes is None else routes
        self.origin = origin
        self.requests: list[tuple[str, dict, str]] = []

    def __call__(self, url: str, *, headers: dict | None = None, user_agent: str | None = None) -> Response:
        headers = headers or {}
        chain: list[tuple[int, str]] = []
        current = url
        for _ in range(7):
            self.requests.append((current, headers, user_agent or ""))
            if not current.startswith(self.origin):
                return Response(url, final_url=current, chain=chain, error="offsite")
            path = current[len(self.origin):].split("?")[0] or "/"
            route = self.routes.get(path)
            if callable(route):
                route = route(headers, user_agent or "")
            if route is None:
                route = html("<h1>Not found</h1>", 404)
            status, hdrs, body = route
            hdrs = {k.lower(): v for k, v in hdrs.items()}
            if status in REDIRECTS and "location" in hdrs:
                chain.append((status, current))
                loc = hdrs["location"]
                current = loc if loc.startswith("http") else self.origin + loc
                continue
            return Response(url, status=status, final_url=current, headers=hdrs,
                            body=body.encode(), chain=chain)
        return Response(url, final_url=current, chain=chain, error="too many redirects")
