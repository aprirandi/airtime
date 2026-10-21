"""Deterministic provider for tests and dry runs. Never calls the network."""

from __future__ import annotations

from typing import Callable

from airtime.providers.base import Answer, Provider

Responder = Callable[[str], "str | Answer | Exception"]


class FakeProvider(Provider):
    name = "fake"
    channel = "api"

    def __init__(self, model: str = "fake-1", *, ask_responder: Responder | None = None,
                 complete_responder: Callable[[str, dict | None], str] | None = None, **kwargs):
        super().__init__(model, **kwargs)
        self.ask_responder = ask_responder or (lambda q: f"Some shops for: {q}.")
        self.complete_responder = complete_responder or (lambda p, s: "{}")
        self.prompts: list[str] = []

    def _ask(self, question: str) -> Answer:
        out = self.ask_responder(question)
        if isinstance(out, Exception):
            raise out
        if isinstance(out, Answer):
            return out
        return Answer(text=out, raw={"fake": True, "text": out}, model=self.model)

    def _complete(self, prompt: str, *, json_schema: dict | None, system: str | None) -> str:
        self.prompts.append(prompt)
        return self.complete_responder(prompt, json_schema)
