import json

from airtime.agents.visibility.extract import parse_extraction
from airtime.agents.visibility.verify import mention_rows, quote_in_text, verify_extraction

TEXT = """Here are some great options:
1. **Milligram** – a stylish stationery chain with stores across Melbourne.
2. Handworks in Prahran and Brighton has a lovely range of cards and gifts.
"""
ALIASES = ("Handworks", "Handworks Stationery", "Hand Works")


def ex(stores, tone="positive"):
    return {"stores": stores, "our_store_tone": tone}


def test_quote_verbatim_passes():
    assert quote_in_text("Handworks in Prahran and Brighton has a lovely range", TEXT)


def test_quote_ignores_markdown_curly_quotes_and_spacing():
    assert quote_in_text("1. Milligram - a stylish  stationery chain", TEXT)


def test_paraphrased_quote_fails():
    assert not quote_in_text("Handworks has a great range of cards", TEXT)


def test_quote_is_case_sensitive():
    assert not quote_in_text("handworks in prahran", TEXT)


def test_empty_quote_fails():
    assert not quote_in_text("   ", TEXT)


def test_good_extraction_verifies():
    e = ex([{"name": "Milligram", "rank": 1, "quote": "Milligram – a stylish stationery chain"},
            {"name": "Handworks", "rank": 2, "quote": "Handworks in Prahran and Brighton"}])
    assert verify_extraction(TEXT, e, ALIASES) == []


def test_bad_quote_reported():
    e = ex([{"name": "Milligram", "rank": 1, "quote": "Milligram, the best shop"},
            {"name": "Handworks", "rank": 2, "quote": "Handworks in Prahran and Brighton"}])
    problems = verify_extraction(TEXT, e, ALIASES)
    assert len(problems) == 1 and "not verbatim" in problems[0]


def test_missing_our_store_reported():
    e = ex([{"name": "Milligram", "rank": 1, "quote": "Milligram"}], tone="none")
    assert any("names our store" in p for p in verify_extraction(TEXT, e, ALIASES))


def test_tone_must_match_presence():
    e = ex([{"name": "Milligram", "rank": 1, "quote": "Milligram"},
            {"name": "Handworks", "rank": 2, "quote": "Handworks"}], tone="none")
    assert any("tone is none" in p for p in verify_extraction(TEXT, e, ALIASES))


def test_duplicate_ranks_reported():
    e = ex([{"name": "Milligram", "rank": 1, "quote": "Milligram"},
            {"name": "Handworks", "rank": 1, "quote": "Handworks"}])
    assert any("same rank" in p for p in verify_extraction(TEXT, e, ALIASES))


def test_parse_extraction_is_strict():
    assert parse_extraction("not json")[0] is None
    assert parse_extraction(json.dumps({"stores": "x", "our_store_tone": "none"}))[0] is None
    _, problems = parse_extraction(json.dumps(
        {"stores": [{"name": "A", "rank": 0, "quote": "A"}], "our_store_tone": "great"}))
    assert any("rank" in p for p in problems) and any("tone" in p for p in problems)
    ok, problems = parse_extraction(json.dumps(
        {"stores": [{"name": "A", "rank": None, "quote": "A"}], "our_store_tone": "none"}))
    assert problems == [] and ok["stores"][0]["name"] == "A"


def test_mention_rows_merge_aliases(cfg):
    e = ex([{"name": "Milligram Studio", "rank": None, "quote": "x"},
            {"name": "Milligram", "rank": None, "quote": "y"},
            {"name": "Handworks Stationery", "rank": None, "quote": "z"}])
    rows = mention_rows(e, cfg)
    assert [(r["store_key"], r["is_ours"]) for r in rows] == [("milligram", False), ("handworks", True)]
    assert rows[1]["tone"] == "positive" and rows[0]["tone"] is None
