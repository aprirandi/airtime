"""Fetch public text from a store's home page for step 1. Cached in data/cache/."""

from __future__ import annotations

import re
import urllib.request
from html.parser import HTMLParser

from airtime.config import REPO_ROOT, StoreConfig

CACHE_DIR = REPO_ROOT / "data" / "cache"


class _TextParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def html_to_text(html: str) -> str:
    parser = _TextParser()
    parser.feed(html)
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def fetch_site_text(store: StoreConfig, timeout: float = 20.0) -> str:
    """Return home-page text, or '' if the site cannot be reached (step 1 then uses config only)."""
    cache = CACHE_DIR / f"{store.slug}_site.txt"
    if cache.exists():
        return cache.read_text()
    req = urllib.request.Request(f"https://{store.domain}/", headers={"User-Agent": "airtime/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = html_to_text(resp.read().decode(errors="replace"))
    except Exception:
        return ""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(text)
    return text
