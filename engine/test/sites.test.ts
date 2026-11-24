import { beforeEach, describe, expect, it } from "vitest"
import replay from "./replay.json"
import { clearCache, MemoryLimiter } from "../src/api"
import { buildGuide, scriptTag } from "../src/guide"
import { Response, type Fetcher } from "../src/http"
import { handleSite, hashToken, memoryStore, newToken, storeFromEnv, supabaseStore, type SiteDeps, type SiteStore } from "../src/sites"

// Two recorded sites on shop.test: a good one (scenario 0) and a weaker one. The address typed is example-shop.com.
const bodies = replay.bodies as Record<string, string>
const serve = (n: number): Fetcher => {
  const byKey = new Map(replay.scenarios[n]!.calls.map((c) => [`${c.url}|${c.accept}|${c.ua}`, c]))
  return async (rawUrl, o) => {
    const url = rawUrl.replace("example-shop.com", "shop.test")
    const c = byKey.get(`${url}|${o?.headers?.["Accept"] ?? ""}|${o?.userAgent ?? ""}`)
    if (!c) return new Response(url, { status: 404, finalUrl: url })
    return new Response(c.url, {
      status: c.status, finalUrl: c.final_url, headers: c.headers as Record<string, string>,
      body: new Uint8Array(Buffer.from(bodies[c.body] as string, "base64")), chain: c.chain as [number, string][], error: c.error,
    })
  }
}
const weakest = replay.scenarios.map((s, i) => [s.expected.score.score as number, i] as const).sort((a, b) => a[0] - b[0])[0]![1]
const best = replay.scenarios.map((s, i) => [s.expected.score.score as number, i] as const).sort((a, b) => b[0] - a[0])[0]![1]

function setup(overrides: Partial<SiteDeps> = {}) {
  const store = memoryStore()
  let site = serve(weakest)
  const deps: SiteDeps = {
    store, fetcher: (u, o) => site(u, o), createLimiter: new MemoryLimiter(100), rescanLimiter: new MemoryLimiter(100),
    token: () => "t".repeat(32), ...overrides,
  }
  return { store, deps, switchTo: (n: number) => (site = serve(n)) }
}
const call = (deps: SiteDeps, body: Record<string, unknown>) => handleSite({ client: "9.9.9.9", ...body } as never, deps)

beforeEach(() => clearCache())

