from airtime.agents.visibility.verify import AnswerFacts, count_answers

MILLIGRAM = {"milligram": "Milligram"}


def baseline_facts():
    """Same shape as the Handworks manual run of 14 Oct 2026 (18 asked, 4 empty).

    Q3 names an area: 3 asks, 1 empty, both answers name Handworks.
    Other 5 questions: 15 asks, 3 empty, 12 answers, 1 names Handworks.
    Milligram named in 10 of the 14 answers.
    """
    facts, i = [], 0

    def add(status, area, ours=False, milligram=False):
        nonlocal i
        i += 1
        facts.append(AnswerFacts(id=i, status=status, names_area=area, ours=ours,
                                 competitors=dict(MILLIGRAM) if milligram else {}))

    add("ok", True, ours=True, milligram=True)
    add("ok", True, ours=True, milligram=False)
    add("no_answer", True)
    add("ok", False, ours=True, milligram=True)
    for n in range(11):
        add("ok", False, milligram=n < 8)
    for _ in range(3):
        add("no_answer", False)
    return facts


def test_baseline_counts():
    c = count_answers(baseline_facts())
    assert (c.asked, c.no_answer, c.total_answers) == (18, 4, 14)
    assert c.our_mentions == 3
    assert (c.top_competitor, c.top_competitor_mentions) == ("Milligram", 10)
    assert (c.area_mentions, c.area_answers) == (2, 2)
    assert (c.no_area_mentions, c.no_area_answers) == (1, 12)
    assert c.area_rate == 1.0 and abs(c.no_area_rate - 1 / 12) < 1e-9


def test_needs_review_is_excluded_from_counts():
    facts = baseline_facts() + [AnswerFacts(id=99, status="needs_review", names_area=False, ours=True)]
    c = count_answers(facts)
    assert c.needs_review == 1 and c.our_mentions == 3 and c.total_answers == 14 and c.asked == 19


def test_zeros_are_kept():
    c = count_answers([AnswerFacts(id=1, status="no_answer", names_area=True)])
    assert c.total_answers == 0 and c.our_mentions == 0 and c.top_competitor is None
    assert c.area_rate is None and c.no_area_rate is None


def test_competitor_counted_once_per_answer_and_ties_listed():
    facts = [AnswerFacts(1, "ok", False, competitors={"a": "A", "b": "B"}),
             AnswerFacts(2, "ok", False, competitors={"b": "B", "a": "A shop"})]
    c = count_answers(facts)
    assert c.top_competitor_mentions == 2 and c.tied_top == ["A", "B"]
    assert c.competitors[0]["answer_ids"] == [1, 2]
