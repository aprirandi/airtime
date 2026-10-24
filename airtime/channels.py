"""First check: how do answers differ between two sources (e.g. Gemini API vs Gemini app)?

Compares the latest run of each source, overall and question by question. Pure counting.
"""

from __future__ import annotations

from html import escape

from airtime.agents.visibility.compare import pct, scope_label


def _latest(conn, store_id: int, provider: str, channel: str):
    return conn.execute(
        """SELECT * FROM daily_summary WHERE store_id = ? AND provider = ? AND channel = ?
           ORDER BY date DESC LIMIT 1""", (store_id, provider, channel)).fetchone()


def per_question(conn, run_id: int | None) -> dict[str, dict]:
    """question text -> {asked, counted, ours, stores:set, lengths:list}"""
    out: dict[str, dict] = {}
    if run_id is None:
        return out
    rows = conn.execute(
        """SELECT a.id, a.status, a.text, q.text AS question FROM answers a
           JOIN questions q ON q.id = a.question_id WHERE a.run_id = ?""", (run_id,)).fetchall()
    for r in rows:
        d = out.setdefault(r["question"], {"asked": 0, "counted": 0, "ours": 0, "stores": set(), "lengths": []})
        d["asked"] += 1
        if r["status"] != "ok":
            continue
        d["counted"] += 1
        d["lengths"].append(len(r["text"].split()))
        ms = conn.execute("SELECT store_key, is_ours FROM mentions WHERE answer_id = ?", (r["id"],)).fetchall()
        d["ours"] += any(m["is_ours"] for m in ms)
        d["stores"].update(m["store_key"] for m in ms if not m["is_ours"])
    return out


def jaccard(a: set, b: set) -> float | None:
    return None if not (a or b) else len(a & b) / len(a | b)


def compare_sources(conn, store_id: int, a: tuple[str, str], b: tuple[str, str]) -> dict:
    ra, rb = _latest(conn, store_id, *a), _latest(conn, store_id, *b)
    if ra is None or rb is None:
        missing = [scope_label(*s) for s, r in ((a, ra), (b, rb)) if r is None]
        return {"ok": False, "missing": missing}
    qa, qb = per_question(conn, ra["run_id"]), per_question(conn, rb["run_id"])
    questions = []
    for q in sorted(set(qa) | set(qb)):
        da, db = qa.get(q), qb.get(q)
        overlap = jaccard(da["stores"], db["stores"]) if da and db else None
        questions.append({"question": q, "a": da, "b": db,
                          "shared": sorted(da["stores"] & db["stores"]) if da and db else [],
                          "overlap": overlap})
    return {"ok": True, "a": dict(ra), "b": dict(rb), "a_label": scope_label(*a),
            "b_label": scope_label(*b), "questions": questions,
            "per_answer_b": rb["run_id"] is not None, "per_answer_a": ra["run_id"] is not None}


def _cell(d) -> str:
    if not d:
        return "not asked"
    avg = round(sum(d["lengths"]) / len(d["lengths"])) if d["lengths"] else 0
    return (f"ours in {d['ours']} of {d['counted']} counted ({d['asked']} asked); "
            f"{len(d['stores'])} other stores; about {avg} words")


def render_markdown(result: dict, store_name: str) -> str:
    if not result["ok"]:
        return "Cannot compare: no stored run for " + " and ".join(result["missing"]) + "."
    a, b = result["a"], result["b"]
    lines = [f"# {store_name}: {result['a_label']} vs {result['b_label']}", "",
             f"Latest runs: {a['date']} vs {b['date']}.", "",
             "| | " + result["a_label"] + " | " + result["b_label"] + " |", "|---|---|---|"]
    for label, key_n, key_d in (("Our store named", "our_mentions", "total_answers"),
                                ("Top competitor named", "top_competitor_mentions", "total_answers"),
                                ("Ours, area questions", "area_mentions", "area_answers"),
                                ("Ours, other questions", "no_area_mentions", "no_area_answers"),
                                ("No answer", "no_answer", "asked")):
        lines.append(f"| {label} | {a[key_n]} of {a[key_d]} ({pct(a[key_n], a[key_d])}) | "
                     f"{b[key_n]} of {b[key_d]} ({pct(b[key_n], b[key_d])}) |")
    lines.append(f"| Top competitor | {a['top_competitor'] or 'none'} | {b['top_competitor'] or 'none'} |")
    lines.append(f"| Answers using web search | {a['web_search_answers']} | {b['web_search_answers']} |")
    lines.append("")
    if not (result["per_answer_a"] and result["per_answer_b"]):
        lines.append("Only totals are stored for one side, so the question-by-question comparison "
                     "is not possible yet. Import the pasted answers to enable it.")
        return "\n".join(lines)
    lines += ["## By question", "", "| Question | " + result["a_label"] + " | " + result["b_label"]
              + " | Other stores in both | Overlap |", "|---|---|---|---|---|"]
    for q in result["questions"]:
        ov = "n/a" if q["overlap"] is None else f"{round(100 * q['overlap'])}%"
        lines.append(f"| {q['question']} | {_cell(q['a'])} | {_cell(q['b'])} | "
                     f"{', '.join(q['shared']) or 'none'} | {ov} |")
    lines += ["", "Overlap = share of other stores named by either source that both sources named.",
              "Single runs vary a lot; repeat the comparison over several days before drawing conclusions."]
    return "\n".join(lines)


def render_html(md: str, title: str) -> str:
    """Tiny markdown-table renderer, enough for the comparison page."""
    from airtime.report import _page
    out, in_table = [], False
    for line in md.splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= {"-"} for c in cells):
                continue
            if not in_table:
                out.append("<div class='scroll'><table>")
                in_table = True
                out.append("<tr>" + "".join(f"<th>{escape(c)}</th>" for c in cells) + "</tr>")
            else:
                out.append("<tr>" + "".join(f"<td>{escape(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</table></div>")
            in_table = False
        if line.startswith("## "):
            out.append(f"<h2>{escape(line[3:])}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{escape(line[2:])}</h1>")
        elif line.strip():
            out.append(f"<p>{escape(line)}</p>")
    if in_table:
        out.append("</table></div>")
    return _page(title, "<p><a href='../index.html'>&larr; Airtime</a></p>" + "".join(out))
