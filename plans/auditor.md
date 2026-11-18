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

## Checks, in four groups

Every check is code: an HTTP request and a rule. No AI decides pass or fail.

| Group | Checks (as named by the scanners) | Scored for a store? |
|---|---|---|
| **A. Access and content** | robots.txt exists; sitemap exists and is listed in robots.txt; AI crawlers not blocked (ChatGPT-User, OAI-SearchBot, Claude-User, PerplexityBot); main text in raw HTML without JavaScript, a clear H1, headings in order; homepage not hidden from search; redirects resolve cleanly | Yes |
| **B. Trust and identity** | JSON-LD Organization with description, contactPoint and address; About, Contact and Privacy pages with real content; metadata (canonical, lang, og tags); prices readable in structured data | Yes |
| **C. Agent discovery (advanced)** | llms.txt and agents.md; Markdown for agents (`Accept: text/markdown`); Markdown body on 404 pages; Link headers with useful relations; Content Signals in robots.txt; API catalog; MCP server card; agent skills index; DNS-AID | Yes, lower priority. Some may not be changeable on the store's platform. |
| **D. Not for stores** | OpenAPI spec, scoped permissions, JSON error responses, MCP resources, API docs, function-calling schemas, x402, MPP, ACP | **No.** These are for API products or agent payments. Shown as "not applicable", never as a failure. |

Weights between groups are **not set yet**. They are decided after the first before/after tests with
the Asker, not guessed now.

## Handworks baseline (19 Nov 2026)

- **Already passing:** robots.txt, sitemap, AI crawlers not blocked, llms.txt (48 lines), agents.md,
  an MCP server with 14 tools, OAuth discovery, prices in structured data, metadata.
- **Group A and B gaps:** main text is 1.9% of the page and headings jump from H1 to H4;
  Organization data lacks description, contactPoint and address; no Privacy page.
- **Group C gaps:** no Markdown negotiation (fails in both scanners), no Markdown 404 body, no
  agent-useful Link headers, no Content Signals, no API catalog, MCP server card, skills index or
  DNS-AID records.
- The site looks like Shopify (`/products/...` paths, an MCP server named "universal-commerce").
  To confirm with the owner. If so, much of the baseline is platform default, and some group C items
  may not be changeable at all.

## Steps

| # | Step | Kind | What happens |
|---|------|------|--------------|
| 1 | Fetch | CODE | Request the homepage, robots.txt, sitemap, llms.txt, agents.md, well-known files, a probe 404 and one product page, with and without `Accept: text/markdown`. Public pages only. |
| 2 | Check | CODE | Apply each check's rule to the stored responses. Store pass, partial or fail, with the evidence (URL, status, the text that was found or missing). |
| 3 | Group and score | CODE | Group A first, then B, then C. Group D is marked not applicable. |
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

1. Is Handworks on Shopify? Which of group C can the platform actually change?
2. Rescan Is Agentic (the snapshot is from 6 Nov) before using it as a baseline.
3. How many pages to sample per store besides the homepage and one product page.
4. Which checks matter most for being named by AI assistants. Answered later, with Asker data.
