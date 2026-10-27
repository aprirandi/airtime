"""Topics: what the store sells, grouped the way shoppers ask about it.

A store with thousands of products is not asked about product by product. Its catalogue is
grouped into topics (config `[[topics]]`), every question is placed in a topic by code, and the
results are read per topic. In explore mode the Asker aims its new questions at the topics where
the store is named least. Everything here is CODE: no AI, no customer data.
"""

from __future__ import annotations

import re
from collections import Counter

from airtime.config import Topic
from airtime.textutil import store_key


def matches_term(text: str, term: str) -> bool:
    """Whole-word, case-insensitive match that also accepts a plural ("card" matches "cards")."""
    words = [re.escape(w) for w in store_key(term).split()]
    if not words:
        return False
    pattern = r"\b" + r"[\W_]*".join(words) + r"(?:s|es)?\b"
    return re.search(pattern, store_key(text)) is not None


def topics_for(text: str, topics: tuple[Topic, ...]) -> list[str]:
    """Every topic a question belongs to, in config order. A question can be in several."""
    return [t.name for t in topics if any(matches_term(text, term) for term in t.terms)]


def topic_stats(conn, store_id: int, topics: tuple[Topic, ...], *, before: str, days: int,
                provider: str | None = None, channel: str | None = None) -> list[dict]:
    """Results per topic from shift answers in the `days` days before `before` (a run date).

    Counts only answers that passed verification (status ok). A question in two topics counts
    in both. Topics never asked in the window come back with answers = 0.
    """
    sql = """SELECT q.id AS qid, q.text, a.id AS aid,
                    EXISTS (SELECT 1 FROM mentions m WHERE m.answer_id = a.id AND m.is_ours) AS ours
             FROM answers a JOIN questions q ON q.id = a.question_id JOIN runs r ON r.id = a.run_id
             WHERE r.store_id = ? AND a.status = 'ok' AND r.run_date < ? AND r.run_date >= date(?, ?)"""
    args: list = [store_id, before, before, f"-{days} days"]
    if provider:
        sql += " AND a.provider = ?"
        args.append(provider)
    if channel:
        sql += " AND a.channel = ?"
        args.append(channel)
    rows = conn.execute(sql, args).fetchall()
    rivals = conn.execute(
        """SELECT m.answer_id, m.store_key, m.store_name FROM mentions m
           JOIN answers a ON a.id = m.answer_id JOIN runs r ON r.id = a.run_id
           WHERE r.store_id = ? AND NOT m.is_ours AND a.status = 'ok'
             AND r.run_date < ? AND r.run_date >= date(?, ?)""",
        (store_id, before, before, f"-{days} days")).fetchall()
    rivals_by_answer: dict[int, set[str]] = {}
    names: dict[str, str] = {}
    for m in rivals:
        rivals_by_answer.setdefault(m["answer_id"], set()).add(m["store_key"])
        names.setdefault(m["store_key"], m["store_name"])

    out = []
    for topic in topics:
        mine = [r for r in rows if topic.name in topics_for(r["text"], topics)]
        rival_counts = Counter(k for r in mine for k in rivals_by_answer.get(r["aid"], ()))
        top = rival_counts.most_common(1)
        per_q: dict[int, dict] = {}
        for r in mine:
            q = per_q.setdefault(r["qid"], {"text": r["text"], "answers": 0, "ours": 0})
            q["answers"] += 1
            q["ours"] += int(r["ours"])
        answers = len(mine)
        ours = sum(int(r["ours"]) for r in mine)
        out.append({
            "topic": topic.name, "weight": topic.weight,
            "answers": answers, "ours": ours,
            "rate": round(ours / answers, 3) if answers else None,
            "competitor": names[top[0][0]] if top else None,
            "competitor_mentions": top[0][1] if top else 0,
            "questions": list(per_q.values()),
        })
    return out


def pick_weak_topics(stats: list[dict], n: int) -> list[dict]:
    """The `n` topics to explore next: never-asked topics first, then the lowest share of answers
    naming our store; ties go to the topic that matters more, then to the stronger competitor."""
    def key(s):
        asked = s["answers"] > 0
        return (asked, s["rate"] if asked else 0, -s["weight"], -s["competitor_mentions"], s["topic"])
    return sorted(stats, key=key)[:max(n, 0)]


def reason_for(stat: dict, window_days: int) -> dict:
    """Why a topic was chosen, stored with each explore question (the site words it per language)."""
    return {"topic": stat["topic"], "answers": stat["answers"], "ours": stat["ours"],
            "competitor": stat["competitor"], "competitor_mentions": stat["competitor_mentions"],
            "window_days": window_days}
