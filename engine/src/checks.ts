/**
 * The checks. Each one reads a Snapshot and returns an Outcome. All rules are plain code (HTTP status, headers,
 * parsed HTML, JSON): no AI decides pass or fail. Same rules, thresholds and words as the Python engine
 * (airtime/agents/auditor/checks.py); the replay tests compare the two on recorded pages.
 */
import { contentRatio, jsonldItems, linkHref, metaContent, typesOf } from "./html"
import type { Response } from "./http"
import { Robots } from "./robots"
import { AI_USER_AGENTS, isSitemapIndex, sitemapLocs, type Snapshot } from "./snapshot"
import { clip, collapse, cpLen, fixed, isDict, pyIter, pyOr, pyRound, pyStrip, splitLines, truthy } from "./util"

const MIN_TEXT = 500
const MIN_RATIO = 0.05
const MIN_ERROR_BODY = 20
const MAX_HOPS_OK = 3
const LOGIN_PATHS = new Set(["/login", "/signin", "/sign-in", "/account/login", "/password", "/users/sign_in"])
const USEFUL_RELS = new Set(["api-catalog", "service-doc", "service-desc", "describedby", "status", "llms-txt", "mcp"])
const ORG_TYPES = new Set(["organization", "corporation", "localbusiness", "store", "onlinestore", "onlinebusiness"])
const CONTENT_SIGNAL_KEYS = ["ai-train", "search", "ai-input"]

export interface Outcome {
  result: "pass" | "partial" | "fail" | "na"
  percent: number
  evidence: string
  details: Record<string, unknown>
}

const passed = (evidence: string, details: Record<string, unknown> = {}): Outcome => ({ result: "pass", percent: 100, evidence, details })
const failed = (evidence: string, details: Record<string, unknown> = {}): Outcome => ({ result: "fail", percent: 0, evidence, details })
const partial = (percent: number, evidence: string, details: Record<string, unknown> = {}): Outcome => ({
  result: "partial", percent: Math.max(1, Math.min(99, percent)), evidence, details,
})
const na = (evidence: string, details: Record<string, unknown> = {}): Outcome => ({ result: "na", percent: 0, evidence, details })
/** 100 is a pass, 0 a fail, anything between is partial credit. */
const graded = (percent: number, evidence: string, details: Record<string, unknown> = {}): Outcome =>
  percent >= 100 ? passed(evidence, details) : percent > 0 ? partial(percent, evidence, details) : failed(evidence, details)

const status = (r: Response | null | undefined) => (r && r.status ? String(r.status) : "no response")

function json(resp: Response): unknown {
  if (!resp.ok) return null
  try {
    return JSON.parse(resp.text)
  } catch {
    return null
  }
}

function robotsOf(snap: Snapshot): Robots | null {
  return snap.robots.ok ? new Robots(snap.robots.text) : null
}

type Dict = Record<string, unknown>

export function orgOf(snap: Snapshot): Dict | null {
  const [items] = jsonldItems(snap.homePage)
  for (const item of items) {
    for (const t of typesOf(item)) {
      const low = t.toLowerCase()
      if (ORG_TYPES.has(low) || low.endsWith("store") || low.endsWith("business")) return item
    }
  }
  return null
}

/** What the Organization entity on this site says about itself, for the fix prompt. */
function orgFacts(org: Dict): Record<string, unknown> {
  const name = org["name"]
  const types = typesOf(org)
  return {
    // one line, whatever the site wrote: this text is quoted in the fix prompt
    org_name: typeof name === "string" ? clip(collapse(name), 80) : "",
    org_type: types[0] !== undefined ? clip(collapse(types[0]), 60) : "",
    present: Object.entries(org).filter(([k, v]) => !k.startsWith("@") && filled(v)).map(([k]) => k),
  }
}

const filled = (v: unknown) => (typeof v === "string" ? pyStrip(v) !== "" : truthy(v))
const rel = (r: Response) => {
  try {
    return new URL(r.url).pathname || r.url
  } catch {
    return r.url
  }
}
const plural = (n: number) => (n !== 1 ? "s" : "")

