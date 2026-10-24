"""Step 5 (CODE): verify every extracted quote, then count.

Everything here except the step functions is a pure function over plain data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from airtime.agents.visibility.compare import save_counts
from airtime.agents.visibility.extract import extract, parse_extraction
from airtime.config import StoreConfig
from airtime.providers.base import ProviderError, call_with_backoff, utc_now
from airtime.textutil import contains_term, normalize_for_match, store_key


# ---- Verification --------------------------------------------------------------------

def quote_in_text(quote: str, text: str) -> bool:
    q = normalize_for_match(quote)
    return bool(q) and q in normalize_for_match(text)


def is_our_store(name: str, aliases: tuple[str, ...]) -> bool:
    return any(contains_term(name, a) for a in aliases)


def verify_extraction(text: str, extraction: dict, aliases: tuple[str, ...]) -> list[str]:
    """Check an extraction against the stored answer text. Empty list = verified."""
    problems = []
    stores = extraction["stores"]
    for i, s in enumerate(stores, 1):
        if not quote_in_text(s["quote"], text):
            problems.append(f"store {i} ({s['name']!r}) quote is not verbatim in the answer: {s['quote']!r}")
    ours_listed = any(is_our_store(s["name"], aliases) for s in stores)
    ours_in_text = any(contains_term(text, a) for a in aliases)
    if ours_in_text and not ours_listed:
        problems.append("the answer names our store but the extraction does not list it")
    if ours_listed and not ours_in_text:
        problems.append("the extraction lists our store but no known spelling of it is in the answer")
    tone = extraction["our_store_tone"]
    if ours_listed and tone == "none":
        problems.append("our store is listed but our_store_tone is none")
    if not ours_listed and tone != "none":
        problems.append("our store is not listed but our_store_tone is not none")
    # Repeated ranks are allowed: an answer can hold several numbered lists (one per suburb).
    return problems


def mention_rows(extraction: dict, store: StoreConfig) -> list[dict]:
    """Turn a verified extraction into mention rows, one per distinct store, in order."""
    alias_to_canonical = {}
    for canonical, alts in store.competitor_aliases.items():
        for n in (canonical, *alts):
            alias_to_canonical[store_key(n)] = canonical
    rows, seen = [], set()
    for s in extraction["stores"]:
        ours = is_our_store(s["name"], store.all_aliases)
        if ours:
            key = store_key(store.name)
        else:
            key = store_key(alias_to_canonical.get(store_key(s["name"]), s["name"]))
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "store_name": s["name"].strip(), "store_key": key, "is_ours": ours,
            "position": len(rows) + 1, "rank": s.get("rank"),
            "tone": extraction["our_store_tone"] if ours else None, "quote": s["quote"].strip(),
        })
    return rows


# ---- Counting ------------------------------------------------------------------------

@dataclass
class AnswerFacts:
    """What counting needs to know about one stored answer."""
    id: int
    status: str                       # ok | no_answer | needs_review
    names_area: bool
    ours: bool = False
    competitors: dict[str, str] = field(default_factory=dict)  # store_key -> display name
    used_search: bool = False


@dataclass
class Counts:
    asked: int
    no_answer: int
    needs_review: int
    total_answers: int
    our_mentions: int
    our_answer_ids: list[int]
    top_competitor: str | None
    top_competitor_mentions: int
    tied_top: list[str]
    competitors: list[dict]
    area_mentions: int
    area_answers: int
    no_area_mentions: int
    no_area_answers: int
    web_search_answers: int

    @property
    def area_rate(self) -> float | None:
        return rate(self.area_mentions, self.area_answers)

    @property
    def no_area_rate(self) -> float | None:
        return rate(self.no_area_mentions, self.no_area_answers)


def rate(num: int, den: int) -> float | None:
    return None if den == 0 else num / den


def count_answers(facts: list[AnswerFacts]) -> Counts:
    """Only status=ok answers are counted; no_answer and needs_review are reported, not counted."""
    ok = [f for f in facts if f.status == "ok"]
    comp: dict[str, dict] = {}
    for f in ok:
        for key, name in f.competitors.items():
            c = comp.setdefault(key, {"key": key, "names": {}, "answer_ids": []})
            c["names"][name] = c["names"].get(name, 0) + 1
            c["answer_ids"].append(f.id)
    competitors = []
    for c in comp.values():
        display = sorted(c["names"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        competitors.append({"key": c["key"], "name": display, "mentions": len(c["answer_ids"]),
                            "answer_ids": sorted(c["answer_ids"]), "spellings": sorted(c["names"])})
    competitors.sort(key=lambda c: (-c["mentions"], c["name"].casefold()))
    top = competitors[0] if competitors else None
    tied = [c["name"] for c in competitors if top and c["mentions"] == top["mentions"]]
    area = [f for f in ok if f.names_area]
    no_area = [f for f in ok if not f.names_area]
    return Counts(
        asked=len(facts),
        no_answer=sum(f.status == "no_answer" for f in facts),
        needs_review=sum(f.status == "needs_review" for f in facts),
        total_answers=len(ok),
        our_mentions=sum(f.ours for f in ok),
        our_answer_ids=sorted(f.id for f in ok if f.ours),
        top_competitor=top["name"] if top else None,
        top_competitor_mentions=top["mentions"] if top else 0,
        tied_top=tied,
        competitors=competitors,
        area_mentions=sum(f.ours for f in area),
        area_answers=len(area),
        no_area_mentions=sum(f.ours for f in no_area),
        no_area_answers=len(no_area),
        web_search_answers=sum(f.used_search for f in ok),
    )


# ---- Step functions ------------------------------------------------------------------

def run_answers(ctx) -> list:
    return ctx.conn.execute(
        """SELECT a.*, q.text AS question, q.names_area FROM answers a
           JOIN questions q ON q.id = a.question_id WHERE a.run_id = ? ORDER BY a.id""",
        (ctx.run_id,),
    ).fetchall()


def step_extract_mentions(ctx) -> dict:
    """Step 4 (AI): one extraction per answer that has text. Results are verified in step 5."""
    pcfg = ctx.store.provider
    raw: dict[int, str | None] = {}
    errors = 0
    pending = [a for a in run_answers(ctx) if a["status"] == "ok" and not a["extracted_at"]]
    for n, a in enumerate(pending, 1):
        ctx.report(type="extract", done=n - 1, total=len(pending), question=a["question"])
        try:
            raw[a["id"]] = call_with_backoff(
                lambda: extract(ctx.work_provider, ctx.store, a["text"]),
                max_retries=pcfg.max_retries, base_delay=pcfg.backoff_base_seconds,
                sleep=ctx.sleep)
        except ProviderError as exc:
            raw[a["id"]] = None
            ctx.data.setdefault("_extract_errors", {})[a["id"]] = f"{type(exc).__name__}: {exc}"
            errors += 1
    ctx.data["_extractions"] = raw
    return {"extracted": len(raw) - errors, "failed_calls": errors}


def step_verify_and_count(ctx) -> dict:
    """Step 5 (CODE): verify quotes (one re-try of step 4 on failure), store mentions, count."""
    pcfg = ctx.store.provider
    raw_by_id = ctx.data.get("_extractions", {})
    retried = 0
    for a in run_answers(ctx):
        if a["id"] not in raw_by_id:
            continue
        extraction, problems = _check(raw_by_id[a["id"]], a["text"], ctx.store)
        if problems:
            retried += 1
            try:
                again = call_with_backoff(
                    lambda: extract(ctx.work_provider, ctx.store, a["text"], problems),
                    max_retries=pcfg.max_retries, base_delay=pcfg.backoff_base_seconds,
                    sleep=ctx.sleep)
            except ProviderError as exc:
                again = None
                problems = problems + [f"retry failed: {type(exc).__name__}: {exc}"]
            if again is not None:
                extraction, problems = _check(again, a["text"], ctx.store)
        now = utc_now()
        if problems:
            ctx.conn.execute(
                "UPDATE answers SET status = 'needs_review', error = ?, extracted_at = ? WHERE id = ?",
                ("; ".join(problems)[:2000], now, a["id"]))
            continue
        for m in mention_rows(extraction, ctx.store):
            ctx.conn.execute(
                """INSERT INTO mentions (answer_id, store_name, store_key, is_ours, position, rank, tone, quote)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (a["id"], m["store_name"], m["store_key"], int(m["is_ours"]), m["position"],
                 m["rank"], m["tone"], m["quote"]))
        ctx.conn.execute("UPDATE answers SET our_tone = ?, extracted_at = ? WHERE id = ?",
                         (extraction["our_store_tone"], now, a["id"]))
    ctx.conn.commit()
    counts = count_answers(load_facts(ctx.conn, ctx.run_id))
    ctx.data["_counts"] = counts
    provider, channel = ctx.data["_scope"]
    save_counts(ctx.conn, store_id=ctx.store_id, date=ctx.run_date, provider=provider,
                channel=channel, run_id=ctx.run_id, counts=counts)
    return {"retried": retried, "asked": counts.asked, "ok": counts.total_answers,
            "no_answer": counts.no_answer, "needs_review": counts.needs_review,
            "our_mentions": counts.our_mentions, "top_competitor": counts.top_competitor,
            "top_competitor_mentions": counts.top_competitor_mentions}


