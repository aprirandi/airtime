/**
 * Fix prompts: text an AI assistant or a developer can follow to fix what the Auditor found. Built by code from
 * the stored results and the registry, with no AI call. Same wording as airtime/agents/auditor/prompts.py: the
 * golden tests compare the two character by character.
 */
import { BY_ID, REGISTRY } from "./registry"
import { fixed } from "./util"
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
    here: "On this site",
    todo: "What to do",
    ask: "Ask the owner first",
    on_platform: "On {platform}",
    check: "How to check",
    expect: "Expect",
    rules_head: "Rules",
    rules: [
      "Change only what the issue needs. Keep the existing design, text and behaviour.",
      "Before you change a file or a setting, note its current value so it can be restored.",
      "If you do not have the access you need (for example to the theme), say so and stop. Do not work around it.",
    ],
    ask_rule: "Where an issue says to ask the owner first, ask and wait for the answer. Never invent contact details, legal text or policy choices.",
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
    here: "Di situs ini",
    todo: "Yang perlu dilakukan",
    ask: "Tanyakan dulu ke pemilik",
    on_platform: "Di {platform}",
    check: "Cara mengecek",
    expect: "Hasil yang diharapkan",
    rules_head: "Aturan",
    rules: [
      "Ubah hanya yang dibutuhkan masalah itu. Pertahankan desain, teks dan perilaku yang ada.",
      "Sebelum mengubah berkas atau pengaturan, catat nilai aslinya supaya bisa dikembalikan.",
      "Kalau kamu tidak punya akses yang dibutuhkan (misalnya ke tema), katakan dan berhenti. Jangan mencari jalan pintas.",
    ],
    ask_rule: "Kalau sebuah masalah menyuruh bertanya dulu ke pemilik, tanyakan dan tunggu jawabannya. Jangan pernah mengarang data kontak, teks hukum, atau pilihan kebijakan.",
    done_one: "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan.",
    done_many:
      "Setelah selesai, tuliskan persis apa yang kamu ubah dan cara membatalkan tiap perubahan, dan sebutkan masalah mana yang selesai dan mana yang belum.",
    none: "Scan tidak menemukan apa pun yang bisa diperbaiki pemilik.",
  },
} as const


const CONTEXT = {
  en: {
    outline: "Headings, in order: {outline}.",
    no_headings: "The page has no headings.",
    text: "Visible text: {chars} characters, {pct}% of the HTML.",
    org: "The Organization entity {name}(type {type}). It has: {present}.",
    org_lacks: " It lacks: {missing}.",
    org_none_types: "The homepage has JSON-LD of these types, but no Organization: {types}.",
    org_no_jsonld: "The homepage has no JSON-LD.",
    robots: "robots.txt today ({shown} of {total} lines):",
    blocked: "Blocked: {blocked}.",
    pages: "About, Contact and Privacy: {pages}.",
    page: "{kind}: {status}",
    page_ok: "ok",
    page_thin: "only {chars} characters at {url}",
    page_missing: "not found",
    noindex: "noindex was found in: {sources}.",
    named: '"{name}" ',
    none: "none",
  },
  id: {
    outline: "Heading, berurutan: {outline}.",
    no_headings: "Halaman tidak punya heading.",
    text: "Teks yang terlihat: {chars} karakter, {pct}% dari HTML.",
    org: "Entitas Organization {name}(tipe {type}). Isinya: {present}.",
    org_lacks: " Yang belum ada: {missing}.",
    org_none_types: "Beranda punya JSON-LD bertipe ini, tapi tidak ada Organization: {types}.",
    org_no_jsonld: "Beranda tidak punya JSON-LD.",
    robots: "robots.txt saat ini ({shown} dari {total} baris):",
    blocked: "Diblokir: {blocked}.",
    pages: "About, Contact dan Privacy: {pages}.",
    page: "{kind}: {status}",
    page_ok: "ada",
    page_thin: "hanya {chars} karakter di {url}",
    page_missing: "tidak ditemukan",
    noindex: "noindex ditemukan di: {sources}.",
    named: '"{name}" ',
    none: "tidak ada",
  },
} as const

type Dict = Record<string, unknown>
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

function factsOrg(c: (typeof CONTEXT)["en"] | (typeof CONTEXT)["id"], d: Dict, lacks: boolean): string {
  const name = d["org_name"] ? fmt(c.named, { name: String(d["org_name"]) }) : ""
  const present = list(d["present"]).join(", ")
  let line = fmt(c.org, { name, type: String(d["org_type"] || "?"), present: present || c.none })
  const missing = list(d["missing"])
  if (lacks && missing.length) line += fmt(c.org_lacks, { missing: missing.join(", ") })
  return line
}