// ---- Group 1: access and content -------------------------------------------------------------------------

function robots_txt(snap: Snapshot): Outcome {
  const r = snap.robots
  if (!r.ok) return failed(`/robots.txt returned HTTP ${status(r)}.`)
  if (!/^\s*user-agent\s*:/im.test(r.text)) return failed("/robots.txt exists but has no User-agent rules.")
  return passed("/robots.txt exists and has crawl rules.")
}

function ai_crawlers_allowed(snap: Snapshot): Outcome {
  const parser = robotsOf(snap)
  const blocked: string[] = []
  for (const [name, probe] of Object.entries(snap.uaProbes)) {
    if (parser && !parser.canFetch(name, "/")) blocked.push(`${name} (robots.txt)`)
    else if (!probe.ok) blocked.push(`${name} (HTTP ${status(probe)})`)
  }
  const n = Object.keys(AI_USER_AGENTS).length
  if (!blocked.length) return passed(`The homepage is open to all ${n} AI crawlers tested.`, { crawlers: Object.keys(AI_USER_AGENTS) })
  return graded(pyRound((100 * (n - blocked.length)) / n), `Blocked for ${blocked.length} of ${n} AI crawlers: ${blocked.join(", ")}.`, { blocked })
}

function sitemap(snap: Snapshot): Outcome {
  const r = snap.sitemap
  if (!r || !r.ok) return failed(`No sitemap at ${snap.sitemapUrl} (HTTP ${r ? r.status : "none"}).`)
  const entries = sitemapLocs(r.text).length
  if (!(entries && (isSitemapIndex(r.text) || /<urlset/i.test(r.text)))) return failed(`${snap.sitemapUrl} is not a valid sitemap.`)
  if (!snap.sitemapListed) return partial(50, `A valid sitemap with ${entries} entries exists, but robots.txt does not list it.`, { entries })
  return passed(`A valid sitemap with ${entries} entries, listed in robots.txt.`, { entries })
}

function raw_html_content(snap: Snapshot): Outcome {
  const { home, homePage: page } = snap
  if (!home.ok) return failed(`The homepage returned HTTP ${home.status}.`)
  const levels = page.headings.map(([lvl]) => lvl)
  const sequential = levels.length > 0 && levels[0] === 1 && levels.slice(1).every((b, i) => b <= (levels[i] as number) + 1)
  const chars = cpLen(page.text)
  const ratio = contentRatio(page)
  const rules: [string, boolean][] = [
    [`at least ${MIN_TEXT} characters of text (${chars} found)`, chars >= MIN_TEXT],
    ["an H1 heading", levels.includes(1)],
    ["headings in order starting at H1" + (sequential || !levels.length ? "" : ` (first is H${levels[0]})`), sequential],
    [`text is at least ${Math.round(MIN_RATIO * 100)}% of the HTML (${fixed(ratio * 100, 1)}%)`, ratio >= MIN_RATIO],
  ]
  const missing = rules.filter(([, ok]) => !ok).map(([name]) => name)
  const percent = pyRound((100 * (rules.length - missing.length)) / rules.length)
  if (!missing.length) return passed(`The raw HTML has ${chars} characters of text, an H1 and ordered headings.`)
  return graded(percent, "Missing in the raw HTML: " + missing.join("; ") + ".", {
    text_chars: chars, ratio: pyRound(ratio, 4), headings: levels.slice(0, 12),
    outline: page.headings.slice(0, 12).map(([lvl, text]) => [lvl, clip(text, 60)]),
  })
}

function redirects_clean(snap: Snapshot): Outcome {
  const { home, homePage: page } = snap
  const stub = cpLen(page.text) < 300 && (Boolean(metaContent(page, "refresh")) || page.scriptRedirect)
  if (stub) return failed("The homepage is a meta-refresh or JavaScript redirect stub, not a real redirect.")
  const hops = home.chain.length
  if (hops > MAX_HOPS_OK) return partial(50, `${hops} redirects before the homepage; ${MAX_HOPS_OK} or fewer is clean.`, { hops })
  return passed(`${hops} redirect${plural(hops)} before the homepage, no meta-refresh or script redirects.`, { hops })
}

