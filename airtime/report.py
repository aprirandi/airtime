"""Static report pages in docs/ (GitHub Pages ready). Every number links back to stored answers."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

from airtime.agents.visibility.compare import compare_days, mention_range, pct, scope_label
from airtime.config import REPO_ROOT

DOCS_DIR = REPO_ROOT / "docs"

CSS = """
:root { --bg:#fff; --fg:#1d1d1f; --muted:#666; --line:#ddd; --card:#f6f6f7; --ours:#0b6e4f; --warn:#9a5b00; }
@media (prefers-color-scheme: dark) { :root { --bg:#16171a; --fg:#e8e8ea; --muted:#9a9aa0; --line:#33343a; --card:#1f2024; --ours:#5fd3a5; --warn:#e3a54a; } }
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.15rem; margin-top: 2rem; }
.muted { color: var(--muted); } .ours { color: var(--ours); font-weight: 600; } .warn { color: var(--warn); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; } td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
details pre { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
a { color: inherit; }
"""

VARIANCE_NOTE = ("AI answers vary a lot from run to run, even for the same question on the same day. "
                 "Read the ranges over several days, not a single day's number.")


def _page(title: str, body: str) -> str:
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            f"<meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>{escape(title)}</title><style>{CSS}</style></head>"
            f"<body><main>{body}</main></body></html>")


def page_name(row) -> str:
    return f"{row['date']}-{row['provider']}-{row['channel']}.html"


def search_note(row) -> str:
    if row["channel"] != "api":
        return "Answers were pasted by hand from the consumer app; the app may have searched the web."
    if row["web_search_answers"] == 0:
        return ("These API answers were generated without web search (search grounding off). "
                "Consumer apps usually search the web, so their answers can differ.")
    return f"{row['web_search_answers']} of {row['total_answers']} counted answers used web search grounding."


def _counts_table(row) -> str:
    def frac(a, b):
        return f"{a} of {b} ({pct(a, b)})"
    return f"""<div class='scroll'><table>
<tr><th>Asked</th><td class='n'>{row['asked']}</td></tr>
<tr><th>No answer</th><td class='n'>{row['no_answer']}</td></tr>
<tr><th>Set aside for review (not counted)</th><td class='n'>{row['needs_review']}</td></tr>
<tr><th>Counted answers</th><td class='n'>{row['total_answers']}</td></tr>
<tr><th>Our store named</th><td class='n ours'>{frac(row['our_mentions'], row['total_answers'])}</td></tr>
<tr><th>Top competitor: {escape(row['top_competitor'] or 'none')}</th><td class='n'>{frac(row['top_competitor_mentions'], row['total_answers'])}</td></tr>
<tr><th>Our store, questions naming an area</th><td class='n'>{frac(row['area_mentions'], row['area_answers'])}</td></tr>
<tr><th>Our store, other questions</th><td class='n'>{frac(row['no_area_mentions'], row['no_area_answers'])}</td></tr>
</table></div>"""


def daily_page(conn, store, row, previous) -> str:
    label = scope_label(row["provider"], row["channel"])
    parts = [f"<p><a href='index.html'>&larr; {escape(store['name'])}</a></p>",
             f"<h1>{escape(store['name'])}: {escape(row['date'])}</h1>",
             f"<p class='muted'>{escape(label)}. {escape(search_note(row))}</p>"]
    if row["text"]:
        src = {"ai": "written by AI, numbers filled and checked by code",
               "code_fallback": "written by code (AI summary was rejected)",
               "manual": "manual baseline"}.get(row["text_source"], row["text_source"] or "")
        parts.append(f"<div class='card'><p>{escape(row['text'])}</p><p class='muted'>Summary {escape(src)}.</p></div>")
    if row["note"]:
        parts.append(f"<p class='warn'>{escape(row['note'])}</p>")
    parts.append("<h2>Counts</h2>" + _counts_table(row))
    lines = compare_days(dict(row), dict(previous) if previous else None, store["name"])
    parts.append("<h2>Compared with previous run</h2><ul>"
                 + "".join(f"<li>{escape(line)}</li>" for line in lines) + "</ul>")
    competitors = json.loads(row["competitors"] or "[]")
    if competitors:
        rows = "".join(
            f"<tr><td>{escape(c['name'])}</td><td class='n'>{c['mentions']} of {row['total_answers']}</td>"
            f"<td>{' '.join(f'<a href=#a{i}>#{i}</a>' for i in c.get('answer_ids', []))}</td></tr>"
            for c in competitors)
        parts.append("<h2>Stores named</h2><div class='scroll'><table><tr><th>Store</th><th>Answers</th>"
                     f"<th>Answer ids</th></tr>{rows}</table></div>")
    if row["run_id"]:
        parts.append("<h2>Every answer</h2>" + _answers_table(conn, row["run_id"]))
    parts.append(f"<p class='muted'>{escape(VARIANCE_NOTE)}</p>")
    return _page(f"{store['name']} {row['date']}", "".join(parts))


def _answers_table(conn, run_id: int) -> str:
    answers = conn.execute(
        """SELECT a.*, q.text AS question, q.names_area FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.run_id = ? ORDER BY q.id, a.attempt""", (run_id,)).fetchall()
    out = []
    for a in answers:
        ms = conn.execute("SELECT * FROM mentions WHERE answer_id = ? ORDER BY position", (a["id"],)).fetchall()
        named = "".join(_mention_item(m) for m in ms)
        status = escape(a["status"]) + (f"<br><span class='muted'>{escape(a['error'] or '')}</span>"
                                        if a["error"] else "")
        sources = json.loads(a["sources"] or "[]")
        src_html = ("<p>Sources: " + " ".join(f"<a href='{escape(s)}'>{escape(s[:60])}</a>" for s in sources)
                    + "</p>") if sources else ""
        out.append(
            f"<tr id='a{a['id']}'><td class='n'>#{a['id']}</td><td>{escape(a['question'])}"
            f"{' <span class=muted>(names area)</span>' if a['names_area'] else ''}</td>"
            f"<td class='n'>{a['attempt']}</td><td>{status}</td>"
            f"<td><ul>{named or '<li class=muted>no stores</li>'}</ul>"
            f"<details><summary>Full answer</summary><pre>{escape(a['text'] or '(empty)')}</pre>{src_html}</details></td></tr>")
    return ("<div class='scroll'><table><tr><th>Id</th><th>Question</th><th>Try</th><th>Status</th>"
            "<th>Stores named, with verified quotes</th></tr>" + "".join(out) + "</table></div>")


def _mention_item(m) -> str:
    rank = f" (rank {m['rank']})" if m["rank"] else ""
    tone = f" [tone: {escape(m['tone'] or 'none')}]" if m["is_ours"] else ""
    cls = " class='ours'" if m["is_ours"] else ""
    return f"<li{cls}>{escape(m['store_name'])}{rank}{tone}: <q>{escape(m['quote'])}</q></li>"


def store_index(conn, store) -> str:
    rows = conn.execute("SELECT * FROM daily_summary WHERE store_id = ? ORDER BY date DESC, provider, channel",
                        (store["id"],)).fetchall()
    parts = [f"<p><a href='../index.html'>&larr; All stores</a></p><h1>{escape(store['name'])}</h1>",
             f"<p class='muted'>{escape(store['domain'])} &middot; areas: {escape(', '.join(json.loads(store['areas'])))}</p>"]
    scopes = sorted({(r["provider"], r["channel"]) for r in rows})
    for provider, channel in scopes:
        series = [dict(r) for r in reversed(rows) if (r["provider"], r["channel"]) == (provider, channel)]
        latest = series[-1]
        rng = mention_range(series)
        rng_text = (f"Range over the last {rng['runs']} run(s) ({rng['from']} to {rng['to']}): "
                    f"{rng['min_pct']}% to {rng['max_pct']}% of counted answers name {store['name']}."
                    if rng else "No counted answers yet.")
        parts.append(f"<h2>{escape(scope_label(provider, channel))}</h2>"
                     f"<div class='card'><p>{escape(latest['text'] or '')}</p>"
                     f"<p class='muted'>Latest: <a href='{page_name(latest)}'>{escape(latest['date'])}</a>. "
                     f"{escape(rng_text)} {escape(search_note(latest))}</p></div>")
    table = "".join(
        f"<tr><td><a href='{page_name(r)}'>{escape(r['date'])}</a></td><td>{escape(scope_label(r['provider'], r['channel']))}</td>"
        f"<td class='n ours'>{r['our_mentions']} of {r['total_answers']}</td>"
        f"<td>{escape(r['top_competitor'] or 'none')} <span class='n'>{r['top_competitor_mentions']} of {r['total_answers']}</span></td>"
        f"<td class='n'>{r['area_mentions']} of {r['area_answers']}</td><td class='n'>{r['no_area_mentions']} of {r['no_area_answers']}</td>"
        f"<td class='n'>{r['no_answer']} / {r['needs_review']}</td></tr>" for r in rows)
    parts.append("<h2>All runs</h2><div class='scroll'><table><tr><th>Date</th><th>Source</th><th>Our store</th>"
                 "<th>Top competitor</th><th>Area questions</th><th>Other questions</th><th>No answer / review</th></tr>"
                 f"{table}</table></div><p class='muted'>{escape(VARIANCE_NOTE)}</p>")
    return _page(f"{store['name']} visibility", "".join(parts))


def build_site(conn, out_dir: Path = DOCS_DIR) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / ".nojekyll").touch()
    written = []
    stores = conn.execute("SELECT * FROM stores ORDER BY name").fetchall()
    links = []
    for store in stores:
        sdir = out_dir / store["slug"]
        sdir.mkdir(exist_ok=True)
        rows = conn.execute("SELECT * FROM daily_summary WHERE store_id = ? ORDER BY date",
                            (store["id"],)).fetchall()
        for i, row in enumerate(rows):
            prev = next((p for p in reversed(rows[:i])
                         if (p["provider"], p["channel"]) == (row["provider"], row["channel"])), None)
            path = sdir / page_name(row)
            path.write_text(daily_page(conn, store, row, prev))
            written.append(path)
        (sdir / "index.html").write_text(store_index(conn, store))
        written.append(sdir / "index.html")
        links.append(f"<li><a href='{escape(store['slug'])}/index.html'>{escape(store['name'])}</a></li>")
    for extra in sorted(out_dir.glob("comparisons/*.html")):
        links.append(f"<li><a href='comparisons/{escape(extra.name)}'>Comparison: {escape(extra.stem)}</a></li>")
    index = out_dir / "index.html"
    index.write_text(_page("Airtime reports", "<h1>Airtime</h1><p class='muted'>How often AI assistants name "
                           "each store. Counts only; no rankings or sales are implied.</p><ul>"
                           + "".join(links) + "</ul>"))
    written.append(index)
    return written
