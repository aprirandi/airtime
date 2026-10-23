"""End-to-end: the whole Visibility agent on a fake provider, then report and import."""

import json

import pytest

from airtime.agents.visibility.agent import VisibilityAgent
from airtime.channels import compare_sources, render_markdown
from airtime.core.agent import Flow, RunFailed
from airtime.importer import import_file, seed_baseline
from airtime.config import REPO_ROOT
from airtime.providers.base import RateLimitError
from airtime.providers.fake import FakeProvider
from airtime.report import build_site
from conftest import fake_extractor, make_ctx

ANSWERS = {
    "Best stationery shops in Melbourne": "1. Milligram - stylish stationery.\n2. Notemaker - pens and paper.",
    "Where can I buy greeting cards and wrapping paper in Melbourne?": "",  # empty -> no_answer
    "Unique gift shops in Prahran or Brighton Melbourne": "Handworks in Prahran is a lovely gift shop.\nMilligram also has gifts.",
    "Best place to buy journals and notebooks in Melbourne": "kikki.K has journals. Milligram too.",
    "Birthday gift ideas under $30 in Melbourne": "Try Milligram for small gifts.",
    "Online stationery store in Australia with fast shipping": "Officeworks ships fast.",
}


def ask_responder():
    seen = {"rate_limited": False}

    def respond(q):
        if q.startswith("Online") and not seen["rate_limited"]:
            seen["rate_limited"] = True
            return RateLimitError("429", retry_after=1)
        return ANSWERS[q]
    return respond


def test_daily_run_end_to_end(conn, cfg, fake_work, tmp_path):
    ask = FakeProvider(ask_responder=ask_responder(), sleep=lambda s: None)
    ctx = make_ctx(conn, cfg, ask=ask, work=fake_work)
    Flow([VisibilityAgent()]).run(ctx)

    run = conn.execute("SELECT * FROM runs").fetchone()
    steps = json.loads(run["steps"])
    assert run["status"] == "ok"
    assert [(s["step"], s["kind"]) for s in steps] == [
        (1, "AI"), (2, "CODE"), (3, "CODE"), (4, "AI"), (5, "CODE"), (6, "CODE"), (7, "AI")]

    answers = conn.execute("SELECT * FROM answers").fetchall()
    assert len(answers) == 18  # 6 questions x 3 attempts, nothing dropped
    assert {a["provider"] for a in answers} == {"fake"} and {a["channel"] for a in answers} == {"api"}
    assert sum(a["status"] == "no_answer" for a in answers) == 3
    retried = [json.loads(a["raw"])["retries"] for a in answers if a["raw"] and json.loads(a["raw"])["retries"]]
    assert len(retried) == 1 and retried[0][0]["error"] == "429"  # the rate-limited ask is explained

    s = conn.execute("SELECT * FROM daily_summary").fetchone()
    assert (s["asked"], s["no_answer"], s["total_answers"]) == (18, 3, 15)
    assert s["our_mentions"] == 3 and (s["area_mentions"], s["area_answers"]) == (3, 3)
    assert (s["no_area_mentions"], s["no_area_answers"]) == (0, 12)
    assert (s["top_competitor"], s["top_competitor_mentions"]) == ("Milligram", 12)
    assert s["text_source"] == "code_fallback"  # fake work provider returns no summary template

    # Every counted mention has a quote that appears in its answer.
    for m in conn.execute("SELECT m.quote, a.text FROM mentions m JOIN answers a ON a.id = m.answer_id"):
        assert m["quote"] in m["text"]

    pages = build_site(conn, tmp_path)
    page = (tmp_path / "handworks" / "2026-10-20-fake-api.html").read_text()
    assert tmp_path / "index.html" in pages and "without web search" in page and "Milligram" in page


def test_bad_quote_is_retried_then_marked_needs_review(conn, cfg):
    calls = []

    def bad_then_good(prompt, schema):
        calls.append(prompt)
        out = json.loads(fake_extractor(prompt, schema))
        if "Notemaker" in prompt:  # always wrong for this answer
            for st in out["stores"]:
                st["quote"] = "a paraphrase that is not in the answer"
        elif "previous output had these problems" not in prompt and "Officeworks" in prompt:
            out["stores"][0]["quote"] = "Officeworks is great"  # wrong first time only
        return json.dumps(out)

    ask = FakeProvider(ask_responder=lambda q: ANSWERS[q] or "Nothing.", sleep=lambda s: None)
    work = FakeProvider(complete_responder=bad_then_good, sleep=lambda s: None)
    ctx = make_ctx(conn, cfg, ask=ask, work=work)
    Flow([VisibilityAgent()]).run(ctx)
    rows = conn.execute("SELECT a.status, a.error, q.text FROM answers a JOIN questions q ON q.id = a.question_id").fetchall()
    review = [r for r in rows if r["status"] == "needs_review"]
    assert len(review) == 3 and all(r["text"].startswith("Best stationery") for r in review)
    assert all("not verbatim" in r["error"] for r in review)
    online = [r for r in rows if r["text"].startswith("Online")]
    assert all(r["status"] == "ok" for r in online)  # fixed on the retry
    s = conn.execute("SELECT * FROM daily_summary").fetchone()
    assert s["needs_review"] == 3 and s["total_answers"] == 15


