"""Step 1 (AI): write buyer questions. Step 2 (CODE): validate the list."""

from __future__ import annotations

import json
from difflib import SequenceMatcher

from airtime.config import StoreConfig
from airtime.core.agent import RunContext, RunFailed
from airtime.providers.base import Provider, utc_now
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


def generate_questions(store: StoreConfig, provider: Provider, site_text: str) -> list[str]:
    raw = provider.complete(build_question_prompt(store, site_text), json_schema=QUESTIONS_SCHEMA)
    questions = parse_questions(raw)
    leaked = [q for q in questions if any(contains_term(q, a) for a in store.all_aliases)]
    if leaked:
        raise RunFailed(f"generated questions name our own store: {leaked}")
    return questions


# ---- Step functions wired into the agent ---------------------------------------------

def step_write_questions(ctx: RunContext, fetch_site_text=None) -> dict:
    """Step 1. Reuses the stored list unless this is the first run or the config changed."""
    cfg = ctx.store
    wanted_hash = cfg.question_hash()
    row = ctx.conn.execute("SELECT question_hash FROM stores WHERE id = ?", (ctx.store_id,)).fetchone()
    current = [q["text"] for q in _active(ctx)]
    if row["question_hash"] == wanted_hash and current:
        return {"action": "reused", "count": len(current)}

    if cfg.question_mode == "fixed":
        questions, source = list(cfg.questions), "config"
    elif cfg.question_mode == "generate":
        if ctx.work_provider is None:
            raise RunFailed("question_mode=generate needs an AI provider")
        if fetch_site_text is None:
            from airtime.site import fetch_site_text
        site_text = fetch_site_text(cfg)
        questions, source = generate_questions(cfg, ctx.work_provider, site_text), "ai"
    else:
        raise RunFailed(f"unknown question mode {cfg.question_mode!r}")

    problems = validate_questions(questions, cfg.areas)
    if problems:
        raise RunFailed("new question list is invalid: " + "; ".join(problems))
    now = utc_now()
    ctx.conn.execute("UPDATE questions SET active = 0 WHERE store_id = ?", (ctx.store_id,))
    for q in questions:
        ctx.conn.execute(
            "INSERT INTO questions (store_id, text, names_area, created_at, active, source)"
            " VALUES (?, ?, ?, ?, 1, ?)",
            (ctx.store_id, q, int(names_area(q, cfg.areas)), now, source),
        )
    ctx.conn.execute("UPDATE stores SET question_hash = ? WHERE id = ?", (wanted_hash, ctx.store_id))
    ctx.conn.commit()
    return {"action": "created", "source": source, "count": len(questions), "questions": questions}


def step_validate_questions(ctx: RunContext) -> dict:
    """Step 2. Runs every day on the active list; fails the run loudly if invalid."""
    rows = _active(ctx)
    problems = validate_questions([r["text"] for r in rows], ctx.store.areas)
    if problems:
        raise RunFailed("question list is invalid: " + "; ".join(problems))
    for r in rows:  # names_area is decided by code, keep it in sync with the config areas
        flag = int(names_area(r["text"], ctx.store.areas))
        if flag != r["names_area"]:
            ctx.conn.execute("UPDATE questions SET names_area = ? WHERE id = ?", (flag, r["id"]))
    ctx.conn.commit()
    rows = _active(ctx)
    ctx.data["_questions"] = rows
    return {"count": len(rows), "naming_area": sum(r["names_area"] for r in rows)}


def _active(ctx: RunContext):
    return ctx.conn.execute(
        "SELECT * FROM questions WHERE store_id = ? AND active = 1 ORDER BY id", (ctx.store_id,)
    ).fetchall()
