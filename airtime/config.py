"""Store configuration, loaded from config/stores/<slug>.toml."""

from __future__ import annotations

import hashlib
import json
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config" / "stores"


@dataclass(frozen=True)
class ProviderConfig:
    name: str = "gemini"
    ask_model: str = "gemini-3.8-flash"
    work_model: str = "gemini-3.5-flash-lite"
    use_search: bool = False
    ask_thinking_level: str = "low"   # "" = model default; low is closest to the app's fast mode
    timeout_seconds: float = 300.0
    min_seconds_between_calls: float = 7.0
    max_ask_calls_per_run: int = 24
    max_work_calls_per_run: int = 60
    max_retries: int = 4
    backoff_base_seconds: float = 30.0


@dataclass(frozen=True)
class Topic:
    """A group of products or needs the store sells. Big catalogues are measured per topic,
    not per product: shoppers ask AI assistants about needs, not SKUs."""
    name: str
    terms: tuple[str, ...]             # words that put a question in this topic (plurals match too)
    weight: float = 1.0                # how much the topic matters to the store; later from GSC/GA


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


@dataclass(frozen=True)
class StoreConfig:
    slug: str
    name: str
    domain: str
    areas: tuple[str, ...]
    categories: tuple[str, ...]
    city: str = ""                     # daily questions must name the city, an area, or the country
    country: str = ""
    aliases: tuple[str, ...] = ()
    competitor_aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)
    question_mode: str = "fixed"  # "fixed" (use `questions`) or "generate" (step 1, AI)
    questions: tuple[str, ...] = ()
    target_question_count: int = 6
    attempts_per_day: int = 3          # tries per core question (the same every day)
    daily_count: int = 0               # new questions the AI writes each day (0 = off)
    daily_attempts: int = 1            # tries per daily question
    novelty_days: int = 14             # daily questions must differ from those of the last N days
    daily_mode: str = "profile"        # "profile" (any need) or "explore" (aim at the weakest topics)
    explore_per_topic: int = 2         # explore mode: new questions per weak topic
    explore_window_days: int = 28      # explore mode: how far back results are read
    topics: tuple[Topic, ...] = ()
    weekdays: tuple[str, ...] = WEEKDAYS  # days the shift runs, in the store's timezone
    timezone: str = "Australia/Melbourne"
    provider: ProviderConfig = field(default_factory=ProviderConfig)

    @property
    def all_aliases(self) -> tuple[str, ...]:
        return (self.name, *self.aliases)

    def question_hash(self) -> str:
        """Hash of every input that should trigger new questions when it changes."""
        payload = {
            "name": self.name, "domain": self.domain, "areas": self.areas,
            "categories": self.categories, "mode": self.question_mode,
            "questions": self.questions, "target": self.target_question_count,
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def parse_store_config(slug: str, data: dict) -> StoreConfig:
    store = data["store"]
    questions = data.get("questions", {})
    run = data.get("run", {})
    provider = ProviderConfig(**data.get("provider", {}))
    topics = tuple(Topic(t["name"], tuple(t["terms"]), float(t.get("weight", 1.0)))
                   for t in data.get("topics", ()))
    weekdays = tuple(d.lower()[:3] for d in run.get("weekdays", WEEKDAYS))
    bad = [d for d in weekdays if d not in WEEKDAYS]
    if bad:
        raise ValueError(f"unknown weekdays in run.weekdays: {bad}")
    return StoreConfig(
        slug=slug,
        name=store["name"],
        domain=store["domain"],
        areas=tuple(store["areas"]),
        categories=tuple(store["categories"]),
        city=store.get("city", ""),
        country=store.get("country", ""),
        aliases=tuple(store.get("aliases", ())),
        competitor_aliases={k: tuple(v) for k, v in data.get("competitor_aliases", {}).items()},
        question_mode=questions.get("mode", "fixed"),
        questions=tuple(questions.get("list", ())),
        target_question_count=questions.get("target_count", 6),
        attempts_per_day=run.get("attempts_per_day", 3),
        daily_count=questions.get("daily_count", 0),
        daily_attempts=run.get("daily_attempts", 1),
        novelty_days=questions.get("novelty_days", 14),
        daily_mode=questions.get("daily_mode", "profile"),
        explore_per_topic=questions.get("explore_per_topic", 2),
        explore_window_days=questions.get("explore_window_days", 28),
        topics=topics,
        weekdays=weekdays,
        timezone=run.get("timezone", "Australia/Melbourne"),
        provider=provider,
    )


def load_store_config(slug: str, config_dir: Path = CONFIG_DIR) -> StoreConfig:
    path = config_dir / f"{slug}.toml"
    with path.open("rb") as fh:
        return parse_store_config(slug, tomllib.load(fh))
