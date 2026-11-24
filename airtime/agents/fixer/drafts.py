"""What the Fixer can prepare from the site's own public pages, without asking the owner for what is already there.

Everything here is a draft: facts copied from the owner's pages, each with the page it came from, to be confirmed.
Nothing is published. Pure functions over the Snapshot, so the same pages always give the same draft.

Version 0 reads Australian phone numbers and addresses (state + postcode); other countries give no address draft
and the owner is asked instead.

The TypeScript engine (engine/src/fixer.ts) does the same for the website check, and engine/test/golden.json holds cases
it must reproduce exactly. So the patterns read ASCII only (re.ASCII, ASCII letter checks) and positions are counted
the way JavaScript counts them in text without emoji; keep the two in step when changing either.
"""

from __future__ import annotations

import re
import urllib.parse
from collections import Counter

from airtime.agents.auditor.checks import _org
from airtime.agents.auditor.htmlparse import Page
from airtime.agents.auditor.snapshot import Snapshot

A = re.ASCII
PHONE = re.compile(r"(?<![\d.])(?:\+?61\s?\(?0?\d\)?|\(?0\d\)?)[\s-]?\d{4}[\s-]?\d{4}(?!\d)|(?<![\d.])1[38]00[\s-]?\d{3}[\s-]?\d{3}(?!\d)", A)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}", A)
STATE_POSTCODE = re.compile(r"\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})\b", A)
STREET_START = re.compile(r"\b\d{1,5}[A-Za-z]?(?:[/-]\d{1,5})?\s+[A-Za-z]", A)
STREET_WORD = re.compile(r"\b(St|Street|Rd|Road|Ave|Avenue|Lane|Ln|Dr|Drive|Hwy|Highway|Pde|Parade|Way|Court|Ct|Place|Pl|Blvd|Boulevard|Terrace|Tce|Crescent|Cres)\b\.?", re.I | A)
# Marks of a menu or footer that ran into the sentence, not of a sentence a person wrote.
NOISE = re.compile(r"[\u00b7|\u00a9\[\]\u00bb]|\s/[A-Za-z]|\d:\d|--|skip to content", re.I | A)
UPPER = re.compile(r"[A-Z]", A)
LETTERS = re.compile(r"[A-Za-z]+", A)
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


def find_phones(pages: list[tuple[str, Page]]) -> tuple[list[str], str] | None:
    """Every distinct phone number on the first page that has any (a shop with two stores has two)."""
    for kind, page in pages:
        found = list(dict.fromkeys(_clean(m) for m in PHONE.findall(page.text)))
        if found:
            return found[:3], kind
    return None


def find_email(pages: list[tuple[str, Page]]) -> tuple[str, str] | None:
    for kind, page in pages:                     # the first page that has any wins; the best source comes first
        found = [m.lower() for m in EMAIL.findall(page.text) if not any(b in m.lower() for b in NOT_EMAIL)]
        if found:
            return Counter(found).most_common(1)[0][0], kind
    return None


PLACE_STOP = {"store", "shop", "address", "visit", "us", "contact", "location", "find", "phone", "ph", "tel", "call",
              "our", "the", "open", "at", "email", "stores", "locations", "map"}
PLACE_PREFIX = {"south", "north", "east", "west", "port", "mount", "mt", "glen", "box", "st", "new", "point"}


def _name_word(w: str) -> bool:
    return bool(UPPER.fullmatch(w[:1])) and bool(LETTERS.fullmatch(w.replace("'", "").replace("-", "")))


def _locality(before: str, between: str) -> str:
    """The suburb: written after the street ("123 Smith St Richmond VIC") or just before the number ("Richmond 123 Smith St")."""
    after = between.strip(" ,.")
    words = after.split()
    if 0 < len(words) <= 3 and all(_name_word(w) for w in words):
        return after
    tokens = before.split()
    if tokens:
        last = tokens[-1].strip(",.:")
        if UPPER.fullmatch(last[:1]) and LETTERS.fullmatch(last) and last.lower() not in PLACE_STOP:
            if len(tokens) > 1 and tokens[-2].strip(",.:").lower() in PLACE_PREFIX:
                return f"{tokens[-2].strip(',.:')} {last}"
            return last
    return ""