function public_no_login(snap: Snapshot): Outcome {
  const { home, homePage: page } = snap
  let path = "/"
  try {
    path = new URL(home.finalUrl).pathname.replace(/\/+$/, "") || "/"
  } catch {
    path = "/"
  }
  if (!home.ok) return failed(`The homepage returned HTTP ${home.status}.`)
  if (LOGIN_PATHS.has(path) || (page.hasPasswordInput && cpLen(page.text) < 300)) {
    return failed(`The homepage is behind a login or store password (${path}).`)
  }
  if (snap.product && !snap.product.ok) return partial(50, `The homepage is public, but the product page returned HTTP ${snap.product.status}.`)
  return passed("The homepage" + (snap.product ? " and a product page are" : " is") + " readable without signing in.")
}

function not_noindex(snap: Snapshot): Outcome {
  const robotsMeta = ["robots", "googlebot", "bingbot"].map((n) => metaContent(snap.homePage, n)).join(" ").toLowerCase()
  const header = snap.home.header("x-robots-tag").toLowerCase()
  if (robotsMeta.includes("noindex") || header.includes("noindex")) {
    const sources = [...(robotsMeta.includes("noindex") ? ["meta tag"] : []), ...(header.includes("noindex") ? ["X-Robots-Tag header"] : [])]
    return failed("The homepage tells search engines not to index it (noindex).", { sources })
  }
  return passed("No noindex in the homepage's meta tags or headers.")
}

function not_found_markdown(snap: Snapshot): Outcome {
  const nf = snap.notFound
  const md = snap.notFoundMarkdown
  if (nf.status !== 404 && nf.status !== 410) return failed(`A page that does not exist returns HTTP ${status(nf)}, not 404.`)
  const body = pyStrip(md.text)
  if (md.contentType === "text/markdown" && cpLen(body) >= MIN_ERROR_BODY && /\]\(|https?:\/\//.test(body)) {
    return passed("A missing page returns 404 with a Markdown error message that links onward.")
  }
  return partial(50, "A missing page correctly returns 404, but there is no Markdown error body when the request asks for text/markdown.")
}

// ---- Group 2: trust and identity -------------------------------------------------------------------------

function jsonld_organization(snap: Snapshot): Outcome {
  const [items, invalid] = jsonldItems(snap.homePage)
  const org = orgOf(snap)
  if (!org) {
    const found: string[] = []
    for (const item of items) for (const t of typesOf(item)) if (!found.includes(t)) found.push(t)
    return failed("No Organization or store entity in the homepage JSON-LD" + (invalid ? ` (${invalid} block(s) were not valid JSON).` : "."), {
      jsonld_types: found.slice(0, 8), invalid_blocks: invalid,
    })
  }
  const facts = orgFacts(org)
  if (!filled(org["description"])) return partial(50, "An Organization entity is present but has no description.", facts)
  return passed("An Organization entity with a description is present in the JSON-LD.", facts)
}

function organization_completeness(snap: Snapshot): Outcome {
  const org = orgOf(snap)
  if (!org) return failed("No Organization entity to check for contact details and address.")
  const have: [string, boolean][] = [["contactPoint", filled(org["contactPoint"])], ["address", filled(org["address"])]]
  const missing = have.filter(([, ok]) => !ok).map(([k]) => k)
  const facts = { ...orgFacts(org), missing }
  if (!missing.length) return passed("The Organization has a contactPoint and an address.", facts)
  return graded(50 * have.filter(([, ok]) => ok).length, "The Organization is missing: " + missing.join(", ") + ".", facts)
}

