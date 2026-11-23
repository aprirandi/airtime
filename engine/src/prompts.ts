/**
 * Fix prompts: text an AI assistant or a developer can follow to fix what the Auditor found. Built by code from
 * the stored results and the registry, with no AI call. Same wording as airtime/agents/auditor/prompts.py: the
 * golden tests compare the two character by character.
 */
import { BY_ID, REGISTRY } from "./registry"
import type { Lang, RegistryCheck } from "./types"

const TEXT = {
  en: {
    one_head: "Fix one issue on {site}{platform}.",
    many_head:
      "Fix {n} issue{s} on {site}{platform}, found by an Airtime scan on {date}. Work in the order listed, most important first.",
    platform: " ({platform} store)",
    issue: "Issue",
    issue_n: "Issue {i} of {n}",
    found: "What the scan found",
    todo: "What to do",
    on_platform: "On {platform}",
    check: "How to check",
    expect: "Expect",
    rules_head: "Rules",
    rules: [
      "Change only what the issue needs. Keep the existing design, text and behaviour.",
      "Before you change a file or a setting, note its current value so it can be restored.",
      "If you do not have the access you need (for example to the theme), say so and stop. Do not work around it.",
    ],
    done_one: "When you finish, list exactly what you changed and how to undo each change.",
    done_many:
      "When you finish, list exactly what you changed and how to undo each change, and say which issues are done and which are not.",
    none: "The scan found nothing the owner can fix.",
  },
  id: {
    one_head: "Perbaiki satu masalah di {site}{platform}.",
    many_head: "Perbaiki {n} masalah di {site}{platform}, yang ditemukan scan Airtime pada {date}. Kerjakan berurutan, dari yang terpenting.",
    platform: " (toko {platform})",
    issue: "Masalah",
    issue_n: "Masalah {i} dari {n}",
    found: "Yang ditemukan scan",
    todo: "Yang perlu dilakukan",
    on_platform: "Di {platform}",
    check: "Cara mengecek",
    expect: "Hasil yang diharapkan",
    rules_head: "Aturan",
    rules: [
      "Ubah hanya yang dibutuhkan masalah itu. Pertahankan desain, teks dan perilaku yang ada.",
      "Sebelum mengubah berkas atau pengaturan, catat nilai aslinya supaya bisa dikembalikan.",
      "Kalau kamu tidak punya akses yang dibutuhkan (misalnya ke tema), katakan dan berhenti. Jangan mencari jalan pintas.",
    ],
    done_one: "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan.",
    done_many:
      "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan, dan sebutkan masalah mana yang selesai dan mana yang belum.",
    none: "Scan tidak menemukan apa pun yang bisa diperbaiki pemilik.",
  },
} as const

const TIER_ID: Record<string, string> = { essential: "esensial", recommended: "disarankan", bonus: "bonus" }

/** Python's str.format for the {name} placeholders used above. */
const fmt = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]))

const platformName = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "")
const platformLabel = (p: string, lang: Lang) => (p ? fmt(TEXT[lang].platform, { platform: platformName(p) }) : "")

export interface GapRow {
  check_id: string
  tier: string
  evidence: string
}

function issueBlock(d: RegistryCheck, row: GapRow, site: string, platform: string, lang: Lang, heading: string): string[] {
  const t = TEXT[lang]
  const en = lang === "en"
  const hint = d.platform_fix[platform]
  const group = REGISTRY.groups[String(d.group)]?.[lang] ?? ""
  const tier = en ? row.tier : (TIER_ID[row.tier] ?? row.tier)
  const lines = [
    `${heading}: ${en ? d.name : d.name_id} (${tier}, ${group})`,
    `${t.found}: ${row.evidence}`,
    `${t.todo}: ${en ? d.fix : d.fix_id}`,
  ]
  if (hint) lines.push(`${fmt(t.on_platform, { platform: platformName(platform) })}: ${hint[lang]}`)
  if (d.verify) {
    lines.push(`${t.check}:`, `    ${d.verify.command.split("{site}").join(site)}`, `${t.expect}: ${en ? d.verify.en : d.verify.id}`)
  }
  return lines
}

const rules = (lang: Lang) => [`${TEXT[lang].rules_head}:`, ...TEXT[lang].rules.map((r) => `- ${r}`)]

/** One prompt for one gap. `row` is the stored result (tier, evidence). */
export function fixPrompt(checkId: string, row: GapRow, site: string, platform = "", lang: Lang = "en"): string {
  const t = TEXT[lang]
  const d = BY_ID[checkId] as RegistryCheck
  const head = fmt(t.one_head, { site, platform: platformLabel(platform, lang) })
  return [head, "", ...issueBlock(d, row, site, platform, lang, t.issue), "", ...rules(lang), "", t.done_one].join("\n") + "\n"
}

/** One prompt for every gap, in the order given (most important first). */
export function allPrompt(gaps: GapRow[], site: string, platform = "", lang: Lang = "en", scanned = ""): string {
  const t = TEXT[lang]
  if (!gaps.length) return t.none + "\n"
  const n = gaps.length
  const head = fmt(t.many_head, {
    n,
    s: n === 1 || lang === "id" ? "" : "s",
    site,
    date: scanned,
    platform: platformLabel(platform, lang),
  })
  const out: string[] = [head, "", ...rules(lang), ""]
  gaps.forEach((row, i) => {
    out.push(...issueBlock(BY_ID[row.check_id] as RegistryCheck, row, site, platform, lang, fmt(t.issue_n, { i: i + 1, n })), "")
  })
  out.push(t.done_many)
  return out.join("\n") + "\n"
}
