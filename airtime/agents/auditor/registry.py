"""The Auditor's check registry: every check Airtime takes from the two scanners, in four groups.

Group 1 access and content, 2 trust and identity, 3 agent discovery (advanced), 4 not for stores.
Tier follows Is Agentic's structure: essential, recommended, bonus. `source` records which scanner
the check comes from (is_agentic, cloudflare or both), so a check that both run is reported once.

A check with `run = None` is planned: it is listed so coverage is honest, but it is never scored.
`platform_controlled` names platforms on which the owner cannot change the result; those checks are
still run and shown, but left out of the score, because they are not a gap the owner can fix.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from airtime.agents.auditor import checks as c

GROUPS = {
    1: ("Access and content", "Akses dan isi"),
    2: ("Trust and identity", "Kepercayaan dan identitas"),
    3: ("Agent discovery", "Penemuan agent"),
    4: ("Not for stores", "Bukan untuk toko"),
}
TIERS = ("essential", "recommended", "bonus")


@dataclass(frozen=True)
class CheckDef:
    id: str
    group: int
    tier: str
    source: str                       # is_agentic | cloudflare | both
    name: str
    name_id: str
    fix: str = ""
    fix_id: str = ""
    run: Callable | None = None       # None = planned, not built yet
    platform_controlled: dict[str, tuple[str, str]] = field(default_factory=dict)  # platform -> (en, id)
    platform_fix: dict[str, tuple[str, str]] = field(default_factory=dict)         # platform -> (en, id)
    na_reason: tuple[str, str] | None = None   # group 4: why it does not apply to a store


SHOPIFY = "shopify"
_PLATFORM_OWNS = ("Shopify controls this and the owner cannot change it.",
                  "Shopify yang mengaturnya dan pemilik tidak bisa mengubahnya.")


def _impl(id, group, tier, source, name, name_id, fix, fix_id, run, controlled=None, shopify=None):
    return CheckDef(id, group, tier, source, name, name_id, fix, fix_id, run,
                    {SHOPIFY: controlled} if controlled else {}, {SHOPIFY: shopify} if shopify else {})


def _planned(id, group, tier, source, name, name_id):
    return CheckDef(id, group, tier, source, name, name_id)


def _not_store(id, source, name, name_id):
    return CheckDef(id, 4, "bonus", source, name, name_id,
                    na_reason=("Applies to API products or agent payments, not to a store.",
                               "Untuk produk API atau pembayaran antar-agent, bukan untuk toko."))


REGISTRY: list[CheckDef] = [
    # ---- Group 1: access and content
    _impl("robots_txt", 1, "recommended", "cloudflare", "robots.txt exists", "robots.txt ada",
          "Publish /robots.txt with clear crawl rules and a Sitemap line.",
          "Terbitkan /robots.txt dengan aturan crawl yang jelas dan baris Sitemap.", c.robots_txt,
          shopify=("Shopify generates robots.txt. Change it through the robots.txt.liquid template.",
                   "Shopify membuat robots.txt. Ubah lewat template robots.txt.liquid.")),
    _impl("ai_crawlers_allowed", 1, "essential", "both", "AI crawlers can reach the site",
          "Crawler AI bisa mengakses situs",
          "Do not block ChatGPT-User, OAI-SearchBot, Claude-User or PerplexityBot in robots.txt, and check "
          "that firewall or bot protection lets them in.",
          "Jangan blokir ChatGPT-User, OAI-SearchBot, Claude-User atau PerplexityBot di robots.txt, dan pastikan "
          "firewall atau perlindungan bot mengizinkan mereka masuk.", c.ai_crawlers_allowed),
    _impl("sitemap", 1, "recommended", "both", "Sitemap exists", "Sitemap ada",
          "Publish a sitemap.xml and list it in robots.txt with a Sitemap line.",
          "Terbitkan sitemap.xml dan cantumkan di robots.txt dengan baris Sitemap.", c.sitemap),
    _impl("raw_html_content", 1, "essential", "is_agentic", "Content available without JavaScript",
          "Konten tersedia tanpa JavaScript",
          "Serve at least 500 characters of real homepage text in the HTML itself, with one clear H1, headings "
          "in order (H1, H2, H3 without skipping), and little markup around the text.",
          "Sajikan minimal 500 karakter teks beranda langsung di HTML, dengan satu H1 yang jelas, judul berurutan "
          "(H1, H2, H3 tanpa melompat), dan sedikit markup di sekitar teks.", c.raw_html_content,
          shopify=("This comes from the theme: change the heading levels in the theme's sections so the first "
                   "heading is an H1.",
                   "Ini berasal dari tema: ubah tingkat judul di bagian tema supaya judul pertama adalah H1.")),
    _impl("redirects_clean", 1, "essential", "is_agentic", "Redirects resolve cleanly",
          "Redirect berjalan bersih",
          "Use plain HTTP redirects (301), not meta-refresh or JavaScript, and keep the chain to three hops or fewer.",
          "Pakai redirect HTTP biasa (301), bukan meta-refresh atau JavaScript, dan jaga rantainya maksimal tiga lompatan.",
          c.redirects_clean),
    _impl("public_no_login", 1, "essential", "is_agentic", "Content available without signing in",
          "Konten tersedia tanpa login",
          "Make sure the homepage and product pages can be read without logging in or entering a store password.",
          "Pastikan beranda dan halaman produk bisa dibaca tanpa login atau kata sandi toko.", c.public_no_login),
    _impl("not_noindex", 1, "recommended", "is_agentic", "Homepage not hidden from search",
          "Beranda tidak disembunyikan dari pencarian",
          "Remove noindex from the homepage's robots meta tag and from any X-Robots-Tag header.",
          "Hapus noindex dari meta tag robots beranda dan dari header X-Robots-Tag.", c.not_noindex),
    _impl("not_found_markdown", 1, "essential", "is_agentic", "Agent-friendly 404 pages",
          "Halaman 404 ramah agent",
          "Return a real HTTP 404 for missing pages, and a Markdown error message with a link to your sitemap or "
          "docs when the request asks for text/markdown.",
          "Kembalikan HTTP 404 yang benar untuk halaman yang tidak ada, dan pesan error Markdown dengan tautan ke "
          "sitemap atau dokumentasi saat permintaan meminta text/markdown.", c.not_found_markdown,
          controlled=("Shopify serves 404 pages; a Markdown error body is not something the owner can change.",
                      "Shopify yang menyajikan halaman 404; isi error Markdown tidak bisa diubah pemilik.")),
    _planned("controls_labelled", 1, "essential", "is_agentic", "Controls and forms are understandable",
             "Kontrol dan form bisa dipahami"),
    _planned("page_token_budget", 1, "recommended", "is_agentic", "Pages fit an agent's context budget",
             "Halaman muat di anggaran konteks agent"),

    # ---- Group 2: trust and identity
    _impl("jsonld_organization", 2, "recommended", "is_agentic", "Organization data in JSON-LD",
          "Data Organization di JSON-LD",
          "Add Organization (or LocalBusiness) JSON-LD to the homepage, with a name and a description.",
          "Tambahkan JSON-LD Organization (atau LocalBusiness) di beranda, dengan nama dan deskripsi.",
          c.jsonld_organization,
          shopify=("Shopify's structured_data filter does not output Organization data: add a JSON-LD block to "
                   "the theme layout (not verified).",
                   "Filter structured_data Shopify tidak menghasilkan data Organization: tambahkan blok JSON-LD di "
                   "layout tema (belum terverifikasi).")),
    _impl("organization_completeness", 2, "recommended", "is_agentic", "Organization contact details and address",
          "Kontak dan alamat Organization",
          "Add contactPoint (phone or email with a contactType) and address (PostalAddress) to the Organization JSON-LD.",
          "Tambahkan contactPoint (telepon atau email dengan contactType) dan address (PostalAddress) ke JSON-LD Organization.",
          c.organization_completeness,
          shopify=("Add them in the same JSON-LD block in the theme layout (not verified).",
                   "Tambahkan di blok JSON-LD yang sama di layout tema (belum terverifikasi).")),
    _impl("metadata_complete", 2, "recommended", "is_agentic", "Page metadata is complete",
          "Metadata halaman lengkap",
          "Add a canonical link, the html lang attribute, og:image and og:type to the homepage head.",
          "Tambahkan link canonical, atribut lang pada html, og:image dan og:type di head beranda.",
          c.metadata_complete),
    _impl("pricing_structured", 2, "recommended", "is_agentic", "Prices readable in structured data",
          "Harga terbaca di data terstruktur",
          "Show price and currency in Product JSON-LD (offers.price and offers.priceCurrency) on product pages.",
          "Tampilkan harga dan mata uang di JSON-LD Product (offers.price dan offers.priceCurrency) di halaman produk.",
          c.pricing_structured,
          shopify=("Shopify's structured_data filter outputs Product data: check that the theme uses it.",
                   "Filter structured_data Shopify menghasilkan data Product: pastikan tema memakainya.")),
    _impl("trust_pages", 2, "recommended", "is_agentic", "About, Contact and Privacy pages",
          "Halaman About, Contact dan Privacy",
          "Publish real About, Contact and Privacy pages with at least 500 characters each, and link them from the footer.",
          "Terbitkan halaman About, Contact dan Privacy yang nyata dengan minimal 500 karakter masing-masing, dan tautkan dari footer.",
          c.trust_pages,
          shopify=("Privacy: Settings > Customer privacy > Privacy policy, published at /policies/privacy-policy.",
                   "Privacy: Settings > Customer privacy > Privacy policy, terbit di /policies/privacy-policy.")),
    _planned("schema_breadth", 2, "bonus", "is_agentic", "Breadth of schema types", "Keragaman tipe schema"),

    # ---- Group 3: agent discovery (advanced)
    _impl("markdown_negotiation", 3, "essential", "both", "Markdown content negotiation",
          "Negosiasi konten Markdown",
          "Return Markdown when a request sends Accept: text/markdown (Content-Type: text/markdown, Vary: Accept) "
          "and keep serving HTML to browsers.",
          "Kembalikan Markdown saat permintaan mengirim Accept: text/markdown (Content-Type: text/markdown, "
          "Vary: Accept) dan tetap sajikan HTML untuk browser.", c.markdown_negotiation,
          controlled=("Shopify controls this and its Markdown route is not reliable yet.",
                      "Shopify yang mengaturnya dan rute Markdown-nya belum andal.")),
    _impl("llms_txt", 3, "bonus", "is_agentic", "llms.txt exists and its links work",
          "llms.txt ada dan tautannya berfungsi",
          "Publish /llms.txt with Markdown links that all resolve.",
          "Terbitkan /llms.txt dengan tautan Markdown yang semuanya berfungsi.", c.llms_txt,
          shopify=("Shopify generates it from agents.md; override it with the llms.txt.liquid template.",
                   "Shopify membuatnya dari agents.md; timpa dengan template llms.txt.liquid.")),
    _impl("agents_md", 3, "bonus", "is_agentic", "agents.md exists", "agents.md ada",
          "Publish /agents.md, a Markdown guide that tells agents how to use the site.",
          "Terbitkan /agents.md, panduan Markdown yang memberi tahu agent cara memakai situs.", c.agents_md,
          shopify=("Shopify generates it; override it with the agents.md.liquid template.",
                   "Shopify membuatnya; timpa dengan template agents.md.liquid.")),
    _impl("content_signals", 3, "recommended", "cloudflare", "Content Signals in robots.txt",
          "Content Signals di robots.txt",
          "Add a Content-Signal line to robots.txt stating your preferences, for example: "
          "Content-Signal: ai-train=no, search=yes, ai-input=no.",
          "Tambahkan baris Content-Signal di robots.txt yang menyatakan preferensi Anda, misalnya: "
          "Content-Signal: ai-train=no, search=yes, ai-input=no.", c.content_signals,
          shopify=("Add it through the robots.txt.liquid template.",
                   "Tambahkan lewat template robots.txt.liquid.")),
    _impl("link_headers", 3, "bonus", "cloudflare", "Link headers for agent discovery",
          "Header Link untuk penemuan agent",
          "Send Link response headers that point agents to useful resources, for example rel=\"api-catalog\" "
          "or rel=\"service-doc\".",
          "Kirim header Link yang mengarahkan agent ke sumber berguna, misalnya rel=\"api-catalog\" atau "
          "rel=\"service-doc\".", c.link_headers,
          controlled=("Shopify sets Link headers itself; whether an owner can add their own is not documented.",
                      "Shopify mengatur header Link sendiri; belum jelas apakah pemilik bisa menambah sendiri.")),
    _impl("mcp_server_card", 3, "bonus", "both", "MCP server card", "MCP server card",
          "Serve an MCP server card at /.well-known/mcp/server-card.json with serverInfo (name, version).",
          "Sajikan MCP server card di /.well-known/mcp/server-card.json dengan serverInfo (name, version).",
          c.mcp_server_card, controlled=_PLATFORM_OWNS),
    _impl("agent_skills_index", 3, "bonus", "cloudflare", "Agent skills index", "Indeks agent skills",
          "Publish /.well-known/agent-skills/index.json with a $schema and a skills array.",
          "Terbitkan /.well-known/agent-skills/index.json dengan $schema dan array skills.",
          c.agent_skills_index, controlled=_PLATFORM_OWNS),
    _impl("ard_manifest", 3, "bonus", "cloudflare", "ARD manifest", "Manifest ARD",
          "Serve /.well-known/ai-catalog.json with specVersion, host and entries.",
          "Sajikan /.well-known/ai-catalog.json dengan specVersion, host dan entries.",
          c.ard_manifest, controlled=_PLATFORM_OWNS),
    _impl("auth_md", 3, "bonus", "both", "Agent registration (auth.md)", "Registrasi agent (auth.md)",
          "Serve /auth.md with agent registration instructions.",
          "Sajikan /auth.md dengan petunjuk registrasi agent.", c.auth_md, controlled=_PLATFORM_OWNS),
    _impl("oauth_discovery", 3, "bonus", "both", "OAuth / OpenID Connect discovery",
          "Penemuan OAuth / OpenID Connect",
          "Publish OAuth or OpenID Connect discovery metadata so agents can authenticate.",
          "Terbitkan metadata penemuan OAuth atau OpenID Connect agar agent bisa mengautentikasi.",
          c.oauth_discovery, controlled=_PLATFORM_OWNS),
    _impl("oauth_protected_resource", 3, "bonus", "both", "OAuth protected-resource metadata",
          "Metadata protected-resource OAuth",
          "Publish /.well-known/oauth-protected-resource (RFC 9728).",
          "Terbitkan /.well-known/oauth-protected-resource (RFC 9728).",
          c.oauth_protected_resource, controlled=_PLATFORM_OWNS),
    _planned("mcp_live", 3, "bonus", "both", "MCP server answers a live connection",
             "Server MCP menjawab koneksi langsung"),
    _planned("mcp_quality", 3, "bonus", "is_agentic", "MCP tool quality", "Kualitas alat MCP"),
    _planned("web_search_discovery", 3, "bonus", "is_agentic", "Found through web search",
             "Ditemukan lewat pencarian web"),
    _planned("webmcp", 3, "bonus", "cloudflare", "WebMCP tools in the browser", "Alat WebMCP di browser"),
    _planned("dns_aid", 3, "bonus", "cloudflare", "DNS for AI Discovery (DNS-AID)", "DNS untuk AI Discovery (DNS-AID)"),
    _planned("web_bot_auth", 3, "bonus", "cloudflare", "Web Bot Auth", "Web Bot Auth"),

    # ---- Group 4: not for stores
    _not_store("api_discovery", "both", "API discovery (OpenAPI, API catalog)", "Penemuan API (OpenAPI, katalog API)"),
    _not_store("api_surface", "is_agentic", "API surface (scopes, JSON errors, onboarding)",
               "Permukaan API (scope, error JSON, onboarding)"),
    _not_store("agent_payments", "cloudflare", "Agent payments (x402, MPP)", "Pembayaran antar-agent (x402, MPP)"),
    _not_store("agent_checkout", "cloudflare", "Agent checkout (ACP)", "Checkout antar-agent (ACP)"),
]

BY_ID = {d.id: d for d in REGISTRY}
assert len(BY_ID) == len(REGISTRY), "duplicate check id"
