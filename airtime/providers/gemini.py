"""Gemini via the public REST API (free tier key from Google AI Studio).

Free-tier content may be used by Google: only send public questions and public store
facts through this provider, never customer data.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from airtime.providers.base import Answer, Provider, ProviderError, RateLimitError

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider(Provider):
    name = "gemini"
    channel = "api"

    def __init__(self, model: str, *, api_key: str | None = None, use_search: bool = False,
                 timeout: float = 90.0, **kwargs):
        super().__init__(model, **kwargs)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        if not self.api_key:
            raise ProviderError("GEMINI_API_KEY is not set")
        self.use_search = use_search
        self.timeout = timeout

    def _ask(self, question: str) -> Answer:
        body: dict = {"contents": [{"role": "user", "parts": [{"text": question}]}]}
        if self.use_search:
            body["tools"] = [{"google_search": {}}]
        raw = self._post(body)
        return parse_answer(raw, self.model)

    def _complete(self, prompt: str, *, json_schema: dict | None, system: str | None) -> str:
        body: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0},
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if json_schema:
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseSchema"] = json_schema
        return parse_answer(self._post(body), self.model).text

    def _post(self, body: dict) -> dict:
        req = urllib.request.Request(
            f"{API_ROOT}/{self.model}:generateContent",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            if exc.code in (429, 500, 502, 503, 504):
                retry_after = exc.headers.get("Retry-After")
                raise RateLimitError(f"HTTP {exc.code}: {detail}",
                                     float(retry_after) if retry_after else None) from exc
            raise ProviderError(f"HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise RateLimitError(f"network error: {exc}") from exc


def parse_answer(raw: dict, model: str) -> Answer:
    """Turn a generateContent response into an Answer. Blocked/empty -> empty text."""
    candidates = raw.get("candidates") or []
    text, sources, used_search = "", [], False
    if candidates:
        cand = candidates[0]
        parts = (cand.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
        grounding = cand.get("groundingMetadata") or {}
        used_search = bool(grounding.get("webSearchQueries") or grounding.get("groundingChunks"))
        for chunk in grounding.get("groundingChunks") or []:
            uri = (chunk.get("web") or {}).get("uri")
            if uri and uri not in sources:
                sources.append(uri)
    return Answer(text=text, sources=sources, raw=raw,
                  model=raw.get("modelVersion") or model, used_search=used_search)
