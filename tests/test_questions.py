from airtime.agents.visibility.questions import (generate_questions, names_area, near_duplicate,
                                                 validate_questions)
from airtime.core.agent import RunFailed
from airtime.providers.fake import FakeProvider

AREAS = ("Prahran", "Brighton")


def test_handworks_seed_questions_are_valid(cfg):
    assert validate_questions(list(cfg.questions), cfg.areas) == []


def test_live_config_core_questions_are_valid():
    from airtime.config import load_store_config
    live = load_store_config("handworks")
    assert validate_questions(list(live.questions), live.areas) == []
    assert live.daily_count == 6 and live.attempts_per_day * len(live.questions) + live.daily_count * live.daily_attempts <= 14


def test_seed_area_flags(cfg):
    flags = [names_area(q, cfg.areas) for q in cfg.questions]
    assert flags == [False, False, True, False, False, False]


def test_empty_list_rejected():
    assert validate_questions([], AREAS) == ["question list is empty"]


def test_empty_question_rejected():
    problems = validate_questions(["Gift shops in Prahran", "  ", "Best notebooks in Melbourne"], AREAS)
    assert any("question 2 is empty" in p for p in problems)


def test_exact_duplicate_rejected():
    qs = ["Gift shops in Prahran", "Best notebooks in Melbourne", "gift shops in prahran?"]
    assert any("duplicates" in p for p in validate_questions(qs, AREAS))


def test_near_duplicate_rejected():
    assert near_duplicate("Best stationery shops in Melbourne", "Best stationery shop in Melbourne")
    assert near_duplicate("Where to buy cards in Melbourne", "Where can I buy cards in Melbourne")
    assert not near_duplicate("Best stationery shops in Melbourne",
                              "Best place to buy journals and notebooks in Melbourne")


def test_must_name_an_area():
    qs = ["Best stationery shops in Melbourne", "Where to buy journals in Melbourne",
          "Online stationery store in Australia"]
    assert any("names a store area" in p for p in validate_questions(qs, AREAS))


def test_area_match_is_whole_word():
    assert names_area("gift shops near brighton beach", AREAS)
    assert not names_area("brightonia gifts", AREAS)


def test_generated_questions_must_not_name_our_store(cfg):
    provider = FakeProvider(complete_responder=lambda p, s: '{"questions": ["Is Handworks good?"]}')
    try:
        generate_questions(cfg, provider, "")
    except RunFailed as exc:
        assert "our own store" in str(exc)
    else:
        raise AssertionError("expected RunFailed")
