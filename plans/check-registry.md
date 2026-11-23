# Check registry and platform rules

Generated from `airtime/agents/auditor/registry.py`. Do not edit by hand: run `python -m airtime.agents.auditor.registry_doc > plans/check-registry.md`.

**37 checks**: 24 built, 9 planned, 4 not for stores.

Tiers: **essential** (up to 80 points), **recommended** (up to 20), **bonus** (up to +5, never lowers the score). Source is the scanner the check comes from. A check both scanners run is reported once.

## Group 1: Access and content

| Check | Name | Tier | Source | Status |
|---|---|---|---|---|
| `robots_txt` | robots.txt exists | recommended | Cloudflare | built |
| `ai_crawlers_allowed` | AI crawlers can reach the site | essential | Both | built |
| `sitemap` | Sitemap exists | recommended | Both | built |
| `raw_html_content` | Content available without JavaScript | essential | Is Agentic | built |
| `redirects_clean` | Redirects resolve cleanly | essential | Is Agentic | built |
| `public_no_login` | Content available without signing in | essential | Is Agentic | built |
| `not_noindex` | Homepage not hidden from search | recommended | Is Agentic | built |
| `not_found_markdown` | Agent-friendly 404 pages | essential | Is Agentic | built |
| `controls_labelled` | Controls and forms are understandable | essential | Is Agentic | planned |
| `page_token_budget` | Pages fit an agent's context budget | recommended | Is Agentic | planned |

## Group 2: Trust and identity

| Check | Name | Tier | Source | Status |
|---|---|---|---|---|
| `jsonld_organization` | Organization data in JSON-LD | recommended | Is Agentic | built |
| `organization_completeness` | Organization contact details and address | recommended | Is Agentic | built |
| `metadata_complete` | Page metadata is complete | recommended | Is Agentic | built |
| `pricing_structured` | Prices readable in structured data | recommended | Is Agentic | built |
| `trust_pages` | About, Contact and Privacy pages | recommended | Is Agentic | built |
| `schema_breadth` | Breadth of schema types | bonus | Is Agentic | planned |

## Group 3: Agent discovery

| Check | Name | Tier | Source | Status |
|---|---|---|---|---|
| `markdown_negotiation` | Markdown content negotiation | essential | Both | built |
| `llms_txt` | llms.txt exists and its links work | bonus | Is Agentic | built |
| `agents_md` | agents.md exists | bonus | Is Agentic | built |
| `content_signals` | Content Signals in robots.txt | recommended | Cloudflare | built |
| `link_headers` | Link headers for agent discovery | bonus | Cloudflare | built |
| `mcp_server_card` | MCP server card | bonus | Both | built |
| `agent_skills_index` | Agent skills index | bonus | Cloudflare | built |
| `ard_manifest` | ARD manifest | bonus | Cloudflare | built |
| `auth_md` | Agent registration (auth.md) | bonus | Both | built |
| `oauth_discovery` | OAuth / OpenID Connect discovery | bonus | Both | built |
| `oauth_protected_resource` | OAuth protected-resource metadata | bonus | Both | built |
| `mcp_live` | MCP server answers a live connection | bonus | Both | planned |
| `mcp_quality` | MCP tool quality | bonus | Is Agentic | planned |
| `web_search_discovery` | Found through web search | bonus | Is Agentic | planned |
| `webmcp` | WebMCP tools in the browser | bonus | Cloudflare | planned |
| `dns_aid` | DNS for AI Discovery (DNS-AID) | bonus | Cloudflare | planned |
| `web_bot_auth` | Web Bot Auth | bonus | Cloudflare | planned |

## Group 4: Not for stores

| Check | Name | Tier | Source | Status |
|---|---|---|---|---|
| `api_discovery` | API discovery (OpenAPI, API catalog) | bonus | Both | n/a |
| `api_surface` | API surface (scopes, JSON errors, onboarding) | bonus | Is Agentic | n/a |
| `agent_payments` | Agent payments (x402, MPP) | bonus | Cloudflare | n/a |
| `agent_checkout` | Agent checkout (ACP) | bonus | Cloudflare | n/a |

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

## Platform rules

### Shopify

**Controlled by the platform (9).** Scored, but the owner cannot fix them, so no fix prompt:

| Check | Why the owner cannot fix it |
|---|---|
| `not_found_markdown` | Shopify serves 404 pages; a Markdown error body is not something the owner can change. |
| `markdown_negotiation` | Shopify controls this and its Markdown route is not reliable yet. |
| `link_headers` | Shopify sets Link headers itself; whether an owner can add their own is not documented. |
| `mcp_server_card` | Shopify controls this and the owner cannot change it. |
| `agent_skills_index` | Shopify controls this and the owner cannot change it. |
| `ard_manifest` | Shopify controls this and the owner cannot change it. |
| `auth_md` | Shopify controls this and the owner cannot change it. |
| `oauth_discovery` | Shopify controls this and the owner cannot change it. |
| `oauth_protected_resource` | Shopify controls this and the owner cannot change it. |

**Where the owner makes the change (9).** Shown in the fix prompt:

| Check | Hint |
|---|---|
| `robots_txt` | Shopify generates robots.txt. Change it through the robots.txt.liquid template. |
| `raw_html_content` | This comes from the theme: change the heading levels in the theme's sections so the first heading is an H1. |
| `jsonld_organization` | Shopify's structured_data filter does not output Organization data: add a JSON-LD block to the theme layout (not verified). |
| `organization_completeness` | Add them in the same JSON-LD block in the theme layout (not verified). |
| `pricing_structured` | Shopify's structured_data filter outputs Product data: check that the theme uses it. |
| `trust_pages` | Privacy: Settings > Customer privacy > Privacy policy, published at /policies/privacy-policy. |
| `llms_txt` | Shopify generates it from agents.md; override it with the llms.txt.liquid template. |
| `agents_md` | Shopify generates it; override it with the agents.md.liquid template. |
| `content_signals` | Add it through the robots.txt.liquid template. |

## How to verify a built check by hand

| Check | Command | Expect |
|---|---|---|
| `robots_txt` | `curl -sS -i {site}/robots.txt` | HTTP 200, at least one User-agent line, and a Sitemap line. |
| `ai_crawlers_allowed` | `curl -sS -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0 (compatible; ChatGPT-User/1.0)' {site}/` | 200 for ChatGPT-User, OAI-SearchBot, Claude-User and PerplexityBot (change the name after -A), and no Disallow for them in robots.txt. |
| `sitemap` | `curl -sS {site}/sitemap.xml | head -20` | A <urlset> or <sitemapindex> with <loc> entries, and a Sitemap line in robots.txt. |
| `raw_html_content` | `curl -sS {site}/ | grep -io '<h[1-6][^>]*>' | head -20` | The first heading is <h1> and levels never skip (h1, h2, h3). The raw HTML has at least 500 characters of text. |
| `redirects_clean` | `curl -sSIL {site}/ | grep -iE '^(HTTP|location)'` | At most three redirects (301), ending in HTTP 200, and no meta-refresh in the HTML. |
| `public_no_login` | `curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' -L {site}/` | 200, and the final URL is not a login or password page. |
| `not_noindex` | `curl -sSI {site}/ | grep -i x-robots-tag; curl -sS {site}/ | grep -i 'name="robots"'` | No noindex in either result. |
| `not_found_markdown` | `curl -sS -i -H 'Accept: text/markdown' {site}/a-page-that-does-not-exist` | HTTP 404 with Content-Type: text/markdown and a short message that links to the sitemap. |
| `jsonld_organization` | `curl -sS {site}/ | grep -o 'application/ld+json' | head -3` | An Organization (or LocalBusiness) JSON-LD block with a name and a description. Test it at validator.schema.org. |
| `organization_completeness` | `curl -sS {site}/ | grep -o 'contactPoint\|PostalAddress' | sort -u` | Both contactPoint and PostalAddress appear in the Organization JSON-LD. |
| `metadata_complete` | `curl -sS {site}/ | grep -iE 'rel="canonical"|og:image|og:type|<html[^>]*lang'` | A canonical link, lang on <html>, og:image and og:type. |
| `pricing_structured` | `curl -sS <product-page-url> | grep -o '"price"[^,]*\|priceCurrency[^,]*'` | offers.price and offers.priceCurrency in the product's JSON-LD. |
| `trust_pages` | `curl -sS -o /dev/null -w '%{http_code}\n' {site}/policies/privacy-policy` | HTTP 200 for each of the About, Contact and Privacy pages (use their real URLs), each with at least 500 characters of text and linked from the footer. |
| `markdown_negotiation` | `curl -sS -i -H 'Accept: text/markdown' {site}/` | Content-Type: text/markdown, Vary: Accept and a Markdown body. The same URL with Accept: text/html still returns HTML. |
| `llms_txt` | `curl -sS -i {site}/llms.txt` | HTTP 200 text with Markdown links that all open. |
| `agents_md` | `curl -sS -i {site}/agents.md` | HTTP 200 and Content-Type text/markdown or text/plain. |
| `content_signals` | `curl -sS {site}/robots.txt | grep -i content-signal` | A Content-Signal line with ai-train, search and ai-input each set to yes or no. |
| `link_headers` | `curl -sSI {site}/ | grep -i '^link'` | A Link header with rel="api-catalog", "service-doc" or a similar useful relation. |
| `mcp_server_card` | `curl -sS -i {site}/.well-known/mcp/server-card.json` | HTTP 200 JSON with serverInfo.name and serverInfo.version. |
| `agent_skills_index` | `curl -sS -i {site}/.well-known/agent-skills/index.json` | HTTP 200 JSON with $schema and a skills array; each entry has name, type, description, url and sha256. |
| `ard_manifest` | `curl -sS -i {site}/.well-known/ai-catalog.json` | HTTP 200 JSON with specVersion, host and entries. |
| `auth_md` | `curl -sS -i {site}/auth.md` | HTTP 200 text with agent registration instructions. |
| `oauth_discovery` | `curl -sS -i {site}/.well-known/openid-configuration` | HTTP 200 JSON with an issuer. |
| `oauth_protected_resource` | `curl -sS -i {site}/.well-known/oauth-protected-resource` | HTTP 200 JSON with a resource. |
