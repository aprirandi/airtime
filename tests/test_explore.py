"""Explore mode: new questions aimed at the topics where the store is named least."""

import json
from dataclasses import replace

import pytest

from airtime import db
from airtime.agents.visibility.agent import shift_flow
from airtime.agents.visibility.questions import explore_plan, filter_explore
from airtime.agents.visibility.topics import matches_term, pick_weak_topics, topic_stats, topics_for
from airtime.cli import is_shift_day
from airtime.config import parse_store_config
from airtime.providers.fake import FakeProvider
from conftest import fake_extractor, make_ctx

CORE = ("Best stationery shops in Melbourne",
        "Where can I buy greeting cards and wrapping paper in Melbourne?",
        "Unique gift shops in Prahran or Brighton Melbourne")


@pytest.fixture(autouse=True)
def no_site_fetch(monkeypatch):
    monkeypatch.setattr("airtime.site.fetch_site_text", lambda store: "")


@pytest.fixture
def ecfg(cfg):
    return replace(cfg, questions=CORE, attempts_per_day=1, daily_count=4, daily_attempts=1,
                   daily_mode="explore", explore_per_topic=2)


def writer(pairs_by_call, prompts):
    calls = iter(pairs_by_call)

    def respond(prompt, schema):
        if "for the topics below" in prompt:
            prompts.append(prompt)
            pairs = next(calls, [])  # a retry for topics still short gets nothing new
            return json.dumps({"questions": [{"topic": t, "question": q} for t, q in pairs]})
        return fake_extractor(prompt, schema)

    return FakeProvider(complete_responder=respond, sleep=lambda s: None)


def run_day(conn, cfg, date, work, named_when=lambda q: False):
    def answer(q):
        return f"1. Handworks for: {q}." if named_when(q) else f"1. Milligram for: {q}."
    ask = FakeProvider(ask_responder=answer, sleep=lambda s: None)
    ctx = make_ctx(conn, cfg, date, ask=ask, work=work)
    shift_flow().run(ctx)
    return ctx


def test_topic_words_match_plurals_and_a_question_can_be_in_two_topics(cfg):
    assert matches_term("Funny birthday cards", "card") and matches_term("gift boxes", "gift box")
    assert not matches_term("cardboard boxes", "card")
    assert topics_for("Where can I buy greeting cards and wrapping paper in Melbourne?", cfg.topics) == \
        ["Greeting cards", "Wrapping paper"]
    assert topics_for("Where is the nearest post office?", cfg.topics) == []


def test_pick_order_never_asked_then_weakest_then_weight():
    stats = [
        {"topic": "A", "weight": 1, "answers": 10, "ours": 5, "rate": 0.5, "competitor_mentions": 1},
        {"topic": "B", "weight": 1, "answers": 10, "ours": 0, "rate": 0.0, "competitor_mentions": 3},
        {"topic": "C", "weight": 1, "answers": 0, "ours": 0, "rate": None, "competitor_mentions": 0},
        {"topic": "D", "weight": 3, "answers": 10, "ours": 0, "rate": 0.0, "competitor_mentions": 0},
    ]
    assert [s["topic"] for s in pick_weak_topics(stats, 3)] == ["C", "D", "B"]


def test_filter_explore_checks_topic_words_and_the_usual_rules(ecfg):
    plan = [({"topic": "Greeting cards"}, 1), ({"topic": "Gifts"}, 2)]
    kept, dropped = filter_explore([
        ("Greeting cards", "Where to buy funny birthday cards in Melbourne?"),
        ("Greeting cards", "Handmade cards shop in Prahran"),          # over the planned 1 for this topic
        ("Gifts", "Best notebooks shop in Melbourne"),                 # labelled Gifts, has no gift word
        ("Gifts", "Handworks gift vouchers Melbourne"),                # names our store
        ("Stationery", "Fountain pen shop Melbourne"),                 # not one of today's topics
        ("Gifts", "Last minute gift ideas in Brighton"),
    ], ecfg, plan, avoid=[], kept=[])
    assert kept == [("Greeting cards", "Where to buy funny birthday cards in Melbourne?"),
                    ("Gifts", "Last minute gift ideas in Brighton")]
    assert any("does not use a Gifts word" in d for d in dropped)
    assert any("names our store" in d for d in dropped)
    assert any("not one of today's topics" in d for d in dropped)