def find_addresses(pages: list[tuple[str, Page]]) -> tuple[list[dict], str] | None:
    """Every distinct street address (state + postcode) on the first page that has any. Version 0 reads Australian ones.

    A page often repeats its store list (menu, footer, body) with the suburb labels in a different place each time, so
    each reading votes for a suburb; the most repeated suburb wins and a suburb belongs to one address only."""
    for kind, page in pages:
        order: list[tuple[str, str]] = []
        base: dict[tuple[str, str], dict] = {}
        votes: Counter = Counter()
        for m in STATE_POSTCODE.finditer(page.text):
            window = page.text[max(0, m.start() - 90):m.start()]
            for s in reversed([x.start() for x in STREET_START.finditer(window)]):
                chunk = window[s:]
                w = STREET_WORD.search(chunk)
                if not w:
                    continue
                street = _clean(chunk[: w.end()])
                key = (street.lower(), m.group(2))
                if key not in base:
                    base[key] = {"street": street, "locality": "", "region": m.group(1), "postcode": m.group(2)}
                    order.append(key)
                locality = _locality(window[:s], chunk[w.end():])
                if locality:
                    votes[(key, locality)] += 1
                break
        used: set[str] = set()
        for (key, locality), _ in sorted(votes.items(), key=lambda kv: (-kv[1], order.index(kv[0][0]))):
            if not base[key]["locality"] and locality not in used:
                base[key]["locality"] = locality
                used.add(locality)
        found = [base[k] for k in order]
        for a in found:
            a["text"] = _clean(f"{a['street']} {a['locality']} {a['region']} {a['postcode']}")
        if found:
            return found[:3], kind
    return None


def find_description(snap: Snapshot) -> tuple[str, str] | None:
    for meta in snap.home_page.meta:
        key = (meta.get("name") or meta.get("property") or "").lower()
        text = _clean(meta.get("content", ""))
        # a site that builds its meta description from the page text brings the menu and the code samples with it
        if key in ("description", "og:description") and len(text) >= 40 and not NOISE.search(text):
            return text[:300], "home"
    about = snap.trust.get("about")
    if about:
        # Only the text of a real paragraph: in the visible text of a whole page a menu, a heading or a footer runs
        # into the first sentence. A site that writes its text without <p> tags gets a question instead of a draft.
        for paragraph in about[1].paragraphs:
            taken: list[str] = []
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
                s = _clean(sentence)
                if 60 <= len(s) <= 300 and not NOISE.search(s):
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
    phones, email, addresses = find_phones(pages), find_email(pages), find_addresses(pages)
    if not (phones or email or addresses):
        return None
    org: dict = {"@context": "https://schema.org", "@type": "Organization", "name": name, "url": snap.base}
    existing = _org(snap)
    if existing and isinstance(existing.get("@type"), str):
        org["@type"] = existing["@type"]
    facts, answered = [], set()
    if phones or email:
        points = []
        for number in (phones[0] if phones else [None]):
            point: dict = {"@type": "ContactPoint", "contactType": "customer service"}
            if number:
                point["telephone"] = number
            if email:
                point["email"] = email[0]
            points.append(point)
        org["contactPoint"] = points[0] if len(points) == 1 else points
        for number in (phones[0] if phones else []):
            facts.append(_fact("phone", number, phones[1], "Phone", "Telepon"))
        if email:
            facts.append(_fact("email", email[0], email[1], "Email", "Email"))
        answered.add(0)
    if addresses:
        places = []
        for a in addresses[0]:
            place = {"@type": "PostalAddress", "streetAddress": a["street"], "addressRegion": a["region"],
                     "postalCode": a["postcode"], "addressCountry": "AU"}
            if a["locality"]:
                place["addressLocality"] = a["locality"]
            places.append(place)
            facts.append(_fact("address", a["text"], addresses[1], "Address", "Alamat"))
        org["address"] = places[0] if len(places) == 1 else places
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


def site_name(snap: Snapshot) -> str:
    """What to call a site that has no configured name: its Organization name, its og:site_name, else its host."""
    org = _org(snap)
    name = org.get("name") if org else None
    if isinstance(name, str) and _clean(name):
        return _clean(name)[:80]
    og = _clean(snap.home_page.meta_content("og:site_name"))
    if og:
        return og[:80]
    host = urllib.parse.urlsplit(snap.base).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def draft_for(check_id: str, snap: Snapshot, name: str) -> dict | None:
    fn = DRAFTERS.get(check_id)
    return fn(snap, name) if fn else None
