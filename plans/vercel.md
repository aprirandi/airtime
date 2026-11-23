# Putting the website check on Vercel

What this is: the page where anyone types a website address and gets the score, what to fix first and a prompt
for each fix (like Is Agentic or Cloudflare's checker). The page and the checking service are one Vercel project.

## What is in the repo

| Part | Where | Notes |
|---|---|---|
| The page | `web/` (Vite + React) | `#/` is the address form, `#/check/<address>?platform=shopify` is a result you can link to. English at `/`, Indonesian at `/id/`. |
| The checking service | `api/audit.ts` | A Vercel function. `GET /api/audit?url=...&platform=...` or `POST` with `{"url": "...", "platform": "shopify"}`. |
| The engine | `engine/src/` (TypeScript) | Fetcher, HTML reader, robots.txt reader, 24 checks, scoring, fix prompts. Checked against the Python engine (see below). |
| Settings | `vercel.json`, `tsconfig.json`, `.vercelignore` | Install and build commands, the output folder, 60 seconds for the function. |

The daily-shift pages (Asker and Analyst results, the agent team, the store's check list) are hidden: not in the menu,
still reachable at `#/dashboard`, `#/agents/team`, `#/checks`. Set `VITE_SHOW_ANALYSIS=1` at build time to show the menu.

## What you do (I cannot do this from here)

1. Create a Vercel account and choose **Add New > Project**, then import `aprirandi/airtime` from GitHub.
2. Leave **Root Directory** as the repo root and **Framework Preset** as "Other". Everything else comes from `vercel.json`
   (install: `npm ci` in `engine` and `web`; build: `npm run build:site --prefix web`; output: `web/dist`).
3. No environment variables are needed. Deploy.
4. Try it: open the project address, type a website, and also run
   `curl -X POST https://YOUR-PROJECT.vercel.app/api/audit -H 'content-type: application/json' -d '{"url":"handworks.com.au","platform":"shopify"}'`.
5. If the build or the function fails, send me the log: this configuration was compiled and run here (the function as
   CommonJS under Node, the site build, the whole flow in a browser against recorded sites) but has never run on Vercel.

## Things to know

- **Licence.** Vercel's free Hobby plan is for personal, non-commercial use. A product you bill clients for needs a paid
  plan. Check Vercel's current terms before launch.
- **Abuse.** The service visits any public website a visitor types, so it is limited: ordinary web names only (no IP
  numbers, no odd ports, no logins in the address), 10 checks per visitor per 10 minutes, one scan per site and platform
  every 10 minutes, and the fetcher refuses private networks at the moment it connects. The visitor limit and the
  10-minute memory live inside one running function, so they are best effort: Vercel can run several copies, and each
  starts empty. Before a public launch add a Vercel Firewall rate-limit rule on `/api/audit`, or a shared store.
- **Time.** A scan takes 1 to 5 seconds (the Python engine took 4 to 17). The function is allowed 60 seconds and gives
  up after 50.
- **Only Shopify has platform tips.** The score does not depend on the platform; the platform only changes the fix
  advice and which gaps are "held back by the platform".
- **The Is Agentic second opinion is not in this service.** It stays with the store audit in `airtime/`, because it
  creates a public report on Is Agentic's site for the address scanned, which is not right for anyone's website.
- **GitHub Pages** (`docs/`) is still built by `npm run build` and shows the same page, but has no checking service
  unless the build is given `VITE_API_URL=https://YOUR-PROJECT.vercel.app`.

## How the engine is kept the same as the Python one

- `python -m airtime.agents.auditor.golden` writes the registry and scoring/prompt cases the TypeScript engine reads.
- `python tests/engine_replay.py` records the Python engine's visits to 52 fake sites and what it concluded; the
  TypeScript tests replay the same pages and must conclude the same for every check. Python tests fail when either file
  is out of date; CI runs the TypeScript tests.
- The `Engine parity` workflow runs both engines on live sites and compares every check. On 23 Nov 2026: 10 sites
  (Handworks, Allbirds, Gymshark, WooCommerce, Etsy, NYTimes, example.com, WordPress.org, Vercel, BBC), 370 of 370 checks
  identical, the TypeScript engine 2 to 7 times faster. It found two real bugs (a request header that changed a shop's
  currency, and a private-address rule that blocked Automattic's public range), both fixed.
- Both engines read robots.txt by RFC 9309 (wildcards, longest match). That is Python 3.13's reader, so Python is 3.13
  everywhere.
