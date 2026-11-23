import { beforeEach, describe, expect, it } from "vitest"
import replay from "./replay.json"
import { clearCache, handleAudit, MemoryLimiter, parseAddress } from "../src/api"
import { Response, type Fetcher } from "../src/http"

// A fetcher that serves one recorded site (the first replay scenario, a good site on shop.test).
const scenario = replay.scenarios[0]!
const bodies = replay.bodies as Record<string, string>
const byKey = new Map(scenario.calls.map((c) => [`${c.url}|${c.accept}|${c.ua}`, c]))
// The recorded site lives at shop.test, which is not a name the service accepts, so the address typed below is
// "example-shop.com" and the fetcher answers it from the recording.
const site: Fetcher = async (rawUrl, o) => {
  const url = rawUrl.replace("example-shop.com", "shop.test")
  const c = byKey.get(`${url}|${o?.headers?.["Accept"] ?? ""}|${o?.userAgent ?? ""}`)
  if (!c) return new Response(url, { status: 404, finalUrl: url })
  return new Response(c.url, {
    status: c.status, finalUrl: c.final_url, headers: c.headers as Record<string, string>,
    body: new Uint8Array(Buffer.from(bodies[c.body] as string, "base64")), chain: c.chain as [number, string][], error: c.error,
  })
}
const down: Fetcher = async (url) => new Response(url, { error: "ConnectionRefusedError" })

beforeEach(() => clearCache())

describe("what counts as a website address", () => {
  it.each([
    ["handworks.com.au", "https://handworks.com.au"],
    ["  https://www.handworks.com.au/products/x?y=1  ", "https://www.handworks.com.au"],
    ["HTTP://Example.COM", "http://example.com"],
    ["https://example.com:443/", "https://example.com"],
    ["https://xn--bcher-kva.example.org", "https://xn--bcher-kva.example.org"],
  ])("accepts %s", (raw, base) => {
    const p = parseAddress(raw)
    expect(p.ok && p.baseUrl).toBe(base)
  })

  it.each([
    [123], [null], [""], ["   "], ["a".repeat(301)], ["localhost"], ["http://localhost:3000"], ["127.0.0.1"], ["http://10.0.0.5/admin"],
    ["http://[::1]/"], ["https://169.254.169.254/latest/meta-data"], ["ftp://example.com"], ["file:///etc/passwd"],
    ["javascript:alert(1)"], ["https://user:pass@example.com"], ["https://example.com:8080"], ["https://example.com:22"],
    ["intranet"], ["printer.local"], ["https://foo.internal"], ["not a url"], ["https://exa mple.com"], ["https://example."],
  ])("refuses %j", (raw) => expect(parseAddress(raw).ok).toBe(false))
})

describe("the service", () => {
  it("audits a site and returns the result with its prompts", async () => {
    const r = await handleAudit({ url: "example-shop.com", platform: "shopify", client: "1.1.1.1" }, { fetcher: site })
    expect(r.status).toBe(200)
    expect(r.body["target"]).toBe("https://shop.test")
    expect(r.body["engine"]).toBe("airtime-auditor/2")
    expect(typeof r.body["score"]).toBe("number")
    expect((r.body["checks"] as unknown[]).length).toBe(37)
    expect(r.body["cached"]).toBe(false)
  })

  it("returns the same result from memory for the same site and platform, without a new scan", async () => {
    let calls = 0
    const counting: Fetcher = (u, o) => (calls++, site(u, o))
    const first = await handleAudit({ url: "example-shop.com", client: "a" }, { fetcher: counting })
    const used = calls
    const second = await handleAudit({ url: "https://example-shop.com/other", client: "b" }, { fetcher: counting })
    expect(calls).toBe(used)
    expect(second.body["cached"]).toBe(true)
    expect(second.body["score"]).toBe(first.body["score"])
    await handleAudit({ url: "example-shop.com", platform: "shopify", client: "a" }, { fetcher: counting })
    expect(calls).toBeGreaterThan(used) // another platform is another scan
  })

  it("limits how often one visitor can scan", async () => {
    const limiter = new MemoryLimiter(2, 60_000)
    let t = 1000
    const deps = { fetcher: site, limiter, now: () => t }
    expect((await handleAudit({ url: "a.test.com", client: "x" }, deps)).status).toBe(200)
    expect((await handleAudit({ url: "b.test.com", client: "x" }, deps)).status).toBe(200)
    const third = await handleAudit({ url: "c.test.com", client: "x" }, deps)
    expect(third.status).toBe(429)
    expect(Number(third.headers?.["retry-after"])).toBeGreaterThan(0)
    expect((await handleAudit({ url: "c.test.com", client: "y" }, deps)).status).toBe(200) // someone else is not limited
    t += 61_000
    expect((await handleAudit({ url: "d.test.com", client: "x" }, deps)).status).toBe(200)
  })

  it("does not count a cached answer or a refused address against the limit", async () => {
    const limiter = new MemoryLimiter(1, 60_000)
    const deps = { fetcher: site, limiter }
    await handleAudit({ url: "bad address", client: "x" }, deps)
    expect((await handleAudit({ url: "example-shop.com", client: "x" }, deps)).status).toBe(200)
    expect((await handleAudit({ url: "example-shop.com", client: "x" }, deps)).status).toBe(200) // from memory
  })

  it("says plainly when the site cannot be opened", async () => {
    const r = await handleAudit({ url: "nowhere.example.org", client: "x" }, { fetcher: down })
    expect(r.status).toBe(422)
    expect(r.body["error"]).toBe("unreachable")
    expect(String(r.body["message"])).toContain("nowhere.example.org")
  })

  it("gives up when a site is too slow", async () => {
    const slow: Fetcher = () => new Promise(() => undefined)
    const r = await handleAudit({ url: "slow.example.org", client: "x" }, { fetcher: slow, deadlineMs: 50 })
    expect(r.status).toBe(504)
  })

  it("refuses an unknown platform and a bad address before doing anything", async () => {
    let calls = 0
    const f: Fetcher = (u, o) => (calls++, site(u, o))
    expect((await handleAudit({ url: "example-shop.com", platform: "joomla", client: "x" }, { fetcher: f })).status).toBe(400)
    expect((await handleAudit({ url: "10.0.0.1", client: "x" }, { fetcher: f })).status).toBe(400)
    expect(calls).toBe(0)
  })
})
