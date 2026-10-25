# Asker: next version (plan, not built yet)

Today the Asker runs every day on the Gemini free tier: 3 core questions x 2 tries plus 6 new
questions x 1 try, written from the store profile. This plan moves it to a weekly shift with
questions taken from the customer's own Google Search Console (GSC) data.

## Schedule

- **Once a week.** A fix made by the Fixer takes days to weeks to show in AI answers, so measuring
  every day adds cost without adding information. The flow stays one waterfall per week:
  Asker -> Analyst -> Planner -> Owner -> Fixer, and next week's Asker shift measures the result.
- **10 questions x 3 tries** to each AI. Three tries per question make up for having one shift a
  week instead of seven.
- **Reports show the range over the last 4 weeks**, not just this week's number.

## Questions: 8 fixed + 2 new

| Kind | How many | Where they come from | Used for |
|------|----------|----------------------|----------|
| Fixed | 8 | Top GSC queries, chosen once | Headline numbers and week-to-week trend |
| New | 2 a week | GSC queries that are rising, or gaps GSC cannot show | "Found this week", reported apart from the trend |

Trends and the headline count use only the 8 fixed questions, so a change from one week to the
next is never caused by asking different questions.

## Steps

| # | Step | Kind | What happens |
|---|------|------|--------------|
| 1 | Read GSC | CODE | Connect Google (read-only OAuth). Pull queries for the last 90 days with clicks, impressions and position. |
| 2 | Filter | CODE | Drop queries that name our store (an AI always names a store that is in the question), queries with no buying intent, and duplicates. Keep queries that name a product or category the store sells. Prefer queries that name a place. |
| 3 | Rewrite as questions | AI | Turn each kept query into the full question a shopper would type into an AI app ("stationery shop prahran" -> "Where can I buy nice stationery in Prahran?"). |
| 4 | Check the rewrite | CODE | The question keeps every place and product word from the query, adds no store name, and passes the existing question validation. Rejected rewrites are dropped. |
| 5 | Pick | CODE | First shift: the 8 fixed questions, ranked by impressions, at most 2 per category. Every shift: 2 new questions (rising GSC queries first). |
| 6 | Ask | CODE | Same as today: every question 3 times to each AI, full answer stored. |

**Questions GSC cannot give.** GSC only lists searches where the store already appeared, and it
hides rare searches. So the 2 new questions can also come from the store profile: categories the
store sells that are missing from GSC, or questions that return competitors. A fixed question can be
replaced by a better one only by the owner, and the report marks that week.

**No GSC (not connected, or too little data):** questions are written from the store profile, as
they are today.

**What no source gives:** the exact questions people type into ChatGPT or Claude. AI companies do
not share them. GSC is the closest real signal.

## Cost and limits

- Paid APIs, 4 AIs with web search: about $22 a month per store (10 x 3 x ~4.3 shifts, ~$0.16 per
  question to all 4 AIs, plus ~$1 for the other agents). Spending cap: $30 a month per store.
- GSC and GA data: free.
- On today's Gemini free tier (about 20 asks a day on 3.8 Flash), 30 asks do not fit in one day:
  use 2 tries per question, or split the shift over 2 days, until the paid API is on.
- Customer GSC data must not be sent to a free-tier model, since Google may use free-tier content.
  Steps 1 to 5 run on paid APIs only.
