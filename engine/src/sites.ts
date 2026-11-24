/**
 * A page per website: the client enters an address, we keep the scans, the state of every fix and a private link.
 *
 * What is stored lives behind `SiteStore`. In production it is Supabase (a Postgres database) reached over its REST
 * interface with a key only the server has; in tests it is memory. The link is the only key to the page, so only a
 * hash of it is stored: someone who reads the database cannot open anyone's page.
 */
import { createHash, randomBytes } from "node:crypto"
import { fail, MemoryLimiter, parseAddress, PLATFORMS, scanAddress, type ApiResponse, type Deps, type Limiter } from "./api"
import type { AuditResult } from "./audit"
import { ProfileError, runAsker, validateProfile, type AskProvider, type AskerResult, type Profile } from "./asker"
import { buildGuide, type Guide } from "./guide"
import { BY_ID } from "./registry"

export const FIX_STATES = ["open", "self", "asked_fixer"] as const
export type FixState = (typeof FIX_STATES)[number]

export interface SiteRow {
  id: string
  token_hash: string
  url: string
  host: string
  platform: string
  name: string
  created_at: string
}

export interface ScanSummary {
  scanned_at: string
  score: number | null
  label: string
}

export interface AskerSummary {
  ran_at: string
  asked: number
  answered: number
  named: number
}

