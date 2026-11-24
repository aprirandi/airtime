"""Read what the Auditor needs from raw HTML (no JavaScript is run, as an AI agent would see it)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

SKIP_TAGS = {"script", "style", "noscript", "template"}
_SPACE = re.compile(r"\s+")


def collapse(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


@dataclass
class Page:
    lang: str = ""
    headings: list[tuple[int, str]] = field(default_factory=list)   # (level, text) in document order
    meta: list[dict[str, str]] = field(default_factory=list)        # attributes of every <meta>
    link_tags: list[dict[str, str]] = field(default_factory=list)   # attributes of every <link>
    anchors: list[tuple[str, str]] = field(default_factory=list)    # (href, text)
    paragraphs: list[str] = field(default_factory=list)             # text of each closed <p>, so menus never run into it
    jsonld_raw: list[str] = field(default_factory=list)
    text: str = ""                                                   # visible text, whitespace collapsed
    html_bytes: int = 0
    has_password_input: bool = False
    script_redirect: bool = False                                    # location.href=... / location.replace(...)

    def meta_content(self, *names: str) -> str:
        wanted = {n.lower() for n in names}
        for attrs in self.meta:
            key = (attrs.get("name") or attrs.get("property") or attrs.get("http-equiv") or "").lower()
            if key in wanted:
                return attrs.get("content", "")
        return ""

    def link_href(self, rel: str) -> str:
        for attrs in self.link_tags:
            if rel in attrs.get("rel", "").lower().split():
                return attrs.get("href", "")
        return ""

    @property
    def content_ratio(self) -> float:
        return len(self.text) / self.html_bytes if self.html_bytes else 0.0


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.page = Page()
        self._parts: list[str] = []
        self._skip = 0
        self._jsonld = False
        self._script_buf: list[str] = []
        self._script_is_ld = False
        self._heading: int | None = None
        self._heading_buf: list[str] = []
        self._href: str | None = None
        self._anchor_buf: list[str] = []
        self._para: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "html":
            self.page.lang = a.get("lang", "")
        elif tag == "meta":
            self.page.meta.append(a)
        elif tag == "link":
            self.page.link_tags.append(a)
        elif tag == "input" and a.get("type", "").lower() == "password":
            self.page.has_password_input = True
        elif tag == "a" and "href" in a:
            self._href, self._anchor_buf = a["href"], []
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._heading, self._heading_buf = int(tag[1]), []
        if tag == "p":
            self._close_paragraph()
            self._para = []
        if tag in SKIP_TAGS:
            self._skip += 1
            if tag == "script":
                self._script_is_ld = "ld+json" in a.get("type", "").lower()
                self._script_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP_TAGS and self._skip:
            self._skip -= 1
            if tag == "script":
                body = "".join(self._script_buf)
                if self._script_is_ld:
                    self.page.jsonld_raw.append(body)
                elif re.search(r"(location\s*\.\s*(href|replace|assign)\s*[=(]|window\.location\s*=)", body):
                    self.page.script_redirect = True
                self._script_is_ld = False
        elif tag == "a" and self._href is not None:
            self.page.anchors.append((self._href, collapse("".join(self._anchor_buf))))
            self._href = None
        elif self._heading and tag == f"h{self._heading}":
            self.page.headings.append((self._heading, collapse("".join(self._heading_buf))))
            self._heading = None
        elif tag == "p":
            self._close_paragraph()

    def _close_paragraph(self) -> None:
        if self._para is not None:
            text = collapse("".join(self._para))
            if text:
                self.page.paragraphs.append(text)
        self._para = None

    def handle_data(self, data: str) -> None:
        if self._skip:
            self._script_buf.append(data)
            return
        self._parts.append(data)
        if self._heading:
            self._heading_buf.append(data)
        if self._href is not None:
            self._anchor_buf.append(data)
        if self._para is not None:
            self._para.append(data)


def parse_page(html: str) -> Page:
    parser = _Parser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed HTML must not stop an audit; keep what was read
        pass
    page = parser.page
    page.text = collapse(" ".join(parser._parts))
    page.html_bytes = len(html.encode("utf-8", errors="replace"))
    return page


def jsonld_items(page: Page) -> tuple[list[dict], int]:
    """Every JSON-LD object on the page (flattening @graph and lists), and how many blocks were invalid."""
    items: list[dict] = []
    invalid = 0

    def walk(node) -> None:
        if isinstance(node, list):
            for n in node:
                walk(n)
        elif isinstance(node, dict):
            items.append(node)
            walk(node.get("@graph", []))

    for raw in page.jsonld_raw:
        try:
            walk(json.loads(raw))
        except (json.JSONDecodeError, ValueError):
            invalid += 1
    return items, invalid


def types_of(item: dict) -> list[str]:
    t = item.get("@type", [])
    return [t] if isinstance(t, str) else [x for x in t if isinstance(x, str)]