describe("a page for a website", () => {
  it("is not available when nothing can store it", async () => {
    const r = await call({ fetcher: serve(0) }, { action: "create", url: "example-shop.com" })
    expect(r.status).toBe(503)
    expect(r.body["error"]).toBe("storage_off")
  })

  it("is created from an address, scanned, and opened with a private link", async () => {
    const { deps, store } = setup()
    const r = await call(deps, { action: "create", url: "example-shop.com", platform: "wordpress" })
    expect(r.status).toBe(200)
    expect(r.body["token"]).toBe("t".repeat(32))
    expect((r.body["site"] as { host: string }).host).toBe("example-shop.com")
    expect((r.body["latest"] as { checks: unknown[] }).checks.length).toBe(37)
    expect(Object.keys(r.body["latest"] as object)).not.toContain("fetches")
    expect(Object.keys(r.body["latest"] as object)).not.toContain("fix_drafts")
    expect(r.body["done"]).toEqual([])
    // the link itself is never stored, only its hash
    const stored = await store.findSite(hashToken("t".repeat(32)))
    expect(stored?.token_hash).toBe(hashToken("t".repeat(32)))
    expect(JSON.stringify(stored)).not.toContain("t".repeat(32))
    const again = await call(deps, { action: "get", token: "t".repeat(32) })
    expect(again.status).toBe(200)
    expect((again.body["latest"] as { score: number }).score).toBe((r.body["latest"] as { score: number }).score)
  })

  it("answers the same way for a wrong link as for a missing one", async () => {
    const { deps } = setup()
    for (const token of ["x".repeat(32), "short", 123, undefined, "y".repeat(500)]) {
      const r = await call(deps, { action: "get", token })
      expect([r.status, r.body["error"]]).toEqual([404, "not_found"])
    }
  })

  it("refuses bad addresses and platforms and limits how many pages one visitor makes", async () => {
    const { deps } = setup({ createLimiter: new MemoryLimiter(1) })
    expect((await call(deps, { action: "create", url: "localhost" })).body["error"]).toBe("bad_address")
    expect((await call(deps, { action: "create", url: "example-shop.com", platform: "nope" })).body["error"]).toBe("bad_platform")
    expect((await call(deps, { action: "create", url: "example-shop.com" })).status).toBe(200)
    const second = await call(deps, { action: "create", url: "example-shop.com" })
    expect([second.status, second.headers?.["retry-after"] !== undefined]).toEqual([429, true])
  })

  it("keeps the first scan as the before and finds fixes by the checks, whoever did the work", async () => {
    const { deps, switchTo } = setup()
    const first = await call(deps, { action: "create", url: "example-shop.com" })
    const gaps = (first.body["latest"] as { gaps: string[] }).gaps
    expect(gaps.length).toBeGreaterThan(0)
    switchTo(best) // the site was improved
    const second = await call(deps, { action: "rescan", token: "t".repeat(32) })
    expect(second.status).toBe(200)
    const baseline = second.body["baseline"] as { score: number; gaps: string[] }
    expect(baseline.gaps).toEqual(gaps)
    expect(baseline.score).toBe((first.body["latest"] as { score: number }).score)
    expect((second.body["history"] as unknown[]).length).toBe(2)
    const nowGaps = (second.body["latest"] as { gaps: string[] }).gaps
    const fixed = gaps.filter((g) => !nowGaps.includes(g))
    expect((second.body["done"] as string[]).sort()).toEqual(fixed.sort())
    expect(fixed.length).toBeGreaterThan(0)
  })

  it("limits how often a page is checked again", async () => {
    const { deps } = setup({ rescanLimiter: new MemoryLimiter(1) })
    await call(deps, { action: "create", url: "example-shop.com" })
    expect((await call(deps, { action: "rescan", token: "t".repeat(32) })).status).toBe(200)
    expect((await call(deps, { action: "rescan", token: "t".repeat(32) })).status).toBe(429)
  })

  it("remembers what the client chose for an item, and refuses unknown items and choices", async () => {
    const { deps } = setup()
    const made = await call(deps, { action: "create", url: "example-shop.com" })
    const first = (made.body["latest"] as { gaps: string[] }).gaps[0] as string
    const set = await call(deps, { action: "fix", token: "t".repeat(32), check_id: first, state: "self" })
    expect((set.body["states"] as Record<string, string>)[first]).toBe("self")
    const back = await call(deps, { action: "fix", token: "t".repeat(32), check_id: first, state: "open" })
    expect((back.body["states"] as Record<string, string>)[first]).toBe("open")
    expect((await call(deps, { action: "fix", token: "t".repeat(32), check_id: "nope", state: "self" })).body["error"]).toBe("bad_check")
    expect((await call(deps, { action: "fix", token: "t".repeat(32), check_id: first, state: "done" })).body["error"]).toBe("bad_state")
    expect((await call(deps, { action: "dance", token: "t".repeat(32) })).body["error"]).toBe("bad_action")
  })

  it("gives a how-to for every item the client can act on and none for what the platform holds", async () => {
    const { deps } = setup()
    const r = await call(deps, { action: "create", url: "example-shop.com", platform: "shopify" })
    const latest = r.body["latest"] as { fixes: { check_id: string; status: string }[] }
    const guides = r.body["guides"] as Record<string, { steps: unknown[] }>
    for (const f of latest.fixes) {
      if (f.status === "platform_held") expect(guides[f.check_id]).toBeUndefined()
      else expect(guides[f.check_id]?.steps.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("turns a failure of the storage into a calm message, not a crash", async () => {
    const { deps, store } = setup()
    const broken: SiteStore = { ...store, findSite: async () => { throw new (await import("../src/sites")).StoreError("x") } }
    const r = await call({ ...deps, store: broken }, { action: "get", token: "t".repeat(32) })
    expect([r.status, r.body["error"]]).toEqual([502, "storage"])
  })
})

describe("the how-to", () => {
  it("adds the prepared code, with the right place to paste it for the platform", () => {
    const draft = { "@context": "https://schema.org", "@type": "Organization", name: "</script><b>x" }
    const wp = buildGuide("organization_completeness", "wordpress", draft)!
    const shop = buildGuide("organization_completeness", "shopify", draft)!
    expect(wp.steps.map((s) => s.en).join(" ")).toContain("Yoast")
    expect(shop.steps.map((s) => s.en).join(" ")).toContain("theme.liquid")
    expect(wp.code?.text.startsWith('<script type="application/ld+json">')).toBe(true)
    // text from a page cannot close the tag early
    expect(wp.code?.text.match(/<\/script>/g)?.length).toBe(1)
    expect(scriptTag(draft)).toContain("\\u003c/script>")
    expect(wp.steps.at(-1)?.en).toContain("Re-check")
  })
  it("has a guide for every check that is built, and none for an unknown one", () => {
    expect(buildGuide("robots_txt", "")?.steps.length).toBeGreaterThanOrEqual(2)
    expect(buildGuide("no_such_check", "")).toBeNull()
    expect(buildGuide("sitemap", "")?.code).toBeUndefined()
  })
})

describe("Supabase over its REST interface", () => {
  type Seen = { url: string; method: string; headers: Record<string, string>; body?: string }
  function fake(answers: (seen: Seen) => unknown) {
    const seen: Seen[] = []
    const doFetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
      const s = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body }
      seen.push(s)
      const out = answers(s)
      return { ok: out !== "error", status: out === "error" ? 500 : 200, text: async () => (out === null || out === "error" ? "" : JSON.stringify(out)) }
    }
    return { seen, doFetch }
  }

  it("sends the key only in headers and stores only the hash of the link", async () => {
    const f = fake(() => [{ id: "uuid-1", token_hash: "h", url: "https://x.com", host: "x.com", platform: "", name: "x.com", created_at: "now" }])
    const store = supabaseStore("https://proj.supabase.co/", "SECRET", f.doFetch)
    const row = await store.createSite({ token_hash: hashToken("abc"), url: "https://x.com", host: "x.com", platform: "", name: "x.com" })
    expect(row.id).toBe("uuid-1")
    const s = f.seen[0]!
    expect(s.url).toBe("https://proj.supabase.co/rest/v1/sites")
    expect(s.headers["apikey"]).toBe("SECRET")
    expect(s.headers["authorization"]).toBe("Bearer SECRET")
    expect(s.url).not.toContain("SECRET")
    expect(s.body).toContain(hashToken("abc"))
    expect(s.body).not.toContain('"abc"')
  })

  it("reads the newest scan, the first scan's gaps and the choices with the queries the tables need", async () => {
    const f = fake((s) => (s.url.includes("fix_states") ? [{ check_id: "sitemap", state: "self" }] : s.url.includes("limit=1") ? [{ scanned_at: "t", result: { gaps: ["a"] }, gaps: ["a"], score: 1, label: "x" }] : [{ scanned_at: "t", score: 1, label: "x" }]))
    const store = supabaseStore("https://proj.supabase.co", "K", f.doFetch)
    expect((await store.latestScan("id 1"))?.result).toEqual({ gaps: ["a"] })
    expect((await store.firstScan("id 1"))?.gaps).toEqual(["a"])
    expect(await store.history("id 1")).toHaveLength(1)
    expect(await store.fixStates("id 1")).toEqual({ sitemap: "self" })
    const urls = f.seen.map((s) => s.url)
    expect(urls[0]).toContain("scans?site_id=eq.id%201&select=scanned_at,result&order=scanned_at.desc&limit=1")
    expect(urls[1]).toContain("select=scanned_at,score,label,gaps:result->gaps&order=scanned_at.asc&limit=1")
  })

  it("saves a choice as an upsert on the item", async () => {
    const f = fake(() => null)
    await supabaseStore("https://p.supabase.co", "K", f.doFetch).setFixState("s1", "sitemap", "asked_fixer")
    const s = f.seen[0]!
    expect([s.method, s.url]).toEqual(["POST", "https://p.supabase.co/rest/v1/fix_states?on_conflict=site_id,check_id"])
    expect(s.headers["prefer"]).toContain("resolution=merge-duplicates")
    expect(JSON.parse(s.body!)).toMatchObject({ site_id: "s1", check_id: "sitemap", state: "asked_fixer" })
  })

  it("raises a storage error when Supabase answers with a failure", async () => {
    const store = supabaseStore("https://p.supabase.co", "K", fake(() => "error").doFetch)
    await expect(store.findSite("h")).rejects.toThrow("storage answered 500")
  })

  it("sends a new sb_secret_ key in the apikey header alone, and the older JWT key as the bearer too", async () => {
    const a = fake(() => [])
    await supabaseStore("https://p.supabase.co", "sb_secret_abc", a.doFetch).findSite("h")
    expect(a.seen[0]!.headers["apikey"]).toBe("sb_secret_abc")
    expect(a.seen[0]!.headers["authorization"]).toBeUndefined()
    const b = fake(() => [])
    await supabaseStore("https://p.supabase.co", "eyJhbGciOi.payload.sig", b.doFetch).findSite("h")
    expect(b.seen[0]!.headers["authorization"]).toBe("Bearer eyJhbGciOi.payload.sig")
  })

  it("says which status and error code came back, never the key", async () => {
    const doFetch = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.sites'" }) })
    const store = supabaseStore("https://p.supabase.co", "SECRETKEY", doFetch)
    const r = await handleSite({ action: "get", token: "t".repeat(32), client: "c" } as never, { store })
    expect([r.status, r.body["error"], r.body["detail"]]).toEqual([502, "storage", "supabase 404 PGRST205"])
    expect(JSON.stringify(r.body)).not.toContain("SECRETKEY")
  })

  it("is used only when both settings exist", () => {
    expect(storeFromEnv({})).toBeNull()
    expect(storeFromEnv({ SUPABASE_URL: "https://p.supabase.co" })).toBeNull()
    expect(storeFromEnv({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).not.toBeNull()
  })

  it("makes links that cannot be guessed", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken))
    expect(tokens.size).toBe(200)
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(30)
  })
})
