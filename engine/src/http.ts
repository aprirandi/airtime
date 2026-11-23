/**
 * HTTP fetching for the Auditor. Every request goes through one function, `fetcher(url, {headers, userAgent})`,
 * so tests can replay recorded pages. The real one follows redirects by hand so the chain is recorded, caps
 * the body size, and refuses hosts that are, or resolve to, private or local addresses: the Auditor follows
 * links found on a customer's site, and a public form that takes any address must never reach our own network.
 * The address is checked at the moment the connection is made, so a name cannot change its answer in between.
 */
import dns from "node:dns"
import net from "node:net"
import { Agent, fetch as undiciFetch } from "undici"

export const USER_AGENT = "AirtimeAuditor/1.0 (+https://github.com/aprirandi/airtime)"
export const MAX_BYTES = 1_500_000
export const MAX_HOPS = 6
const REDIRECTS = new Set([301, 302, 303, 307, 308])

const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

export class Response {
  url: string
  status: number
  finalUrl: string
  headers: Record<string, string>
  body: Uint8Array
  chain: [number, string][]
  error: string | null
  truncated: boolean

  constructor(url: string, init: Partial<Omit<Response, "text" | "ok" | "contentType">> = {}) {
    this.url = url
    this.status = init.status ?? 0
    this.finalUrl = init.finalUrl ?? ""
    this.headers = init.headers ?? {}
    this.body = init.body ?? new Uint8Array()
    this.chain = init.chain ?? []
    this.error = init.error ?? null
    this.truncated = init.truncated ?? false
  }

  private cached?: string
  get text(): string {
    return (this.cached ??= decoder.decode(this.body))
  }
  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }
  header(name: string): string {
    return this.headers[name.toLowerCase()] ?? ""
  }
  get contentType(): string {
    return (this.header("content-type").split(";")[0] ?? "").trim().toLowerCase()
  }
  /** Small, JSON-safe description kept as evidence. The body itself is not stored. */
  summary() {
    return {
      url: this.url,
      status: this.status,
      final_url: this.finalUrl || this.url,
      content_type: this.contentType,
      bytes: this.body.length,
      hops: this.chain.length,
      error: this.error,
    }
  }
}

export interface FetchOptions {
  headers?: Record<string, string>
  userAgent?: string
}
export type Fetcher = (url: string, options?: FetchOptions) => Promise<Response>

/** True for addresses that must never be reached: private, loopback, link-local, reserved, multicast, unspecified. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.split("%")[0] ?? address
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number]
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === "::" || v === "::1") return true
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1] as string)
    return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
      v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff") || v.startsWith("2001:db8")
  }
  return true // not an address at all: refuse
}

/** The connection's own DNS lookup: it answers only with public addresses. */
const publicLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (...a: unknown[]) => void
  const opts = typeof options === "function" ? {} : (options as dns.LookupOptions)
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err)
    const list = addresses as dns.LookupAddress[]
    const allowed = list.filter((a) => !isPrivateAddress(a.address))
    if (!allowed.length || allowed.length !== list.length) {
      return cb(Object.assign(new Error(`refused: ${hostname} is not a public address`), { code: "EPRIVATE" }))
    }
    if (opts.all) return cb(null, allowed)
    const first = allowed[0] as dns.LookupAddress
    return cb(null, first.address, first.family)
  })
}) as typeof dns.lookup

export interface HttpFetcherOptions {
  timeoutMs?: number
  allowPrivate?: boolean
}

export function httpFetcher({ timeoutMs = 15_000, allowPrivate = false }: HttpFetcherOptions = {}): Fetcher {
  const dispatcher = new Agent(allowPrivate ? {} : { connect: { lookup: publicLookup } })

  return async (url, { headers, userAgent } = {}) => {
    const chain: [number, string][] = []
    let current = url
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      let parsed: URL
      try {
        parsed = new URL(current)
      } catch {
        return new Response(url, { finalUrl: current, chain, error: `unsupported URL: ${current.slice(0, 80)}` })
      }
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
        return new Response(url, { finalUrl: current, chain, error: `unsupported URL: ${current.slice(0, 80)}` })
      }
      const bare = parsed.hostname.replace(/^\[|\]$/g, "")
      if (!allowPrivate && net.isIP(bare) && isPrivateAddress(bare)) {
        return new Response(url, { finalUrl: current, chain, error: `refused: ${bare} is not a public address` })
      }
      let res: Awaited<ReturnType<typeof undiciFetch>>
      try {
        res = await undiciFetch(current, {
          redirect: "manual",
          headers: { "User-Agent": userAgent ?? USER_AGENT, Accept: "*/*", ...(headers ?? {}) },
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher,
        })
      } catch (err) {
        const cause = (err as { cause?: { message?: string } }).cause
        const message = cause?.message ?? (err as Error).message
        return new Response(url, { finalUrl: current, chain, error: `${(err as Error).name}: ${message}`.slice(0, 200) })
      }
      const out: Record<string, string> = {}
      res.headers.forEach((value, name) => {
        out[name.toLowerCase()] = value
      })
      const location = out["location"]
      if (REDIRECTS.has(res.status) && location) {
        await res.body?.cancel().catch(() => undefined)
        chain.push([res.status, current])
        current = new URL(location, current).href
        continue
      }
      const body = await readCapped(res)
      return new Response(url, {
        status: res.status,
        finalUrl: current,
        headers: out,
        body: body.bytes.slice(0, MAX_BYTES),
        chain,
        truncated: body.bytes.length > MAX_BYTES,
      })
    }
    return new Response(url, { finalUrl: current, chain, error: "too many redirects" })
  }
}

async function readCapped(res: Awaited<ReturnType<typeof undiciFetch>>): Promise<{ bytes: Uint8Array }> {
  if (!res.body) return { bytes: new Uint8Array() }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size <= MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
  } catch {
    /* a body cut off by the network: keep what was read */
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES + 1))
  let offset = 0
  for (const c of chunks) {
    if (offset >= bytes.length) break
    bytes.set(c.subarray(0, bytes.length - offset), offset)
    offset += c.length
  }
  return { bytes }
}
