"""Step 7: the AI writes a short owner summary with placeholders; CODE fills and checks it.

The AI never sees or types a number. It writes a template such as
"{store} was named in {our_mentions} of {total_answers} answers." Code fills the
placeholders from the stored counts, then rejects the text if any number in it does not
match those counts, if it states causes or promises, or mentions prices.
If the AI fails twice, a summary written entirely by code is used and labelled as such.
"""

from __future__ import annotations

import json
import re
import string

from airtime.agents.visibility.compare import scope_label
from airtime.providers.base import ProviderError

NUMBER_FIELDS = (
    "our_mentions", "total_answers", "our_pct", "top_competitor_mentions", "area_mentions",
    "area_answers", "no_area_mentions", "no_area_answers", "no_answer", "needs_review", "asked",
    "prev_our_mentions", "prev_total_answers",
)
TEXT_FIELDS = ("store", "scope", "top_competitor", "areas", "prev_date", "our_change")

BANNED = re.compile(
    r"\$|£|€|\bprice|\bpricing|\bcost|\bbudget|\bcheap|\bafford|\bspend|\bguarantee|\bpromise"
    r"|\bwill\b|\bbecause\b|\bdue to\b|\bas a result\b|\bcaused?\b|\bthanks to\b|\bled to\b"
    r"|\bdriven by\b|\bsales\b|\brevenue\b|\branks?\b|\branking|#\s*1|\bnumber one\b|\btop spot\b"
    r"|\bshould\b|\brecommend|\bfix\b",
    re.IGNORECASE,
)
NUMBER_WORDS = re.compile(
    r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen"
    r"|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|half|once"
    r"|twice|none of the|all of the)\b",
    re.IGNORECASE,
)
DIGITS = re.compile(r"\d+(?:\.\d+)?")
PAIR = re.compile(r"(\d+) (?:of|out of) (?:the )?(\d+)")
PERCENT = re.compile(r"(\d+(?:\.\d+)?) ?(?:%|percent)")
PAIRS = (("our_mentions", "total_answers"), ("top_competitor_mentions", "total_answers"),
         ("area_mentions", "area_answers"), ("no_area_mentions", "no_area_answers"),
         ("no_answer", "asked"), ("needs_review", "asked"), ("total_answers", "asked"),
         ("prev_our_mentions", "prev_total_answers"))

SUMMARY_SCHEMA = {
    "type": "OBJECT",
    "properties": {"template": {"type": "STRING"}},
    "required": ["template"],
}


def summary_facts(row: dict, previous: dict | None, store_name: str, areas) -> dict:
    """All values the summary may use, taken from stored daily_summary rows."""
    facts = {
        "store": store_name,
        "scope": scope_label(row["provider"], row["channel"]),
        "top_competitor": row["top_competitor"] or "no other store",
        "areas": " or ".join(areas),
        "our_mentions": row["our_mentions"],
        "total_answers": row["total_answers"],
        "our_pct": round(100 * row["our_mentions"] / row["total_answers"]) if row["total_answers"] else 0,
        "top_competitor_mentions": row["top_competitor_mentions"],
        "area_mentions": row["area_mentions"],
        "area_answers": row["area_answers"],
        "no_area_mentions": row["no_area_mentions"],
        "no_area_answers": row["no_area_answers"],
        "no_answer": row["no_answer"],
        "needs_review": row["needs_review"],
        "asked": row["asked"],
    }
    if previous:
        facts.update(prev_date=previous["date"], prev_our_mentions=previous["our_mentions"],
                     prev_total_answers=previous["total_answers"],
                     our_change=_change_word(row, previous))
    return facts


def _change_word(row: dict, prev: dict) -> str:
    if not row["total_answers"] or not prev["total_answers"]:
        return "not comparable"
    a = row["our_mentions"] / row["total_answers"]
    b = prev["our_mentions"] / prev["total_answers"]
    return "unchanged" if a == b else ("higher" if a > b else "lower")


def allowed_numbers(facts: dict) -> set[str]:
    return {str(facts[k]) for k in NUMBER_FIELDS if k in facts}


def allowed_pairs(facts: dict) -> set[tuple[str, str]]:
    return {(str(facts[a]), str(facts[b])) for a, b in PAIRS if a in facts and b in facts}


def fill_template(template: str, facts: dict) -> tuple[str | None, list[str]]:
    """Fill {placeholders} with code values. The template itself may not contain digits."""
    problems = []
    if DIGITS.search(template):
        problems.append("template contains digits; numbers must come from placeholders")
    try:
        fields = {f for _, f, _, _ in string.Formatter().parse(template) if f is not None}
    except ValueError as exc:
        return None, problems + [f"bad template: {exc}"]
    unknown = sorted(f for f in fields if f not in facts)
    if unknown:
        problems.append(f"unknown placeholders: {unknown}")
    if problems:
        return None, problems
    return template.format_map(facts), []


