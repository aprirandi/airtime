"""Step 4 (AI): read one answer and list the stores it names, as strict JSON."""

from __future__ import annotations

import json

from airtime.config import StoreConfig
from airtime.providers.base import Provider

TONES = ("positive", "neutral", "negative", "none")

# Gemini responseSchema (OpenAPI subset). Code re-checks the same shape in parse_extraction.
EXTRACTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "stores": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "rank": {"type": "INTEGER", "nullable": True},
                    "quote": {"type": "STRING"},
                },
                "required": ["name", "rank", "quote"],
                "propertyOrdering": ["name", "rank", "quote"],
            },
        },
        "our_store_tone": {"type": "STRING", "enum": list(TONES)},
    },
    "required": ["stores", "our_store_tone"],
    "propertyOrdering": ["stores", "our_store_tone"],
}

SYSTEM = (
    "You extract facts from text. You never add stores that are not in the text, never "
    "paraphrase quotes, and return only JSON matching the schema."
)


def build_extraction_prompt(store: StoreConfig, answer_text: str, problems: list[str] | None = None) -> str:
    lines = [
        "Below is an AI assistant's answer to a shopper's question.",
        "List every shop, store, brand outlet or online retailer the answer names, in the order "
        "they first appear. For each give:",
        "- name: the store name as written in the answer",
        "- rank: its number if the answer is a numbered or ordered list, else null",
        "- quote: a short exact quote (5 to 25 words) copied character for character from the "
        "answer, containing the store name",
        "Do not list markets, streets, suburbs or product brands that are not shops.",
        f"Our store is {store.name!r} (also written as: {', '.join(store.aliases) or 'no other names'}).",
        "our_store_tone: the answer's tone toward our store: positive, neutral or negative; "
        "use none if our store is not named.",
    ]
    if problems:
        lines.append("Your previous output had these problems, fix them: " + "; ".join(problems))
    lines += ["", "ANSWER:", "<<<", answer_text, ">>>"]
    return "\n".join(lines)


def parse_extraction(raw: str) -> tuple[dict | None, list[str]]:
    """Strictly check the JSON shape. Returns (extraction, problems)."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        return None, [f"invalid JSON: {exc}"]
    if not isinstance(data, dict):
        return None, ["top level is not an object"]
    problems = []
    extra = set(data) - {"stores", "our_store_tone"}
    if extra:
        problems.append(f"unexpected keys: {sorted(extra)}")
    stores = data.get("stores")
    if not isinstance(stores, list):
        return None, problems + ["'stores' is not a list"]
    if data.get("our_store_tone") not in TONES:
        problems.append(f"our_store_tone must be one of {TONES}")
    for i, s in enumerate(stores, 1):
        if not isinstance(s, dict):
            problems.append(f"store {i} is not an object")
            continue
        if not isinstance(s.get("name"), str) or not s["name"].strip():
            problems.append(f"store {i} has no name")
        if not isinstance(s.get("quote"), str) or not s["quote"].strip():
            problems.append(f"store {i} has no quote")
        rank = s.get("rank")
        if rank is not None and (not isinstance(rank, int) or isinstance(rank, bool) or rank < 1):
            problems.append(f"store {i} rank must be a positive integer or null")
    return (data if not problems else None), problems


def extract(provider: Provider, store: StoreConfig, answer_text: str,
            problems: list[str] | None = None) -> str:
    """One AI call; returns the raw JSON text for parse_extraction/verify."""
    return provider.complete(build_extraction_prompt(store, answer_text, problems),
                             json_schema=EXTRACTION_SCHEMA, system=SYSTEM)
