/**
 * The Fixer for the website check: for every gap, who has to move next, and what can already be prepared from the
 * site's own public pages. A port of airtime/agents/fixer (drafts.py, agent.py); engine/test/golden.json holds cases
 * from the Python side that this file must reproduce exactly. Change the two together.
 *
 * Nothing here changes a website. A draft is facts copied from the owner's pages with the page each came from.
 * The patterns read ASCII only, as the Python ones do (re.ASCII).
 */
import texts from "./fixer.generated.json"
import { orgOf } from "./checks"
import type { Page } from "./html"
import { metaContent } from "./html"
import { gaps, limitedGaps } from "./score"
import type { Row } from "./types"
import { clip, collapse, cpLen } from "./util"

type Pair = [string, string]
const CLIENT = texts.client as unknown as Record<string, [string, string, string, string]>
const QUESTIONS = texts.questions as unknown as Record<string, Pair[]>
const STATUS_TEXT = texts.status_text as unknown as Record<string, Pair>

export interface Fix {
  check_id: string
  position: number
  status: string
  tier: string
  title: string
  title_id: string
  why: string
  why_id: string
  summary: string
  summary_id: string
  questions: { en: string; id: string }[]
  confirm: Fact[]
}

export interface Fact {
  kind: string
  value: string
  source: string
  label: string
  label_id: string
}

interface Draft {
  jsonld: Record<string, unknown>
  confirm: Fact[]
  answered: number[]
}

/** What the drafts read: the site's address, its homepage and its About and Contact pages. */
export interface FactsSource {
  base: string
  homePage: Page
  trust: Record<string, [unknown, Page] | null | undefined>
}

const PHONE = /(?<![\d.])(?:\+?61\s?\(?0?\d\)?|\(?0\d\)?)[\s-]?\d{4}[\s-]?\d{4}(?!\d)|(?<![\d.])1[38]00[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const STATE_POSTCODE = /\b(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})\b/g
const STREET_START = /\b\d{1,5}[A-Za-z]?(?:[/-]\d{1,5})?\s+[A-Za-z]/g
const STREET_WORD = /\b(St|Street|Rd|Road|Ave|Avenue|Lane|Ln|Dr|Drive|Hwy|Highway|Pde|Parade|Way|Court|Ct|Place|Pl|Blvd|Boulevard|Terrace|Tce|Crescent|Cres)\b\.?/i
// Marks of a menu or footer that ran into the sentence, not of a sentence a person wrote.
const NOISE = /[\u00b7|\u00a9[\]\u00bb]|\s\/[A-Za-z]|\d:\d|--|skip to content/i
const NOT_EMAIL = ["sentry", "example.", "@2x", ".png", ".jpg", ".webp", "wixpress", "shopify.com", "yourdomain"]
const PLACE_STOP = new Set(["store", "shop", "address", "visit", "us", "contact", "location", "find", "phone", "ph", "tel", "call",
  "our", "the", "open", "at", "email", "stores", "locations", "map"])
const PLACE_PREFIX = new Set(["south", "north", "east", "west", "port", "mount", "mt", "glen", "box", "st", "new", "point"])

type Source = [string, Page]

function sources(snap: FactsSource): Source[] {
  const out: Source[] = []
  for (const kind of ["contact", "about"]) {
    const t = snap.trust[kind]
    if (t) out.push([kind, t[1]])
  }
  out.push(["home", snap.homePage])
  return out
}

const matches = (re: RegExp, text: string) => [...text.matchAll(re)]
const unique = <T>(items: T[]) => [...new Set(items)]

function findPhones(pages: Source[]): [string[], string] | null {
  for (const [kind, page] of pages) {
    const found = unique(matches(PHONE, page.text).map((m) => collapse(m[0])))
    if (found.length) return [found.slice(0, 3), kind]
  }
  return null
}

