import json
import re
from dataclasses import replace

import pytest

from airtime import db
from airtime.config import load_store_config
from airtime.core.agent import RunContext
from airtime.providers.fake import FakeProvider

# The 6 questions of the 14 Oct 2026 manual run; most tests use them with no daily questions.
BASELINE_QUESTIONS = (
    "Best stationery shops in Melbourne",
    "Where can I buy greeting cards and wrapping paper in Melbourne?",
    "Unique gift shops in Prahran or Brighton Melbourne",
    "Best place to buy journals and notebooks in Melbourne",
    "Birthday gift ideas under $30 in Melbourne",
    "Online stationery store in Australia with fast shipping",
)

KNOWN_STORES = ["Handworks", "Milligram", "kikki.K", "Notemaker", "Officeworks"]


@pytest.fixture
def cfg():
    # Pinned to 3 attempts so tests do not depend on the live quota setting in handworks.toml.
    return replace(load_store_config("handworks"), attempts_per_day=3, daily_count=0, questions=BASELINE_QUESTIONS)


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def answer_from_prompt(prompt: str) -> str:
    return prompt.split("<<<\n", 1)[1].rsplit("\n>>>", 1)[0]


def fake_extractor(prompt: str, schema) -> str:
    """Stands in for the AI in step 4: finds known store names and quotes their line."""
    if "<<<" not in prompt:  # not an extraction prompt (e.g. the summary): no template
        return "{}"
    text = answer_from_prompt(prompt)
    stores = []
    for line in text.splitlines():
        for name in KNOWN_STORES:
            if name.lower() in line.lower() and name not in [s["name"] for s in stores]:
                m = re.match(r"\s*(\d+)\.", line)
                stores.append({"name": name, "rank": int(m.group(1)) if m else None,
                               "quote": line.strip()})
    ours = any(s["name"] == "Handworks" for s in stores)
    return json.dumps({"stores": stores, "our_store_tone": "positive" if ours else "none"})


def make_ctx(conn, cfg, date="2026-10-20", ask=None, work=None):
    store_id = db.upsert_store(conn, cfg)
    return RunContext(conn=conn, store=cfg, store_id=store_id, run_date=date,
                      ask_provider=ask, work_provider=work, sleep=lambda s: None)


@pytest.fixture
def fake_work():
    return FakeProvider(complete_responder=fake_extractor, sleep=lambda s: None)