def test_explore_aims_at_weak_topics_and_learns_from_earlier_answers(conn, ecfg):
    prompts = []
    work = writer([
        # day 1: nothing measured yet, so every topic is "not asked"; ties go alphabetically
        [("Gifts", "Gift shop near Brighton"), ("Gifts", "Last minute gift ideas in Melbourne"),
         ("Greeting cards", "Where to buy funny birthday cards in Melbourne?"),
         ("Greeting cards", "Wedding card shops near Prahran")],
        # day 2
        [("Journals and notebooks", "Where can I buy Japanese notebooks in Melbourne?"),
         ("Journals and notebooks", "Best planner shop in Prahran for 2027"),
         ("Greeting cards", "Handmade thank you cards in Brighton"),
         ("Greeting cards", "Sympathy card shop in Melbourne CBD")],
    ], prompts)
    # Our store is named for gift questions only, so Gifts is not a weak topic on day 2.
    named = lambda q: "gift" in q.lower()
    d1 = run_day(conn, ecfg, "2026-10-26", work, named).data["write_questions"]["daily"]
    assert d1["mode"] == "explore" and [t["topic"] for t in d1["topics"]] == ["Gifts", "Greeting cards"]
    assert d1["count"] == 4

    d2 = run_day(conn, ecfg, "2026-10-27", work, named).data["write_questions"]["daily"]
    # Journals was never asked, so it comes first; then the weakest topic with the strongest rival.
    assert [t["topic"] for t in d2["topics"]] == ["Journals and notebooks", "Greeting cards"]
    assert d2["count"] == 4
    # The writer saw what was asked before in that topic, that our store was not named, and who was.
    assert "Already asked: Where to buy funny birthday cards in Melbourne? (shop not named)" in prompts[1]
    assert "Milligram named most (3)" in prompts[1]
    assert "Topic: Journals and notebooks" in prompts[1] and "Not asked yet." in prompts[1]
    # Each question keeps why its topic was picked.
    row = conn.execute("SELECT reason FROM questions WHERE text = 'Handmade thank you cards in Brighton'").fetchone()
    reason = json.loads(row["reason"])
    assert (reason["topic"], reason["answers"], reason["ours"], reason["competitor"]) == ("Greeting cards", 3, 0, "Milligram")


def test_topic_stats_only_reads_the_window(conn, ecfg):
    work = writer([[("Gifts", "Gift shop near Brighton"), ("Gifts", "Last minute gift ideas in Melbourne"),
                    ("Greeting cards", "Where to buy funny birthday cards in Melbourne?")]], [])
    run_day(conn, ecfg, "2026-09-01", work)
    sid = db.upsert_store(conn, ecfg)
    assert all(s["answers"] == 0 for s in topic_stats(conn, sid, ecfg.topics, before="2026-10-27", days=28))
    gifts = next(s for s in topic_stats(conn, sid, ecfg.topics, before="2026-09-02", days=28) if s["topic"] == "Gifts")
    assert (gifts["answers"], gifts["ours"], gifts["competitor"]) == (3, 0, "Milligram")


def test_shift_days_come_from_the_config(cfg):
    weekly = replace(cfg, weekdays=("mon",))
    assert is_shift_day(weekly, "2026-10-26")       # a Monday
    assert not is_shift_day(weekly, "2026-10-27")
    data = {"store": {"name": "X", "domain": "x", "areas": ["A"], "categories": ["c"]},
            "run": {"weekdays": ["Monday", "Thu"]}}
    assert parse_store_config("x", data).weekdays == ("mon", "thu")
    with pytest.raises(ValueError):
        parse_store_config("x", {**data, "run": {"weekdays": ["someday"]}})


def test_run_command_does_nothing_on_a_day_off(tmp_path, monkeypatch):
    from airtime import cli
    real = cli.load_store_config
    monkeypatch.setattr(cli, "load_store_config", lambda slug: replace(real(slug), weekdays=("mon",)))
    path = tmp_path / "a.sqlite"
    assert cli.main(["--db", str(path), "run", "--store", "handworks", "--date", "2026-10-27"]) == 0
    assert not path.exists()
    assert cli.main(["due", "--store", "handworks", "--date", "2026-10-27"]) == 1
    assert cli.main(["due", "--store", "handworks", "--date", "2026-10-26"]) == 0


def test_export_shows_topics_and_why_each_new_question_was_asked(conn, ecfg, tmp_path):
    from airtime.export import export_site
    work = writer([[("Gifts", "Gift shop near Brighton"), ("Gifts", "Last minute gift ideas in Melbourne"),
                    ("Greeting cards", "Where to buy funny birthday cards in Melbourne?"),
                    ("Greeting cards", "Wedding card shops near Prahran")]], [])
    run_day(conn, ecfg, "2026-10-26", work, lambda q: "gift" in q.lower())
    export_site(conn, tmp_path)
    store = json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]
    by_topic = {t["topic"]: t for t in store["topics"]}
    assert (by_topic["Gifts"]["answers"], by_topic["Gifts"]["ours"]) == (3, 3)
    assert by_topic["Journals and notebooks"]["answers"] == 0
    q = next(q for q in store["runs"][0]["questions"] if q["text"] == "Wedding card shops near Prahran")
    assert q["topics"] == ["Greeting cards"] and q["reason"]["topic"] == "Greeting cards"
    assert "named least: Gifts, Greeting cards" in store["runs"][0]["steps"][0]["description"]
