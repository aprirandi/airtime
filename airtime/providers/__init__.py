"""Provider registry. Register new providers here."""

from __future__ import annotations

from airtime.config import ProviderConfig
from airtime.providers.base import (Answer, BudgetExceeded, Provider, ProviderError,
                                    RateLimitError, call_with_backoff)


def make_provider(cfg: ProviderConfig, role: str, name: str | None = None) -> Provider:
    """Build the provider for a role: 'ask' (buyer questions) or 'work' (agent's own AI steps)."""
    name = name or cfg.name
    model = cfg.ask_model if role == "ask" else cfg.work_model
    max_calls = cfg.max_ask_calls_per_run if role == "ask" else cfg.max_work_calls_per_run
    common = {"max_calls": max_calls, "min_interval": cfg.min_seconds_between_calls}
    if name == "gemini":
        from airtime.providers.gemini import GeminiProvider
        return GeminiProvider(model, use_search=cfg.use_search and role == "ask",
                              thinking_level=cfg.ask_thinking_level if role == "ask" else "",
                              timeout=cfg.timeout_seconds, **common)
    raise ProviderError(f"unknown provider {name!r}")


__all__ = ["Answer", "BudgetExceeded", "Provider", "ProviderError", "RateLimitError",
           "call_with_backoff", "make_provider"]
