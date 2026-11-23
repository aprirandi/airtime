"""Fix prompts: one per gap and one for all gaps, built by code from the stored audit."""

import json
from dataclasses import replace

import pytest

from airtime.agents.auditor.agent import audit_flow
from airtime.agents.auditor.prompts import all_prompt, fix_prompt
from airtime.agents.auditor.registry import REGISTRY, VERIFY
from airtime.export import export_site
from auditor_site import HOME, ORIGIN, FakeSite, good_routes, html, text
from conftest import make_ctx

SITE = "https://shop.test"


def gap(check_id, tier="recommended", evidence="what was found"):
    return {"check_id": check_id, "tier": tier, "evidence": evidence}


def test_every_built_check_can_be_verified_by_hand():
    built = [d for d in REGISTRY if d.run]
    assert {d.id for d in built} == set(VERIFY)
    for d in built:
        command, expect_en, expect_id = d.verify
        assert command.startswith("curl") and expect_en and expect_id
        assert "{site}" in command or "<product-page-url>" in command, d.id


def test_a_single_prompt_names_the_issue_the_evidence_the_fix_and_how_to_check():
    p = fix_prompt("content_signals", gap("content_signals", evidence="robots.txt has no Content-Signal directive."),
                   SITE, "shopify")
    assert p.startswith("Fix one issue on https://shop.test (Shopify store).")
    assert "Issue: Content Signals in robots.txt (recommended, Agent discovery)" in p
    assert "What the scan found: robots.txt has no Content-Signal directive." in p
    assert "What to do: Add a Content-Signal line to robots.txt" in p
    assert "On Shopify: Add it through the robots.txt.liquid template." in p
    assert "curl -sS https://shop.test/robots.txt | grep -i content-signal" in p     # {site} filled in
    assert "{site}" not in p
    assert "Expect: A Content-Signal line" in p
    assert "note its current value so it can be restored" in p and "how to undo each change" in p


def test_no_platform_line_when_the_platform_has_no_hint_or_is_unknown():
    p = fix_prompt("content_signals", gap("content_signals"), SITE, "")
    assert "(Shopify store)" not in p and "On Shopify" not in p and p.startswith("Fix one issue on https://shop.test.")
    assert "On Wix" not in fix_prompt("content_signals", gap("content_signals"), SITE, "wix")


def test_the_indonesian_prompt_is_translated_but_keeps_the_commands():
    p = fix_prompt("raw_html_content", gap("raw_html_content", "essential"), SITE, "shopify", "id")
    assert p.startswith("Perbaiki satu masalah di https://shop.test (toko Shopify).")
    assert "Masalah: Konten tersedia tanpa JavaScript (esensial, Akses dan isi)" in p
    assert "Yang perlu dilakukan: Sajikan minimal 500 karakter" in p and "Di Shopify: Ini berasal dari tema" in p
    assert "Aturan:" in p and "cara membatalkan" in p
    assert "curl -sS https://shop.test/ | grep -io" in p and "Hasil yang diharapkan: Judul pertama" in p


def test_the_combined_prompt_lists_the_issues_in_the_order_given():
    gaps = [gap("raw_html_content", "essential"), gap("organization_completeness"), gap("content_signals")]
    p = all_prompt(gaps, SITE, "shopify", scanned="2026-11-22")
    assert p.startswith("Fix 3 issues on https://shop.test (Shopify store), found by an Airtime scan on 2026-11-22.")
    order = [p.index(f"Issue {i} of 3") for i in (1, 2, 3)]
    assert order == sorted(order)
    assert p.index("Content available without JavaScript") < p.index("Organization contact details") < \
        p.index("Content Signals in robots.txt")
    assert p.count("Rules:") == 1 and p.count("How to check:") == 3
    assert "say which issues are done and which are not" in p


def test_one_gap_reads_as_singular_and_no_gaps_say_so():
    assert "Fix 1 issue on" in all_prompt([gap("content_signals")], SITE)
    assert all_prompt([], SITE) == "The scan found nothing the owner can fix.\n"
    assert all_prompt([], SITE, lang="id") == "Scan tidak menemukan apa pun yang bisa diperbaiki pemilik.\n"
    assert "Perbaiki 2 masalah" in all_prompt([gap("content_signals"), gap("sitemap")], SITE, lang="id")


# ---- through the audit and the export -----------------------------------------------------------

@pytest.fixture
def acfg(cfg):
    return replace(cfg, domain="shop.test", audit_url=ORIGIN, platform="shopify")


