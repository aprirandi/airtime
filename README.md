# Airtime

Airtime agents measure how often AI assistants name a store when shoppers ask them for help.

This MVP has one agent, the **Visibility agent**. Every day it asks Gemini the questions a
store's buyers would ask, records which stores each answer names, and reports how often our
store is named compared with competitors. The first test store is Handworks
(handworks.com.au, Prahran and Brighton, Melbourne).

What it does not do: change any website, recommend fixes, promise rankings or sales, use paid
APIs, or show any UI beyond a static report.

## The daily run

Code decides anything that can be counted or checked. AI only reads and writes language.

| # | Step | Kind | What happens |
|---|------|------|--------------|
| 1 | Write questions | AI | Two kinds. **Core** questions are the same every day so days can be compared (Handworks: 3 from the 14 Oct manual run, set in the config). **Daily** questions are new each morning: the AI writes 6 from the store profile; code drops any that name our store, name no place (Melbourne, Prahran, Brighton, Australia), or repeat a question from the last 14 days. If writing them fails, the core questions still go out. |
| 2 | Validate questions | CODE | Every run. Rejects empty, too-short, duplicate and near-duplicate questions; requires at least one question naming a store area. The run fails loudly if the list is invalid. |
| 3 | Ask | CODE | Every question N times (default 3). Stores full raw response, timestamp, provider, channel, model, attempt. Backs off on rate limits. Failed or empty answers are stored as `no_answer`, never dropped. Refuses to start if the planned calls exceed the call budget. |
| 4 | Extract mentions | AI | Per answer, strict JSON: stores named in order, rank if it is a list, tone toward our store, and an exact quote per store. |
| 5 | Verify and count | CODE | Every quote must appear verbatim in the stored answer; our store's name in the text must match what was extracted. On failure step 4 is retried once with the problems listed; if still wrong the answer becomes `needs_review` and is not counted. Then counts: ours X of N, top competitor Y of N, rate with and without an area in the question. |
| 6 | Compare | CODE | Against the previous run of the same provider and channel. Reports changes, no-changes and zeros, plus the range over the last 7 runs. |
| 7 | Summary | AI + CODE | The AI writes a 2-3 sentence template using `{placeholders}`, never digits. Code fills in the stored counts, then rejects the text if any number, "X of Y" pair or percentage does not match the stored row, or if it states causes, promises, rankings or prices. After two rejections a summary written by code is used, and the report says so. |

Every run is logged in the `runs` table with each step's kind, status and result.

## Layout

```
airtime/
  core/agent.py              Step / Agent / Flow framework (CODE vs AI steps, run log)
  providers/base.py          Provider interface: ask(question) -> Answer(text, sources, timestamp, raw)
  providers/gemini.py        GeminiProvider (REST, free-tier key)
  providers/fake.py          Deterministic provider used by tests
  agents/visibility/         The 7 steps, one module per concern
  importer.py                Import answers pasted from ChatGPT / Claude / Gemini apps
  channels.py                Compare two sources, e.g. Gemini API vs Gemini app
  report.py                  Static HTML report in docs/
config/stores/handworks.toml Store config (public facts only)
data/airtime.sqlite          All stored questions, answers, mentions and daily summaries
data/seed/                   Handworks manual baseline and a CSV template for pasted answers
web/                         Report website (React + Vite + Tailwind + shadcn/ui), built into docs/
docs/                        GitHub Pages: built website + docs/data/*.json exported from SQLite
```

Tables: `stores`, `questions`, `runs`, `answers`, `mentions`, `daily_summary`. Every
`daily_summary` row points to its `run_id`, which leads to every answer and every verified quote.

## Running it

Needs Python 3.11+, no runtime dependencies.

```bash
export GEMINI_API_KEY=...                       # from Google AI Studio; never commit it
python -m airtime seed --store handworks        # register store, load 14 Oct baseline
python -m airtime plan --store handworks        # planned calls vs budget
python -m airtime run --store handworks         # one daily run, then rewrites docs/data/
python -m airtime import --store handworks data/seed/my_pasted_answers.csv
python -m airtime compare --store handworks --a gemini:api --b gemini:app_pasted
python -m airtime export                        # rewrite docs/data/*.json only
python -m airtime recheck --store handworks --run-id 1   # re-check needs_review answers
pip install pytest && python -m pytest -q
```

### Report website