function findEmail(pages: Source[]): [string, string] | null {
  for (const [kind, page] of pages) {
    const found = matches(EMAIL, page.text).map((m) => m[0].toLowerCase()).filter((m) => !NOT_EMAIL.some((b) => m.includes(b)))
    if (found.length) {
      // the most repeated; on a tie the first one met (Python's Counter.most_common)
      const counts = new Map<string, number>()
      for (const f of found) counts.set(f, (counts.get(f) ?? 0) + 1)
      let best = found[0] as string
      for (const [k, v] of counts) if (v > (counts.get(best) as number)) best = k
      return [best, kind]
    }
  }
  return null
}

const isUpperAscii = (c: string) => /^[A-Z]$/.test(c)
const nameWord = (w: string) => isUpperAscii(w.slice(0, 1)) && /^[A-Za-z]+$/.test(w.replace(/'/g, "").replace(/-/g, ""))
const stripPunct = (s: string) => s.replace(/^[,.:]+|[,.:]+$/g, "")

/** The suburb: written after the street ("123 Smith St Richmond VIC") or just before the number ("Richmond 123 Smith St"). */
function locality(before: string, between: string): string {
  const after = between.replace(/^[ ,.]+|[ ,.]+$/g, "")
  const words = after.split(/\s+/).filter(Boolean)
  if (words.length > 0 && words.length <= 3 && words.every(nameWord)) return after
  const tokens = before.split(/\s+/).filter(Boolean)
  if (tokens.length) {
    const last = stripPunct(tokens[tokens.length - 1] as string)
    if (isUpperAscii(last.slice(0, 1)) && /^[A-Za-z]+$/.test(last) && !PLACE_STOP.has(last.toLowerCase())) {
      const prev = tokens.length > 1 ? stripPunct(tokens[tokens.length - 2] as string) : ""
      if (tokens.length > 1 && PLACE_PREFIX.has(prev.toLowerCase())) return `${prev} ${last}`
      return last
    }
  }
  return ""
}

interface Address {
  street: string
  locality: string
  region: string
  postcode: string
  text: string
}

function findAddresses(pages: Source[]): [Address[], string] | null {
  for (const [kind, page] of pages) {
    const order: string[] = []
    const base = new Map<string, Address>()
    const votes = new Map<string, { key: string; locality: string; n: number }>()
    for (const m of matches(STATE_POSTCODE, page.text)) {
      const at = m.index as number
      const window = page.text.slice(Math.max(0, at - 90), at)
      const starts = matches(STREET_START, window).map((x) => x.index as number).reverse()
      for (const s of starts) {
        const chunk = window.slice(s)
        const w = STREET_WORD.exec(chunk)
        if (!w) continue
        const end = w.index + w[0].length
        const street = collapse(chunk.slice(0, end))
        const key = `${street.toLowerCase()}|${m[2]}`
        if (!base.has(key)) {
          base.set(key, { street, locality: "", region: m[1] as string, postcode: m[2] as string, text: "" })
          order.push(key)
        }
        const loc = locality(window.slice(0, s), chunk.slice(end))
        if (loc) {
          const vk = `${key}\u0000${loc}`
          const v = votes.get(vk)
          if (v) v.n += 1
          else votes.set(vk, { key, locality: loc, n: 1 })
        }
        break
      }
    }
    const used = new Set<string>()
    const ranked = [...votes.values()].sort((a, b) => b.n - a.n || order.indexOf(a.key) - order.indexOf(b.key))
    for (const v of ranked) {
      const a = base.get(v.key) as Address
      if (!a.locality && !used.has(v.locality)) {
        a.locality = v.locality
        used.add(v.locality)
      }
    }
    const found = order.map((k) => base.get(k) as Address)
    for (const a of found) a.text = collapse(`${a.street} ${a.locality} ${a.region} ${a.postcode}`)
    if (found.length) return [found.slice(0, 3), kind]
  }
  return null
}

function findDescription(snap: FactsSource): [string, string] | null {
  for (const meta of snap.homePage.meta) {
    const key = (meta["name"] || meta["property"] || "").toLowerCase()
    const text = collapse(meta["content"] ?? "")
    // a site that builds its meta description from the page text brings the menu and the code samples with it
    if ((key === "description" || key === "og:description") && cpLen(text) >= 40 && !NOISE.test(text)) {
      return [clip(text, 300), "home"]
    }
  }
  const about = snap.trust["about"]
  if (about) {
    // Only the text of a real paragraph: in the visible text of a whole page a menu, a heading or a footer runs
    // into the first sentence. A site that writes its text without <p> tags gets a question instead of a draft.
    for (const paragraph of about[1].paragraphs) {
      const taken: string[] = []
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        const s = collapse(sentence)
        if (cpLen(s) >= 60 && cpLen(s) <= 300 && !NOISE.test(s)) taken.push(s)
        if (cpLen(taken.join(" ")) >= 120 || taken.length === 2) break
      }
      if (taken.length) return [clip(taken.join(" "), 300), "about"]
    }
  }
  return null
}

const fact = (kind: string, value: string, source: string, label: string, label_id: string): Fact => ({ kind, value, source, label, label_id })

function draftOrganizationCompleteness(snap: FactsSource, name: string): Draft | null {
  const pages = sources(snap)
  const phones = findPhones(pages)
  const email = findEmail(pages)
  const addresses = findAddresses(pages)
  if (!phones && !email && !addresses) return null
  const org: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Organization", name, url: snap.base }
  const existing = orgOf(snap as never)
  if (existing && typeof existing["@type"] === "string") org["@type"] = existing["@type"]
  const confirm: Fact[] = []
  const answered: number[] = []
  if (phones || email) {
    const numbers: (string | null)[] = phones ? phones[0] : [null]
    const points = numbers.map((n) => {
      const p: Record<string, unknown> = { "@type": "ContactPoint", contactType: "customer service" }
      if (n) p["telephone"] = n
      if (email) p["email"] = email[0]
      return p
    })
    org["contactPoint"] = points.length === 1 ? points[0] : points
    for (const n of phones ? phones[0] : []) confirm.push(fact("phone", n, (phones as [string[], string])[1], "Phone", "Telepon"))
    if (email) confirm.push(fact("email", email[0], email[1], "Email", "Email"))
    answered.push(0)
  }
  if (addresses) {
    const places = addresses[0].map((a) => {
      const p: Record<string, unknown> = { "@type": "PostalAddress", streetAddress: a.street, addressRegion: a.region, postalCode: a.postcode, addressCountry: "AU" }
      if (a.locality) p["addressLocality"] = a.locality
      confirm.push(fact("address", a.text, addresses[1], "Address", "Alamat"))
      return p
    })
    org["address"] = places.length === 1 ? places[0] : places
    answered.push(1)
  }
  return { jsonld: org, confirm, answered }
}

function draftJsonldOrganization(snap: FactsSource, name: string): Draft | null {
  const found = findDescription(snap)
  if (!found) return null
  const [text, source] = found
  const org = { "@context": "https://schema.org", "@type": "Organization", name, url: snap.base, description: text }
  return { jsonld: org, confirm: [fact("description", text, source, "Description", "Deskripsi")], answered: [0] }
}

export function draftFor(checkId: string, snap: FactsSource, name: string): Draft | null {
  if (checkId === "organization_completeness") return draftOrganizationCompleteness(snap, name)
  if (checkId === "jsonld_organization") return draftJsonldOrganization(snap, name)
  return null
}

/** What to call a site that has no configured name: its Organization name, its og:site_name, else its host. */
export function siteName(snap: FactsSource): string {
  const org = orgOf(snap as never)
  const name = org?.["name"]
  if (typeof name === "string" && collapse(name)) return clip(collapse(name), 80)
  const og = collapse(metaContent(snap.homePage, "og:site_name"))
  if (og) return clip(og, 80)
  let host = ""
  try {
    host = new URL(snap.base).host.toLowerCase()
  } catch {
    host = ""
  }
  return host.startsWith("www.") ? host.slice(4) : host
}

export function planFix(row: Row, platform: string, position: number, draft: Draft | null = null): Fix & { draft: Draft | null } {
  const cid = row.check_id
  const [titleEn, titleId, whyEn, whyId] = CLIENT[cid] as [string, string, string, string]
  const limited = Boolean(row.controlled_by)
  let questions: Pair[] = QUESTIONS[cid] ?? []
  let status: string
  if (limited) status = "platform_held"
  else if (draft && !questions.length) {
    draft = null
    status = "not_started"
  } else if (draft) {
    status = "draft_ready"
    const answered = new Set(draft.answered)
    questions = questions.filter((_, i) => !answered.has(i))
  } else if (questions.length) status = "needs_owner"
  else status = "not_started"
  const keep = status === "needs_owner" || status === "draft_ready"
  const name = platform ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase() : ""
  const [sayEn, sayId] = STATUS_TEXT[status] as Pair
  const fill = (s: string) => s.split("{platform}").join(name)
  return {
    check_id: cid, position, status, tier: row.tier, draft,
    title: titleEn, title_id: titleId, why: whyEn, why_id: whyId, summary: fill(sayEn), summary_id: fill(sayId),
    questions: keep ? questions.map(([en, id]) => ({ en, id })) : [], confirm: [],
  }
}

export function planAll(rows: Row[], platform: string, drafts: Record<string, Draft | null> = {}) {
  const ordered = [...gaps(rows), ...limitedGaps(rows)]
  return ordered.map((r, i) => planFix(r, platform, i + 1, drafts[r.check_id] ?? null))
}

/** The owner's view of every fix for one scan: the same as Python's build_fixes. */
export function buildFixes(rows: Row[], platform: string, snap: FactsSource, name: string): Fix[] {
  const drafts: Record<string, Draft | null> = {}
  for (const r of rows) if (!r.controlled_by) drafts[r.check_id] = draftFor(r.check_id, snap, name)
  return planAll(rows, platform, drafts).map(({ draft, ...fix }) => ({ ...fix, confirm: draft ? draft.confirm : [] }))
}

/** The JSON-LD the Fixer prepared for each gap, for the owner's tutorial. Not part of the public audit answer. */
export function fixDrafts(rows: Row[], snap: FactsSource, name: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const r of gaps(rows)) {
    const draft = draftFor(r.check_id, snap, name)
    if (draft) out[r.check_id] = draft.jsonld
  }
  return out
}

export interface ProfileHint {
  name: string
  city: string
  country: string
  areas: string[]
}

/** What a page of the site tells us about who and where the business is, to ask AI assistants about it without a form. */
export function profileHint(snap: FactsSource): ProfileHint {
  const found = findAddresses(sources(snap))
  const places = unique((found ? found[0] : []).map((a) => a.locality).filter(Boolean))
  return { name: siteName(snap), city: places[0] ?? "", country: found ? "Australia" : "", areas: places.slice(1, 4) }
}

export interface SiteSummary {
  title: string
  description: string
  headings: string[]
  text: string
}

/** A few lines of the homepage, kept so that what the business sells can be worked out later. Data, never instructions. */
export function siteSummary(snap: FactsSource): SiteSummary {
  const page = snap.homePage
  return {
    title: clip(collapse(metaContent(page, "og:title", "twitter:title")), 100),
    description: clip(collapse(metaContent(page, "description", "og:description")), 300),
    headings: page.headings.filter(([level]) => level <= 2).map(([, text]) => clip(collapse(text), 80)).filter(Boolean).slice(0, 8),
    text: clip(page.text, 600),
  }
}