def test_the_export_gives_each_gap_a_prompt_and_the_site_one_for_all(conn, acfg, tmp_path):
    routes = good_routes()
    routes["/"] = html(HOME)                                  # Markdown and Link header gone: Shopify controls them
    routes["/robots.txt"] = text("User-agent: *\nAllow: /\n")   # no Content-Signal and no Sitemap line
    audit_flow(FakeSite(routes)).run(make_ctx(conn, acfg, "2026-11-22"))
    export_site(conn, tmp_path)
    audit = json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]["audit"]
    by = {c["id"]: c for c in audit["checks"]}
    assert audit["gaps"] == ["sitemap", "content_signals"]    # group 1 before group 3, both recommended
    assert "Fix one issue on https://shop.test (Shopify store)." in by["content_signals"]["prompt"]
    assert by["content_signals"]["prompt_id"].startswith("Perbaiki satu masalah")
    # checks that are not gaps get no prompt, and neither do the ones Shopify controls
    assert by["robots_txt"]["prompt"] == "" and by["markdown_negotiation"]["prompt"] == ""
    assert "Markdown" not in audit["prompt_all"] and "Link headers" not in audit["prompt_all"]
    assert "markdown_negotiation" in audit["limited_gaps"] and "markdown_negotiation" not in audit["gaps"]
    assert by["markdown_negotiation"]["scored"] is True      # held back by Shopify, but it still counts in the score
    assert audit["prompt_all"].startswith(f"Fix {len(audit['gaps'])} issue")
    assert audit["prompt_all_id"].startswith("Perbaiki ")


def test_a_clean_audit_has_no_prompts(conn, acfg, tmp_path):
    audit_flow(FakeSite()).run(make_ctx(conn, acfg, "2026-11-22"))
    export_site(conn, tmp_path)
    audit = json.loads((tmp_path / "data" / "site.json").read_text())["stores"][0]["audit"]
    assert audit["gaps"] == [] and audit["prompt_all"] == "The scan found nothing the owner can fix.\n"
    assert all(c["prompt"] == "" for c in audit["checks"])


def test_the_audit_command_can_print_the_prompt(tmp_path, monkeypatch, capsys):
    from airtime import cli
    routes = good_routes()
    routes["/robots.txt"] = text("User-agent: *\nAllow: /\n")
    monkeypatch.setattr("airtime.agents.auditor.http.HttpFetcher",
                        lambda: FakeSite(routes, origin="https://handworks.com.au"))
    monkeypatch.setattr("airtime.export.export_site", lambda conn: None)
    args = ["--db", str(tmp_path / "a.sqlite"), "audit", "--store", "handworks", "--date", "2026-11-22"]
    assert cli.main(args) == 0
    assert "Rules:" not in capsys.readouterr().out                      # no prompt unless asked
    assert cli.main(args + ["--prompt", "--lang", "id"]) == 0
    out = capsys.readouterr().out
    assert "Perbaiki" in out and "Aturan:" in out and "https://handworks.com.au" in out


def test_the_registry_document_is_up_to_date():
    from pathlib import Path
    from airtime.agents.auditor.registry_doc import registry_markdown
    doc = Path(__file__).resolve().parent.parent / "plans" / "check-registry.md"
    assert doc.read_text() == registry_markdown() + "\n" or doc.read_text() == registry_markdown(), \
        "run: python -m airtime.agents.auditor.registry_doc > plans/check-registry.md"


def test_the_export_carries_the_whole_registry_for_the_checks_page(conn, acfg, tmp_path):
    audit_flow(FakeSite()).run(make_ctx(conn, acfg, "2026-11-22"))
    export_site(conn, tmp_path)
    reg = json.loads((tmp_path / "data" / "site.json").read_text())["registry"]
    assert len(reg["checks"]) == len(REGISTRY) and set(reg["groups"]) == {"1", "2", "3", "4"}
    by = {c["id"]: c for c in reg["checks"]}
    assert by["content_signals"]["status"] == "built" and "robots.txt.liquid" in by["content_signals"]["platform_fix"]["shopify"]["en"]
    assert by["content_signals"]["verify"]["command"].startswith("curl")
    assert "shopify" in by["link_headers"]["controlled"] and by["webmcp"]["status"] == "planned"
    assert {c["status"] for c in reg["checks"] if c["group"] == 4} == {"na"}


def test_the_files_the_typescript_engine_is_checked_against_are_up_to_date():
    from airtime.agents.auditor import golden
    registry, golden_json = golden.build()
    assert golden.REGISTRY_FILE.read_text() == registry and golden.GOLDEN_FILE.read_text() == golden_json, \
        "run: python -m airtime.agents.auditor.golden"


def test_the_recorded_visits_the_typescript_engine_replays_are_up_to_date():
    import engine_replay
    assert engine_replay.OUT.read_text() == engine_replay.build(), "run: python tests/engine_replay.py"