/** Plain facts about this site that make the fix specific. Empty when the check stores none. */
export function contextLines(checkId: string, details: Dict | undefined, lang: Lang): string[] {
  const c = CONTEXT[lang]
  const d = details ?? {}
  if (checkId === "raw_html_content" && "outline" in d) {
    const outline = (d["outline"] as [number, string][]).map(([lvl, text]) => `H${lvl} "${text}"`).join(", ")
    const ratio = typeof d["ratio"] === "number" ? d["ratio"] : 0
    return [outline ? fmt(c.outline, { outline }) : c.no_headings, fmt(c.text, { chars: String(d["text_chars"] ?? 0), pct: fixed(ratio * 100, 1) })]
  }
  if (checkId === "jsonld_organization") {
    if ("org_type" in d) return [factsOrg(c, d, false)]
    if (list(d["jsonld_types"]).length) return [fmt(c.org_none_types, { types: list(d["jsonld_types"]).join(", ") })]
    return "jsonld_types" in d ? [c.org_no_jsonld] : []
  }
  if (checkId === "organization_completeness" && "org_type" in d) return [factsOrg(c, d, true)]
  if (checkId === "content_signals" && list(d["robots_head"]).length) {
    const shown = list(d["robots_head"])
    return [fmt(c.robots, { shown: shown.length, total: String(d["robots_lines"] ?? shown.length) }), ...shown.map((line) => "    " + line)]
  }
  if (checkId === "ai_crawlers_allowed" && list(d["blocked"]).length) return [fmt(c.blocked, { blocked: list(d["blocked"]).join(", ") })]
  if (checkId === "not_noindex" && list(d["sources"]).length) return [fmt(c.noindex, { sources: list(d["sources"]).join(", ") })]
  if (checkId === "trust_pages" && d["pages"] && typeof d["pages"] === "object") {
    const pages = d["pages"] as Record<string, { status?: string; chars?: number; url?: string }>
    const parts = ["about", "contact", "privacy"].map((kind) => {
      const p = pages[kind] ?? {}
      const status =
        p.status === "ok" ? c.page_ok : p.status === "thin" ? fmt(c.page_thin, { chars: String(p.chars ?? 0), url: p.url ?? "" }) : c.page_missing
      return fmt(c.page, { kind, status })
    })
    return [fmt(c.pages, { pages: parts.join("; ") })]
  }
  return []
}

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
  details?: Record<string, unknown>
}

function issueBlock(d: RegistryCheck, row: GapRow, site: string, platform: string, lang: Lang, heading: string): string[] {
  const t = TEXT[lang]
  const en = lang === "en"
  const hint = d.platform_fix[platform]
  const group = REGISTRY.groups[String(d.group)]?.[lang] ?? ""
  const tier = en ? row.tier : (TIER_ID[row.tier] ?? row.tier)
  const lines = [`${heading}: ${en ? d.name : d.name_id} (${tier}, ${group})`, `${t.found}: ${row.evidence}`]
  const here = contextLines(d.id, row.details, lang)
  if (here.length) lines.push(`${t.here}: ${here[0]}`, ...here.slice(1))
  lines.push(`${t.todo}: ${en ? d.fix : d.fix_id}`)
  if (hint) lines.push(`${fmt(t.on_platform, { platform: platformName(platform) })}: ${hint[lang]}`)
  if (d.ask) lines.push(`${t.ask}: ${d.ask[lang]}`)
  if (d.verify) {
    lines.push(`${t.check}:`, `    ${d.verify.command.split("{site}").join(site)}`, `${t.expect}: ${en ? d.verify.en : d.verify.id}`)
  }
  return lines
}

const rules = (lang: Lang, asks = false) => [
  `${TEXT[lang].rules_head}:`,
  ...TEXT[lang].rules.map((r) => `- ${r}`),
  ...(asks ? [`- ${TEXT[lang].ask_rule}`] : []),
]

/** One prompt for one gap. `row` is the stored result (tier, evidence). */
export function fixPrompt(checkId: string, row: GapRow, site: string, platform = "", lang: Lang = "en"): string {
  const t = TEXT[lang]
  const d = BY_ID[checkId] as RegistryCheck
  const head = fmt(t.one_head, { site, platform: platformLabel(platform, lang) })
  return [head, "", ...issueBlock(d, row, site, platform, lang, t.issue), "", ...rules(lang, Boolean(d.ask)), "", t.done_one].join("\n") + "\n"
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
  const out: string[] = [head, "", ...rules(lang, gaps.some((g) => Boolean((BY_ID[g.check_id] as RegistryCheck).ask))), ""]
  gaps.forEach((row, i) => {
    out.push(...issueBlock(BY_ID[row.check_id] as RegistryCheck, row, site, platform, lang, fmt(t.issue_n, { i: i + 1, n })), "")
  })
  out.push(t.done_many)
  return out.join("\n") + "\n"
}