`docs/` holds the built website and `docs/data/`, the JSON it reads. It has two menus:

- **Dashboard**: real counts from every shift (findings, day-by-day chart, who gets recommended,
  work diary, every answer and verified quote per day). It re-reads its data on its own and
  shows a live banner while the agent works.
- **AI Agents**: *Team* is the "Airtime HQ" office where the Visibility Agent replays its last
  shift (or shows the step it is on right now) plus an employee card per agent, with empty desks
  for the planned ones; *Data flow* shows how the data is gathered, step by step, with the real
  numbers from the last shift and one real answer followed from question to count.

Live progress: while the agent runs, `airtime/live.py` rewrites `docs/data/live.json` on every
event, and the daily workflow commits that file every 7 minutes (GitHub Pages allows about 10
deploys an hour). Between shifts the site shows the last shift and the time of the next one.

The daily run only rewrites `docs/data/`, so it needs no Node. After changing anything in `web/`:

```bash
cd web && npm ci && npm run build   # builds into docs/, then re-exports docs/data/
```

### Pasted app answers

ChatGPT, Claude and Gemini app answers can be pasted into a CSV or JSON file
(template: `data/seed/pasted_answers_template.csv`; columns `question, provider, channel,
attempt, asked_at, text, sources`) and imported. They are stored with `channel = app_pasted`
and go through steps 4 to 7 exactly like API answers. Each provider, channel and date is its
own series, so API and app numbers are never mixed.

### Daily schedule

`.github/workflows/daily.yml` runs at 20:17 UTC (early morning in Melbourne). It runs the
tests, checks the call plan, runs the agent, and commits `data/airtime.sqlite` and `docs/`
back to the repo. A failed run is still committed (the `runs` row records why) and the job
then fails so it is visible. One-time setup:

1. Settings > Secrets and variables > Actions: add `GEMINI_API_KEY`.
2. Settings > Pages: deploy from branch `main`, folder `/docs`.
3. Actions > Daily visibility run > Run workflow, to try it once by hand.

## Adding things later

- **Another AI** (ChatGPT, Claude): subclass `Provider` with `_ask` and `_complete`, register
  it in `airtime/providers/__init__.py:make_provider`, add its key as a secret. Nothing else changes.
- **Another agent** (Auditor, Planner, Fixer, Reporter): subclass `Agent`, list its `Step`s
  with their kind, and add it to the `Flow` in `cli.py`. A Master check is the `master_check`
  callback on `Flow`; it runs after all agents and fails the run if it returns problems.
- **Another store**: add `config/stores/<slug>.toml` and a line in the workflow.

## Settled and open questions

- **Repo visibility:** public, so GitHub Actions minutes are free. This also means
  `data/airtime.sqlite` and `docs/` are public; they only hold public questions and AI answers.
- **Web search:** the Gemini API answers without web search unless grounding is turned on
  (`use_search` in the config, off by default). The report states this on every page and counts
  answers that did use search. The Gemini app normally searches, so expect differences.
- **Free-tier limits:** read in AI Studio (Rate limit page) on 24 Oct 2026: Gemini 3.8 Flash
  allows 5 requests per minute and about 20 per day (peak use 23, bar full); Gemini 3.5 Flash Lite
  15 per minute with far more daily headroom. So the agent asks 3 core questions x 2 tries plus
  6 new questions x 1 try = 12 calls a day on 3.8 Flash (hard cap 14) and about 14 on 3.5 Flash Lite (cap 40). When Gemini reports the
  daily quota as used up, the agent stops calling that model for the rest of the run instead of
  retrying, and records the remaining asks as `no_answer`. Quotas reset daily; with no billing
  account on the project there is nothing to pay. `python -m airtime plan` shows the numbers.
- **Free-tier data use:** Google may use free-tier content. Only public questions and public
  store facts are sent; never put customer data in the config or questions.
- **Baseline:** the 14 Oct 2026 manual run (Handworks 3 of 14, Milligram 10 of 14, 2 of 2 with
  an area vs 1 of 12 without) is stored as totals only, as `mixed / app_pasted`. It mixes
  ChatGPT, Gemini and Claude, so it is a reference point, not a like-for-like comparison with
  the Gemini API series. Importing the pasted answer texts makes it traceable to quotes and
  enables the Gemini API vs Gemini app comparison question by question.
- **Variance:** answers vary a lot from run to run. Read the multi-day ranges, not one day.
