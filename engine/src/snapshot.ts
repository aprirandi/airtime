/**
 * Fetch what the checks need from a site's public pages, once, as a Snapshot, so the checks are pure functions
 * of stored responses and can be tested without a network. Only public pages are requested, with a plain GET,
 * about 25 to 35 requests in all. Links found on the site are followed only on the same site.
 * Independent requests run side by side (a few at a time) so a scan fits in a serverless function.
 */
import type { Fetcher, Response } from "./http"
import { type Page, parsePage } from "./html"

export const AI_USER_AGENTS: Record<string, string> = {
  "ChatGPT-User": "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
  "OAI-SearchBot": "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "Claude-User": "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
}
const WELL_KNOWN: Record<string, string> = {
  mcp_server_card: "/.well-known/mcp/server-card.json",
  agent_skills_index: "/.well-known/agent-skills/index.json",
  ard_manifest: "/.well-known/ai-catalog.json",
  auth_md: "/auth.md",
  oidc: "/.well-known/openid-configuration",
  oauth_server: "/.well-known/oauth-authorization-server",
  oauth_resource: "/.well-known/oauth-protected-resource",
}
const NOT_FOUND_PATH = "/__airtime-404-probe"
const TRUST_LINK: Record<string, RegExp> = { about: /about/i, contact: /contact/i, privacy: /privacy/i }
const TRUST_FALLBACKS: Record<string, string[]> = {
  about: ["/pages/about-us", "/pages/about", "/about", "/about-us"],
  contact: ["/pages/contact", "/contact", "/contact-us", "/pages/contact-us"],
  privacy: ["/policies/privacy-policy", "/privacy", "/privacy-policy", "/pages/privacy-policy"],
}
const MARKDOWN = { Accept: "text/markdown" }
const HTML = { Accept: "text/html" }
const MAX_LLMS_LINKS = 5
const CONCURRENCY = 6

export interface ScanConfig {
  baseUrl: string
  platform: string
  productUrl?: string
}

export interface Snapshot {
  base: string
  platform: string
  home: Response
  homePage: Page
  homeMarkdown: Response
  homeHtml: Response
  uaProbes: Record<string, Response>
  robots: Response
  sitemap: Response | null
  sitemapUrl: string
  sitemapListed: boolean
  productUrl: string
  product: Response | null
  productPage: Page | null
  notFound: Response
  notFoundMarkdown: Response
  llms: Response
  llmsLinks: Response[]
  agents: Response
  wellKnown: Record<string, Response>
  trust: Record<string, [Response, Page] | null>
  fetches: Response[]
}

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export const originOf = (url: string) => {
  const u = parse(url)
  return u ? `${u.protocol}//${u.host}` : ""
}

const hostOf = (url: string) => {
  const h = (parse(url)?.hostname ?? "").toLowerCase()
  return h.startsWith("www.") ? h.slice(4) : h
}

export const sameSite = (url: string, base: string) => hostOf(url) === hostOf(base)

export const sitemapLocs = (text: string) => [...text.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)].map((m) => m[1] as string)
export const isSitemapIndex = (text: string) => /<sitemapindex/i.test(text)

const join = (base: string, ref: string) => {
  try {
    return new URL(ref, base).href
  } catch {
    return ""
  }
}

export class ScanError extends Error {}

