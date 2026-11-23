"""Is Agentic (Vercel, checks by Ora) as a second opinion on the store's website.

Their public API is free, read-only and needs no key: `GET /api/v1/report?url=` returns the latest stored
report, but only the checks that failed or earned partial credit. When no report is stored yet, the official
CLI starts a scan through `/api/scan/stream`; we do the same, once, and read the report again.

What we do with it:
- Our own engine stays the source of the score. Is Agentic counts checks meant for API products (OpenAPI,
  scoped permissions, JSON errors, MCP resources) as essential, so a store scores far lower there. Their
  score is shown as their number, with that note, and is never mixed into ours.
- Their issues are sorted into three kinds: `mapped` (the same check as one of ours), `api_product` (does
  not apply to a store) and `extra` (a check we do not run, such as brand search). The extras are shown, not scored.
- Terms (is-agentic.com/terms, read 23 Nov 2026): reports are public, scores are informational snapshots that
  can change, limits can change, and nothing may imply their endorsement. We make at most three requests per
  audit and link to their report.
- A failure here never fails the audit: the result is stored as `unavailable` with the reason.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable

ORIGIN = "https://is-agentic.com"
USER_AGENT = "airtime-auditor/1"
SCAN_WAIT_SECONDS = 120

# Is Agentic check id -> our check id, for the checks both sides run.
MAPPED = {
    "content-no-js": "raw_html_content",
    "sitemap": "sitemap",
    "agent-friendly-404": "not_found_markdown",
    "markdown-negotiation-vary": "markdown_negotiation",
    "json-ld": "jsonld_organization",
    "org-schema-completeness": "organization_completeness",
    "noindex-directives": "not_noindex",
    "link-headers-discovery": "link_headers",
    "llms-txt-exists": "llms_txt",
    "agent-discovery-file": "agents_md",
}

# Checks that are about running an API product, which our registry files under "not for stores".
API_PRODUCT = frozenset({
    "openapi-spec", "scoped-permissions", "json-error-responses", "mcp-resource-listing", "api-schema-analysis",
    "function-calling-compat", "public-api", "public-api-docs", "onboarding-friction", "mcp-resource-quality",
})


class ExternalError(Exception):
    """The second opinion could not be read. The audit goes on without it."""


Transport = Callable[[str, str, float], tuple[int, str]]   # (url, accept, timeout) -> (status, body)


def http_transport(url: str, accept: str, timeout: float) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT, "Cache-Control": "no-store"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:   # noqa: S310 - fixed https origin
            if accept == "text/event-stream":
                return resp.status, _read_until_done(resp)
            return resp.status, resp.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(200_000).decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ExternalError(f"could not reach is-agentic.com: {exc}") from exc


def _read_until_done(resp) -> str:
    """Read the scan stream until it says it is complete or archived. We only need it to finish."""
    deadline = time.monotonic() + SCAN_WAIT_SECONDS
    seen: list[str] = []
    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("data:"):
            seen.append(line[5:].strip()[:200])
            if '"scan_complete"' in line or '"scan_archived"' in line:
                break
        if time.monotonic() > deadline:
            break
    return "\n".join(seen)


def classify(issue_id: str) -> tuple[str, str]:
    """(kind, our check id or empty)."""
    if issue_id in MAPPED:
        return "mapped", MAPPED[issue_id]
    if issue_id in API_PRODUCT:
        return "api_product", ""
    return "extra", ""


def parse_report(body: dict) -> dict:
    try:
        issues = []
        for i in body["issues"]:
            kind, ours = classify(i["id"])
            issues.append({"id": i["id"], "name": i["name"], "tier": i["tier"], "result": i["result"],
                           "details": i.get("details") or "", "recommendation": i.get("recommendation") or "",
                           "kind": kind, "maps_to": ours})
        return {"report_url": body["report_url"], "score": body["score"], "label": body["score_label"],
                "scanned_at": body["scanned_at"], "eligible_checks": body["eligible_checks"],
                "breakdown": body["score_breakdown"], "issues": issues}
    except (KeyError, TypeError) as exc:
        raise ExternalError(f"the report did not have the expected shape: {exc!r}") from exc


class IsAgenticClient:
    def __init__(self, transport: Transport = http_transport):
        self.transport = transport
        self.requests = 0

    def _report(self, target: str) -> tuple[int, str]:
        self.requests += 1
        return self.transport(f"{ORIGIN}/api/v1/report?{urllib.parse.urlencode({'url': target})}",
                              "application/json", 30)

    def fetch(self, target: str) -> dict:
        """The parsed report for `target`, starting a scan once if none is stored yet."""
        status, body = self._report(target)
        if status == 404:
            self.requests += 1
            self.transport(f"{ORIGIN}/api/scan/stream?{urllib.parse.urlencode({'target': target})}",
                           "text/event-stream", SCAN_WAIT_SECONDS + 10)
            status, body = self._report(target)
        if status == 429:
            raise ExternalError("Is Agentic's request limit was reached; try again later")
        if status != 200:
            raise ExternalError(f"Is Agentic answered HTTP {status}")
        try:
            return parse_report(json.loads(body))
        except json.JSONDecodeError as exc:
            raise ExternalError("Is Agentic did not return JSON") from exc
