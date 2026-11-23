"""Auditor scoring, the audit run end to end, the Master check, and the real HTTP fetcher."""

import http.server
import json
import threading
from dataclasses import replace

import pytest

from airtime.agents.auditor.agent import audit_flow
from airtime.agents.auditor.http import HttpFetcher, Response
from airtime.agents.auditor.master import audit_complete
from airtime.agents.auditor.registry import REGISTRY
from airtime.agents.auditor.score import coverage, gaps, label_for, score_rows
from airtime.core.agent import RunFailed
from auditor_site import HOME, ORIGIN, FakeSite, good_routes, html, text
from conftest import make_ctx


def row(tier, result, percent=None, group=1, scored=True, controlled="", check_id="x"):
    pct = {"pass": 100, "fail": 0}.get(result, percent or 0)
    return {"check_id": check_id, "group": group, "tier": tier, "source": "both", "result": result,
            "percent": pct, "scored": scored, "controlled_by": controlled, "evidence": "e", "details": {}}


# ---- scoring ----------------------------------------------------------------------------------

def test_score_follows_the_tier_structure():
    rows = [row("essential", "pass"), row("essential", "partial", 50), row("essential", "fail"),
            row("recommended", "pass"), row("recommended", "fail"),
            row("bonus", "pass"), row("bonus", "fail")]
    s = score_rows(rows)
    assert s["tiers"]["essential"] == {"total": 3, "passing": 1, "partial": 1, "failed": 1,
                                       "available": 80.0, "earned": 40.0}
    assert s["tiers"]["recommended"]["earned"] == 10.0 and s["tiers"]["bonus"]["points"] == 2.5
    assert s["score"] == 52.5 and s["label"] == "blockers"      # (40 + 10) / 100 * 100 + 2.5


def test_a_tier_with_no_scored_checks_is_left_out():
    s = score_rows([row("essential", "pass"), row("essential", "fail")])
    assert s["score"] == 50.0 and s["tiers"]["recommended"]["available"] == 0.0


def test_bonus_never_lowers_the_score_and_the_score_is_capped():
    base = [row("essential", "pass"), row("recommended", "pass")]
    assert score_rows(base + [row("bonus", "fail")])["score"] == 100.0 - 0.0
    assert score_rows(base + [row("bonus", "pass")])["score"] == 100.0
    worse = [row("essential", "fail"), row("recommended", "fail")]
    assert score_rows(worse + [row("bonus", "fail")])["score"] == 0.0


def test_unscored_rows_are_left_out_of_every_number():
    rows = [row("essential", "pass"),
            row("essential", "fail", scored=False, controlled="shopify"),   # platform-controlled
            row("essential", "na", scored=False), row("essential", "planned", scored=False),
            row("essential", "fail", group=4, scored=False)]
    s = score_rows(rows)
    assert s["score"] == 100.0 and s["tiers"]["essential"]["total"] == 1
    assert s["groups"]["1"]["platform_controlled"] == 1 and s["groups"]["1"]["planned"] == 1


def test_no_scored_checks_gives_no_score():
    s = score_rows([row("essential", "na", scored=False)])
    assert s["score"] is None and s["label"] == "none"
    assert score_rows([])["score"] is None


def test_labels():
    assert [label_for(x) for x in (None, 100, 80, 79.9, 60, 59.9, 0)] == \
        ["none", "strong", "strong", "needs_work", "needs_work", "blockers", "blockers"]


def test_group_scores_need_no_weights():
    rows = [row("essential", "pass", group=1), row("recommended", "fail", group=1),
            row("recommended", "partial", 50, group=2), row("bonus", "pass", group=3)]
    g = score_rows(rows)["groups"]
    assert (g["1"]["percent"], g["2"]["percent"], g["3"]["percent"]) == (50, 50, 100)
    assert g["1"]["passing"] == 1 and g["1"]["failed"] == 1


def test_gaps_come_most_important_first():
    rows = [row("bonus", "fail", check_id="b"), row("recommended", "partial", 50, check_id="r"),
            row("essential", "fail", group=3, check_id="e3"), row("essential", "partial", 75, check_id="e1"),
            row("essential", "pass", check_id="ok"), row("essential", "fail", scored=False, check_id="hidden")]
    assert [g["check_id"] for g in gaps(rows)] == ["e1", "e3", "r", "b"]


