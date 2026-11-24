"""Before and after: the day a fix went live is recorded with the Asker's "before", read back later with the "after"."""

import json

import pytest

from airtime import db
from airtime.changes import MIN_AFTER, WINDOW, changes_json, compare_change, record_change
from airtime.export import export_site


def shift(conn, store_id, date, mentions, answers, provider="gemini", channel="api"):
    conn.execute(
        """INSERT INTO daily_summary (store_id, date, provider, channel, asked, no_answer, needs_review, our_mentions,
               total_answers, top_competitor_mentions, area_mentions, area_answers, no_area_mentions, no_area_answers,
               core_mentions, core_answers) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, ?, ?)""",
        (store_id, date, provider, channel, mentions, answers, mentions, answers))
    conn.commit()


@pytest.fixture
def store(conn, cfg):
    return db.upsert_store(conn, cfg)


def row(conn, store, check="organization_completeness", on="2026-11-10"):
    return conn.execute("SELECT * FROM changes WHERE store_id = ? AND check_id = ? AND applied_on = ?",
                        (store, check, on)).fetchone()


def test_the_before_is_kept_the_moment_the_change_is_recorded(conn, store):
    for i, d in enumerate(["2026-11-03", "2026-11-04", "2026-11-05"]):
        shift(conn, store, d, 1 if i == 0 else 0, 6)
    before = record_change(conn, store, "organization_completeness", "2026-11-10", "added contact details")
    assert before["asker"] == {"shifts": 3, "mentions": 1, "answers": 18, "pct": 5.6, "from": "2026-11-03", "to": "2026-11-05"}
    shift(conn, store, "2026-11-12", 5, 6)                      # later results never rewrite what was kept
    assert json.loads(row(conn, store)["before"])["asker"]["answers"] == 18


def test_only_the_last_shifts_before_the_day_count_and_the_day_itself_does_not(conn, store):
    for n in range(9):                                          # 1 to 9 Nov, more than the window
        shift(conn, store, f"2026-11-{n + 1:02d}", 0, 6)
    shift(conn, store, "2026-11-10", 6, 6)                      # the day it went live is neither before nor after
    before = record_change(conn, store, "organization_completeness", "2026-11-10")["asker"]
    assert before["shifts"] == WINDOW and before["mentions"] == 0 and before["to"] == "2026-11-09"
    assert compare_change(conn, row(conn, store))["after"]["shifts"] == 0


def test_shifts_with_no_usable_answer_and_other_sources_count_for_nothing(conn, store):
    shift(conn, store, "2026-11-01", 0, 0)
    shift(conn, store, "2026-11-02", 3, 6, provider="mixed", channel="app_pasted")
    assert record_change(conn, store, "organization_completeness", "2026-11-10")["asker"]["shifts"] == 0


def test_the_result_waits_for_enough_shifts_and_never_names_a_cause(conn, store):
    shift(conn, store, "2026-11-05", 0, 6)
    record_change(conn, store, "organization_completeness", "2026-11-10")
    for n in range(MIN_AFTER - 1):
        shift(conn, store, f"2026-11-{11 + n}", 2, 6)
    early = compare_change(conn, row(conn, store))
    assert early["enough"] is False and early["result"] is None and early["after"]["shifts"] == MIN_AFTER - 1
    shift(conn, store, "2026-11-20", 2, 6)
    done = compare_change(conn, row(conn, store))
    assert done["enough"] is True and done["result"] == "up" and done["after"]["pct"] == 33.3
    assert set(done) == {"check_id", "applied_on", "note", "before", "score_before", "after", "score_after", "needed",
                         "enough", "result"}


def test_no_before_data_gives_no_result_instead_of_a_made_up_one(conn, store):
    record_change(conn, store, "organization_completeness", "2026-11-10")
    for n in range(MIN_AFTER):
        shift(conn, store, f"2026-11-{11 + n}", 1, 6)
    assert compare_change(conn, row(conn, store))["result"] is None


def test_bad_input_is_refused_and_recording_twice_keeps_the_first(conn, store):
    with pytest.raises(ValueError, match="unknown check"):
        record_change(conn, store, "no_such_check", "2026-11-10")
    with pytest.raises(ValueError, match="future"):
        record_change(conn, store, "organization_completeness", "2026-12-01", today="2026-11-23")
    with pytest.raises(ValueError):
        record_change(conn, store, "organization_completeness", "not-a-date")
    shift(conn, store, "2026-11-05", 0, 6)
    record_change(conn, store, "organization_completeness", "2026-11-10", "first note")
    shift(conn, store, "2026-11-08", 6, 6)
    record_change(conn, store, "organization_completeness", "2026-11-10", "second note")
    assert conn.execute("SELECT COUNT(*) FROM changes").fetchone()[0] == 1
    assert row(conn, store)["note"] == "first note" and json.loads(row(conn, store)["before"])["asker"]["shifts"] == 1


def test_the_export_carries_the_change_in_plain_words(conn, store, tmp_path):
    shift(conn, store, "2026-11-05", 0, 6)
    record_change(conn, store, "organization_completeness", "2026-11-10", "added contact details")
    export_site(conn, tmp_path)
    changes = json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]["changes"]
    assert changes[0]["title"] == "Contact details and address for assistants" and changes[0]["note"] == "added contact details"
    assert changes_json(conn, store)[0]["enough"] is False


def test_the_score_after_is_the_latest_scan_after_the_day_and_never_a_scan_before_it(conn, store):
    def audit(day, score):
        conn.execute("INSERT INTO audits (store_id, scanned_at, target, platform, engine, score, score_label) "
                     "VALUES (?, ?, 'https://x', '', 'e', ?, 'x')", (store, f"{day}T10:00:00+00:00", score))
        conn.commit()
    audit("2026-11-09", 60)
    record_change(conn, store, "organization_completeness", "2026-11-10")
    assert compare_change(conn, row(conn, store))["score_before"] == 60
    assert compare_change(conn, row(conn, store))["score_after"] is None
    audit("2026-11-10", 99)                                     # the day itself: it may have run before the fix
    audit("2026-11-12", 70)
    audit("2026-11-15", 75)
    got = compare_change(conn, row(conn, store))
    assert got["score_before"] == 60 and got["score_after"] == 75