function metadata_complete(snap: Snapshot): Outcome {
  const page = snap.homePage
  const have: [string, boolean][] = [
    ["canonical URL", Boolean(linkHref(page, "canonical"))],
    ["lang attribute", Boolean(page.lang)],
    ["og:image", Boolean(metaContent(page, "og:image"))],
    ["og:type", Boolean(metaContent(page, "og:type"))],
  ]
  const missing = have.filter(([, ok]) => !ok).map(([k]) => k)
  if (!missing.length) return passed("Canonical URL, lang, og:image and og:type are all present.")
  return graded(pyRound((100 * (have.length - missing.length)) / have.length), "Missing: " + missing.join(", ") + ".")
}

const pyStr = (v: unknown) => (typeof v === "string" ? v : String(v))

function priceOf(snap: Snapshot): [Dict | null, unknown, unknown] {
  const [items] = snap.productPage ? jsonldItems(snap.productPage) : [[] as Dict[]]
  let product: Dict | null = null
  for (const item of items) {
    const types = new Set(typesOf(item).map((t) => t.toLowerCase()))
    if (types.has("product") || types.has("productgroup")) {
      product = product ?? item
      const variants = "hasVariant" in item ? item["hasVariant"] : []
      const offers = pyOr(
        item["offers"],
        pyIter(variants).filter(isDict).map((v) => v["offers"] ?? null)
      )
      for (let offer of Array.isArray(offers) ? offers : [offers]) {
        if (Array.isArray(offer) && offer.length) offer = offer[0]
        if (isDict(offer)) {
          const price = pyOr(offer["price"], offer["lowPrice"])
          if (price !== undefined && price !== null && price !== "" && truthy(offer["priceCurrency"])) {
            return [product, price, offer["priceCurrency"]]
          }
        }
      }
    }
  }
  return [product, null, null]
}

function pricing_structured(snap: Snapshot): Outcome {
  if (!snap.product || !snap.productPage) return na("No product page was found to read prices from.")
  const [product, price, currency] = priceOf(snap)
  if (!product) return failed(`No Product JSON-LD on ${snap.productUrl}.`)
  if (price === null || price === undefined || price === "") return partial(50, `Product JSON-LD on ${snap.productUrl} has no price and currency.`)
  return passed(`${snap.productUrl} shows its price in structured data (${pyStr(price)} ${pyStr(currency)}).`, {
    price: pyStr(price), currency,
  })
}

function trust_pages(snap: Snapshot): Outcome {
  const parts: string[] = []
  const pages: Record<string, unknown> = {}
  let ok = 0
  for (const kind of ["about", "contact", "privacy"]) {
    const found = snap.trust[kind]
    if (!found) {
      parts.push(`${kind}: not found`)
      pages[kind] = { status: "missing", url: "", chars: 0 }
    } else if (cpLen(found[1].text) < MIN_TEXT) {
      parts.push(`${kind}: only ${cpLen(found[1].text)} characters`)
      pages[kind] = { status: "thin", url: clip(collapse(found[0].url), 200), chars: cpLen(found[1].text) }
    } else {
      ok += 1
      parts.push(`${kind}: ok`)
      pages[kind] = { status: "ok", url: clip(collapse(found[0].url), 200), chars: cpLen(found[1].text) }
    }
  }
  return graded(pyRound((100 * ok) / 3), parts.join("; ") + ".", { pages })
}

// ---- Group 3: agent discovery ----------------------------------------------------------------------------

function markdown_negotiation(snap: Snapshot): Outcome {
  const md = snap.homeMarkdown
  const html = snap.homeHtml
  const isMd = md.contentType === "text/markdown"
  const nonEmpty = cpLen(pyStrip(md.text)) >= MIN_ERROR_BODY
  const vary = md.header("vary").toLowerCase().includes("accept")
  const htmlKept = html.contentType === "text/html"
  if (isMd && nonEmpty && vary && htmlKept) {
    return passed("The homepage returns Markdown for Accept: text/markdown, with Vary: Accept, and HTML otherwise.", {
      tokens: md.header("x-markdown-tokens"),
    })
  }
  if (isMd && nonEmpty) {
    const gaps = [...(vary ? [] : ["Vary: Accept"]), ...(htmlKept ? [] : ["HTML for browsers"])]
    return partial(50, "Markdown is returned but these are missing: " + gaps.join(", ") + ".")
  }
  return failed(`Accept: text/markdown returned ${md.contentType || "no content type"}${md.status !== 200 ? ` (HTTP ${md.status})` : ""}, not Markdown.`)
}

