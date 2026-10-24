"""Small text helpers shared by the steps. Pure functions, no I/O."""

from __future__ import annotations

import re
import unicodedata

_QUOTE_MAP = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "−": "-",
    " ": " ",
})
_MARKDOWN_EMPHASIS = re.compile(r"(\*\*|__|\*|`)")
_MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\([^)\s]*\)")  # [text](url) -> text


def normalize_for_match(text: str) -> str:
    """Normalise text for verbatim quote checks.

    Only presentation differences are removed: unicode form, curly quotes and
    dashes, markdown links (the visible text is kept), markdown emphasis markers and
    runs of whitespace. Case and wording
    are kept, so a quote still has to be copied word for word.
    """
    text = unicodedata.normalize("NFKC", text).translate(_QUOTE_MAP)
    text = _MARKDOWN_LINK.sub(r"\1", text)
    text = _MARKDOWN_EMPHASIS.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def store_key(name: str) -> str:
    """Canonical key for a store name: 'The Milligram Store!' -> 'milligram store'."""
    text = unicodedata.normalize("NFKC", name).casefold().translate(_QUOTE_MAP)
    text = text.replace("&", " and ")
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.startswith("the "):
        text = text[4:]
    return text


def contains_term(text: str, term: str) -> bool:
    """Case-insensitive whole-word search, tolerant of punctuation and spacing."""
    words = [re.escape(w) for w in store_key(term).split()]
    if not words:
        return False
    pattern = r"\b" + r"[\W_]*".join(words) + r"\b"
    return re.search(pattern, store_key(text)) is not None


def word_set(text: str) -> set[str]:
    return set(store_key(text).split())