# ---- the audit run ----------------------------------------------------------------------------

@pytest.fixture
def acfg(cfg):
    return replace(cfg, domain="shop.test", audit_url=ORIGIN, platform="")


def run_audit(conn, cfg, routes=None):
    ctx = make_ctx(conn, cfg, "2026-11-19")
    audit_flow(FakeSite(routes)).run(ctx)
    return ctx


def test_audit_run_stores_every_check_with_its_evidence(conn, acfg):
    ctx = run_audit(conn, acfg)
    run = conn.execute("SELECT * FROM runs").fetchone()
    assert run["agent"] == "auditor" and run["status"] == "ok"
    steps = json.loads(run["steps"])
    assert [s["name"] for s in steps] == ["fetch_pages", "run_checks", "score_audit", "list_gaps", "save_audit",
                                          "master_audit_complete"]
    assert steps[-1]["status"] == "ok" and steps[-1]["agent"] == "master"
    audit = conn.execute("SELECT * FROM audits").fetchone()
    assert audit["score"] == 100.0 and audit["score_label"] == "strong" and audit["target"] == ORIGIN
    rows = conn.execute("SELECT * FROM audit_checks WHERE audit_id = ?", (audit["id"],)).fetchall()
    assert len(rows) == len(REGISTRY)
    by = {r["check_id"]: r for r in rows}
    assert by["markdown_negotiation"]["result"] == "pass" and by["markdown_negotiation"]["evidence"]
    assert by["dns_aid"]["result"] == "planned" and by["dns_aid"]["scored"] == 0
    assert by["agent_payments"]["result"] == "na" and by["agent_payments"]["grp"] == 4
    assert len(json.loads(audit["fetches"])) == ctx.data["fetch_pages"]["requests"] > 25


def test_a_weak_site_gets_a_lower_score_and_a_gap_list(conn, acfg):
    routes = good_routes()
    for path in ("/robots.txt", "/llms.txt", "/pages/about-us"):
        routes.pop(path)
    routes["/"] = html("<h4>Hi</h4>")
    ctx = run_audit(conn, acfg, routes)
    assert ctx.data["score_audit"]["score"] < 80 and ctx.data["score_audit"]["label"] == "needs_work"
    assert ctx.data["list_gaps"]["gaps"] >= 5
    assert ctx.data["list_gaps"]["first"][:2] == ["raw_html_content", "markdown_negotiation"]   # essential first


def test_platform_controlled_checks_count_in_the_score_but_get_no_fix(conn, acfg):
    """The score says how ready the site is for AI, whatever the platform. The platform only decides who can fix it."""
    routes = good_routes()
    routes["/"] = html(HOME)                                        # no Markdown, no Link header
    routes["/__airtime-404-probe"] = html("<h1>x</h1>", 404)
    plain = run_audit(conn, acfg, routes)
    shopify = run_audit(conn, replace(acfg, platform="shopify"), routes)
    assert plain.data["score_audit"]["score"] == shopify.data["score_audit"]["score"] < 100.0   # same score on any platform
    last = conn.execute("SELECT id FROM audits ORDER BY id DESC LIMIT 1").fetchone()["id"]
    md = conn.execute("SELECT * FROM audit_checks WHERE audit_id = ? AND check_id = 'markdown_negotiation'",
                      (last,)).fetchone()
    assert md["result"] == "fail" and md["scored"] == 1 and md["controlled_by"] == "shopify"
    cov = json.loads(conn.execute("SELECT coverage FROM audits WHERE id = ?", (last,)).fetchone()["coverage"])
    assert "markdown_negotiation" in cov["platform_controlled"] and "dns_aid" in cov["planned"]
    # on a platform that controls it the owner cannot fix it: it is a limited gap, not a gap with a prompt
    assert plain.data["list_gaps"]["limited"] == 0 and shopify.data["list_gaps"]["limited"] >= 1
    assert "markdown_negotiation" in plain.data["list_gaps"]["first"]
    assert "markdown_negotiation" not in shopify.data["list_gaps"]["first"]


