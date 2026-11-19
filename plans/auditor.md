# Auditor: plan (not built yet)

The Auditor is the first agent in the flow: **Auditor -> Asker -> Analyst -> Planner -> Owner -> Fixer
-> Reporter**, with the Master checking each hand-off. It checks whether the store's own website is
ready to be read and used by AI agents, and hands the findings on. Only the Asker and Analyst exist
today; this plan covers the Auditor only.

## What it is, and what it is not

- It measures **technical readiness**: can an AI agent reach the site, read its content and trust
  that the business is real. It does **not** measure whether AI assistants recommend the store. That
  is the Asker's job (Handworks is named in 0 of the answers so far).
- So the two agents answer different questions. The Auditor finds possible causes; the Asker shows
  whether anything changed.
- There is **no evidence yet** that raising a readiness score makes AI assistants name a store more
  often. That is a hypothesis. The plan below is built so Handworks can test it.

## Where the checks come from

Two public scanners, both liked by the co-founder, run on handworks.com.au on 19 Nov 2026:

| Scanner | Score | Notes |
|---|---|---|
| Is Agentic (Vercel) | 52/100, "Important blockers remain" | Snapshot dated 6 Nov, not rescanned. Essential 3 of 6 passed, recommended for commerce 5 of 8. Public website 63%, API 7%, authentication 50%, MCP 50%, commerce 100%. |
| isitagentready (Cloudflare) | 33/100, Level 1 "Basic Web Presence" | Discoverability 2/4, Content 0/1, Bot access control 1/2, API/auth/MCP/skill discovery 2/8. |

The Auditor takes the structure of both: Is Agentic's "access first, then other gaps" order, and
Cloudflare's categories with a ready-to-use fix prompt per problem. It runs the checks itself instead
of calling either scanner, so it does not depend on them and costs nothing per scan.

## What each scanner covers, and what the Auditor takes

The Auditor takes the **union** of both scanners, not one of them. Counted as capabilities (one row
can bundle several small checks). The full lists, with what each scanner tests, are in the research
page that goes with this plan.

| Overlap (both scanners) | Only Is Agentic | Only Cloudflare |
|---|---|---|
| Crawler and AI bot rules (Is Agentic tests real access, Cloudflare reads robots.txt) | Content without JavaScript (characters, H1, heading order, content ratio) | Link headers (RFC 8288) |
| Sitemap | Clean redirects; content without sign-in | DNS-AID |
| Markdown negotiation | Agent-friendly 404 (Markdown error body) | Content Signals in robots.txt |
| OAuth / OIDC discovery | Homepage not hidden from search (noindex) | Web Bot Auth (informational) |
| OAuth Protected Resource (RFC 9728) | Controls and forms understandable; page token budget | Agent Skills index |
| Agent registration (agent auth metadata vs `auth.md`) | Structured data: JSON-LD, Organization completeness, schema breadth, prices | WebMCP |
| MCP server (live connection vs MCP Server Card) | Page metadata (canonical, lang, og tags) | ARD manifest |
| API discovery (OpenAPI vs API Catalog) | Trust pages (About, Contact, Privacy) | Agent payments: x402, MPP |
| | `agents.md`, `llms.txt` quality, "when to use" guidance | Agent checkout: ACP |
| | MCP tool quality (descriptions, parameter schemas, naming, resources) | |
| | Discoverability through web search (developer docs, brand name) | |
| | API surface: scoped permissions, JSON errors, agent onboarding, function calling | |

That is 8 overlapping, 14 Is Agentic only and 9 Cloudflare only. Rules for combining them:

