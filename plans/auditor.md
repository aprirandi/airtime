# Auditor: plan (checks and scoring built, 19 Nov 2026)

The Auditor is the first agent in the flow: **Auditor -> Asker -> Analyst -> Planner -> Owner -> Fixer
-> Reporter**, with the Master checking each hand-off. It checks whether the store's own website is
ready to be read and used by AI agents, and hands the findings on. Only the Asker and Analyst exist
today; this plan covers the Auditor only.

**Built:** the engine in `airtime/agents/auditor/`: an HTTP fetcher, a snapshot of the site, 24 checks
(`registry.py` lists them with their group, tier, source scanner and fix text in English and
Indonesian), scoring, the agent with its five steps, a Master check, the `audits` and `audit_checks`
tables, `python -m airtime audit`, a manual workflow (`audit.yml`), the export to the site and a
"Website readiness" card on the dashboard. 24 of the 33 checks that apply to a store are implemented. **Not built:**
the checks marked planned in the registry (MCP quality and live connection, WebMCP, DNS-AID, Web Bot
Auth, web-search discovery, controls and token budget, schema breadth), the AI step that adapts fix
text, and a schedule. **Not yet verified:** a scan of the real site (the research environment cannot
reach it), and the scores against Is Agentic (52) and Cloudflare (33) on the same day.

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

The full list of 37 checks, the platform rules and the verify command for each built check are in
[check-registry.md](check-registry.md), generated from the code.

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
- Group 3 items the platform controls count in the score (changed 23 Nov 2026) but are listed as "held back
  by the platform", with no fix prompt, because the owner cannot fix them.
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
3. **The public APIs are an extra signal, not the core. (Built 23 Nov 2026 for Is Agentic: see "Is Agentic as a second opinion".)** Is Agentic's is free, keyless and returns
   evidence and a fix per issue; Cloudflare's needs an account. Terms for automated or commercial use
   are not verified. Check them before depending on either.
4. **Data model to copy:** per check an id, tier, result (pass, partial with a percentage, fail, not
   applicable), evidence, fix text and source; per tier points earned and available; the number of
   applicable checks, with not-applicable checks left out of the score.

## Is Agentic as a second opinion (built 23 Nov 2026)

Decision (23 Nov 2026): use Is Agentic's API as a second source, beside our own engine, not instead of it.

What the live API showed for Handworks:
- `GET /api/v1/report?url=` (documented, stable `v1`, free, no key, 120 requests per 60 s per IP) returns the
  score, `score_breakdown` and only the **failed or partial** issues (id, name, tier, result, details,
  recommendation). Passed checks are not listed. It never starts a scan: with no stored report it answers 404.
- A scan is started through `/api/scan/stream` (not in their OpenAPI file; it is what their CLI does). Its
  final event carries every check with pass, fail or na.
- Their score for Handworks was **54** ("Important blockers remain") from the report API and **60** (grade C,
  scoring version 2) from the scan stream, seconds apart. Four of the essential failures were API-product
  checks (OpenAPI spec, scoped permissions, JSON error responses, MCP resources), which our registry files under
  "not for stores". So their number is not a grade for a store and is never mixed into ours.
- Their roster also has checks we cannot run from the site alone: brand name discoverability, developer
  resource discoverability (both use web search), Wikipedia/Wikidata presence, MCP registry listings.

Terms of use (is-agentic.com/terms, updated 19 Aug 2026, read 23 Nov 2026): reports are public; scores are
"informational snapshots, not certifications" that can change with Ora's methodology; they may change limits
or discontinue any part of the service without notice; do not overload, scrape or circumvent limits; do not
imply endorsement. Commercial use for a client is not mentioned either way. We make at most 3 requests per
audit, link to their report and label it as theirs.

How it is built: `agents/auditor/isagentic.py` (client, id mapping, classification), step `external_scan`
(stores the report in `external_reports`, or why it was unavailable; never fails the audit), `report.py`
(exports it and an agreement count on the checks both sides run; bonus checks are left out of the count
because their report never lists a missed bonus check). Each issue is `mapped` (same check as one of ours),
`api_product` (not for stores) or `extra` (shown, not scored). For Handworks 7 of 7 comparable checks agree.

Open: the passed checks and the per-check scores are only in the scan stream. We read the documented report
and infer "not listed" for the rest. If the extra checks should one day be scored, that needs their stream.

## Scoring (as built)

- Tiers follow Is Agentic: essential up to 80 points, recommended up to 20, bonus up to 5 more that never
  lowers the score. A partial check earns its percentage; checks that do not apply or are planned are
  left out. Group scores (1 to 3) are the share of points earned in the group and need no weights.
- Labels: 80 and above "strong", 60 and above "needs work", below that "important blockers remain".
  These thresholds are the ones Is Agentic's command-line tool uses to colour its score.
- The weights are provisional. They exist to order the gaps, and are tuned with before and after data
  from the Asker. Scores are only comparable between scans by the same `engine` version.
- **Platform rule (changed 23 Nov 2026, engine 2).** The product promise is a number for how ready a site
  is for AI, and fixes for it, whatever the platform. So a check the platform controls (Shopify: Markdown
  negotiation, Link headers, the `.well-known` files) **counts in the score**, because an agent is affected
  whoever can change the cause. The platform only changes the fix: those gaps are listed separately as
  "held back by the platform" with the reason, and get no fix prompt. Engine 1 left them out; on Handworks
  that was 89.4 against 70.0 with them counted. Scores of engine 1 and 2 are not comparable.

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
