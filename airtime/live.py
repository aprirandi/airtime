"""Live progress for the website: docs/data/live.json, rewritten on every agent event.

During a GitHub Actions run a background loop commits this file every few minutes, so the
dashboard shows what the agent is doing while it works. After the run, export_site() writes
the final idle state.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from airtime.providers.base import utc_now

STEP_TITLES_ID = {
    "write_questions": "Menyiapkan pertanyaan pembeli",
    "validate_questions": "Mengecek pertanyaan",
    "ask_questions": "Bertanya ke Gemini",
    "import_answers": "Mengimpor jawaban yang di-paste",
    "extract_mentions": "Membaca jawaban",
    "verify_and_count": "Mengecek kutipan dan menghitung",
    "compare_previous": "Membandingkan dengan shift lalu",
    "write_summary": "Menulis ringkasan",
}

STEP_TITLES = {
    "write_questions": "Writing buyer questions",
    "validate_questions": "Checking the questions",
    "ask_questions": "Asking Gemini",
    "import_answers": "Importing pasted answers",
    "extract_mentions": "Reading the answers",
    "verify_and_count": "Checking quotes and counting",
    "compare_previous": "Comparing with the last shift",
    "write_summary": "Writing the summary",
}


def write_json(path: Path, payload: dict) -> None:
    """Write atomically so the site never reads a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    os.replace(tmp, path)


class LiveWriter:
    def __init__(self, path: Path, *, agent_name: str, store_slug: str, run_date: str):
        self.path = path
        self.state: dict = {
            "status": "running", "agent": agent_name, "store": store_slug, "run_date": run_date,
            "run_id": None, "started_at": utc_now(), "updated_at": utc_now(),
            "steps": [], "current": None, "progress": None, "last_event": "Starting the shift.",
            "last_event_id": "Memulai shift.",
        }

    def __call__(self, event: dict) -> None:
        s = self.state
        kind = event.get("type")
        if kind == "run_start":
            s["run_id"] = event.get("run_id")
            s["steps"] = [{**st, "title": STEP_TITLES.get(st["name"], st["name"]),
                           "title_id": STEP_TITLES_ID.get(st["name"], st["name"]), "status": "todo"}
                          for st in event.get("steps", [])]
        elif kind == "step_start":
            name = event["entry"]["name"]
            self._set_step(name, "working")
            s["current"] = name
            s["progress"] = None
            s["last_event"] = STEP_TITLES.get(name, name) + "."
            s["last_event_id"] = STEP_TITLES_ID.get(name, name) + "."
        elif kind == "step_done":
            entry = event["entry"]
            self._set_step(entry["name"], "done" if entry.get("status") == "ok" else "failed")
            from airtime.export import describe_step  # local import: export imports live helpers
            s["last_event"] = describe_step(entry, s["store"])
            s["last_event_id"] = describe_step(entry, s["store"], "id")
        elif kind == "answer":
            s["progress"] = {"done": event["done"], "total": event["planned"], "unit": "questions asked",
                             "ok": event["ok"], "no_answer": event["no_answer"]}
            ok = event["status"] == "ok"
            s["last_event"] = f"Asked \"{event['question']}\" (try {event['attempt']}): {'answered' if ok else 'no answer'}."
            s["last_event_id"] = (f"Bertanya \"{event['question']}\" (percobaan {event['attempt']}): "
                                  f"{'dijawab' if ok else 'tanpa jawaban'}.")
        elif kind == "extract":
            s["progress"] = {"done": event["done"], "total": event["total"], "unit": "answers read"}
            s["last_event"] = f"Reading the answer to \"{event['question']}\"."
            s["last_event_id"] = f"Membaca jawaban untuk \"{event['question']}\"."
        elif kind == "run_done":
            s["status"] = "idle" if event.get("status") == "ok" else "failed"
            s["current"] = None
            s["progress"] = None
        s["updated_at"] = utc_now()
        write_json(self.path, s)

    def _set_step(self, name: str, status: str) -> None:
        for st in self.state["steps"]:
            if st["name"] == name:
                st["status"] = status
