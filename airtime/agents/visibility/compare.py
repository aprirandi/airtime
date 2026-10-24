"""Step 6 (CODE): compare with the previous run. Changes, no-changes and zeros are all reported."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from airtime.agents.visibility.verify import Counts

CHANNEL_LABELS = {"api": "API", "app_pasted": "pasted from app"}
PROVIDER_LABELS = {"gemini": "Gemini", "chatgpt": "ChatGPT", "claude": "Claude",
                   "mixed": "ChatGPT/Gemini/Claude", "fake": "Fake"}


def scope_label(provider: str, channel: str) -> str:
    return f"{PROVIDER_LABELS.get(provider, provider)} ({CHANNEL_LABELS.get(channel, channel)})"


def pct(num: int, den: int) -> str:
    return "n/a" if den == 0 else f"{round(100 * num / den)}%"


def save_counts(conn, *, store_id: int, date: str, provider: str, channel: str,
                run_id: int | None, counts: Counts, note: str | None = None) -> None:
    """Upsert the day's counts. A re-run on the same day replaces that day's row."""
    conn.execute(
        """INSERT INTO daily_summary (store_id, date, provider, channel, run_id, asked, no_answer,
               needs_review, our_mentions, total_answers, top_competitor, top_competitor_mentions,
               area_mentions, area_answers, area_rate, no_area_mentions, no_area_answers,
               no_area_rate, web_search_answers, competitors, our_answer_ids, note,
               core_mentions, core_answers, daily_mentions, daily_answers)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (store_id, date, provider, channel) DO UPDATE SET
               run_id=excluded.run_id, asked=excluded.asked, no_answer=excluded.no_answer,
               needs_review=excluded.needs_review, our_mentions=excluded.our_mentions,
               total_answers=excluded.total_answers, top_competitor=excluded.top_competitor,
               top_competitor_mentions=excluded.top_competitor_mentions,
               area_mentions=excluded.area_mentions, area_answers=excluded.area_answers,
               area_rate=excluded.area_rate, no_area_mentions=excluded.no_area_mentions,
               no_area_answers=excluded.no_area_answers, no_area_rate=excluded.no_area_rate,
               web_search_answers=excluded.web_search_answers, competitors=excluded.competitors,
               our_answer_ids=excluded.our_answer_ids, note=excluded.note,
               core_mentions=excluded.core_mentions, core_answers=excluded.core_answers,
               daily_mentions=excluded.daily_mentions, daily_answers=excluded.daily_answers,
               text=NULL, text_source=NULL""",
        (store_id, date, provider, channel, run_id, counts.asked, counts.no_answer,
         counts.needs_review, counts.our_mentions, counts.total_answers, counts.top_competitor,
         counts.top_competitor_mentions, counts.area_mentions, counts.area_answers,
         counts.area_rate, counts.no_area_mentions, counts.no_area_answers, counts.no_area_rate,
         counts.web_search_answers, json.dumps(counts.competitors),
         json.dumps(counts.our_answer_ids), note, counts.core_mentions, counts.core_answers,
         counts.daily_mentions, counts.daily_answers),
    )
    conn.commit()


def _direction(now_num, now_den, prev_num, prev_den, lang: str = "en") -> str:
    id_ = lang == "id"
    if now_den == 0 or prev_den == 0:
        return ("tidak bisa dibandingkan (tidak ada jawaban terhitung di salah satu hari)" if id_
                else "not comparable (no counted answers on one of the days)")
    a, b = now_num / now_den, prev_num / prev_den
    if a == b:
        return "tidak berubah" if id_ else "no change"
    points = round(100 * (a - b))
    if id_:
        return f"naik {points} poin" if a > b else f"turun {-points} poin"
    return f"higher by {points} points" if a > b else f"lower by {-points} points"


def compare_days(today: dict, previous: dict | None, store_name: str, lang: str = "en") -> list[str]:
    """Plain-language lines comparing two daily_summary rows of the same provider and channel.

    lang is "en" (stored in the run log) or "id" (Indonesian, for the website).
    """
    t, p, id_ = today, previous, lang == "id"
    if p is None:
        if id_:
            return [f"Shift pertama untuk {scope_label(t['provider'], t['channel'])}: belum ada pembanding."]
        return [f"First run for {scope_label(t['provider'], t['channel'])}: nothing earlier to compare with."]

    def d(n1, d1, n2, d2):
        return _direction(t[n1], t[d1], p[n2], p[d2], lang)

    same_top = t["top_competitor"] == p["top_competitor"]
    if id_:
        none = "tidak ada"
        return [
            f"Dibandingkan dengan shift sebelumnya ({p['date']}):",
            f"{store_name} disebut di {t['our_mentions']} dari {t['total_answers']} jawaban "
            f"({pct(t['our_mentions'], t['total_answers'])}), sebelumnya {p['our_mentions']} dari "
            f"{p['total_answers']} ({pct(p['our_mentions'], p['total_answers'])}): "
            f"{d('our_mentions', 'total_answers', 'our_mentions', 'total_answers')}.",
            f"Kompetitor teratas {t['top_competitor'] or none} di {t['top_competitor_mentions']} dari "
            f"{t['total_answers']}; sebelumnya {p['top_competitor'] or none} di {p['top_competitor_mentions']} "
            f"dari {p['total_answers']}" + (" (toko yang sama)." if same_top else " (toko berbeda)."),
            f"Pertanyaan yang menyebut area: {t['area_mentions']} dari {t['area_answers']}, sebelumnya "
            f"{p['area_mentions']} dari {p['area_answers']}: {d('area_mentions', 'area_answers', 'area_mentions', 'area_answers')}.",
            f"Pertanyaan lain: {t['no_area_mentions']} dari {t['no_area_answers']}, sebelumnya "
            f"{p['no_area_mentions']} dari {p['no_area_answers']}: "
            f"{d('no_area_mentions', 'no_area_answers', 'no_area_mentions', 'no_area_answers')}.",
            f"Tanpa jawaban: {t['no_answer']} dari {t['asked']} (sebelumnya {p['no_answer']} dari {p['asked']}); "
            f"disisihkan untuk dicek: {t['needs_review']} (sebelumnya {p['needs_review']}).",
        ]
    return [
        f"Compared with the previous run on {p['date']}:",
        f"{store_name} named in {t['our_mentions']} of {t['total_answers']} answers "
        f"({pct(t['our_mentions'], t['total_answers'])}), previously {p['our_mentions']} of "
        f"{p['total_answers']} ({pct(p['our_mentions'], p['total_answers'])}): "
        f"{d('our_mentions', 'total_answers', 'our_mentions', 'total_answers')}.",
        f"Top competitor {t['top_competitor'] or 'none'} in {t['top_competitor_mentions']} of "
        f"{t['total_answers']}; previously {p['top_competitor'] or 'none'} in "
        f"{p['top_competitor_mentions']} of {p['total_answers']}"
        + (" (same store)." if same_top else " (different store)."),
        f"Questions naming an area: {t['area_mentions']} of {t['area_answers']}, previously "
        f"{p['area_mentions']} of {p['area_answers']}: {d('area_mentions', 'area_answers', 'area_mentions', 'area_answers')}.",
        f"Questions not naming an area: {t['no_area_mentions']} of {t['no_area_answers']}, previously "
        f"{p['no_area_mentions']} of {p['no_area_answers']}: "
        f"{d('no_area_mentions', 'no_area_answers', 'no_area_mentions', 'no_area_answers')}.",
        f"No answer: {t['no_answer']} of {t['asked']} asked (previously {p['no_answer']} of {p['asked']}); "
        f"set aside for review: {t['needs_review']} (previously {p['needs_review']}).",
    ]


def mention_range(rows: list[dict], days: int = 7) -> dict | None:
    """Range of our mention rate over the last `days` runs: report ranges, not single-day verdicts."""
    rows = [r for r in rows if r["total_answers"] > 0][-days:]
    if not rows:
        return None
    rates = [r["our_mentions"] / r["total_answers"] for r in rows]
    return {"runs": len(rows), "from": rows[0]["date"], "to": rows[-1]["date"],
            "min_pct": round(100 * min(rates)), "max_pct": round(100 * max(rates))}


def step_compare(ctx) -> dict:
    row = ctx.conn.execute(
        "SELECT * FROM daily_summary WHERE run_id = ?", (ctx.run_id,)).fetchone()
    prev = ctx.conn.execute(
        """SELECT * FROM daily_summary WHERE store_id = ? AND provider = ? AND channel = ?
           AND date < ? ORDER BY date DESC LIMIT 1""",
        (ctx.store_id, row["provider"], row["channel"], row["date"])).fetchone()
    lines = compare_days(dict(row), dict(prev) if prev else None, ctx.store.name)
    history = ctx.conn.execute(
        "SELECT * FROM daily_summary WHERE store_id = ? AND provider = ? AND channel = ? ORDER BY date",
        (ctx.store_id, row["provider"], row["channel"])).fetchall()
    rng = mention_range([dict(h) for h in history])
    ctx.data["_previous"] = dict(prev) if prev else None
    return {"lines": lines, "previous_date": prev["date"] if prev else None, "range": rng}
