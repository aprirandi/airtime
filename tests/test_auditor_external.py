"""Is Agentic as a second opinion: parsed, classified, stored, exported, and never able to fail the audit."""

import json
from dataclasses import replace

import pytest

from airtime.agents.auditor.agent import audit_flow
from airtime.agents.auditor.isagentic import ExternalError, IsAgenticClient, classify, parse_report
from airtime.export import export_site
from auditor_site import ORIGIN, FakeSite, good_routes, html, text
from conftest import make_ctx

# Shaped like the real report for Handworks on 23 Nov 2026 (fields cut down).
REPORT = {
    "target": "https://shop.test", "display_target": "shop.test", "report_url": "https://is-agentic.com/scan/shop.test",
    "score": 54, "score_label": "Important blockers remain", "scanned_at": "2026-11-23T02:56:11.433Z", "eligible_checks": 29,
    "score_breakdown": {"essential": {"earned": 37.6, "available": 80, "passing": 4, "total": 11},
                        "recommended": {"earned": 11.8, "available": 20, "passing": 8, "total": 18},
                        "bonus": {"points": 5, "positive_signals": 23}},
    "issues": [
        {"id": "content-no-js", "name": "Content without JavaScript", "tier": "essential", "result": "partial",
         "details": "2.0% content ratio is below the 5% target.", "recommendation": "Serve at least 500 characters."},
        {"id": "openapi-spec", "name": "OpenAPI spec published", "tier": "essential", "result": "failed",
         "details": "No OpenAPI/Swagger specification found", "recommendation": "Publish an OpenAPI specification."},
        {"id": "brand-search-accuracy", "name": "Brand name discoverability", "tier": "recommended", "result": "failed",
         "details": "not in the top 10", "recommendation": "Describe your main product in the title."},
    ],
}


def transport(routes):
    """A fake of the network: routes maps a path to (status, body); records every call."""
    calls = []

    def call(url, accept, timeout):
        calls.append(url)
        for path, answer in routes.items():
            if path in url:
                return answer(len(calls)) if callable(answer) else answer
        raise AssertionError(f"unexpected call {url}")
    call.calls = calls
    return call


def ok(body=REPORT):
    return (200, json.dumps(body))


def test_the_report_is_parsed_and_each_issue_is_classified():
    got = parse_report(REPORT)
    assert got["score"] == 54 and got["label"] == "Important blockers remain" and got["eligible_checks"] == 29
    kinds = {i["id"]: (i["kind"], i["maps_to"]) for i in got["issues"]}
    assert kinds == {"content-no-js": ("mapped", "raw_html_content"), "openapi-spec": ("api_product", ""),
                     "brand-search-accuracy": ("extra", "")}
    assert classify("something-new") == ("extra", "")          # an unknown check is shown, never hidden or scored


def test_a_stored_report_costs_one_request():
    t = transport({"/api/v1/report": ok()})
    got = IsAgenticClient(t).fetch("https://shop.test")
    assert got["score"] == 54 and len(t.calls) == 1 and "url=https%3A%2F%2Fshop.test" in t.calls[0]


def test_with_no_stored_report_it_starts_one_scan_and_reads_again():
    t = transport({"/api/v1/report": lambda n: (404, "{}") if n == 1 else ok(), "/api/scan/stream": (200, "")})
    client = IsAgenticClient(t)
    assert client.fetch("https://shop.test")["score"] == 54
    assert [c.split("?")[0].rsplit("/api/", 1)[1] for c in t.calls] == ["v1/report", "scan/stream", "v1/report"]
    assert client.requests == 3                                 # never more than three


@pytest.mark.parametrize("status,words", [(429, "limit"), (503, "HTTP 503"), (404, "HTTP 404")])
def test_errors_become_a_reason_not_a_crash(status, words):
    t = transport({"/api/v1/report": (status, "{}"), "/api/scan/stream": (200, "")})
    with pytest.raises(ExternalError, match=words):
        IsAgenticClient(t).fetch("https://shop.test")


