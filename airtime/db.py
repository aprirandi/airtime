"""SQLite storage. One file in data/, schema created on connect."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from airtime.config import REPO_ROOT, StoreConfig

DEFAULT_DB_PATH = REPO_ROOT / "data" / "airtime.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    areas TEXT NOT NULL,           -- JSON list
    categories TEXT NOT NULL,      -- JSON list
    question_hash TEXT             -- config hash the active questions were built from
);

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    text TEXT NOT NULL,
    names_area INTEGER NOT NULL,   -- 1 if the question names a store area (decided by code)
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL           -- config | ai | import
);

-- One row per agent run: which steps ran, what each reported.
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    agent TEXT NOT NULL,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,          -- running | ok | failed
    steps TEXT NOT NULL DEFAULT '[]',
    error TEXT
);

CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id),
    question_id INTEGER NOT NULL REFERENCES questions(id),
    provider TEXT NOT NULL,        -- gemini | chatgpt | claude | ...
    channel TEXT NOT NULL,         -- api | app_pasted
    model TEXT,
    attempt INTEGER NOT NULL,
    asked_at TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    sources TEXT NOT NULL DEFAULT '[]',   -- JSON list of URLs the provider cited
    raw TEXT,                      -- full provider response, JSON
    status TEXT NOT NULL,          -- ok | no_answer | needs_review
    error TEXT,                    -- why no_answer / needs_review
    our_tone TEXT,                 -- positive | neutral | negative | none
    extracted_at TEXT              -- set once step 4/5 has processed the answer
);

CREATE TABLE IF NOT EXISTS mentions (
    id INTEGER PRIMARY KEY,
    answer_id INTEGER NOT NULL REFERENCES answers(id),
    store_name TEXT NOT NULL,      -- as written in the answer
    store_key TEXT NOT NULL,       -- canonical key used for counting
    is_ours INTEGER NOT NULL,
    position INTEGER NOT NULL,     -- order of appearance, 1-based
    rank INTEGER,                  -- list rank if the answer is a ranked list
    tone TEXT,                     -- tone toward our store (our row only)
    quote TEXT NOT NULL            -- verified verbatim quote from answers.text
);

CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    run_id INTEGER REFERENCES runs(id),     -- NULL only for the manual baseline
    asked INTEGER NOT NULL,
    no_answer INTEGER NOT NULL,
    needs_review INTEGER NOT NULL,
    our_mentions INTEGER NOT NULL,
    total_answers INTEGER NOT NULL,         -- answers counted (status ok)
    top_competitor TEXT,
    top_competitor_mentions INTEGER NOT NULL,
    area_mentions INTEGER NOT NULL,
    area_answers INTEGER NOT NULL,
    area_rate REAL,                         -- NULL when area_answers = 0
    no_area_mentions INTEGER NOT NULL,
    no_area_answers INTEGER NOT NULL,
    no_area_rate REAL,
    web_search_answers INTEGER NOT NULL DEFAULT 0,
    competitors TEXT NOT NULL DEFAULT '[]', -- JSON [{key, name, mentions, answer_ids}]
    our_answer_ids TEXT NOT NULL DEFAULT '[]',
    text TEXT,
    text_source TEXT,                       -- ai | code_fallback | manual
    note TEXT,
    UNIQUE (store_id, date, provider, channel)
);
"""


def connect(path: Path | str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


# Columns added after the first release. SQLite cannot add them in CREATE TABLE IF NOT EXISTS.
MIGRATIONS = {
    "questions": [("kind", "TEXT NOT NULL DEFAULT 'core'"),   # core (same every day) | daily (new each day)
                  ("for_date", "TEXT")],                       # run date a daily question was written for
    "daily_summary": [("core_mentions", "INTEGER NOT NULL DEFAULT 0"), ("core_answers", "INTEGER NOT NULL DEFAULT 0"),
                      ("daily_mentions", "INTEGER NOT NULL DEFAULT 0"), ("daily_answers", "INTEGER NOT NULL DEFAULT 0")],
}


def _migrate(conn: sqlite3.Connection) -> None:
    for table, cols in MIGRATIONS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in cols:
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    conn.commit()


def upsert_store(conn: sqlite3.Connection, cfg: StoreConfig) -> int:
    conn.execute(
        """INSERT INTO stores (slug, name, domain, areas, categories)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET name=excluded.name, domain=excluded.domain,
               areas=excluded.areas, categories=excluded.categories""",
        (cfg.slug, cfg.name, cfg.domain, json.dumps(cfg.areas), json.dumps(cfg.categories)),
    )
    conn.commit()
    return conn.execute("SELECT id FROM stores WHERE slug = ?", (cfg.slug,)).fetchone()["id"]


def active_questions(conn: sqlite3.Connection, store_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM questions WHERE store_id = ? AND active = 1 ORDER BY id", (store_id,)
    ).fetchall()


def find_or_add_question(conn, store_id: int, text: str, names_area: bool,
                         created_at: str, source: str) -> int:
    """Match an imported question to a stored one by exact text, else add it inactive."""
    row = conn.execute(
        "SELECT id FROM questions WHERE store_id = ? AND text = ? ORDER BY active DESC, id LIMIT 1",
        (store_id, text),
    ).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO questions (store_id, text, names_area, created_at, active, source)"
        " VALUES (?, ?, ?, ?, 0, ?)",
        (store_id, text, int(names_area), created_at, source),
    )
    return cur.lastrowid


def summaries(conn, store_id: int, provider: str | None = None,
              channel: str | None = None) -> list[sqlite3.Row]:
    sql = "SELECT * FROM daily_summary WHERE store_id = ?"
    args: list = [store_id]
    if provider:
        sql += " AND provider = ?"
        args.append(provider)
    if channel:
        sql += " AND channel = ?"
        args.append(channel)
    return conn.execute(sql + " ORDER BY date, provider, channel", args).fetchall()
