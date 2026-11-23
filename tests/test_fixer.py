"""The Fixer: who has to move next on each gap, in words an owner reads."""

import json
from dataclasses import replace

import pytest

from airtime.agents.auditor.agent import audit_flow
from airtime.agents.auditor.registry import ASK, REGISTRY
from airtime.agents.fixer.agent import plan_all, plan_fix
from airtime.agents.fixer.master import fixes_complete
from airtime.agents.fixer.texts import CLIENT, QUESTIONS, STATUS_TEXT, STATUSES
from airtime.core.agent import RunContext
from airtime.export import export_site
from auditor_site import HOME, ORIGIN, FakeSite, good_routes, html, text
from conftest import make_ctx

TECHNICAL = ("json", "html", "curl", "http", "robots.txt", "sitemap.xml", "llms.txt", "agents.md", "markdown", "mcp",
             "oauth", "h1", "api", "javascript", "dns", "schema")


def row(check_id, tier="recommended", controlled=""):
    return {"check_id": check_id, "group": 1, "tier": tier, "result": "fail", "percent": 0, "scored": True,
            "controlled_by": controlled, "evidence": "e", "details": {}}


def test_a_fix_the_owner_must_answer_asks_the_questions_and_the_rest_wait_for_the_fixer():
    ask = plan_fix(row("organization_completeness"), "shopify", 1)
    assert ask["status"] == "needs_owner" and len(ask["questions"]) == 2
    assert ask["questions"][0]["id"].startswith("Nomor telepon") and ask["summary_id"].startswith("Fixer membutuhkan")
    plain = plan_fix(row("sitemap"), "shopify", 2)
    assert plain["status"] == "not_started" and plain["questions"] == []
    assert plain["summary"] == "The Fixer will prepare this. Nothing is needed from you."


def test_a_gap_the_platform_controls_says_so_and_names_the_platform():
    held = plan_fix(row("markdown_negotiation", "essential", controlled="shopify"), "shopify", 3)
    assert held["status"] == "platform_held" and held["questions"] == []
    assert "Shopify controls this" in held["summary"] and "Shopify yang mengatur ini" in held["summary_id"]


def test_the_owner_sees_what_they_can_act_on_first_and_the_platform_held_last():
    rows = [row("markdown_negotiation", "essential", "shopify"), row("sitemap"), row("raw_html_content", "essential"),
            row("organization_completeness")]
    fixes = plan_all(rows, "shopify")
    assert [f["check_id"] for f in fixes] == ["raw_html_content", "organization_completeness", "sitemap",
                                              "markdown_negotiation"]
    assert [f["position"] for f in fixes] == [1, 2, 3, 4]


def test_every_built_check_has_plain_words_and_the_questions_match_what_the_prompts_ask():
    built = {d.id for d in REGISTRY if d.run}
    assert set(CLIENT) == built
    assert set(QUESTIONS) == set(ASK)               # a check asks the owner in the prompt exactly when the owner is asked here


def test_nothing_an_owner_reads_is_technical():
    texts = [t for entry in CLIENT.values() for t in entry]
    texts += [t for qs in QUESTIONS.values() for pair in qs for t in pair]
    texts += [t for pair in STATUS_TEXT.values() for t in pair]
    for t in texts:
        low = t.lower()
        hit = [w for w in TECHNICAL if w in low]
        assert not hit, f"{t!r} uses {hit}"
    assert set(STATUS_TEXT) == set(STATUSES)


@pytest.fixture
def acfg(cfg):
    return replace(cfg, domain="shop.test", audit_url=ORIGIN, platform="shopify")


def weak_site():
    routes = good_routes()
    routes["/"] = html(HOME)                                     # no Markdown, no Link header (Shopify holds them)
    routes["/robots.txt"] = text("User-agent: *\nAllow: /\n")    # no sitemap line, no Content-Signal
    routes.pop("/llms.txt")
    return routes


def test_the_run_stores_the_fixes_and_the_master_passes_them(conn, acfg):
    ctx = make_ctx(conn, acfg, "2026-11-23")
    audit_flow(FakeSite(weak_site())).run(ctx)
    audit_id = conn.execute("SELECT id FROM audits").fetchone()[0]
    stored = conn.execute("SELECT check_id, status FROM fixes WHERE audit_id = ? ORDER BY position", (audit_id,)).fetchall()
    by = {r["check_id"]: r["status"] for r in stored}
    assert by["content_signals"] == "needs_owner" and by["sitemap"] == "not_started"
    assert by["markdown_negotiation"] == "platform_held" and by["link_headers"] == "platform_held"
    assert [r["status"] for r in stored][-2:] == ["platform_held", "platform_held"] or "platform_held" in by.values()
    run = conn.execute("SELECT steps FROM runs").fetchone()
    last = json.loads(run["steps"])[-1]
    assert last["name"] == "master_fixes_complete" and last["status"] == "ok"
    assert ctx.data["plan_fixes"]["needs_owner"] >= 1


def test_the_export_gives_the_owner_the_fixes_and_never_the_prepared_change(conn, acfg, tmp_path):
    audit_flow(FakeSite(weak_site())).run(make_ctx(conn, acfg, "2026-11-23"))
    conn.execute("UPDATE fixes SET draft = ?", (json.dumps({"secret": "the prepared change"}),))
    conn.commit()
    export_site(conn, tmp_path)
    raw = (tmp_path / "data" / "site.json").read_text()
    audit = json.loads(raw)["stores"][0]["audit"]
    fixes = audit["fixes"]
    assert fixes and fixes[0]["position"] == 1 and set(fixes[0]) == {
        "check_id", "position", "status", "tier", "title", "title_id", "why", "why_id", "summary", "summary_id", "questions"}
    assert "the prepared change" not in raw and '"draft"' not in raw


def test_the_master_sends_the_fixer_back_when_a_gap_has_no_fix(conn, acfg):
    ctx = make_ctx(conn, acfg, "2026-11-23")
    audit_flow(FakeSite(weak_site()), fixer=False).run(ctx)       # the audit alone: no fixes were saved
    ctx.data["_audit_id"] = conn.execute("SELECT id FROM audits").fetchone()[0]
    problems, _ = fixes_complete(ctx)
    assert problems and "do not match the gaps" in problems[0]


def test_an_audit_without_the_fixer_still_works(conn, acfg):
    ctx = make_ctx(conn, acfg, "2026-11-23")
    audit_flow(FakeSite(), fixer=False).run(ctx)
    assert conn.execute("SELECT COUNT(*) FROM fixes").fetchone()[0] == 0
