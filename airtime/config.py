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
class StoreConfig:
    slug: str
    name: str
    domain: str
    areas: tuple[str, ...]
    categories: tuple[str, ...]
    aliases: tuple[str, ...] = ()
    competitor_aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)
    question_mode: str = "fixed"  # "fixed" (use `questions`) or "generate" (step 1, AI)
    questions: tuple[str, ...] = ()
    target_question_count: int = 6
    attempts_per_day: int = 3
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
    return StoreConfig(
        slug=slug,
        name=store["name"],
        domain=store["domain"],
        areas=tuple(store["areas"]),
        categories=tuple(store["categories"]),
        aliases=tuple(store.get("aliases", ())),
        competitor_aliases={k: tuple(v) for k, v in data.get("competitor_aliases", {}).items()},
        question_mode=questions.get("mode", "fixed"),
        questions=tuple(questions.get("list", ())),
        target_question_count=questions.get("target_count", 6),
        attempts_per_day=run.get("attempts_per_day", 3),
        timezone=run.get("timezone", "Australia/Melbourne"),
        provider=provider,
    )


def load_store_config(slug: str, config_dir: Path = CONFIG_DIR) -> StoreConfig:
    path = config_dir / f"{slug}.toml"
    with path.open("rb") as fh:
        return parse_store_config(slug, tomllib.load(fh))
