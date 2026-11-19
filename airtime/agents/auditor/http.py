"""HTTP fetching for the Auditor. Standard library only.

Every request goes through one callable, `fetch(url, headers=..., user_agent=...) -> Response`, so
tests can swap in a fake site. The real one (`HttpFetcher`) follows redirects by hand so the chain
is recorded, caps the body size, and refuses hosts that resolve to private or local addresses: the
Auditor follows links found on a customer's site, and those must never reach an internal network.
"""

from __future__ import annotations

import ipaddress
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

USER_AGENT = "AirtimeAuditor/1.0 (+https://github.com/aprirandi/airtime)"
MAX_BYTES = 1_500_000   # Is Agentic also skips pages over about 1 MB
MAX_HOPS = 6
REDIRECTS = (301, 302, 303, 307, 308)


@dataclass
class Response:
    url: str                                   # the URL that was asked for
    status: int = 0                            # 0 = no response at all (network error, blocked host)
    final_url: str = ""
    headers: dict[str, str] = field(default_factory=dict)  # lowercase names; repeats joined by ", "
    body: bytes = b""
    chain: list[tuple[int, str]] = field(default_factory=list)  # redirects followed: (status, from_url)
    error: str | None = None
    truncated: bool = False

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def header(self, name: str) -> str:
        return self.headers.get(name.lower(), "")

    @property
    def content_type(self) -> str:
        return self.header("content-type").split(";")[0].strip().lower()

    def summary(self) -> dict:
        """Small, JSON-safe description kept as evidence. The body itself is not stored."""
        return {"url": self.url, "status": self.status, "final_url": self.final_url or self.url,
                "content_type": self.content_type, "bytes": len(self.body),
                "hops": len(self.chain), "error": self.error}


Fetcher = Callable[..., Response]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # raise HTTPError for 3xx so we can record it
        return None


def host_is_public(host: str) -> bool:
    """False when the host is, or resolves to, a private, loopback, link-local or reserved address."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True  # cannot resolve: the request itself will fail with a clear error
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            return False
    return True


class HttpFetcher:
    def __init__(self, timeout: float = 15.0, delay: float = 0.15, allow_private: bool = False,
                 sleep: Callable[[float], None] = time.sleep):
        self.timeout = timeout
        self.delay = delay
        self.allow_private = allow_private
        self.sleep = sleep
        self.opener = urllib.request.build_opener(_NoRedirect)

    def __call__(self, url: str, *, headers: dict[str, str] | None = None,
                 user_agent: str | None = None) -> Response:
        chain: list[tuple[int, str]] = []
        current = url
        for _ in range(MAX_HOPS + 1):
            parts = urllib.parse.urlsplit(current)
            if parts.scheme not in ("http", "https") or not parts.hostname:
                return Response(url, final_url=current, chain=chain, error=f"unsupported URL: {current[:80]}")
            if not self.allow_private and not host_is_public(parts.hostname):
                return Response(url, final_url=current, chain=chain,
                                error=f"refused: {parts.hostname} is not a public address")
            if self.delay:
                self.sleep(self.delay)
            request = urllib.request.Request(
                current, headers={"User-Agent": user_agent or USER_AGENT, "Accept": "*/*", **(headers or {})})
            try:
                with self.opener.open(request, timeout=self.timeout) as resp:
                    status, raw_headers, body = resp.status, resp.headers, resp.read(MAX_BYTES + 1)
            except urllib.error.HTTPError as exc:
                status, raw_headers = exc.code, exc.headers
                try:
                    body = exc.read(MAX_BYTES + 1)
                except OSError:
                    body = b""
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                return Response(url, final_url=current, chain=chain, error=f"{type(exc).__name__}: {exc}"[:200])
            headers_out: dict[str, str] = {}
            for name, value in raw_headers.items():
                key = name.lower()
                headers_out[key] = f"{headers_out[key]}, {value}" if key in headers_out else value
            location = headers_out.get("location")
            if status in REDIRECTS and location:
                chain.append((status, current))
                current = urllib.parse.urljoin(current, location)
                continue
            truncated = len(body) > MAX_BYTES
            return Response(url, status=status, final_url=current, headers=headers_out,
                            body=body[:MAX_BYTES], chain=chain, truncated=truncated)
        return Response(url, final_url=current, chain=chain, error="too many redirects")
