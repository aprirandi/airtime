"""Daily questions: new ones every day, never repeating recent ones, core ones kept for trends."""

import json
from dataclasses import replace

import pytest

from airtime.agents.visibility.agent import shift_flow
from airtime.agents.visibility.questions import filter_daily, recent_questions
from airtime.core.agent import Flow
from airtime.providers.fake import FakeProvider
from conftest import fake_extractor, make_ctx

CORE = ("Best stationery shops in Melbourne",
        "Where can I buy greeting cards and wrapping paper in Melbourne?",
        "Unique gift shops in Prahran or Brighton Melbourne")

DAY1 = ["Where to buy a fountain pen gift in Melbourne?", "Wedding card shops near Prahran",
        "Cute desk accessories shop Melbourne CBD", "Where can I find Japanese notebooks in Melbourne?",
        "Last minute gift shop open Sunday Brighton", "Shop for personalised stationery in Melbourne"]
DAY2 = ["Where to buy a fountain pen gift in Melbourne?",          # repeat of yesterday: must be dropped
        "Handworks opening hours",                                 # names our store: must be dropped
        "Best planner and diary shops in Melbourne for 2027", "Gift wrapping service in Brighton Melbourne",
        "Where can I buy watercolour paper in Melbourne?", "Kids stationery shop Prahran",
        "Eco friendly greeting cards Melbourne", "Where to buy calligraphy supplies Melbourne"]


@pytest.fixture(autouse=True)
def no_site_fetch(monkeypatch):
    monkeypatch.setattr("airtime.site.fetch_site_text", lambda store: "")


@pytest.fixture
def daily_cfg(cfg):
    return replace(cfg, questions=CORE, attempts_per_day=2, daily_count=6, daily_attempts=1)


def work_provider(day_lists):
    lists = iter(day_lists)

    def respond(prompt, schema):
        if "NEW questions" in prompt:
            return json.dumps({"questions": next(lists)})
        return fake_extractor(prompt, schema)

    return FakeProvider(complete_responder=respond, sleep=lambda s: None)


def run_day(conn, cfg, date, work):
    ask = FakeProvider(ask_responder=lambda q: f"Try Milligram for: {q}.", sleep=lambda s: None)
    ctx = make_ctx(conn, cfg, date, ask=ask, work=work)
    shift_flow().run(ctx)
    return ctx


def test_core_plus_daily_questions_are_asked_with_their_own_tries(conn, daily_cfg):
    ctx = run_day(conn, daily_cfg, "2026-10-25", work_provider([DAY1]))
    rows = conn.execute("SELECT q.kind, q.text, a.attempt FROM answers a JOIN questions q ON q.id = a.question_id").fetchall()
    assert len(rows) == 3 * 2 + 6 * 1 == 12
    assert {r["text"] for r in rows if r["kind"] == "daily"} == set(DAY1)
    assert max(r["attempt"] for r in rows if r["kind"] == "daily") == 1
    s = conn.execute("SELECT * FROM daily_summary").fetchone()
    assert (s["core_answers"], s["daily_answers"]) == (6, 6)
    assert ctx.data["write_questions"]["daily"]["action"] == "created"


def test_next_day_gets_new_questions_and_never_repeats(conn, daily_cfg):
    work = work_provider([DAY1, DAY2])
    run_day(conn, daily_cfg, "2026-10-25", work)
    ctx = run_day(conn, daily_cfg, "2026-10-26", work)
    day2 = [r["text"] for r in conn.execute("SELECT text FROM questions WHERE kind = 'daily' AND for_date = '2026-10-26'")]
    assert len(day2) == 6
    assert "Where to buy a fountain pen gift in Melbourne?" not in day2 and "Handworks opening hours" not in day2
    dropped = ctx.data["write_questions"]["daily"]["dropped"]
    assert any("repeats a recent question" in d for d in dropped) and any("names our store" in d for d in dropped)
    # the core questions stay the same both days
    assert conn.execute("SELECT COUNT(*) FROM questions WHERE kind = 'core' AND active = 1").fetchone()[0] == 3


def test_rerun_same_day_reuses_todays_questions(conn, daily_cfg):
    work = work_provider([DAY1])
    run_day(conn, daily_cfg, "2026-10-25", work)
    ctx = run_day(conn, daily_cfg, "2026-10-25", work)
    assert ctx.data["write_questions"]["daily"]["action"] == "reused"
    assert conn.execute("SELECT COUNT(*) FROM questions WHERE kind = 'daily'").fetchone()[0] == 6


def test_failed_daily_generation_does_not_stop_the_core_run(conn, daily_cfg):
    def respond(prompt, schema):
        return "not json" if "NEW questions" in prompt else fake_extractor(prompt, schema)

    ctx = run_day(conn, daily_cfg, "2026-10-25", FakeProvider(complete_responder=respond, sleep=lambda s: None))
    assert ctx.data["write_questions"]["daily"]["action"] == "failed"
    assert conn.execute("SELECT COUNT(*) FROM answers").fetchone()[0] == 6  # 3 core x 2 tries
    assert conn.execute("SELECT status FROM runs").fetchone()[0] == "ok"


def test_recent_window(conn, daily_cfg):
    from airtime import db
    sid = db.upsert_store(conn, daily_cfg)
    for d, t in [("2026-10-01", "old one about pens"), ("2026-10-20", "recent one about cards")]:
        conn.execute("INSERT INTO questions (store_id, text, names_area, created_at, active, source, kind, for_date)"
                     " VALUES (?, ?, 0, 'x', 1, 'ai', 'daily', ?)", (sid, t, d))
    recent = recent_questions(conn, sid, "2026-10-25", 14)
    assert "recent one about cards" in recent and "old one about pens" not in recent


def test_filter_daily_caps_and_explains(daily_cfg):
    kept, dropped = filter_daily(["Gift shops in Prahran", "gift shops in prahran?", "Hi", "Pens in Melbourne CBD",
                                  "Funny birthday cards for my coworker"], daily_cfg, [], 5)
    assert kept == ["Gift shops in Prahran", "Pens in Melbourne CBD"]
    assert len(dropped) == 3 and any("names no place" in d for d in dropped)
