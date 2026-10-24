import json

from airtime.agents.visibility.summary import (check_summary, fallback_summary, fill_template,
                                               summary_facts, write_summary)
from airtime.providers.fake import FakeProvider

ROW = {"provider": "gemini", "channel": "api", "date": "2026-10-21", "asked": 18, "no_answer": 4,
       "needs_review": 1, "our_mentions": 3, "total_answers": 13, "top_competitor": "Milligram",
       "top_competitor_mentions": 10, "area_mentions": 2, "area_answers": 2,
       "no_area_mentions": 1, "no_area_answers": 11}
PREV = dict(ROW, date="2026-10-20", our_mentions=2, total_answers=14)


def facts():
    return summary_facts(ROW, PREV, "Handworks", ("Prahran", "Brighton"))


def test_fallback_passes_checks():
    f = facts()
    text = fallback_summary(f)
    assert check_summary(text, f) == []
    assert "3 of 13" in text and "Milligram" in text


def test_fallback_passes_when_everything_is_zero():
    row = {k: (0 if isinstance(v, int) else v) for k, v in ROW.items()}
    row["top_competitor"] = None
    f = summary_facts(row, None, "Handworks", ("Prahran", "Brighton"))
    assert check_summary(fallback_summary(f), f) == []


def test_wrong_number_rejected():
    text = "Handworks was named in 7 of 13 answers. Milligram was named in 10."
    assert any("not in the stored counts" in p for p in check_summary(text, facts()))


def test_real_number_in_wrong_place_rejected():
    # 4 is a stored count (no_answer) but "4 of 13" is not a stored figure.
    text = "Handworks was named in 4 of 13 answers. Milligram was named in 10 of 13."
    assert any("do not match a stored count" in p for p in check_summary(text, facts()))


def test_wrong_percentage_rejected():
    text = "Handworks was named in 3 of 13 answers (30%). Milligram was named in 10 of 13."
    assert any("percentages" in p for p in check_summary(text, facts()))
    assert check_summary(text.replace("30%", "23%"), facts()) == []


def test_matching_numbers_accepted():
    text = "Handworks was named in 3 of 13 answers today. Milligram appeared in 10 of 13."
    assert check_summary(text, facts()) == []


def test_number_words_rejected():
    text = "Handworks was named in three answers. Milligram was named often."
    assert any("spelled-out" in p for p in check_summary(text, facts()))


def test_causes_promises_and_prices_rejected():
    for bad in ("Handworks was named in 3 of 13 because of its website. Fine.",
                "Handworks was named in 3 of 13. This will improve soon.",
                "Handworks was named in 3 of 13. Gifts under $30 were popular."):
        assert check_summary(bad, facts()), bad


def test_sentence_count():
    assert any("2 to 3 sentences" in p for p in check_summary("Handworks was named in 3 of 13.", facts()))


def test_template_may_not_contain_digits_or_unknown_fields():
    assert fill_template("Named in 3 of {total_answers}.", facts())[0] is None
    assert fill_template("Named in {made_up}.", facts())[0] is None
    text, problems = fill_template("{store} named in {our_mentions} of {total_answers}.", facts())
    assert problems == [] and text == "Handworks named in 3 of 13."


def test_write_summary_uses_valid_ai_template():
    template = ("{store} was named in {our_mentions} of {total_answers} {scope} answers, "
                "{our_change} than on {prev_date}. {top_competitor} was named in "
                "{top_competitor_mentions} of {total_answers}.")
    ai = FakeProvider(complete_responder=lambda p, s: json.dumps({"template": template}))
    text, source, rejected = write_summary(ai, facts())
    assert source == "ai" and rejected == []
    assert text.startswith("Handworks was named in 3 of 13 Gemini (API) answers, higher than on 2026-10-20.")


def test_write_summary_falls_back_after_two_rejections():
    ai = FakeProvider(complete_responder=lambda p, s: json.dumps(
        {"template": "{store} will grow because of {our_mentions} mentions. Great."}))
    text, source, rejected = write_summary(ai, facts())
    assert source == "code_fallback" and len(ai.prompts) == 2 and rejected
    assert text == fallback_summary(facts())
