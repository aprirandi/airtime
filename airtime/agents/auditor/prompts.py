"""Fix prompts: text an AI assistant or a developer can follow to fix what the Auditor found.

Built by code from the stored results and the registry, with no AI call, so the same audit always gives
the same prompt. Each prompt names the issue, what the scan found, what to do, how to check the result and
how to undo the change. Only gaps the owner can act on get a prompt: checks a platform controls never do.
"""

from __future__ import annotations

from airtime.agents.auditor.registry import BY_ID, GROUPS, CheckDef

TEXT = {
    "en": {
        "one_head": "Fix one issue on {site}{platform}.",
        "many_head": "Fix {n} issue{s} on {site}{platform}, found by an Airtime scan on {date}. Work in the order listed, most important first.",
        "platform": " ({platform} store)",
        "issue": "Issue",
        "issue_n": "Issue {i} of {n}",
        "found": "What the scan found",
        "todo": "What to do",
        "on_platform": "On {platform}",
        "check": "How to check",
        "expect": "Expect",
        "rules_head": "Rules",
        "rules": [
            "Change only what the issue needs. Keep the existing design, text and behaviour.",
            "Before you change a file or a setting, note its current value so it can be restored.",
            "If you do not have the access you need (for example to the theme), say so and stop. Do not work around it.",
        ],
        "done_one": "When you finish, list exactly what you changed and how to undo each change.",
        "done_many": "When you finish, list exactly what you changed and how to undo each change, and say which issues are done and which are not.",
        "none": "The scan found nothing the owner can fix.",
    },
    "id": {
        "one_head": "Perbaiki satu masalah di {site}{platform}.",
        "many_head": "Perbaiki {n} masalah di {site}{platform}, yang ditemukan scan Airtime pada {date}. Kerjakan berurutan, dari yang terpenting.",
        "platform": " (toko {platform})",
        "issue": "Masalah",
        "issue_n": "Masalah {i} dari {n}",
        "found": "Yang ditemukan scan",
        "todo": "Yang perlu dilakukan",
        "on_platform": "Di {platform}",
        "check": "Cara mengecek",
        "expect": "Hasil yang diharapkan",
        "rules_head": "Aturan",
        "rules": [
            "Ubah hanya yang dibutuhkan masalah itu. Pertahankan desain, teks dan perilaku yang ada.",
            "Sebelum mengubah berkas atau pengaturan, catat nilai aslinya supaya bisa dikembalikan.",
            "Kalau kamu tidak punya akses yang dibutuhkan (misalnya ke tema), katakan dan berhenti. Jangan mencari jalan pintas.",
        ],
        "done_one": "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan.",
        "done_many": "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan, dan sebutkan masalah mana yang selesai dan mana yang belum.",
        "none": "Scan tidak menemukan apa pun yang bisa diperbaiki pemilik.",
    },
}


TIER_ID = {"essential": "esensial", "recommended": "disarankan", "bonus": "bonus"}


def _platform_name(platform: str) -> str:
    return platform.capitalize() if platform else ""


def _issue_block(d: CheckDef, row: dict, site: str, platform: str, lang: str, heading: str) -> list[str]:
    t = TEXT[lang]
    i = 1 if lang == "id" else 0
    hint = d.platform_fix.get(platform)
    group = GROUPS[d.group][i]
    tier = TIER_ID[row["tier"]] if lang == "id" else row["tier"]
    lines = [f"{heading}: {d.name if lang == 'en' else d.name_id} ({tier}, {group})",
             f"{t['found']}: {row['evidence']}",
             f"{t['todo']}: {d.fix if lang == 'en' else d.fix_id}"]
    if hint:
        lines.append(f"{t['on_platform'].format(platform=_platform_name(platform))}: {hint[i]}")
    if d.verify:
        command, expect_en, expect_id = d.verify
        lines += [f"{t['check']}:", f"    {command.replace('{site}', site)}",
                  f"{t['expect']}: {expect_id if lang == 'id' else expect_en}"]
    return lines


def _rules(lang: str) -> list[str]:
    t = TEXT[lang]
    return [f"{t['rules_head']}:"] + [f"- {r}" for r in t["rules"]]


def fix_prompt(check_id: str, row: dict, site: str, platform: str = "", lang: str = "en") -> str:
    """One prompt for one gap. `row` is the stored result (tier, evidence)."""
    t, d = TEXT[lang], BY_ID[check_id]
    head = t["one_head"].format(site=site, platform=t["platform"].format(platform=_platform_name(platform)) if platform else "")
    return "\n".join([head, "", *_issue_block(d, row, site, platform, lang, t["issue"]), "", *_rules(lang), "",
                      t["done_one"]]) + "\n"


def all_prompt(gaps: list[dict], site: str, platform: str = "", lang: str = "en", scanned: str = "") -> str:
    """One prompt for every gap, in the order given (most important first). Each gap is a stored result row."""
    t = TEXT[lang]
    if not gaps:
        return t["none"] + "\n"
    n = len(gaps)
    head = t["many_head"].format(
        n=n, s="" if n == 1 or lang == "id" else "s", site=site, date=scanned,
        platform=t["platform"].format(platform=_platform_name(platform)) if platform else "")
    out = [head, "", *_rules(lang), ""]
    for i, row in enumerate(gaps, 1):
        out += _issue_block(BY_ID[row["check_id"]], row, site, platform, lang, t["issue_n"].format(i=i, n=n))
        out.append("")
    out.append(t["done_many"])
    return "\n".join(out) + "\n"
