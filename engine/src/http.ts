/**
 * HTTP fetching for the Auditor. Every request goes through one function, `fetcher(url, {headers, userAgent})`,
 * so tests can replay recorded pages. The real one follows redirects by hand so the chain is recorded, caps
 * the body size, and refuses hosts that are, or resolve to, private or local addresses: the Auditor follows
 * links found on a customer's site, and a public form that takes any address must never reach our own network.
 * The address is checked at the moment the connection is made, so a name cannot change its answer in between.
 */
import dns from "node:dns"
import net from "node:net"
import { Agent, request } from "undici"

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
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number]
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // only 192.0.0.0/24 and 192.0.2.0/24: 192.0.66.x and 192.0.78.x are public
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
      a >= 224
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
      let res: Awaited<ReturnType<typeof request>>
      try {
        // request(), not fetch(): it sends only the headers given here, as the Python engine does. fetch() adds its
        // own (accept-language, accept-encoding), which can change what a site serves, such as the shop currency.
        res = await request(current, {
          method: "GET",
          headers: { "user-agent": userAgent ?? USER_AGENT, accept: "*/*", ...lowercased(headers) },
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher,
        })
      } catch (err) {
        const cause = (err as { cause?: { message?: string } }).cause
        const message = cause?.message ?? (err as Error).message
        return new Response(url, { finalUrl: current, chain, error: `${(err as Error).name}: ${message}`.slice(0, 200) })
      }
      res.body.on("error", () => undefined) // destroying a body we no longer need reports an abort: that is expected
      const out: Record<string, string> = {}
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value)
      }
      const location = out["location"]
      if (REDIRECTS.has(res.statusCode) && location) {
        res.body.destroy()
        chain.push([res.statusCode, current])
        current = new URL(location, current).href
        continue
      }
      const body = await readCapped(res.body)
      return new Response(url, {
        status: res.statusCode,
        finalUrl: current,
        headers: out,
        body: body.slice(0, MAX_BYTES),
        chain,
        truncated: body.length > MAX_BYTES,
      })
    }
    return new Response(url, { finalUrl: current, chain, error: "too many redirects" })
  }
}

const lowercased = (h?: Record<string, string>) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]))

/** Read a body, stopping once it is over the cap (one byte over is enough to know it was cut). */
async function readCapped(stream: AsyncIterable<Uint8Array> & { destroy: (e?: Error) => unknown }): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      chunks.push(chunk)
      size += chunk.length
      if (size > MAX_BYTES) break
    }
  } catch {
    /* a body cut off by the network: keep what was read */
  } finally {
    stream.destroy()
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES + 1))
  let offset = 0
  for (const c of chunks) {
    if (offset >= bytes.length) break
    bytes.set(c.subarray(0, bytes.length - offset), offset)
    offset += c.length
  }
  return bytes
}
