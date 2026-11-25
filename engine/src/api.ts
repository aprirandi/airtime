/**
 * The audit as a web service: validate the address, limit how often a visitor can scan, remember recent results,
 * run the audit and answer in JSON. It knows nothing about Vercel: `api/audit.ts` hands it a request and sends back
 * what it returns, and the tests call it directly.
 *
 * A public form that takes any address is a way to make our server visit other people's websites, so the rules are
 * strict: only ordinary web addresses (no IP numbers, no odd ports, no logins in the address), a few scans per
 * visitor, one scan per site and platform every ten minutes, and the fetcher itself refuses private networks.
 */
import { runAudit, type AuditResult } from "./audit"
import { httpFetcher, type Fetcher } from "./http"
import { ScanError } from "./snapshot"

export const PLATFORMS = ["shopify", "wordpress", "woocommerce", "wix", "squarespace", "other"] as const

export interface ApiRequest {
  url: unknown
  platform?: unknown
  /** who is asking, for the limit (an IP address) */
  client: string
}

export interface ApiResponse {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export interface Limiter {
  /** true when this client may scan now */
  take(client: string, now: number): { ok: true } | { ok: false; retryAfterSeconds: number }
}

export class MemoryLimiter implements Limiter {
  private hits = new Map<string, number[]>()
  constructor(private max = 10, private windowMs = 10 * 60_000) {}
  take(client: string, now: number) {
    const recent = (this.hits.get(client) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(client, recent)
      return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil(((recent[0] as number) + this.windowMs - now) / 1000)) }
    }
    recent.push(now)
    this.hits.set(client, recent)
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k)
    return { ok: true as const }
  }
}

export interface Deps {
  fetcher?: Fetcher
  limiter?: Limiter
  now?: () => number
  /** how long one scan may take before we give up */
  deadlineMs?: number
}

const cache = new Map<string, { at: number; result: AuditResult }>()
const CACHE_MS = 10 * 60_000
const defaultLimiter = new MemoryLimiter()

export type Parsed = { ok: true; baseUrl: string; host: string } | { ok: false; message: string }

/** An ordinary web address: a name with a dot, http or https, the usual port, no login, not an IP number. */
export function parseAddress(raw: unknown): Parsed {
  if (typeof raw !== "string") return { ok: false, message: "Enter a website address." }
  let text = raw.trim()
  if (!text || text.length > 300) return { ok: false, message: "Enter a website address." }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return { ok: false, message: "That does not look like a website address." }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "Only http and https addresses can be checked." }
  if (u.username || u.password) return { ok: false, message: "The address cannot contain a user name or password." }
  if (u.port && u.port !== (u.protocol === "https:" ? "443" : "80")) return { ok: false, message: "Only the usual web ports can be checked." }
  const host = u.hostname.toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || /^\[/.test(host)) return { ok: false, message: "Enter a website name, not an IP number." }
  if (!host.includes(".") || host.endsWith(".") || /\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/.test(host)) {
    return { ok: false, message: "That is not a public website name." }
  }
  return { ok: true, baseUrl: `${u.protocol}//${u.host}`, host }
}

export const fail = (status: number, error: string, message: string, headers?: Record<string, string>): ApiResponse => ({
  status, body: { error, message }, headers,
})

export async function handleAudit(req: ApiRequest, deps: Deps = {}): Promise<ApiResponse> {
  const now = deps.now ?? Date.now
  const parsed = parseAddress(req.url)
  if (!parsed.ok) return fail(400, "bad_address", parsed.message)
  const platformRaw = typeof req.platform === "string" ? req.platform.toLowerCase() : ""
  if (platformRaw && !(PLATFORMS as readonly string[]).includes(platformRaw)) return fail(400, "bad_platform", "Choose a platform from the list.")
  const platform = platformRaw === "other" ? "" : platformRaw

  const key = `${parsed.baseUrl}|${platform}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < CACHE_MS) {
    const { fix_drafts: _d, profile_hint: _h, site_summary: _s, llms_draft: _l, ...cached } = hit.result
    return { status: 200, body: { ...cached, cached: true } }
  }

  const taken = (deps.limiter ?? defaultLimiter).take(req.client, now())
  if (!taken.ok) {
    return fail(429, "too_many", "Too many checks from your address. Try again in a few minutes.", { "retry-after": String(taken.retryAfterSeconds) })
  }

  const scanned = await scanAddress(parsed, platform, deps)
  if (!scanned.ok) return scanned.response
  const { fix_drafts: _drafts, profile_hint: _hint, site_summary: _summary, llms_draft: _llms, ...result } = scanned.result
  cache.set(key, { at: now(), result: scanned.result })
  if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  return { status: 200, body: { ...result, cached: false } }
}

/** Run one audit with a deadline, and turn the ways it can fail into the answers the service gives. */
export async function scanAddress(
  parsed: { baseUrl: string; host: string }, platform: string, deps: Deps = {}
): Promise<{ ok: true; result: AuditResult } | { ok: false; response: ApiResponse }> {
  const fetcher = deps.fetcher ?? httpFetcher({ timeoutMs: 10_000 })
  const deadline = deps.deadlineMs ?? 50_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      runAudit(fetcher, { baseUrl: parsed.baseUrl, platform }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline")), deadline)
      }),
    ])
    return { ok: true, result }
  } catch (err) {
    if (err instanceof ScanError) return { ok: false, response: fail(422, "unreachable", `We could not open ${parsed.host}: ${err.message.replace(/^could not reach \S+: ?/, "")}`) }
    if ((err as Error).message === "deadline") return { ok: false, response: fail(504, "timeout", "The website took too long to answer.") }
    return { ok: false, response: fail(500, "failed", "Something went wrong while checking the website.") }
  } finally {
    clearTimeout(timer)
  }
}

export const clearCache = () => cache.clear()