function llms_txt(snap: Snapshot): Outcome {
  const r = snap.llms
  if (!r.ok) return failed(`/llms.txt returned HTTP ${status(r)}.`)
  const links = [...r.text.matchAll(/\[[^\]]*\]\(\S+?\)/g)]
  if (!links.length) return partial(50, "/llms.txt exists but has no Markdown links.")
  const probes = snap.llmsLinks
  if (!probes.length) return passed(`/llms.txt exists with ${links.length} Markdown links (none on this site to test).`)
  const resolved = probes.filter((p) => p.ok).length
  if (resolved === probes.length) return passed(`/llms.txt has ${links.length} links; all ${probes.length} probed resolve.`)
  return graded(
    pyRound((100 * resolved) / probes.length),
    `/llms.txt has ${links.length} links; ${probes.length - resolved} of ${probes.length} probed do not resolve.`
  )
}

function agents_md(snap: Snapshot): Outcome {
  const r = snap.agents
  if (!r.ok) return failed(`/agents.md returned HTTP ${status(r)}.`)
  if (!["text/markdown", "text/plain", "text/x-markdown"].includes(r.contentType) || cpLen(pyStrip(r.text)) < 100) {
    return partial(50, "/agents.md exists but is not served as Markdown or text, or is very short.")
  }
  return passed("/agents.md exists and is served as " + r.contentType + ".")
}

function content_signals(snap: Snapshot): Outcome {
  if (!snap.robots.ok) return failed("No robots.txt to hold Content-Signal directives.")
  const found: Record<string, string> = {}
  for (const m of snap.robots.text.matchAll(/^\s*content-signal\s*:\s*(.+)$/gim)) {
    for (const pair of (m[1] as string).split(",")) {
      const eq = pair.indexOf("=")
      const key = pyStrip(eq < 0 ? pair : pair.slice(0, eq)).toLowerCase()
      const value = pyStrip(eq < 0 ? "" : pair.slice(eq + 1)).toLowerCase()
      if (CONTENT_SIGNAL_KEYS.includes(key) && (value === "yes" || value === "no")) found[key] = value
    }
  }
  const lines = splitLines(snap.robots.text)
  // Comments are free text written for readers and agents, not rules: the fix prompt never repeats them.
  const rules = lines.filter((line) => pyStrip(line) !== "" && !pyStrip(line).startsWith("#"))
  const head = rules.slice(0, 25).map((line) => clip(line, 120))
  const names = Object.keys(found)
  if (names.length === CONTENT_SIGNAL_KEYS.length) {
    return passed("robots.txt declares ai-train, search and ai-input preferences.", { signals: found, robots_head: head, robots_lines: lines.length })
  }
  return graded(
    pyRound((100 * names.length) / CONTENT_SIGNAL_KEYS.length),
    !names.length ? "robots.txt has no Content-Signal directive." : "robots.txt declares only: " + names.join(", ") + ".",
    { signals: found, robots_head: head, robots_lines: lines.length }
  )
}

interface LinkHeader {
  target: string
  rels: string[]
  type: string
}

/** RFC 8288 Link header. */
export function parseLinkHeader(value: string): LinkHeader[] {
  const out: LinkHeader[] = []
  for (const m of (value || "").matchAll(/<([^>]*)>([^<]*)/g)) {
    const params = m[2] as string
    const relM = /rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(params)
    const typeM = /type\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(params)
    const rels = (relM ? (relM[1] ?? relM[2] ?? "") : "").toLowerCase().split(/\s+/).filter(Boolean)
    out.push({ target: m[1] as string, rels, type: (typeM ? (typeM[1] ?? typeM[2] ?? "") : "").toLowerCase() })
  }
  return out
}