- Each stored check carries its source: `is_agentic`, `cloudflare` or `both`.
- An overlapping capability is reported once, using the deeper method of the two (for example the
  stricter Markdown rule from Is Agentic plus Cloudflare's `x-markdown-tokens` header).
- Groups 1 and 2 come almost entirely from Is Agentic, and group 3 almost entirely from Cloudflare,
  so one scanner alone would miss half of what the Auditor needs.
- Is Agentic's list was read from a PDF and a copied prompt, and not all 23 of its bonus signals
  were readable. There may be Is Agentic checks missing from this table.

## Checks, in four groups

Every check is code: an HTTP request and a rule. No AI decides pass or fail.

| Group | Checks (as named by the scanners) | Scored for a store? |
|---|---|---|
| **1. Access and content** | robots.txt exists; sitemap exists and is listed in robots.txt; AI crawlers not blocked (ChatGPT-User, OAI-SearchBot, Claude-User, PerplexityBot); main text in raw HTML without JavaScript, a clear H1, headings in order; homepage not hidden from search; redirects resolve cleanly | Yes |
| **2. Trust and identity** | JSON-LD Organization with description, contactPoint and address; About, Contact and Privacy pages with real content; metadata (canonical, lang, og tags); prices readable in structured data | Yes |
| **3. Agent discovery (advanced)** | llms.txt and agents.md; Markdown for agents (`Accept: text/markdown`); Markdown body on 404 pages; Link headers with useful relations; Content Signals in robots.txt; API catalog; MCP server card; agent skills index; DNS-AID | Yes, lower priority. Some may not be changeable on the store's platform. |
| **4. Not for stores** | OpenAPI spec, scoped permissions, JSON error responses, MCP resources, API docs, function-calling schemas, x402, MPP, ACP | **No.** These are for API products or agent payments. Shown as "not applicable", never as a failure. |

Weights between groups are **not set yet**. They are decided after the first before/after tests with
the Asker, not guessed now.

## Handworks baseline (19 Nov 2026)

- **Already passing:** robots.txt, sitemap, AI crawlers not blocked, llms.txt (48 lines), agents.md,
  an MCP server with 14 tools, OAuth discovery, prices in structured data, metadata.
- **Group 1 and 2 gaps:** main text is 1.9% of the page and headings jump from H1 to H4;
  Organization data lacks description, contactPoint and address; no Privacy page.
- **Group 3 gaps:** no Markdown negotiation (fails in both scanners), no Markdown 404 body, no
  agent-useful Link headers, no Content Signals, no API catalog, MCP server card, skills index or
  DNS-AID records.
- Handworks is on **Shopify** (confirmed by the owner, 19 Nov 2026). Much of the baseline is platform
  default, and some group 3 items are controlled by the platform. See the next section.

## What Shopify provides and what a store owner can change

From Shopify's own documentation and developer forum, read 19 Nov 2026. Items marked "unverified"
were not confirmed by an official page and must be tested on the store before the Auditor tells an
owner to do them.

| Item | On Shopify | Status |
|---|---|---|
| `/agents.md`, `/llms.txt`, `/llms-full.txt` | Generated by Shopify. `llms.txt` mirrors `agents.md`. The owner can override them with theme templates (`agents.md.liquid`, `llms.txt.liquid`). | Platform default, editable |
| UCP discovery and MCP endpoint | Listed in the generated `agents.md` and kept in sync by Shopify. | Platform default |
| WebMCP tools | Shopify says every Liquid storefront ships them (catalog search, cart, checkout). The Cloudflare check "WebMCP: browser session timed out" is therefore most likely a scanner timeout, not a real failure. | To re-test |
| `robots.txt` (crawler rules, Content Signals) | Editable through a `robots.txt.liquid` template. Shopify Support does not help with edits to it. | Owner can change |
| Privacy page | Settings > Customer privacy > Privacy policy, published at `/policies/privacy-policy` (the scanner looks for `/privacy`; a redirect may be needed). | Owner can change, redirect unverified |
| Organization JSON-LD (description, contactPoint, address) | The `structured_data` filter covers products and articles only. Organization data most likely needs a hand-written JSON-LD block in the theme. | Owner or developer, unverified |
| Markdown for agents (`Accept: text/markdown`) | Shopify documents an agent Markdown route, but the scan got HTML, and a developer report describes the homepage labelled as Markdown with an HTML body and 404s on product pages. | Platform-controlled, partly broken |
| Link headers | Shopify sets Link headers itself (Early Hints). Whether a merchant can add their own is not documented. | Unverified |
| Content in raw HTML, H1 and heading order | Comes from the theme. | Theme change |
| API catalog, auth.md, MCP server card, skills index, ARD, DNS-AID | No Shopify route found. DNS-AID would be DNS records, which depends on where the domain's DNS is managed. | Unverified, probably not changeable |

What this means for the Auditor on a Shopify store:
- The basics of agent readiness are already provided by Shopify, so the Auditor does not report them
  as achievements or sell them.
- Group 3 items the platform controls are shown as "platform-controlled" (informational), not as a
  failure the owner should fix.
- The work an owner can actually do is mostly groups 1 and 2: theme content and headings,
  Organization data, a Privacy page, `robots.txt.liquid`. The Auditor puts these first.

## Technical model of the two scanners

Researched 19 Nov 2026. The `is-agentic` npm package was read directly: it is only a client, the checks
run on Vercel's server and are not public. Everything else is from vendor documentation and write-ups
found through search (the vendor pages could not be opened), so figures like "118 checks" are unverified.

| | Is Agentic (Vercel, checks by Ora) | Cloudflare isitagentready |
|---|---|---|
| Interfaces | Web page, public read-only API (no key), CLI, MCP | Web page, URL Scanner API (needs an account), MCP server with `scan_site`, Radar API |
| Scan | `GET /api/v1/report?url=` returns the stored report; `GET /api/scan/stream?target=` runs a scan and streams events (check roster, check start, check complete, scan complete) | HTTP requests to the site; WebMCP tested in a real browser session; `llms.txt` only if "Customize scan" adds it |
| Output | `score`, `score_label`, `score_breakdown` (essential, recommended, bonus), `issues[]` with id, result, tier, name, evidence, fix, plus `eligible_checks` | Score, level, per-category scores; per check a goal, result, fix, prompt and a "Skill" file |
| Scoring | Essential up to 80, Recommended up to 20, Bonus up to +5 (never lowers); partial checks earn a percentage; not-applicable checks left out | Pass or fail per check rolled up per category; commerce checked but optional |
| Limits | 120 requests per IP per 60 s; errors follow RFC 9457 | None found |

Known issues reported by users for Cloudflare (unconfirmed by Cloudflare): the DNS-AID check fails valid
records when the resolver does not return authenticated data, and the `Accept` header can be stripped
between two Cloudflare-proxied sites, which may give a false negative on Markdown negotiation. For
Handworks the Markdown failure is probably real, because Is Agentic is not Cloudflare and also got HTML.

What this means for the Auditor:

1. **A score is a snapshot of a tool that is still changing.** A score can change with no change to the
   site. Every stored result records the tool, the date and the raw evidence, and before/after is
   compared only within the same tool, ideally on the same day.
2. **Our own code checks stay the core.** Reproducible, evidence stored, no cost per scan. They are
   what is reported to owners and used for the before/after test.
3. **The public APIs are an extra signal, not the core.** Is Agentic's is free, keyless and returns
   evidence and a fix per issue; Cloudflare's needs an account. Terms for automated or commercial use
   are not verified. Check them before depending on either.
4. **Data model to copy:** per check an id, tier, result (pass, partial with a percentage, fail, not
   applicable), evidence, fix text and source; per tier points earned and available; the number of
   applicable checks, with not-applicable checks left out of the score.

## Steps

| # | Step | Kind | What happens |
|---|------|------|--------------|
| 1 | Fetch | CODE | Request the homepage, robots.txt, sitemap, llms.txt, agents.md, well-known files, a probe 404 and one product page, with and without `Accept: text/markdown`. Public pages only. |
| 2 | Check | CODE | Apply each check's rule to the stored responses. Store pass, partial or fail, with the evidence (URL, status, the text that was found or missing). |
| 3 | Group and score | CODE | Group 1 first, then 2, then 3. Group 4 is marked not applicable. |
| 4 | Fix text | CODE + AI | Each check has a fixed fix text. AI only adapts the wording to the store's platform and writes the "copy prompt". Code verifies the prompt names the same check and the same URL. |
| 5 | Hand off | CODE | Findings go to the Planner (later). A change since the last scan is recorded. |

Master check after the Auditor: every check in the list has a stored result, and every failure has
its evidence.

## Before and after with the Asker

This is what the single scanners do not offer. For each store: scan, apply a fix (by the owner at
first), scan again, and compare the Asker's counts before and after. Reports show the range over
several shifts, as the Asker plan does, and say plainly when nothing changed. A score is never
reported as a cause until the data shows it.

## Cost

- The checks are plain HTTP requests, so the AI cost is close to zero. Only step 4 uses a model, with
  one short call per failed check. It is not measured yet.
- Server cost is covered by the same server as the rest of the app (see the cost page).

## Not now

- Changing the website. The Fixer comes later, and only after the owner approves each change.
- Feeding topics to the Asker. Topics are still set by hand per store; this stays as an idea.
- Calling Is Agentic or Cloudflare from code. We run our own checks.

## Open questions

1. Test the "unverified" Shopify items on a real store before the Auditor recommends them (Link
   headers, `/privacy` redirect, Organization JSON-LD in the theme, well-known files).
2. Check the terms of use of both scanners' APIs (not reachable from the research environment).
3. Rescan Is Agentic (the snapshot is from 6 Nov) before using it as a baseline, and rescan
   Cloudflare to see whether the WebMCP timeout repeats.
4. How many pages to sample per store besides the homepage and one product page.
5. Which checks matter most for being named by AI assistants. Answered later, with Asker data.
6. Other platforms (WordPress, Wix, custom) need their own "what can the owner change" table.

## Sources for the Shopify section

Shopify: [Customize robots.txt](https://shopify.dev/docs/storefronts/themes/seo/robots-txt),
[agents.md.liquid](https://shopify.dev/docs/storefronts/themes/architecture/templates/agents-md-liquid),
[llms.txt.liquid](https://shopify.dev/docs/storefronts/themes/architecture/templates/llms-txt-liquid),
[WebMCP tools](https://shopify.dev/docs/api/web-mcp),
[structured_data filter](https://shopify.dev/docs/api/liquid/filters/structured_data),
[privacy policy settings](https://help.shopify.com/en/manual/privacy-and-security/privacy/customer-privacy-settings/privacy-settings).
Forum report on Markdown: [Storefront returns 404 with Accept: text/markdown](https://community.shopify.dev/t/storefront-returns-404-for-product-and-collection-pages-when-requested-with-accept-text-markdown/38079).
