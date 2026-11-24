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

// ---- the Asker on a client's page -----------------------------------------------------------------

import { ProviderError, type AskProvider } from "../src/asker"

const PROFILE = { name: "Example Shop", aliases: "Ex Shop", city: "Melbourne", areas: "Prahran", categories: "stationery, gifts" }
const TOKEN = "t".repeat(32)

function assistant(answer = "Try Example Shop or Kikki K."): AskProvider & { asked: number } {
  const p = {
    model: "fake", asked: 0,
    async ask() { p.asked++; return answer },
    async complete() { return JSON.stringify({ answers: [] }) },
  }
  return p
}

async function pageWith(deps: Partial<SiteDeps> = {}) {
  const s = setup(deps)
  await call(s.deps, { action: "create", url: "example-shop.com" })
  return s
}

/** What the page does: start a run, ask each question in its own request, then finish. */
async function askAll(deps: SiteDeps) {
  const started = await call(deps, { action: "ask_start", token: TOKEN })
  if (started.status !== 200) return { started }
  const run = started.body["run"]
  const total = Number(started.body["total"])
  const steps = []
  for (let i = 0; i < total; i++) steps.push(await call(deps, { action: "ask_step", token: TOKEN, run, i }))
  const finished = await call(deps, { action: "ask_finish", token: TOKEN, run })
  return { started, steps, finished, run }
}

describe("asking AI assistants", () => {
  it("is off without an assistant, and says so", async () => {
    const { deps } = await pageWith()
    const view = await call(deps, { action: "get", token: TOKEN })
    expect((view.body["asker"] as { enabled: boolean }).enabled).toBe(false)
    for (const action of ["ask_start", "ask_step", "ask_finish"]) {
      const r = await call(deps, { action, token: TOKEN, run: "x", i: 0 })
      expect([r.status, r.body["error"]]).toEqual([503, "asker_off"])
    }
  })

  it("keeps the profile the client typed, cleaned, and refuses an incomplete one", async () => {
    const { deps } = await pageWith({ asker: assistant() })
    const bad = await call(deps, { action: "profile", token: TOKEN, profile: { name: "X" } })
    expect([bad.status, bad.body["error"]]).toEqual([400, "bad_profile"])
    const ok = await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    expect(ok.status).toBe(200)
    expect((ok.body["asker"] as { profile: { aliases: string[]; categories: string[] } }).profile).toMatchObject({ aliases: ["Ex Shop"], categories: ["stationery", "gifts"] })
  })

  it("needs the profile first", async () => {
    const { deps } = await pageWith({ asker: assistant() })
    const r = await call(deps, { action: "ask_start", token: TOKEN })
    expect([r.status, r.body["error"]]).toEqual([400, "no_profile"])
  })

  it("asks a question at a time, keeps the run, and shows how often the business was named", async () => {
    const a = assistant()
    const { deps } = await pageWith({ asker: a })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    const r = await askAll(deps)
    expect(r.started.body["total"]).toBe(6)
    expect(r.steps!.map((s) => s.body["done"])).toEqual([1, 2, 3, 4, 5, 6])
    expect(r.finished!.status).toBe(200)
    const asker = r.finished!.body["asker"] as { latest: { asked: number; answered: number; named: number }; history: unknown[]; enabled: boolean }
    expect([asker.latest.asked, asker.latest.answered, asker.latest.named]).toEqual([6, 6, 6])
    expect(asker.history).toHaveLength(1)
    expect(a.asked).toBe(6)
  })

  it("does not ask the same question twice, and finishing twice gives the same page", async () => {
    const a = assistant()
    const { deps } = await pageWith({ asker: a })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    const r = await askAll(deps)
    await call(deps, { action: "ask_step", token: TOKEN, run: r.run, i: 0 })
    expect([a.asked]).toEqual([6])
    const again = await call(deps, { action: "ask_finish", token: TOKEN, run: r.run })
    expect(again.status).toBe(200)
    expect((again.body["asker"] as { history: unknown[] }).history).toHaveLength(1)
    expect((await call(deps, { action: "ask_step", token: TOKEN, run: r.run, i: 1 })).body["error"]).toBe("run_over")
  })

  it("refuses a step for a run that is not this page's, or a question that does not exist", async () => {
    const { deps } = await pageWith({ asker: assistant() })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    const started = await call(deps, { action: "ask_start", token: TOKEN })
    const run = started.body["run"]
    for (const i of [-1, 6, 1.5, "1", null]) expect((await call(deps, { action: "ask_step", token: TOKEN, run, i })).body["error"]).toBe("bad_step")
    expect((await call(deps, { action: "ask_step", token: TOKEN, run: "nope", i: 0 })).body["error"]).toBe("not_found")
    expect((await call(deps, { action: "ask_step", token: TOKEN, run: 5, i: 0 })).body["error"]).toBe("not_found")
  })

  it("waits between two runs on one page, and across all pages in a day", async () => {
    let t = Date.parse("2026-11-24T00:00:00Z")
    const { deps, store } = await pageWith({ asker: assistant(), now: () => t, askerLimits: { perSiteHours: 12, dailyRuns: 2 } })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    expect((await askAll(deps)).finished!.status).toBe(200)
    t += 3_600_000
    const early = await call(deps, { action: "ask_start", token: TOKEN })
    expect([early.status, early.body["error"], Number(early.headers?.["retry-after"])]).toEqual([429, "asked_recently", 11 * 3600])
    // another page asked too, so the day's allowance (2) is used up
    const other = await store.createSite({ token_hash: "other", url: "https://b.com", host: "b.com", platform: "", name: "b.com" })
    await store.startAskerRun(other.id, { ran_at: new Date(t).toISOString(), questions: ["q"] })
    t += 12 * 3_600_000
    const busy = await call(deps, { action: "ask_start", token: TOKEN })
    expect([busy.status, busy.body["error"]]).toEqual([429, "busy_today"])
    t += 24 * 3_600_000
    expect((await askAll(deps)).finished!.status).toBe(200)
  })

  it("does not start a second run while one is going", async () => {
    const { deps } = await pageWith({ asker: assistant() })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    expect((await call(deps, { action: "ask_start", token: TOKEN })).status).toBe(200)
    const second = await call(deps, { action: "ask_start", token: TOKEN })
    expect([second.status, second.body["error"]]).toEqual([429, "asking_now"])
  })

  it("keeps nothing and says why when no assistant answers, and lets the client try again at once", async () => {
    const quota: AskProvider = { model: "m", ask: async () => { throw new ProviderError("q", "quota") }, complete: async () => "{}" }
    const { deps } = await pageWith({ asker: quota })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    const r = await askAll(deps)
    expect(r.steps!.every((s) => s.body["quota"] === true)).toBe(true)
    expect([r.finished!.status, r.finished!.body["error"]]).toEqual([503, "asker_unavailable"])
    expect(String(r.finished!.body["message"])).toContain("tomorrow")
    const view = await call(deps, { action: "get", token: TOKEN })
    expect((view.body["asker"] as { history: unknown[] }).history).toHaveLength(0)
    // a failed run does not count against the page or the day
    expect((await call(deps, { action: "ask_start", token: TOKEN })).status).toBe(200)
  })

  it("counts a question that takes too long as unanswered and still finishes with the others", async () => {
    let n = 0
    const slowFirst: AskProvider = { model: "m", ask: () => (n++ === 0 ? new Promise(() => {}) : Promise.resolve("Example Shop.")), complete: async () => "{}" }
    const { deps } = await pageWith({ asker: slowFirst, askerStepMs: 30 })
    await call(deps, { action: "profile", token: TOKEN, profile: PROFILE })
    const r = await askAll(deps)
    const asker = r.finished!.body["asker"] as { latest: { asked: number; answered: number; items: { failed: boolean }[] } }
    expect([asker.latest.asked, asker.latest.answered, asker.latest.items[0]!.failed]).toEqual([6, 5, true])
  })
})