def test_an_unreachable_homepage_fails_the_run_loudly(conn, acfg):
    class Down:
        def __call__(self, url, **kw):
            return Response(url, error="ConnectionRefusedError")

    ctx = make_ctx(conn, acfg, "2026-11-19")
    with pytest.raises(RunFailed, match="could not reach"):
        audit_flow(Down()).run(ctx)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run["status"] == "failed" and "could not reach" in run["error"]
    assert conn.execute("SELECT COUNT(*) FROM audits").fetchone()[0] == 0


def test_a_crashing_check_is_recorded_and_stops_the_run(conn, acfg, monkeypatch):
    from airtime.agents.auditor import registry
    boom = replace(registry.BY_ID["robots_txt"], run=lambda snap: 1 / 0)
    monkeypatch.setattr("airtime.agents.auditor.agent.REGISTRY",
                        [boom if d.id == "robots_txt" else d for d in registry.REGISTRY])
    ctx = make_ctx(conn, acfg, "2026-11-19")
    with pytest.raises(RunFailed, match="could not run"):
        audit_flow(FakeSite()).run(ctx)
    assert ctx.data["run_checks"]["errors"] == ["robots_txt"]


# ---- the Master check -------------------------------------------------------------------------

def test_master_catches_a_missing_check_a_blank_evidence_and_a_wrong_score(conn, acfg):
    ctx = run_audit(conn, acfg, {**good_routes(), "/robots.txt": text("# empty")})
    assert audit_complete(ctx) == ([], {"checks": len(REGISTRY), "score": conn.execute(
        "SELECT score FROM audits").fetchone()["score"]})
    audit_id = conn.execute("SELECT id FROM audits").fetchone()["id"]

    conn.execute("UPDATE audits SET score = 99 WHERE id = ?", (audit_id,))
    problems, _ = audit_complete(ctx)
    assert any("stored score 99" in p for p in problems)
    conn.execute("UPDATE audits SET score = (SELECT score FROM audits WHERE id = ?)"
                 " WHERE id = ?", (audit_id, audit_id))

    conn.execute("UPDATE audit_checks SET evidence = '' WHERE check_id = 'robots_txt'")
    assert any("no evidence" in p for p in audit_complete(ctx)[0])

    conn.execute("DELETE FROM audit_checks WHERE check_id = 'sitemap'")
    assert any("no stored result: sitemap" in p for p in audit_complete(ctx)[0])


# ---- the real fetcher, against a local server ---------------------------------------------------

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/":
            self.send_response(301)
            self.send_header("Location", "/home")
            self.end_headers()
        elif self.path == "/home":
            body = b"<h1>Home</h1>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Link", "</a>; rel=preload")
            self.send_header("Link", "</b>; rel=api-catalog")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/loop":
            self.send_response(302)
            self.send_header("Location", "/loop")
            self.end_headers()
        else:
            body = b"nothing here"
            self.send_response(404)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


@pytest.fixture
def local_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_fetcher_follows_redirects_and_keeps_the_chain(local_server):
    r = HttpFetcher(allow_private=True, delay=0)(local_server + "/")
    assert r.status == 200 and r.final_url.endswith("/home") and [s for s, _ in r.chain] == [301]
    assert r.content_type == "text/html" and r.text == "<h1>Home</h1>"
    assert r.header("link") == "</a>; rel=preload, </b>; rel=api-catalog"


def test_fetcher_returns_the_body_of_an_error_page(local_server):
    r = HttpFetcher(allow_private=True, delay=0)(local_server + "/missing")
    assert r.status == 404 and r.text == "nothing here" and r.error is None


def test_fetcher_stops_a_redirect_loop(local_server):
    r = HttpFetcher(allow_private=True, delay=0)(local_server + "/loop")
    assert r.status == 0 and r.error == "too many redirects"


def test_fetcher_refuses_private_addresses_by_default(local_server):
    r = HttpFetcher(delay=0)(local_server + "/")
    assert r.status == 0 and "not a public address" in r.error
    assert HttpFetcher(delay=0)("file:///etc/passwd").error.startswith("unsupported URL")