def test_invalid_questions_fail_loudly(conn, cfg):
    from dataclasses import replace
    bad = replace(cfg, questions=("Best stationery shops in Melbourne", "Best stationery shop in Melbourne",
                                  "Online stationery store in Australia"))
    ctx = make_ctx(conn, bad, ask=FakeProvider(), work=FakeProvider())
    with pytest.raises(RunFailed):
        Flow([VisibilityAgent()]).run(ctx)
    assert conn.execute("SELECT status FROM runs").fetchone()["status"] == "failed"
    assert conn.execute("SELECT COUNT(*) FROM answers").fetchone()[0] == 0


def test_over_budget_plan_fails_before_asking(conn, cfg):
    ctx = make_ctx(conn, cfg, ask=FakeProvider(max_calls=10), work=FakeProvider())
    with pytest.raises(RunFailed, match="call budget"):
        Flow([VisibilityAgent()]).run(ctx)


def test_questions_reused_and_second_day_compared(conn, cfg, fake_work):
    ask = FakeProvider(ask_responder=lambda q: ANSWERS[q], sleep=lambda s: None)
    Flow([VisibilityAgent()]).run(make_ctx(conn, cfg, "2026-10-20", ask=ask, work=fake_work))
    ask2 = FakeProvider(ask_responder=lambda q: ANSWERS[q], sleep=lambda s: None)
    ctx = make_ctx(conn, cfg, "2026-10-21", ask=ask2, work=fake_work)
    Flow([VisibilityAgent()]).run(ctx)
    assert ctx.data["write_questions"]["action"] == "reused"
    assert conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0] == 6
    lines = ctx.data["compare_previous"]["lines"]
    assert lines[0] == "Compared with the previous run on 2026-10-20:" and "no change" in lines[1]


def test_import_pasted_answers_and_compare(conn, cfg, fake_work, tmp_path):
    ask = FakeProvider(ask_responder=lambda q: ANSWERS[q], sleep=lambda s: None)
    ask.name = "gemini"
    Flow([VisibilityAgent()]).run(make_ctx(conn, cfg, ask=ask, work=fake_work))

    csv_path = tmp_path / "pasted.csv"
    csv_path.write_text(
        "question,provider,asked_at,text\n"
        '"Best stationery shops in Melbourne",gemini,2026-10-20,"Handworks and Milligram are both good."\n'
        '"Unique gift shops in Prahran or Brighton Melbourne",gemini,2026-10-20,"Handworks in Prahran."\n'
        '"Birthday gift ideas under $30 in Melbourne",gemini,2026-10-20,\n')
    done = import_file(csv_path, lambda d: make_ctx(conn, cfg, d, work=fake_work))
    assert len(done) == 1
    s = conn.execute("SELECT * FROM daily_summary WHERE channel = 'app_pasted'").fetchone()
    assert (s["provider"], s["asked"], s["no_answer"], s["our_mentions"], s["total_answers"]) == ("gemini", 3, 1, 2, 2)

    result = compare_sources(conn, s["store_id"], ("gemini", "api"), ("gemini", "app_pasted"))
    md = render_markdown(result, "Handworks")
    assert "| Our store named | 3 of 15 (20%) | 2 of 2 (100%) |" in md
    assert "Best stationery shops in Melbourne" in md


def test_seed_baseline(conn, cfg):
    from airtime import db
    store_id = db.upsert_store(conn, cfg)
    seed_baseline(conn, store_id, REPO_ROOT / "data/seed/handworks_baseline_2026-10-14.json")
    seed_baseline(conn, store_id, REPO_ROOT / "data/seed/handworks_baseline_2026-10-14.json")  # idempotent
    rows = conn.execute("SELECT * FROM daily_summary").fetchall()
    assert len(rows) == 1
    r = rows[0]
    assert (r["provider"], r["channel"], r["our_mentions"], r["total_answers"], r["asked"]) == ("mixed", "app_pasted", 3, 14, 18)
    assert (r["area_mentions"], r["area_answers"], r["no_area_mentions"], r["no_area_answers"]) == (2, 2, 1, 12)
    assert (r["top_competitor"], r["top_competitor_mentions"]) == ("Milligram", 10)
    from airtime.agents.visibility.summary import check_summary, summary_facts
    assert check_summary(r["text"], summary_facts(dict(r), None, "Handworks", cfg.areas)) == []
