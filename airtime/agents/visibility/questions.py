"""Step 1 (AI): write buyer questions. Step 2 (CODE): validate the list."""

from __future__ import annotations

import json
from collections import Counter
from difflib import SequenceMatcher

from airtime.config import StoreConfig
from airtime.agents.visibility.topics import pick_weak_topics, reason_for, topic_stats, topics_for
from airtime.core.agent import RunContext, RunFailed
from airtime.providers.base import Provider, ProviderError, utc_now
from airtime.textutil import contains_term, store_key, word_set

MIN_QUESTIONS = 3
MAX_QUESTIONS = 12
MIN_WORDS = 3
NEAR_DUPLICATE_RATIO = 0.85
NEAR_DUPLICATE_JACCARD = 0.8

QUESTIONS_SCHEMA = {
    "type": "OBJECT",
    "properties": {"questions": {"type": "ARRAY", "items": {"type": "STRING"}}},
    "required": ["questions"],
}


# ---- Step 2: validation (pure) -------------------------------------------------------

def names_area(question: str, areas: tuple[str, ...] | list[str]) -> bool:
    return any(contains_term(question, area) for area in areas)


def near_duplicate(a: str, b: str) -> bool:
    ka, kb = store_key(a), store_key(b)
    if ka == kb:
        return True
    if SequenceMatcher(None, ka, kb).ratio() >= NEAR_DUPLICATE_RATIO:
        return True
    wa, wb = word_set(a), word_set(b)
    return bool(wa and wb) and len(wa & wb) / len(wa | wb) >= NEAR_DUPLICATE_JACCARD


def validate_questions(questions: list[str], areas: tuple[str, ...] | list[str]) -> list[str]:
    """Return every problem found; an empty list means the list is valid."""
    problems: list[str] = []
    if not questions:
        return ["question list is empty"]
    if len(questions) < MIN_QUESTIONS:
        problems.append(f"only {len(questions)} questions, need at least {MIN_QUESTIONS}")
    if len(questions) > MAX_QUESTIONS:
        problems.append(f"{len(questions)} questions, at most {MAX_QUESTIONS} allowed")
    for i, q in enumerate(questions, 1):
        if not isinstance(q, str) or not q.strip():
            problems.append(f"question {i} is empty")
        elif len(q.split()) < MIN_WORDS:
            problems.append(f"question {i} is too short: {q!r}")
    clean = [(i, q) for i, q in enumerate(questions, 1) if isinstance(q, str) and q.strip()]
    for x, (i, a) in enumerate(clean):
        for j, b in clean[x + 1:]:
            if store_key(a) == store_key(b):
                problems.append(f"questions {i} and {j} are duplicates: {a!r}")
            elif near_duplicate(a, b):
                problems.append(f"questions {i} and {j} are near-duplicates: {a!r} / {b!r}")
    if not any(names_area(q, areas) for _, q in clean):
        problems.append("no question names a store area (" + ", ".join(areas) + ")")
    return problems


# ---- Step 1: generation (AI) ---------------------------------------------------------

def build_question_prompt(store: StoreConfig, site_text: str) -> str:
    return (
        "You help a small shop understand what its customers ask AI assistants.\n"
        f"Write {store.target_question_count} short questions a shopper might type into an AI "
        "assistant when looking for a shop like this one. Rules:\n"
        "- Write as a shopper, in plain words, as typed into a chat box.\n"
        "- Never include the shop's own name or website.\n"
        f"- At least one question must name one of these areas: {', '.join(store.areas)}.\n"
        "- Cover different products and needs; no two questions may be near-duplicates.\n"
        "- Return JSON: {\"questions\": [\"...\"]}.\n\n"
        f"Shop categories: {', '.join(store.categories)}\n"
        f"Shop areas: {', '.join(store.areas)}\n"
        f"Public text from the shop website (may be empty):\n{site_text[:4000]}"
    )


