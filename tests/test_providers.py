import pytest

from airtime.providers.base import BudgetExceeded, RateLimitError, call_with_backoff
from airtime.providers.fake import FakeProvider
from airtime.providers.gemini import parse_answer


def test_parse_answer_text_and_grounding():
    raw = {"modelVersion": "gemini-2.5-flash", "candidates": [{
        "content": {"parts": [{"text": "Try "}, {"text": "Handworks."}]},
        "groundingMetadata": {"webSearchQueries": ["x"],
                              "groundingChunks": [{"web": {"uri": "https://a"}}, {"web": {"uri": "https://a"}}]}}]}
    ans = parse_answer(raw, "m")
    assert ans.text == "Try Handworks." and ans.sources == ["https://a"] and ans.used_search
    assert ans.raw is raw


def test_parse_answer_blocked_is_empty():
    ans = parse_answer({"promptFeedback": {"blockReason": "OTHER"}}, "m")
    assert ans.text == "" and not ans.used_search


def test_budget_is_enforced():
    p = FakeProvider(max_calls=2)
    p.ask("a")
    p.ask("b")
    with pytest.raises(BudgetExceeded):
        p.ask("c")


def test_min_interval_throttles():
    slept, now = [], [0.0]
    p = FakeProvider(min_interval=5, sleep=slept.append, clock=lambda: now[0])
    p.ask("a")
    now[0] = 2.0
    p.ask("b")
    assert slept == [3.0]


def test_backoff_retries_rate_limits_then_gives_up():
    calls, slept = [], []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise RateLimitError("429")
        return "ok"

    assert call_with_backoff(flaky, max_retries=4, base_delay=1, sleep=slept.append) == "ok"
    assert slept == [1, 2]
    with pytest.raises(RateLimitError):
        call_with_backoff(lambda: (_ for _ in ()).throw(RateLimitError("429")),
                          max_retries=1, base_delay=1, sleep=lambda s: None)