def check_summary(text: str, facts: dict) -> list[str]:
    """Reject the text unless every number in it matches the stored counts."""
    problems = []
    scrub = text
    for k in TEXT_FIELDS:  # names (e.g. a store called "Studio 54") are not counts
        if k in facts and str(facts[k]):
            scrub = scrub.replace(str(facts[k]), " ")
    allowed = allowed_numbers(facts)
    bad = [n for n in DIGITS.findall(scrub) if n not in allowed]
    if bad:
        problems.append(f"numbers not in the stored counts: {bad}")
    pairs = allowed_pairs(facts)
    bad_pairs = [f"{x} of {y}" for x, y in PAIR.findall(scrub) if (x, y) not in pairs]
    if bad_pairs:
        problems.append(f"'X of Y' figures that do not match a stored count: {bad_pairs}")
    bad_pct = [n for n in PERCENT.findall(scrub) if n != str(facts.get("our_pct"))]
    if bad_pct:
        problems.append(f"percentages that do not match the stored rate: {bad_pct}")
    words = NUMBER_WORDS.findall(scrub)
    if words:
        problems.append(f"spelled-out quantities are not allowed: {words}")
    banned = BANNED.findall(scrub)
    if banned:
        problems.append(f"causes, promises or pricing words are not allowed: {banned}")
    if "{" in text or "}" in text:
        problems.append("unfilled placeholder")
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
    if not 2 <= len(sentences) <= 3:
        problems.append(f"summary must be 2 to 3 sentences, got {len(sentences)}")
    return problems


def fallback_summary(facts: dict) -> str:
    """Summary written entirely by code; always passes check_summary."""
    s1 = (f"{facts['store']} was named in {facts['our_mentions']} of {facts['total_answers']} "
          f"counted {facts['scope']} answers ({facts['no_answer']} asks got no answer and "
          f"{facts['needs_review']} were set aside for review).")
    if facts["top_competitor_mentions"]:
        s2 = (f"The most-named other store was {facts['top_competitor']}, in "
              f"{facts['top_competitor_mentions']} of {facts['total_answers']} answers.")
    else:
        s2 = "No other store was named in the counted answers."
    s3 = (f"For questions naming {facts['areas']}, {facts['store']} was named in "
          f"{facts['area_mentions']} of {facts['area_answers']} answers, against "
          f"{facts['no_area_mentions']} of {facts['no_area_answers']} for other questions.")
    return " ".join((s1, s2, s3))


def build_summary_prompt(facts: dict, problems: list[str] | None = None) -> str:
    described = {
        "store": "our store's name", "scope": "which AI and channel the answers came from",
        "top_competitor": "the other store named most often", "areas": "the store's areas",
        "our_mentions": "answers naming our store", "total_answers": "answers counted",
        "our_pct": "percent of counted answers naming our store",
        "top_competitor_mentions": "answers naming the top other store",
        "area_mentions": "answers naming our store, for questions that name an area",
        "area_answers": "answers counted for questions that name an area",
        "no_area_mentions": "answers naming our store, for questions that do not name an area",
        "no_area_answers": "answers counted for questions that do not name an area",
        "no_answer": "asks that got no answer", "needs_review": "answers set aside for review",
        "asked": "questions asked in total", "prev_date": "date of the previous run",
        "prev_our_mentions": "answers naming our store in the previous run",
        "prev_total_answers": "answers counted in the previous run",
        "our_change": "one word comparing our mention rate with the previous run",
    }
    available = {k: v for k, v in described.items() if k in facts}
    lines = [
        "Write a 2 to 3 sentence summary for a shop owner about how often AI assistant answers "
        "named their shop today. Plain, factual, calm.",
        "Rules: never type a number or a number word; insert every value with a {placeholder} "
        "from the list below. Do not explain causes, give advice, predict, promise results, or "
        "mention prices, money or rankings. Report zeros and drops plainly.",
        "Return JSON: {\"template\": \"...\"}.",
        "Placeholders:",
        *[f"- {{{k}}}: {v}" for k, v in available.items()],
        f"Today, {{our_change}} = {facts.get('our_change', 'n/a')!r}; "
        f"{{top_competitor}} = {facts['top_competitor']!r}.",
    ]
    if problems:
        lines.append("Your previous attempt was rejected: " + "; ".join(problems))
    return "\n".join(lines)


def write_summary(provider, facts: dict, attempts: int = 2) -> tuple[str, str, list[str]]:
    """Returns (text, source, rejected_reasons). source is 'ai' or 'code_fallback'."""
    rejected: list[str] = []
    problems: list[str] | None = None
    for _ in range(attempts if provider else 0):
        try:
            raw = provider.complete(build_summary_prompt(facts, problems), json_schema=SUMMARY_SCHEMA)
            template = json.loads(raw).get("template", "")
        except (ProviderError, json.JSONDecodeError, AttributeError) as exc:
            problems = [f"{type(exc).__name__}: {exc}"]
            rejected += problems
            continue
        text, problems = fill_template(str(template), facts)
        if text is not None:
            problems = check_summary(text, facts)
        if not problems:
            return text, "ai", rejected
        rejected += problems
    return fallback_summary(facts), "code_fallback", rejected


def step_write_summary(ctx) -> dict:
    row = ctx.conn.execute("SELECT * FROM daily_summary WHERE run_id = ?", (ctx.run_id,)).fetchone()
    facts = summary_facts(dict(row), ctx.data.get("_previous"), ctx.store.name, ctx.store.areas)
    text, source, rejected = write_summary(ctx.work_provider, facts)
    # Final gate against the stored row, whichever writer produced the text.
    stored = summary_facts(dict(ctx.conn.execute(
        "SELECT * FROM daily_summary WHERE id = ?", (row["id"],)).fetchone()),
        ctx.data.get("_previous"), ctx.store.name, ctx.store.areas)
    final_problems = check_summary(text, stored)
    if final_problems:
        text, source = fallback_summary(stored), "code_fallback"
    ctx.conn.execute("UPDATE daily_summary SET text = ?, text_source = ? WHERE id = ?",
                     (text, source, row["id"]))
    ctx.conn.commit()
    return {"source": source, "rejected": rejected, "text": text}