describe("the Asker's rows in Supabase", () => {
  it("starts a run, saves answers, finishes it, and reads the finished ones back", async () => {
    const seen: { url: string; method: string; body?: string; prefer?: string }[] = []
    const doFetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
      seen.push({ url, method: init.method ?? "GET", body: init.body, prefer: init.headers?.["prefer"] })
      const out = url.includes("/asker_runs") && init.method === "POST" ? [{ id: "run-1" }] : url.includes("status=eq.running") ? [] : url.endsWith("limit=1") ? [{ ran_at: "t", result: { asked: 6 } }] : []
      return { ok: true, status: 200, text: async () => JSON.stringify(out) }
    }
    const store = supabaseStore("https://p.supabase.co", "K", doFetch)
    await store.setProfile("s1", { name: "N", aliases: [], city: "C", country: "", areas: [], categories: ["x"] })
    expect(await store.startAskerRun("s1", { ran_at: "2026-11-24T00:00:00.000Z", questions: ["q1", "q2"] })).toBe("run-1")
    await store.saveAskerAnswer("run-1", 0, { answer: "a", named: true, failed: false, error: "" })
    await store.finishAskerRun("run-1", "done", { model: "m", asked: 2, answered: 2, named: 1, items: [], rivals: [], readOthers: true, quota: false })
    await store.finishAskerRun("run-2", "failed", null)
    expect((await store.latestAskerRun("s1"))?.result).toEqual({ asked: 6 })
    await store.askerHistory("s1")
    expect(await store.askerRunsSince("2026-11-23T00:00:00.000Z")).toBe(0)
    expect(await store.askerRunningSince("s1", "2026-11-23T00:00:00.000Z")).toBe(false)
    const [prof, start, answer, done, failed, latest, history, since, running] = seen
    expect(prof).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/profiles?on_conflict=site_id" })
    expect(JSON.parse(start!.body!)).toMatchObject({ site_id: "s1", status: "running", asked: 2, answered: 0, result: { questions: ["q1", "q2"] } })
    expect(answer).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/asker_answers?on_conflict=run_id,idx" })
    expect(done).toMatchObject({ method: "PATCH", url: "https://p.supabase.co/rest/v1/asker_runs?id=eq.run-1" })
    expect(JSON.parse(done!.body!)).toMatchObject({ status: "done", asked: 2, answered: 2, named: 1, model: "m" })
    expect(JSON.parse(failed!.body!)).toEqual({ status: "failed" })
    expect(latest!.url).toContain("asker_runs?site_id=eq.s1&status=eq.done&select=ran_at,result&order=ran_at.desc&limit=1")
    expect(history!.url).toContain("status=eq.done&select=ran_at,asked,answered,named&order=ran_at.asc")
    expect(since!.url).toContain("status=in.(running,done)&ran_at=gte.2026-11-23T00%3A00%3A00.000Z")
    expect(running!.url).toContain("status=eq.running&ran_at=gte.")
  })

  it("rebuilds a run from its row and its answers", async () => {
    const doFetch = async (url: string) => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(url.includes("/asker_runs") ? [{ id: "r", status: "running", ran_at: "t", result: { questions: ["a", "b"] } }] : [{ idx: 1, answer: "x", named: false, failed: false, error: "" }]),
    })
    const state = await supabaseStore("https://p.supabase.co", "K", doFetch).askerRunState("s1", "r")
    expect(state).toEqual({ id: "r", status: "running", ran_at: "t", questions: ["a", "b"], answers: { 1: { answer: "x", named: false, failed: false, error: "" } } })
  })
})