export interface SiteStore {
  createSite(site: Omit<SiteRow, "id" | "created_at">): Promise<SiteRow>
  findSite(tokenHash: string): Promise<SiteRow | null>
  addScan(siteId: string, scan: { scanned_at: string; score: number | null; label: string; result: unknown }): Promise<void>
  /** the newest scan with everything in it */
  latestScan(siteId: string): Promise<{ scanned_at: string; result: AuditResult } | null>
  /** the first scan, as the "before" */
  firstScan(siteId: string): Promise<(ScanSummary & { gaps: string[] }) | null>
  history(siteId: string): Promise<ScanSummary[]>
  setFixState(siteId: string, checkId: string, state: FixState): Promise<void>
  fixStates(siteId: string): Promise<Record<string, FixState>>
  getProfile(siteId: string): Promise<Profile | null>
  setProfile(siteId: string, profile: Profile): Promise<void>
  addAskerRun(siteId: string, run: { ran_at: string; result: AskerResult }): Promise<void>
  latestAskerRun(siteId: string): Promise<{ ran_at: string; result: AskerResult } | null>
  /** every run, oldest first, without the answers */
  askerHistory(siteId: string): Promise<AskerSummary[]>
  /** how many runs, for all sites, started at or after this time */
  askerRunsSince(isoTime: string): Promise<number>
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")
export const newToken = () => randomBytes(24).toString("base64url")

// ---- memory (tests, and local trials) ------------------------------------------------------------

export function memoryStore(): SiteStore {
  const sites: SiteRow[] = []
  const scans = new Map<string, { scanned_at: string; score: number | null; label: string; result: AuditResult }[]>()
  const states = new Map<string, Record<string, FixState>>()
  const profiles = new Map<string, Profile>()
  const runs: { site: string; ran_at: string; result: AskerResult }[] = []
  return {
    async createSite(site) {
      const row = { ...site, id: `site-${sites.length + 1}`, created_at: new Date().toISOString() }
      sites.push(row)
      return row
    },
    async findSite(hash) {
      return sites.find((s) => s.token_hash === hash) ?? null
    },
    async addScan(siteId, scan) {
      const list = scans.get(siteId) ?? []
      list.push({ ...scan, result: scan.result as AuditResult })
      scans.set(siteId, list)
    },
    async latestScan(siteId) {
      const last = scans.get(siteId)?.at(-1)
      return last ? { scanned_at: last.scanned_at, result: last.result } : null
    },
    async firstScan(siteId) {
      const first = scans.get(siteId)?.[0]
      return first ? { scanned_at: first.scanned_at, score: first.score, label: first.label, gaps: first.result.gaps } : null
    },
    async history(siteId) {
      return (scans.get(siteId) ?? []).map(({ scanned_at, score, label }) => ({ scanned_at, score, label }))
    },
    async setFixState(siteId, checkId, state) {
      states.set(siteId, { ...(states.get(siteId) ?? {}), [checkId]: state })
    },
    async fixStates(siteId) {
      return { ...(states.get(siteId) ?? {}) }
    },
    async getProfile(siteId) {
      return profiles.get(siteId) ?? null
    },
    async setProfile(siteId, profile) {
      profiles.set(siteId, profile)
    },
    async addAskerRun(siteId, run) {
      runs.push({ site: siteId, ...run })
    },
    async latestAskerRun(siteId) {
      const last = runs.filter((r) => r.site === siteId).at(-1)
      return last ? { ran_at: last.ran_at, result: last.result } : null
    },
    async askerHistory(siteId) {
      return runs.filter((r) => r.site === siteId).map(({ ran_at, result }) => ({ ran_at, asked: result.asked, answered: result.answered, named: result.named }))
    },
    async askerRunsSince(isoTime) {
      return runs.filter((r) => r.ran_at >= isoTime).length
    },
  }
}

// ---- Supabase over its REST interface -------------------------------------------------------------

/** The storage said no. `detail` is safe to show: the status and PostgREST's error code, never the key. */
export class StoreError extends Error {
  constructor(message: string, readonly detail: string = "") {
    super(message)
  }
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** The tables are in supabase/schema.sql. `key` is the service role key: it stays on the server. */
export function supabaseStore(baseUrl: string, key: string, doFetch: FetchLike = fetch as unknown as FetchLike): SiteStore {
  const root = `${baseUrl.replace(/\/+$/, "")}/rest/v1`
  // The older service_role key is a JWT and is also sent as the bearer. The newer sb_secret_ keys are not JWTs: they
  // go in the apikey header alone, and the gateway turns them into the service role itself.
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" }
  if (!key.startsWith("sb_")) headers["authorization"] = `Bearer ${key}`
  const call = async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
    const res = await doFetch(`${root}/${path}`, {
      method: init.method ?? "GET",
      headers: { ...headers, ...(init.prefer ? { prefer: init.prefer } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    if (!res.ok) {
      let code = ""
      try {
        code = String((JSON.parse(text) as { code?: unknown }).code ?? "")
      } catch {
        /* not JSON */
      }
      throw new StoreError(`storage answered ${res.status}`, `supabase ${res.status}${code ? ` ${code.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 20)}` : ""}`)
    }
    return text ? JSON.parse(text) : null
  }
  const eq = (v: string) => encodeURIComponent(v)
  return {
    async createSite(site) {
      const rows = await call("sites", { method: "POST", body: site, prefer: "return=representation" })
      return (rows as SiteRow[])[0] as SiteRow
    },
    async findSite(hash) {
      const rows = (await call(`sites?token_hash=eq.${eq(hash)}&select=*&limit=1`)) as SiteRow[]
      return rows[0] ?? null
    },
    async addScan(siteId, scan) {
      await call("scans", { method: "POST", body: { site_id: siteId, ...scan }, prefer: "return=minimal" })
    },
    async latestScan(siteId) {
      const rows = (await call(`scans?site_id=eq.${eq(siteId)}&select=scanned_at,result&order=scanned_at.desc&limit=1`)) as { scanned_at: string; result: AuditResult }[]
      return rows[0] ?? null
    },
    async firstScan(siteId) {
      const rows = (await call(`scans?site_id=eq.${eq(siteId)}&select=scanned_at,score,label,gaps:result->gaps&order=scanned_at.asc&limit=1`)) as (ScanSummary & { gaps: string[] })[]
      return rows[0] ?? null
    },
    async history(siteId) {
      return (await call(`scans?site_id=eq.${eq(siteId)}&select=scanned_at,score,label&order=scanned_at.asc&limit=60`)) as ScanSummary[]
    },
    async setFixState(siteId, checkId, state) {
      await call("fix_states?on_conflict=site_id,check_id", {
        method: "POST", body: { site_id: siteId, check_id: checkId, state, updated_at: new Date().toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      })
    },
    async fixStates(siteId) {
      const rows = (await call(`fix_states?site_id=eq.${eq(siteId)}&select=check_id,state`)) as { check_id: string; state: FixState }[]
      return Object.fromEntries(rows.map((r) => [r.check_id, r.state]))
    },
    async getProfile(siteId) {
      const rows = (await call(`profiles?site_id=eq.${eq(siteId)}&select=name,aliases,city,country,areas,categories&limit=1`)) as Profile[]
      return rows[0] ?? null
    },
    async setProfile(siteId, profile) {
      await call("profiles?on_conflict=site_id", {
        method: "POST", body: { site_id: siteId, ...profile, updated_at: new Date().toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      })
    },
    async addAskerRun(siteId, run) {
      const { asked, answered, named } = run.result
      await call("asker_runs", { method: "POST", body: { site_id: siteId, ran_at: run.ran_at, model: run.result.model, asked, answered, named, result: run.result }, prefer: "return=minimal" })
    },
    async latestAskerRun(siteId) {
      const rows = (await call(`asker_runs?site_id=eq.${eq(siteId)}&select=ran_at,result&order=ran_at.desc&limit=1`)) as { ran_at: string; result: AskerResult }[]
      return rows[0] ?? null
    },
    async askerHistory(siteId) {
      return (await call(`asker_runs?site_id=eq.${eq(siteId)}&select=ran_at,asked,answered,named&order=ran_at.asc&limit=60`)) as AskerSummary[]
    },
    async askerRunsSince(isoTime) {
      const rows = (await call(`asker_runs?ran_at=gte.${eq(isoTime)}&select=id&limit=100`)) as unknown[]
      return rows.length
    },
  }
}

/** Supabase when both settings are present, otherwise nothing (the page then falls back to a plain check). */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): SiteStore | null {
  const url = env["SUPABASE_URL"]
  const key = env["SUPABASE_SERVICE_ROLE_KEY"]
  return url && key ? supabaseStore(url, key) : null
}

// ---- the service -----------------------------------------------------------------------------------

export interface SiteRequest {
  action: unknown
  url?: unknown
  platform?: unknown
  token?: unknown
  check_id?: unknown
  state?: unknown
  profile?: unknown
  client: string
}

export interface SiteDeps extends Deps {
  store?: SiteStore | null
  createLimiter?: Limiter
  rescanLimiter?: Limiter
  token?: () => string
  /** the AI that answers shoppers' questions; without it the Asker is off */
  asker?: AskProvider | null
  /** hours a page must wait between two runs, and how many runs all pages together may start in 24 hours */
  askerLimits?: { perSiteHours: number; dailyRuns: number }
  askConcurrency?: number
}

const defaultCreate = new MemoryLimiter(5, 60 * 60_000)
const defaultRescan = new MemoryLimiter(6, 10 * 60_000)

type Scan = { scanned_at: string; result: AuditResult }

/** What the page needs. The raw requests made during the scan and the prepared code are left out of `latest`. */
async function viewOf(store: SiteStore, site: SiteRow, scan: Scan, askerOn = false) {
  const [first, history, states, profile, askerRun, askerHistory] = await Promise.all([
    store.firstScan(site.id), store.history(site.id), store.fixStates(site.id),
    store.getProfile(site.id), store.latestAskerRun(site.id), store.askerHistory(site.id),
  ])
  const { fetches: _fetches, fix_drafts: drafts, ...latest } = scan.result as AuditResult & { fix_drafts?: Record<string, Record<string, unknown>> }
  const passing = new Set(latest.checks.filter((c) => c.result === "pass").map((c) => c.id))
  const guides: Record<string, Guide> = {}
  for (const fix of latest.fixes) {
    if (fix.status === "platform_held") continue
    const g = buildGuide(fix.check_id, site.platform, drafts?.[fix.check_id])
    if (g) guides[fix.check_id] = g
  }
  return {
    site: { host: site.host, url: site.url, platform: site.platform, name: site.name, created_at: site.created_at },
    latest,
    baseline: first,
    history,
    states,
    // gaps in the first scan that now pass: found by the check itself, whoever did the work
    done: (first?.gaps ?? []).filter((id) => passing.has(id)),
    guides,
    asker: { enabled: askerOn, profile, latest: askerRun ? { ran_at: askerRun.ran_at, ...askerRun.result } : null, history: askerHistory },
  }
}

export async function handleSite(req: SiteRequest, deps: SiteDeps = {}): Promise<ApiResponse> {
  const store = deps.store
  if (!store) return fail(503, "storage_off", "Saving a page for your website is not switched on yet.")
  const now = deps.now ?? Date.now
  try {
    if (req.action === "create") {
      const parsed = parseAddress(req.url)
      if (!parsed.ok) return fail(400, "bad_address", parsed.message)
      const platformRaw = typeof req.platform === "string" ? req.platform.toLowerCase() : ""
      if (platformRaw && !(PLATFORMS as readonly string[]).includes(platformRaw)) return fail(400, "bad_platform", "Choose a platform from the list.")
      const platform = platformRaw === "other" ? "" : platformRaw
      const taken = (deps.createLimiter ?? defaultCreate).take(req.client, now())
      if (!taken.ok) return fail(429, "too_many", "Too many pages from your address. Try again later.", { "retry-after": String(taken.retryAfterSeconds) })
      const scanned = await scanAddress(parsed, platform, deps)
      if (!scanned.ok) return scanned.response
      const token = (deps.token ?? newToken)()
      const site = await store.createSite({ token_hash: hashToken(token), url: parsed.baseUrl, host: parsed.host, platform, name: parsed.host })
      await store.addScan(site.id, { scanned_at: scanned.result.scanned_at, score: scanned.result.score, label: scanned.result.label, result: scanned.result })
      return { status: 200, body: { token, ...(await viewOf(store, site, { scanned_at: scanned.result.scanned_at, result: scanned.result }, Boolean(deps.asker))) } }
    }

    if (typeof req.token !== "string" || req.token.length < 20 || req.token.length > 200) return fail(404, "not_found", "This page does not exist.")
    const hash = hashToken(req.token)
    const site = await store.findSite(hash)
    if (!site) return fail(404, "not_found", "This page does not exist.")

    if (req.action === "get") {
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, Boolean(deps.asker)) }
    }
    if (req.action === "rescan") {
      const taken = (deps.rescanLimiter ?? defaultRescan).take(hash, now())
      if (!taken.ok) return fail(429, "too_many", "You checked a moment ago. Try again in a few minutes.", { "retry-after": String(taken.retryAfterSeconds) })
      const scanned = await scanAddress({ baseUrl: site.url, host: site.host }, site.platform, deps)
      if (!scanned.ok) return scanned.response
      await store.addScan(site.id, { scanned_at: scanned.result.scanned_at, score: scanned.result.score, label: scanned.result.label, result: scanned.result })
      return { status: 200, body: await viewOf(store, site, { scanned_at: scanned.result.scanned_at, result: scanned.result }, Boolean(deps.asker)) }
    }
    if (req.action === "fix") {
      if (typeof req.check_id !== "string" || !BY_ID[req.check_id]) return fail(400, "bad_check", "Unknown item.")
      if (typeof req.state !== "string" || !(FIX_STATES as readonly string[]).includes(req.state)) return fail(400, "bad_state", "Unknown choice.")
      await store.setFixState(site.id, req.check_id, req.state as FixState)
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, Boolean(deps.asker)) }
    }
    if (req.action === "profile") {
      let profile: Profile
      try {
        profile = validateProfile(req.profile)
      } catch (err) {
        if (err instanceof ProfileError) return fail(400, "bad_profile", err.message)
        throw err
      }
      await store.setProfile(site.id, profile)
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, Boolean(deps.asker)) }
    }
    if (req.action === "ask") {
      if (!deps.asker) return fail(503, "asker_off", "Asking AI assistants is not switched on yet.")
      const profile = await store.getProfile(site.id)
      if (!profile) return fail(400, "no_profile", "Tell us about your business first.")
      const limits = deps.askerLimits ?? { perSiteHours: 12, dailyRuns: 3 }
      const at = now()
      const last = (await store.askerHistory(site.id)).at(-1)
      if (last) {
        const wait = new Date(last.ran_at).getTime() + limits.perSiteHours * 3_600_000 - at
        if (wait > 0) return fail(429, "asked_recently", "You asked a little while ago. Come back later to ask again.", { "retry-after": String(Math.ceil(wait / 1000)) })
      }
      if ((await store.askerRunsSince(new Date(at - 24 * 3_600_000).toISOString())) >= limits.dailyRuns) {
        return fail(429, "busy_today", "A lot of people asked today. Try again tomorrow.")
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        runAsker(profile, deps.asker, deps.askConcurrency ?? 3),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("deadline")), deps.deadlineMs ?? 52_000)
        }),
      ]).finally(() => clearTimeout(timer))
      if (result.answered === 0) {
        return fail(503, "asker_unavailable", result.quota ? "The AI assistants are not answering more questions today. Try again tomorrow." : "The AI assistants did not answer. Try again in a moment.")
      }
      await store.addAskerRun(site.id, { ran_at: new Date(at).toISOString(), result })
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, true) }
    }
    return fail(400, "bad_action", "Unknown request.")
  } catch (err) {
    if ((err as Error).message === "deadline") return fail(504, "timeout", "The AI assistants took too long to answer. Try again in a moment.")
    if (err instanceof StoreError) {
      const res = fail(502, "storage", "We could not reach the place where pages are kept. Try again in a moment.")
      return { ...res, body: { ...res.body, detail: err.detail } }
    }
    return fail(500, "failed", "Something went wrong.")
  }
}
