"""What the Fixer can prepare from the site's own public pages, without asking the owner for what is already there.

Everything here is a draft: facts copied from the owner's pages, each with the page it came from, to be confirmed.
Nothing is published. Pure functions over the Snapshot, so the same pages always give the same draft.

Version 0 reads Australian phone numbers and addresses (state + postcode); other countries give no address draft
and the owner is asked instead.
"""

from __future__ import annotations

import re
from collections import Counter

from airtime.agents.auditor.checks import _org
from airtime.agents.auditor.htmlparse import Page
from airtime.agents.auditor.snapshot import Snapshot

PHONE = re.compile(r"(?<![\d.])(?:\+?61\s?\(?0?\d\)?|\(?0\d\)?)[\s-]?\d{4}[\s-]?\d{4}(?!\d)|(?<![\d.])1[38]00[\s-]?\d{3}[\s-]?\d{3}(?!\d)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
STATE_POSTCODE = re.compile(r"\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})\b")
STREET_START = re.compile(r"\b\d{1,5}[A-Za-z]?(?:[/-]\d{1,5})?\s+[A-Za-z]")
STREET_WORD = re.compile(r"\b(St|Street|Rd|Road|Ave|Avenue|Lane|Ln|Dr|Drive|Hwy|Highway|Pde|Parade|Way|Court|Ct|Place|Pl|Blvd|Boulevard|Terrace|Tce|Crescent|Cres)\b\.?", re.I)
NOT_EMAIL = ("sentry", "example.", "@2x", ".png", ".jpg", ".webp", "wixpress", "shopify.com", "yourdomain")

SOURCE_TEXT = {"contact": ("your Contact page", "halaman Kontak Anda"), "about": ("your About page", "halaman Tentang Anda"),
               "home": ("your homepage", "beranda Anda")}


def _sources(snap: Snapshot) -> list[tuple[str, Page]]:
    """The pages worth reading for contact facts, best source first."""
    out: list[tuple[str, Page]] = []
    for kind in ("contact", "about"):
        t = snap.trust.get(kind)
        if t:
            out.append((kind, t[1]))
    out.append(("home", snap.home_page))
    return out


def _clean(value: str) -> str:
    return " ".join(value.split())


def find_phone(pages: list[tuple[str, Page]]) -> tuple[str, str] | None:
    return _most_common(pages, lambda text: [_clean(m) for m in PHONE.findall(text)])


def find_email(pages: list[tuple[str, Page]]) -> tuple[str, str] | None:
    return _most_common(pages, lambda text: [m.lower() for m in EMAIL.findall(text) if not any(b in m.lower() for b in NOT_EMAIL)])


def _most_common(pages, finder) -> tuple[str, str] | None:
    for kind, page in pages:                     # the first page that has any wins; the best source comes first
        found = finder(page.text)
        if found:
            return Counter(found).most_common(1)[0][0], kind
    return None


def find_address(pages: list[tuple[str, Page]]) -> tuple[dict, str] | None:
    for kind, page in pages:
        for m in STATE_POSTCODE.finditer(page.text):
            window = page.text[max(0, m.start() - 90):m.end()]
            starts = [s.start() for s in STREET_START.finditer(window)]
            # the street number closest to the postcode that is followed by a street word
            for s in reversed(starts):
                chunk = window[s:]
                if STREET_WORD.search(chunk[: len(chunk) - len(m.group(0))]):
                    street_and_suburb = _clean(chunk[: len(chunk) - len(m.group(0))]).rstrip(" ,")
                    return {"text": _clean(chunk), "street_and_suburb": street_and_suburb,
                            "region": m.group(1), "postcode": m.group(2)}, kind
    return None


def find_description(snap: Snapshot) -> tuple[str, str] | None:
    for meta in snap.home_page.meta:
        key = (meta.get("name") or meta.get("property") or "").lower()
        if key in ("description", "og:description") and len(_clean(meta.get("content", ""))) >= 40:
            return _clean(meta["content"])[:300], "home"
    about = snap.trust.get("about")
    if about:
        taken: list[str] = []
        body = about[1].text
        for _, heading in about[1].headings:     # headings run into the first sentence in the visible text
            if heading:
                body = body.replace(heading, " ", 1)
        for sentence in re.split(r"(?<=[.!?])\s+", body):
            s = _clean(sentence)
            if len(s) >= 60 and "|" not in s and "©" not in s:
                taken.append(s)
            if len(" ".join(taken)) >= 120 or len(taken) == 2:
                break
        if taken:
            return " ".join(taken)[:300], "about"
    return None


def _fact(kind: str, value: str, source: str, en: str, idn: str) -> dict:
    return {"kind": kind, "value": value, "source": source, "label": en, "label_id": idn}


def draft_organization_completeness(snap: Snapshot, name: str) -> dict | None:
    """Contact point and address for the Organization entity. Lacking a fact leaves it out and keeps the question."""
    pages = _sources(snap)
    phone, email, address = find_phone(pages), find_email(pages), find_address(pages)
    if not (phone or email or address):
        return None
    org: dict = {"@context": "https://schema.org", "@type": "Organization", "name": name, "url": snap.base}
    existing = _org(snap)
    if existing and isinstance(existing.get("@type"), str):
        org["@type"] = existing["@type"]
    facts, answered = [], set()
    if phone or email:
        point: dict = {"@type": "ContactPoint", "contactType": "customer service"}
        if phone:
            point["telephone"] = phone[0]
            facts.append(_fact("phone", phone[0], phone[1], "Phone", "Telepon"))
        if email:
            point["email"] = email[0]
            facts.append(_fact("email", email[0], email[1], "Email", "Email"))
        org["contactPoint"] = point
        answered.add(0)
    if address:
        a, source = address
        org["address"] = {"@type": "PostalAddress", "streetAddress": a["street_and_suburb"],
                          "addressRegion": a["region"], "postalCode": a["postcode"], "addressCountry": "AU"}
        facts.append(_fact("address", a["text"], source, "Address", "Alamat"))
        answered.add(1)
    return {"jsonld": org, "confirm": facts, "answered": sorted(answered)}


def draft_jsonld_organization(snap: Snapshot, name: str) -> dict | None:
    """An Organization entity whose description is the owner's own words from their pages."""
    found = find_description(snap)
    if not found:
        return None
    text, source = found
    org = {"@context": "https://schema.org", "@type": "Organization", "name": name, "url": snap.base, "description": text}
    return {"jsonld": org, "confirm": [_fact("description", text, source, "Description", "Deskripsi")], "answered": [0]}


DRAFTERS = {"organization_completeness": draft_organization_completeness, "jsonld_organization": draft_jsonld_organization}


def draft_for(check_id: str, snap: Snapshot, name: str) -> dict | None:
    fn = DRAFTERS.get(check_id)
    return fn(snap, name) if fn else None