export async function collect(fetch: Fetcher, cfg: ScanConfig): Promise<Snapshot> {
  const seen: (Response | null)[] = []
  let running = 0
  const waiting: (() => void)[] = []

  const get = async (url: string, options?: Parameters<Fetcher>[1]): Promise<Response> => {
    const slot = seen.length
    seen.push(null)
    while (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
    try {
      const resp = await fetch(url, options)
      seen[slot] = resp
      return resp
    } finally {
      running--
      waiting.shift()?.()
    }
  }

  const start = cfg.baseUrl.replace(/\/+$/, "") + "/"
  const home = await get(start)
  if (home.status === 0) throw new ScanError(`could not reach ${start}: ${home.error || "no response"}`)
  const base = originOf(home.finalUrl || start)
  const at = (path: string, options?: Parameters<Fetcher>[1]) => get(base + path, options)
  const homePage = parsePage(home.text)

  const robotsFlow = async () => {
    const robots = await at("/robots.txt")
    const listed = [...(robots.ok ? robots.text : "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)]
      .map((m) => m[1] as string)
      .filter((m) => sameSite(m, base))
    const sitemapUrl = listed[0] ?? base + "/sitemap.xml"
    const sitemap = await get(sitemapUrl)
    const product = await findProduct(get, cfg, base, sitemap)
    return { robots, sitemapUrl, sitemap, sitemapListed: listed.length > 0, product }
  }
  const llmsFlow = async () => {
    const llms = await at("/llms.txt")
    return { llms, links: await probeLlmsLinks(get, llms, base) }
  }

  const [homeMarkdown, homeHtml, uaEntries, rf, notFound, notFoundMarkdown, lf, agents, wellKnownEntries, trust] =
    await Promise.all([
      get(base + "/", { headers: MARKDOWN }),
      get(base + "/", { headers: HTML }),
      Promise.all(
        Object.entries(AI_USER_AGENTS).map(async ([name, ua]) => [name, await get(base + "/", { userAgent: ua })] as const)
      ),
      robotsFlow(),
      at(NOT_FOUND_PATH),
      at(NOT_FOUND_PATH, { headers: MARKDOWN }),
      llmsFlow(),
      at("/agents.md"),
      Promise.all(Object.entries(WELL_KNOWN).map(async ([key, path]) => [key, await at(path)] as const)),
      findTrustPages(get, homePage, home.finalUrl || start, base),
    ])

  return {
    base, platform: cfg.platform, home, homePage, homeMarkdown, homeHtml,
    uaProbes: Object.fromEntries(uaEntries), robots: rf.robots, sitemap: rf.sitemap, sitemapUrl: rf.sitemapUrl,
    sitemapListed: rf.sitemapListed, productUrl: rf.product.url, product: rf.product.response,
    productPage: rf.product.page, notFound, notFoundMarkdown, llms: lf.llms, llmsLinks: lf.links, agents,
    wellKnown: Object.fromEntries(wellKnownEntries), trust, fetches: seen.filter((r): r is Response => r !== null),
  }
}

type Get = (url: string, options?: Parameters<Fetcher>[1]) => Promise<Response>

/** A product page to read prices from: the configured one, else the first product in the sitemap. */
async function findProduct(get: Get, cfg: ScanConfig, base: string, sitemap: Response | null) {
  let url = cfg.productUrl ?? ""
  if (!url && sitemap && sitemap.ok) {
    let locs = sitemapLocs(sitemap.text).filter((u) => sameSite(u, base))
    if (isSitemapIndex(sitemap.text)) {
      const children = locs.filter((u) => u.toLowerCase().includes("product"))
      if (children.length) {
        const child = await get(children[0] as string)
        locs = child.ok ? sitemapLocs(child.text).filter((u) => sameSite(u, base)) : []
      } else locs = []
    }
    url = locs.find((u) => u.toLowerCase().includes("/product")) ?? ""
  }
  if (!url) return { url: "", response: null, page: null as Page | null }
  const response = await get(url)
  return { url, response: response as Response | null, page: response.ok ? parsePage(response.text) : null }
}

async function probeLlmsLinks(get: Get, llms: Response, base: string): Promise<Response[]> {
  if (!llms.ok) return []
  const targets: string[] = []
  for (const m of llms.text.matchAll(/\[([^\]]*)\]\((\S+?)\)/g)) {
    const target = join(base + "/", m[2] as string)
    if (target && sameSite(target, base) && targets.length < MAX_LLMS_LINKS) targets.push(target)
  }
  return Promise.all(targets.map((t) => get(t)))
}

/** About, Contact and Privacy: footer links first, then the usual paths. A page counts only with real content. */
async function findTrustPages(get: Get, homePage: Page, homeUrl: string, base: string) {
  const kinds = Object.entries(TRUST_LINK)
  const found = await Promise.all(
    kinds.map(async ([kind, pattern]) => {
      let candidates: string[] = []
      for (const [href, text] of homePage.anchors) {
        const target = join(homeUrl, href)
        if (target && sameSite(target, base) && (pattern.test(href) || pattern.test(text)) && !candidates.includes(target)) {
          candidates.push(target)
        }
      }
      candidates = [...candidates.slice(0, 2), ...(TRUST_FALLBACKS[kind] as string[]).slice(0, 2).map((p) => base + p)]
      const tried = new Set<string>()
      for (const url of candidates) {
        if (tried.has(url)) continue
        tried.add(url)
        const resp = await get(url)
        if (resp.ok) return [kind, [resp, parsePage(resp.text)] as [Response, Page]] as const
      }
      return [kind, null] as const
    })
  )
  return Object.fromEntries(found) as Record<string, [Response, Page] | null>
}