def parse_questions(raw: str) -> list[str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunFailed(f"question writer returned invalid JSON: {exc}") from exc
    qs = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(qs, list) or not all(isinstance(q, str) for q in qs):
        raise RunFailed("question writer JSON has no list of strings under 'questions'")
    return [q.strip() for q in qs]


def build_daily_prompt(store: StoreConfig, site_text: str, count: int, avoid: list[str],
                       problems: list[str] | None = None) -> str:
    lines = [
        "You help a small shop understand what its customers ask AI assistants.",
        f"Write {count} NEW questions a shopper might type into an AI assistant today when looking "
        "for products this shop sells. Rules:",
        "- Write as a shopper, in plain words, as typed into a chat box. Vary the need: occasions, "
        "budgets, gift ideas, specific products, local or online, urgency.",
        "- Never include the shop's own name or website.",
        f"- Every question must name {_places_text(store)}, as a local shopper would.",
        f"- At least one question must name one of these areas: {', '.join(store.areas)}.",
        "- Each question must be clearly different from every other one and from the list of "
        "questions already asked below.",
        "- Return JSON: {\"questions\": [\"...\"]}.",
        "",
        f"Shop categories: {', '.join(store.categories)}",
        f"Shop areas: {', '.join(store.areas)} (city: {store.city or '?'}, country: {store.country or '?'})",
        "Questions already asked recently (do not repeat or rephrase these):",
        *[f"- {q}" for q in avoid[-60:]],
    ]
    if problems:
        lines.append("Your previous list had these problems, avoid them: " + "; ".join(problems[:10]))
    if site_text:
        lines += ["", f"Public text from the shop website:\n{site_text[:3000]}"]
    return "\n".join(lines)


def _places(store: StoreConfig) -> list[str]:
    return [p for p in (store.city, *store.areas, store.country) if p]


def _places_text(store: StoreConfig) -> str:
    return " or ".join(_places(store)) or "the shop's city"


def drop_reason(q: str, store: StoreConfig, avoid: list[str], kept: list[str]) -> str | None:
    """Why a new question cannot be used, or None if it can."""
    if len(q.split()) < MIN_WORDS:
        return f"too short: {q!r}"
    if any(contains_term(q, a) for a in store.all_aliases):
        return f"names our store: {q!r}"
    if _places(store) and not any(contains_term(q, p) for p in _places(store)):
        return f"names no place ({_places_text(store)}): {q!r}"
    if any(near_duplicate(q, old) for old in avoid):
        return f"repeats a recent question: {q!r}"
    if any(near_duplicate(q, k) for k in kept):
        return f"duplicate within today's list: {q!r}"
    return None


def filter_daily(candidates: list[str], store: StoreConfig, avoid: list[str], count: int
                 ) -> tuple[list[str], list[str]]:
    """Keep up to `count` usable new questions. Returns (kept, reasons for each one dropped)."""
    kept: list[str] = []
    dropped: list[str] = []
    for q in candidates:
        q = q.strip()
        why = drop_reason(q, store, avoid, kept)
        if why:
            dropped.append(why)
        elif len(kept) < count:
            kept.append(q)
    return kept, dropped


def generate_daily_questions(store: StoreConfig, provider: Provider, site_text: str, avoid: list[str],
                             count: int) -> tuple[list[str], list[str]]:
    """Step 1 (AI) for the daily questions: one call, and one more if too few survive the checks."""
    kept, dropped = [], []
    for _ in range(2):
        need = count - len(kept)
        raw = provider.complete(build_daily_prompt(store, site_text, need + 2, avoid + kept, dropped),
                                json_schema=QUESTIONS_SCHEMA)
        more, why = filter_daily(parse_questions(raw), store, avoid + kept, need)
        kept += more
        dropped += why
        if len(kept) >= count:
            break
    return kept, dropped


def generate_questions(store: StoreConfig, provider: Provider, site_text: str) -> list[str]:
    raw = provider.complete(build_question_prompt(store, site_text), json_schema=QUESTIONS_SCHEMA)
    questions = parse_questions(raw)
    leaked = [q for q in questions if any(contains_term(q, a) for a in store.all_aliases)]
    if leaked:
        raise RunFailed(f"generated questions name our own store: {leaked}")
    return questions


# ---- Step 1, explore mode: aim the new questions at the weakest topics (AI + CODE) -----

EXPLORE_SCHEMA = {
    "type": "OBJECT",
    "properties": {"questions": {"type": "ARRAY", "items": {
        "type": "OBJECT",
        "properties": {"topic": {"type": "STRING"}, "question": {"type": "STRING"}},
        "required": ["topic", "question"]}}},
    "required": ["questions"],
}


def explore_plan(stats: list[dict], store: StoreConfig) -> list[tuple[dict, int]]:
    """(topic stats, how many new questions) for the weakest topics, daily_count in total."""
    per = max(store.explore_per_topic, 1)
    picks = pick_weak_topics(stats, -(-store.daily_count // per))
    plan, left = [], store.daily_count
    for stat in picks:
        n = min(per, left)
        if n > 0:
            plan.append((stat, n))
            left -= n
    return plan


def build_explore_prompt(store: StoreConfig, plan: list[tuple[dict, int]], avoid: list[str],
                         window_days: int, problems: list[str] | None = None) -> str:
    topics = {t.name: t for t in store.topics}
    lines = [
        "You help a small shop understand what its customers ask AI assistants.",
        "Write NEW questions a shopper might type into an AI assistant, for the topics below. "
        "These are the topics where the shop is named least, so ask about them the way different "
        "shoppers would. Rules:",
        "- Write as a shopper, in plain words, as typed into a chat box. Vary the angle: occasion, "
        "budget, who it is for, specific product, local or online, urgency.",
        "- Never include the shop's own name or website.",
        f"- Every question must name {_places_text(store)}, as a local shopper would.",
        "- Every question must use at least one of its topic's words.",
        "- Do not repeat or rephrase any question listed below.",
        "- Return JSON: {\"questions\": [{\"topic\": \"...\", \"question\": \"...\"}]}, "
        "with the topic name exactly as written here.",
        "",
    ]
    for stat, n in plan:
        t = topics[stat["topic"]]
        lines.append(f"Topic: {t.name} — write {n} question{'s' if n != 1 else ''}. "
                     f"Topic words: {', '.join(t.terms)}.")
        if stat["answers"]:
            line = (f"  Last {window_days} days: {store.name} named in {stat['ours']} of "
                    f"{stat['answers']} answers")
            if stat["competitor"]:
                line += f"; {stat['competitor']} named most ({stat['competitor_mentions']})"
            lines.append(line + ".")
            for q in stat["questions"][-8:]:
                lines.append(f"  Already asked: {q['text']} ({'shop named' if q['ours'] else 'shop not named'})")
        else:
            lines.append("  Not asked yet.")
    lines += ["", f"Shop areas: {', '.join(store.areas)} (city: {store.city or '?'}, "
                  f"country: {store.country or '?'})",
              "Other questions already asked recently (do not repeat or rephrase these):",
              *[f"- {q}" for q in avoid[-40:]]]
    if problems:
        lines.append("Your previous list had these problems, avoid them: " + "; ".join(problems[:10]))
    return "\n".join(lines)


def parse_explore(raw: str) -> list[tuple[str, str]]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunFailed(f"question writer returned invalid JSON: {exc}") from exc
    items = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise RunFailed("question writer JSON has no list under 'questions'")
    out = []
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("topic"), str) and isinstance(item.get("question"), str):
            out.append((item["topic"].strip(), item["question"].strip()))
    return out


def filter_explore(candidates: list[tuple[str, str]], store: StoreConfig, plan: list[tuple[dict, int]],
                   avoid: list[str], kept: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], list[str]]:
    """Keep usable (topic, question) pairs, at most the planned number per topic. Code decides
    the topic from the question's words: the AI's label is only accepted if the words agree."""
    want = {stat["topic"]: n for stat, n in plan}
    have = Counter(t for t, _ in kept)
    texts = [q for _, q in kept]
    new: list[tuple[str, str]] = []
    dropped: list[str] = []
    for topic, q in candidates:
        if topic not in want:
            dropped.append(f"not one of today's topics ({topic}): {q!r}")
        elif topic not in topics_for(q, store.topics):
            dropped.append(f"does not use a {topic} word: {q!r}")
        elif (why := drop_reason(q, store, avoid, texts)):
            dropped.append(why)
        elif have[topic] < want[topic]:
            new.append((topic, q))
            texts.append(q)
            have[topic] += 1
    return new, dropped


def generate_explore_questions(store: StoreConfig, provider: Provider, plan: list[tuple[dict, int]],
                               avoid: list[str], window_days: int) -> tuple[list[tuple[str, str]], list[str]]:
    """One call, and one more for the topics still short after the checks."""
    kept: list[tuple[str, str]] = []
    dropped: list[str] = []
    todo = plan
    for _ in range(2):
        raw = provider.complete(build_explore_prompt(store, todo, avoid + [q for _, q in kept],
                                                     window_days, dropped),
                                json_schema=EXPLORE_SCHEMA)
        more, why = filter_explore(parse_explore(raw), store, plan, avoid, kept)
        kept += more
        dropped += why
        have = Counter(t for t, _ in kept)
        todo = [(stat, n - have[stat["topic"]]) for stat, n in plan if have[stat["topic"]] < n]
        if not todo:
            break
    return kept, dropped


# ---- Step functions wired into the agent ---------------------------------------------

def step_write_questions(ctx: RunContext, fetch_site_text=None) -> dict:
    """Step 1. Core questions: reused unless this is the first run or the config changed.
    Daily questions: written fresh by the AI once per run date (reused on a re-run that day)."""
    if fetch_site_text is None:
        from airtime.site import fetch_site_text
    core = _write_core(ctx, fetch_site_text)
    daily = _write_daily(ctx, fetch_site_text) if ctx.store.daily_count > 0 else {"action": "off", "count": 0}
    return {"core": core, "daily": daily}


def _write_core(ctx: RunContext, fetch_site_text) -> dict:
    cfg = ctx.store
    wanted_hash = cfg.question_hash()
    row = ctx.conn.execute("SELECT question_hash FROM stores WHERE id = ?", (ctx.store_id,)).fetchone()
    current = [q["text"] for q in _core(ctx)]
    if row["question_hash"] == wanted_hash and current:
        return {"action": "reused", "count": len(current)}

    if cfg.question_mode == "fixed":
        questions, source = list(cfg.questions), "config"
    elif cfg.question_mode == "generate":
        if ctx.work_provider is None:
            raise RunFailed("question_mode=generate needs an AI provider")
        questions, source = generate_questions(cfg, ctx.work_provider, fetch_site_text(cfg)), "ai"
    else:
        raise RunFailed(f"unknown question mode {cfg.question_mode!r}")

    problems = validate_questions(questions, cfg.areas)
    if problems:
        raise RunFailed("new question list is invalid: " + "; ".join(problems))
    now = utc_now()
    ctx.conn.execute("UPDATE questions SET active = 0 WHERE store_id = ? AND kind = 'core'", (ctx.store_id,))
    for q in questions:
        ctx.conn.execute(
            "INSERT INTO questions (store_id, text, names_area, created_at, active, source, kind)"
            " VALUES (?, ?, ?, ?, 1, ?, 'core')",
            (ctx.store_id, q, int(names_area(q, cfg.areas)), now, source),
        )
    ctx.conn.execute("UPDATE stores SET question_hash = ? WHERE id = ?", (wanted_hash, ctx.store_id))
    ctx.conn.commit()
    return {"action": "created", "source": source, "count": len(questions), "questions": questions}


def _write_daily(ctx: RunContext, fetch_site_text) -> dict:
    """New questions for today. A failure here never stops the run: the core questions still go out."""
    cfg = ctx.store
    today = _daily(ctx)
    if today:
        return {"action": "reused", "count": len(today)}
    if ctx.work_provider is None:
        return {"action": "skipped", "count": 0, "error": "no AI provider"}
    avoid = recent_questions(ctx.conn, ctx.store_id, ctx.run_date, cfg.novelty_days)
    if cfg.daily_mode == "explore" and cfg.topics:
        return _write_explore(ctx, avoid)
    try:
        questions, dropped = generate_daily_questions(cfg, ctx.work_provider, fetch_site_text(cfg),
                                                      avoid, cfg.daily_count)
    except (ProviderError, RunFailed) as exc:
        return {"action": "failed", "count": 0, "error": f"{type(exc).__name__}: {exc}"[:300]}
    now = utc_now()
    for q in questions:
        ctx.conn.execute(
            "INSERT INTO questions (store_id, text, names_area, created_at, active, source, kind, for_date)"
            " VALUES (?, ?, ?, ?, 1, 'ai', 'daily', ?)",
            (ctx.store_id, q, int(names_area(q, cfg.areas)), now, ctx.run_date),
        )
    ctx.conn.commit()
    return {"action": "created", "count": len(questions), "questions": questions, "dropped": dropped[:10]}


def _write_explore(ctx: RunContext, avoid: list[str]) -> dict:
    """Explore mode: read the results per topic, pick the weakest, ask the AI for new questions
    there, and store with each question why its topic was picked."""
    cfg = ctx.store
    scope = (ctx.ask_provider.name, ctx.ask_provider.channel) if ctx.ask_provider else (None, None)
    stats = topic_stats(ctx.conn, ctx.store_id, cfg.topics, before=ctx.run_date,
                        days=cfg.explore_window_days, provider=scope[0], channel=scope[1])
    plan = explore_plan(stats, cfg)
    try:
        pairs, dropped = generate_explore_questions(cfg, ctx.work_provider, plan, avoid,
                                                    cfg.explore_window_days)
    except (ProviderError, RunFailed) as exc:
        return {"action": "failed", "mode": "explore", "count": 0, "error": f"{type(exc).__name__}: {exc}"[:300]}
    reasons = {stat["topic"]: reason_for(stat, cfg.explore_window_days) for stat, _ in plan}
    now = utc_now()
    for topic, q in pairs:
        ctx.conn.execute(
            "INSERT INTO questions (store_id, text, names_area, created_at, active, source, kind, for_date, reason)"
            " VALUES (?, ?, ?, ?, 1, 'ai', 'daily', ?, ?)",
            (ctx.store_id, q, int(names_area(q, cfg.areas)), now, ctx.run_date, json.dumps(reasons[topic])),
        )
    ctx.conn.commit()
    return {"action": "created", "mode": "explore", "count": len(pairs),
            "topics": [{"topic": stat["topic"], "planned": n, "answers": stat["answers"], "ours": stat["ours"],
                        "competitor": stat["competitor"]} for stat, n in plan],
            "questions": [q for _, q in pairs], "dropped": dropped[:10]}


def recent_questions(conn, store_id: int, run_date: str, days: int) -> list[str]:
    """Core questions plus daily questions written in the last `days` days, oldest first."""
    rows = conn.execute(
        """SELECT text FROM questions WHERE store_id = ? AND (
               (kind = 'core' AND active = 1) OR
               (kind = 'daily' AND for_date < ? AND for_date >= date(?, ?)))
           ORDER BY id""",
        (store_id, run_date, run_date, f"-{days} days"),
    ).fetchall()
    return [r["text"] for r in rows]


def step_validate_questions(ctx: RunContext) -> dict:
    """Step 2. Runs every day on today's list; fails the run loudly if the core list is invalid."""
    core = _core(ctx)
    problems = validate_questions([r["text"] for r in core], ctx.store.areas)
    if problems:
        raise RunFailed("question list is invalid: " + "; ".join(problems))
    rows = core + _daily(ctx)
    # Today's daily questions were filtered when written; re-check them against the core list.
    clash = [d["text"] for d in rows[len(core):] if any(near_duplicate(d["text"], c["text"]) for c in core)]
    for text in clash:
        ctx.conn.execute("UPDATE questions SET active = 0 WHERE store_id = ? AND kind = 'daily' AND for_date = ? AND text = ?",
                         (ctx.store_id, ctx.run_date, text))
    for r in rows:  # names_area is decided by code, keep it in sync with the config areas
        flag = int(names_area(r["text"], ctx.store.areas))
        if flag != r["names_area"]:
            ctx.conn.execute("UPDATE questions SET names_area = ? WHERE id = ?", (flag, r["id"]))
    ctx.conn.commit()
    rows = _core(ctx) + _daily(ctx)
    ctx.data["_questions"] = rows
    return {"count": len(rows), "core": len(core), "daily": len(rows) - len(core),
            "naming_area": sum(r["names_area"] for r in rows), "removed_as_duplicate": len(clash)}


def _core(ctx: RunContext):
    return ctx.conn.execute(
        "SELECT * FROM questions WHERE store_id = ? AND active = 1 AND kind = 'core' ORDER BY id", (ctx.store_id,)
    ).fetchall()


def _daily(ctx: RunContext):
    return ctx.conn.execute(
        "SELECT * FROM questions WHERE store_id = ? AND active = 1 AND kind = 'daily' AND for_date = ? ORDER BY id",
        (ctx.store_id, ctx.run_date),
    ).fetchall()
