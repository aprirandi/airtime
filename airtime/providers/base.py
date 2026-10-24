"""Provider adapter: every AI sits behind this one interface.

Adding ChatGPT or Claude later means one new subclass of `Provider` plus an API key,
registered in `airtime.providers.make_provider`. Nothing else changes.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Answer:
    text: str
    sources: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=utc_now)
    raw: Any = None
    model: str | None = None
    used_search: bool = False


class ProviderError(Exception):
    """A call failed and should not be retried."""


class RateLimitError(ProviderError):
    """A call was refused for rate/quota reasons or a transient server error; retry later."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class BudgetExceeded(ProviderError):
    """This run already used the configured maximum number of calls for this provider."""


class Provider(ABC):
    """One AI behind one interface.

    `ask` sends a buyer question exactly as a person would type it (no system prompt).
    `complete` is for the agent's own language work and may request JSON output.
    Both count against `max_calls` and respect `min_interval` between calls.
    """

    name: str = "base"
    channel: str = "api"

    def __init__(self, model: str, *, max_calls: int = 100, min_interval: float = 0.0,
                 sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic):
        self.model = model
        self.max_calls = max_calls
        self.min_interval = min_interval
        self.calls_made = 0
        self._sleep = sleep
        self._clock = clock
        self._last_call: float | None = None

    def ask(self, question: str) -> Answer:
        self._before_call()
        return self._ask(question)

    def complete(self, prompt: str, *, json_schema: dict | None = None,
                 system: str | None = None) -> str:
        self._before_call()
        return self._complete(prompt, json_schema=json_schema, system=system)

    @property
    def calls_left(self) -> int:
        return self.max_calls - self.calls_made

    def _before_call(self) -> None:
        if self.calls_made >= self.max_calls:
            raise BudgetExceeded(f"{self.name}/{self.model}: call budget of {self.max_calls} used")
        if self._last_call is not None and self.min_interval > 0:
            wait = self.min_interval - (self._clock() - self._last_call)
            if wait > 0:
                self._sleep(wait)
        self.calls_made += 1
        self._last_call = self._clock()

    @abstractmethod
    def _ask(self, question: str) -> Answer: ...

    @abstractmethod
    def _complete(self, prompt: str, *, json_schema: dict | None, system: str | None) -> str: ...


def call_with_backoff(fn: Callable[[], Any], *, max_retries: int, base_delay: float,
                      sleep: Callable[[float], None] = time.sleep,
                      on_retry: Callable[[RateLimitError, float], None] | None = None) -> Any:
    """Run `fn`, retrying RateLimitError with exponential backoff. Other errors propagate.

    `on_retry(error, delay)` is called before each wait, so callers can record why.
    """
    attempt = 0
    while True:
        try:
            return fn()
        except RateLimitError as exc:
            if attempt >= max_retries:
                raise
            delay = max(exc.retry_after or 0.0, base_delay * (2 ** attempt))
            if on_retry:
                on_retry(exc, delay)
            sleep(delay)
            attempt += 1