def _check(raw: str | None, text: str, store: StoreConfig) -> tuple[dict | None, list[str]]:
    if raw is None:
        return None, ["extraction call failed"]
    extraction, problems = parse_extraction(raw)
    if problems:
        return None, problems
    return extraction, verify_extraction(text, extraction, store.all_aliases)


def load_facts(conn, run_id: int) -> list[AnswerFacts]:
    """Read one run's answers and verified mentions back from the database."""
    rows = conn.execute(
        """SELECT a.id, a.status, a.raw, q.names_area FROM answers a
           JOIN questions q ON q.id = a.question_id WHERE a.run_id = ? ORDER BY a.id""", (run_id,)
    ).fetchall()
    facts = []
    for r in rows:
        ms = conn.execute("SELECT store_key, store_name, is_ours FROM mentions WHERE answer_id = ?"
                          " ORDER BY position", (r["id"],)).fetchall()
        raw = json.loads(r["raw"]) if r["raw"] else {}
        facts.append(AnswerFacts(
            id=r["id"], status=r["status"], names_area=bool(r["names_area"]),
            ours=any(m["is_ours"] for m in ms),
            competitors={m["store_key"]: m["store_name"] for m in ms if not m["is_ours"]},
            used_search=bool(isinstance(raw, dict) and raw.get("used_search")),
        ))
    return facts