def test_fetcher_reports_a_connection_error():
    r = HttpFetcher(allow_private=True, delay=0, timeout=2)("http://127.0.0.1:9/")
    assert r.status == 0 and r.error


# ---- the command line -------------------------------------------------------------------------

def test_audit_command_prints_the_score_and_stores_the_audit(tmp_path, monkeypatch, capsys):
    from airtime import cli, db
    path = tmp_path / "a.sqlite"
    monkeypatch.setattr("airtime.agents.auditor.http.HttpFetcher", lambda: FakeSite(origin="https://handworks.com.au"))
    monkeypatch.setattr("airtime.cli.export_site", lambda conn: None, raising=False)
    monkeypatch.setattr("airtime.export.export_site", lambda conn: None)
    assert cli.main(["--db", str(path), "audit", "--store", "handworks", "--date", "2026-11-19"]) == 0
    out = capsys.readouterr().out
    assert "/ 100" in out and "groups: 1=" in out and "platform: shopify" in out
    conn = db.connect(path)
    assert conn.execute("SELECT platform, engine FROM audits").fetchone()[:] == ("shopify", "airtime-auditor/2")


def test_audit_command_exits_2_when_the_site_is_down(tmp_path, monkeypatch, capsys):
    from airtime import cli
    monkeypatch.setattr("airtime.agents.auditor.http.HttpFetcher",
                        lambda: (lambda url, **kw: Response(url, error="ConnectionRefusedError")))
    monkeypatch.setattr("airtime.export.export_site", lambda conn: None)
    assert cli.main(["--db", str(tmp_path / "a.sqlite"), "audit", "--store", "handworks"]) == 2
    assert "AUDIT FAILED" in capsys.readouterr().err


# ---- what the website reads ---------------------------------------------------------------------

def test_export_gives_the_site_the_audit_and_the_run(conn, acfg, tmp_path):
    from airtime.export import export_site
    routes = good_routes()
    routes["/"] = html(HOME)                       # no Markdown and no Link header
    routes.pop("/llms.txt")
    run_audit(conn, replace(acfg, platform="shopify"), routes)
    export_site(conn, tmp_path)
    site = json.loads((tmp_path / "data" / "site.json").read_text())
    store = site["stores"][0]
    audit = store["audit"]
    assert audit["platform"] == "shopify" and audit["label"] == "strong" and audit["score"] == 90.6
    assert len(audit["checks"]) == len(REGISTRY) and audit["history"][0]["engine"] == "airtime-auditor/2"
    by = {c["id"]: c for c in audit["checks"]}
    assert by["llms_txt"]["result"] == "fail" and "404" in by["llms_txt"]["evidence"]
    assert by["llms_txt"]["platform_fix"].startswith("Shopify generates it") and by["llms_txt"]["fix_id"]
    assert by["markdown_negotiation"]["scored"] is True and by["markdown_negotiation"]["controlled_note"]
    assert audit["gaps"] == ["llms_txt"]      # Markdown and Link headers fail too, but Shopify controls them
    assert audit["group_names"]["1"]["id"] == "Akses dan isi"
    # the run shows up as an audit, not a shift, with a plain sentence per step in both languages
    run = next(r for r in store["runs"] if r["kind"] == "audit")
    assert [s["agent"] for s in run["steps"]][-1] == "master"
    first = run["steps"][0]
    assert first["description"].startswith("Fetched ") and first["description_id"].startswith("Mengambil ")
    assert run["steps"][-1]["description"].startswith("Master checked the Auditor's work")
    assert store["totals"]["days_on_duty"] == 0                   # an audit is not a shift
    assert next(m for m in site["team"] if m["id"] == "auditor")["status"] == "active"
    assert (tmp_path / "data" / "runs" / f"{run['id']}.json").exists()


def test_a_store_never_audited_has_no_audit_block(conn, cfg, tmp_path):
    from airtime import db
    from airtime.export import export_site
    db.upsert_store(conn, cfg)
    export_site(conn, tmp_path)
    assert json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]["audit"] is None