def test_a_report_with_an_unexpected_shape_is_refused_not_guessed():
    with pytest.raises(ExternalError, match="shape"):
        parse_report({"score": 1})


@pytest.fixture
def acfg(cfg):
    return replace(cfg, domain="shop.test", audit_url=ORIGIN, platform="shopify", audit_external=True)


def run(conn, acfg, tmp_path, client, routes=None):
    ctx = make_ctx(conn, acfg, "2026-11-23")
    audit_flow(FakeSite(routes or good_routes()), client).run(ctx)
    export_site(conn, tmp_path)
    return ctx, json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]["audit"]


def test_the_second_opinion_is_stored_and_exported_beside_our_score(conn, acfg, tmp_path):
    routes = good_routes()
    routes["/robots.txt"] = text("User-agent: *\nAllow: /\n")
    ctx, audit = run(conn, acfg, tmp_path, IsAgenticClient(transport({"/api/v1/report": ok()})), routes)
    assert ctx.data["external_scan"]["status"] == "ok" and ctx.data["external_scan"]["extra"] == 1
    ext = audit["external"]
    assert ext["score"] == 54 and ext["report_url"] == "https://is-agentic.com/scan/shop.test"
    assert audit["score"] != ext["score"]                       # never mixed
    assert [i["kind"] for i in ext["issues"]] == ["mapped", "api_product", "extra"]
    by = {c["id"]: c for c in audit["checks"]}
    assert by["raw_html_content"]["external"]["result"] == "partial"
    assert by["sitemap"]["external"] == {"id": "sitemap", "result": "not_listed", "details": ""}
    assert by["robots_txt"]["external"] is None                 # not a check they report


def test_agreement_counts_only_checks_both_sides_ran(conn, acfg, tmp_path):
    _, audit = run(conn, acfg, tmp_path, IsAgenticClient(transport({"/api/v1/report": ok()})))
    a = audit["external"]["agreement"]
    assert a["compared"] == len([c for c in audit["checks"] if c["external"]]) > 0
    # our clean fixture passes content, they list it as partial: exactly one disagreement
    assert a["agree"] == a["compared"] - 1


def test_a_bonus_check_they_do_not_list_is_not_counted_as_agreement(conn, acfg, tmp_path):
    routes = good_routes()
    del routes["/llms.txt"]                                        # ours: llms_txt fails, and it is a bonus check
    _, audit = run(conn, acfg, tmp_path, IsAgenticClient(transport({"/api/v1/report": ok()})), routes)
    by = {c["id"]: c for c in audit["checks"]}
    assert by["llms_txt"]["tier"] == "bonus" and by["llms_txt"]["result"] == "fail"
    assert by["llms_txt"]["external"] is None                     # no claim either way


def test_when_is_agentic_is_down_the_audit_still_finishes_and_says_why(conn, acfg, tmp_path):
    ctx, audit = run(conn, acfg, tmp_path, IsAgenticClient(transport({"/api/v1/report": (503, "")})))
    assert ctx.data["external_scan"]["status"] == "unavailable" and "503" in ctx.data["external_scan"]["reason"]
    assert audit["score"] is not None and audit["external"]["status"] == "unavailable"
    assert audit["external"]["error"] and audit["external"]["agreement"] is None
    assert all(c["external"] is None for c in audit["checks"])


def test_without_a_client_there_is_no_step_and_no_external_block(conn, acfg, tmp_path):
    ctx, audit = run(conn, acfg, tmp_path, None)
    assert "external_scan" not in ctx.data and audit["external"] is None


def test_the_registry_export_names_the_matching_is_agentic_check(tmp_path, conn, acfg):
    run(conn, acfg, tmp_path, None)
    reg = {c["id"]: c for c in json.loads((tmp_path / "data" / "site.json").read_text())["registry"]["checks"]}
    assert reg["raw_html_content"]["external_id"] == "content-no-js" and reg["robots_txt"]["external_id"] == ""