function link_headers(snap: Snapshot): Outcome {
  const links = parseLinkHeader(snap.home.header("link"))
  if (!links.length) return failed("The homepage sends no Link headers.")
  const useful = links.filter((l) => l.rels.some((r) => USEFUL_RELS.has(r)) || (l.rels.includes("alternate") && l.type === "text/markdown"))
  if (useful.length) {
    return passed(`${useful.length} of ${links.length} Link headers point agents to useful resources.`, {
      rels: [...new Set(useful.flatMap((l) => l.rels))].sort(),
    })
  }
  const seen = [...new Set(links.flatMap((l) => l.rels))].sort().slice(0, 6)
  return failed(`${links.length} Link headers, none with a relation useful to agents (found: ${seen.join(", ") || "none"}).`)
}

function mcp_server_card(snap: Snapshot): Outcome {
  const r = snap.wellKnown["mcp_server_card"] as Response
  const data = json(r)
  if (!isDict(data)) return failed(`No MCP server card at ${rel(r)} (HTTP ${status(r)}).`)
  const info = data["serverInfo"]
  if (isDict(info) && truthy(info["name"]) && truthy(info["version"])) return passed("An MCP server card with serverInfo (name, version) is published.")
  return partial(50, "A JSON file exists at the server-card path but serverInfo has no name and version.")
}

function agent_skills_index(snap: Snapshot): Outcome {
  const r = snap.wellKnown["agent_skills_index"] as Response
  const data = json(r)
  const skills = isDict(data) ? data["skills"] : null
  if (!Array.isArray(skills) || !skills.length) return failed(`No agent skills index at ${rel(r)} (HTTP ${status(r)}).`)
  const needed = ["name", "type", "description", "url", "sha256"]
  if (isDict(data) && "$schema" in data && skills.every((s) => isDict(s) && needed.every((k) => truthy(s[k])))) {
    return passed(`An agent skills index lists ${skills.length} skills with digests.`)
  }
  return partial(50, "A skills index exists but lacks $schema or fields (name, type, description, url, sha256).")
}

function ard_manifest(snap: Snapshot): Outcome {
  const r = snap.wellKnown["ard_manifest"] as Response
  const data = json(r)
  if (!isDict(data)) return failed(`No ARD manifest at ${rel(r)} (HTTP ${status(r)}).`)
  if (truthy(data["specVersion"]) && isDict(data["host"]) && Array.isArray(data["entries"])) {
    return passed(`An ARD manifest lists ${data["entries"].length} entries.`)
  }
  return partial(50, "A JSON file exists at the ARD path but lacks specVersion, host or entries.")
}

function auth_md(snap: Snapshot): Outcome {
  const r = snap.wellKnown["auth_md"] as Response
  if (r.ok && cpLen(pyStrip(r.text)) >= 50) return passed("/auth.md is published with agent registration instructions.")
  return failed(`/auth.md returned HTTP ${status(r)}.`)
}

function oauth_discovery(snap: Snapshot): Outcome {
  for (const key of ["oidc", "oauth_server"]) {
    const data = json(snap.wellKnown[key] as Response)
    if (isDict(data) && truthy(data["issuer"])) return passed("OAuth or OpenID Connect discovery metadata is published.")
  }
  return failed("No OAuth or OpenID Connect discovery metadata.")
}

function oauth_protected_resource(snap: Snapshot): Outcome {
  const data = json(snap.wellKnown["oauth_resource"] as Response)
  if (isDict(data) && truthy(data["resource"])) return passed("OAuth protected-resource metadata (RFC 9728) is published.")
  return failed("No OAuth protected-resource metadata.")
}

/** The checks the engine runs, by id. The registry (data) says which ids are built. */
export const CHECKS: Record<string, (snap: Snapshot) => Outcome> = {
  robots_txt, ai_crawlers_allowed, sitemap, raw_html_content, redirects_clean, public_no_login, not_noindex,
  not_found_markdown, jsonld_organization, organization_completeness, metadata_complete, pricing_structured,
  trust_pages, markdown_negotiation, llms_txt, agents_md, content_signals, link_headers, mcp_server_card,
  agent_skills_index, ard_manifest, auth_md, oauth_discovery, oauth_protected_resource,
}
