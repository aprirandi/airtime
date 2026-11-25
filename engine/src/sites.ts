/**
 * A page per website: the client enters an address, we keep the scans, the state of every fix and a private link.
 *
 * What is stored lives behind `SiteStore`. In production it is Supabase (a Postgres database) reached over its REST
 * interface with a key only the server has; in tests it is memory. The link is the only key to the page, so only a
 * hash of it is stored: someone who reads the database cannot open anyone's page.
 */
import { businessCard } from "./package"
import { createHash, randomBytes } from "node:crypto"
import { fail, MemoryLimiter, parseAddress, PLATFORMS, scanAddress, type ApiResponse, type Deps, type Limiter } from "./api"
import type { AuditResult } from "./audit"
import { askQuestion, buildQuestions, finishRun, inferCategories, ProfileError, validateProfile, type Answered, type AskProvider, type AskerResult, type Profile } from "./asker"
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

export interface AskerRunState {
  id: string
  status: "running" | "done" | "failed"
  ran_at: string
  questions: string[]
  answers: Record<number, Answered>
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
  /** A run is asked a question at a time, each in its own request: it starts, collects answers, then finishes. */
  startAskerRun(siteId: string, run: { ran_at: string; questions: string[] }): Promise<string>
  saveAskerAnswer(runId: string, idx: number, answer: Answered): Promise<void>
  askerRunState(siteId: string, runId: string): Promise<AskerRunState | null>
  finishAskerRun(runId: string, status: "done" | "failed", result: AskerResult | null): Promise<void>
  /** is a run of this site still going that started at or after this time */
  askerRunningSince(siteId: string, isoTime: string): Promise<boolean>
  /** the newest finished run */
  latestAskerRun(siteId: string): Promise<{ ran_at: string; result: AskerResult } | null>
  /** every finished run, oldest first, without the answers */
  askerHistory(siteId: string): Promise<AskerSummary[]>
  /** how many runs, finished or still going, for all sites, started at or after this time */
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
  const runs: { id: string; site: string; ran_at: string; status: "running" | "done" | "failed"; questions: string[]; result: AskerResult | null }[] = []
  const answers = new Map<string, Record<number, Answered>>()
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
    async startAskerRun(siteId, run) {
      const id = `run-${runs.length + 1}`
      runs.push({ id, site: siteId, ran_at: run.ran_at, status: "running", questions: run.questions, result: null })
      return id
    },
    async saveAskerAnswer(runId, idx, answer) {
      answers.set(runId, { ...(answers.get(runId) ?? {}), [idx]: answer })
    },
    async askerRunState(siteId, runId) {
      const r = runs.find((x) => x.id === runId && x.site === siteId)
      return r ? { id: r.id, status: r.status, ran_at: r.ran_at, questions: r.questions, answers: { ...(answers.get(runId) ?? {}) } } : null
    },
    async finishAskerRun(runId, status, result) {
      const r = runs.find((x) => x.id === runId)
      if (r) Object.assign(r, { status, result })
    },
    async askerRunningSince(siteId, isoTime) {
      return runs.some((r) => r.site === siteId && r.status === "running" && r.ran_at >= isoTime)
    },
    async latestAskerRun(siteId) {
      const last = runs.filter((r) => r.site === siteId && r.status === "done").at(-1)
      return last?.result ? { ran_at: last.ran_at, result: last.result } : null
    },
    async askerHistory(siteId) {
      return runs.filter((r) => r.site === siteId && r.status === "done" && r.result).map((r) => ({ ran_at: r.ran_at, asked: r.result!.asked, answered: r.result!.answered, named: r.result!.named }))
    },
    async askerRunsSince(isoTime) {
      return runs.filter((r) => r.status !== "failed" && r.ran_at >= isoTime).length
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
    async startAskerRun(siteId, run) {
      const rows = (await call("asker_runs", {
        method: "POST", prefer: "return=representation",
        body: { site_id: siteId, ran_at: run.ran_at, status: "running", asked: run.questions.length, answered: 0, named: 0, result: { questions: run.questions } },
      })) as { id: string }[]
      return (rows[0] as { id: string }).id
    },
    async saveAskerAnswer(runId, idx, a) {
      await call("asker_answers?on_conflict=run_id,idx", { method: "POST", body: { run_id: runId, idx, answer: a.answer, named: a.named, failed: a.failed, error: a.error }, prefer: "resolution=merge-duplicates,return=minimal" })
    },
    async askerRunState(siteId, runId) {
      const runs = (await call(`asker_runs?id=eq.${eq(runId)}&site_id=eq.${eq(siteId)}&select=id,status,ran_at,result&limit=1`)) as { id: string; status: AskerRunState["status"]; ran_at: string; result: { questions?: string[] } }[]
      const r = runs[0]
      if (!r) return null
      const rows = (await call(`asker_answers?run_id=eq.${eq(runId)}&select=idx,answer,named,failed,error`)) as (Answered & { idx: number })[]
      return { id: r.id, status: r.status, ran_at: r.ran_at, questions: r.result?.questions ?? [], answers: Object.fromEntries(rows.map(({ idx, ...a }) => [idx, a])) }
    },
    async finishAskerRun(runId, status, result) {
      await call(`asker_runs?id=eq.${eq(runId)}`, {
        method: "PATCH", prefer: "return=minimal",
        body: result ? { status, asked: result.asked, answered: result.answered, named: result.named, model: result.model, result } : { status },
      })
    },
    async askerRunningSince(siteId, isoTime) {
      const rows = (await call(`asker_runs?site_id=eq.${eq(siteId)}&status=eq.running&ran_at=gte.${eq(isoTime)}&select=id&limit=1`)) as unknown[]
      return rows.length > 0
    },
    async latestAskerRun(siteId) {
      const rows = (await call(`asker_runs?site_id=eq.${eq(siteId)}&status=eq.done&select=ran_at,result&order=ran_at.desc&limit=1`)) as { ran_at: string; result: AskerResult }[]
      return rows[0] ?? null
    },
    async askerHistory(siteId) {
      return (await call(`asker_runs?site_id=eq.${eq(siteId)}&status=eq.done&select=ran_at,asked,answered,named&order=ran_at.asc&limit=60`)) as AskerSummary[]
    },
    async askerRunsSince(isoTime) {
      const rows = (await call(`asker_runs?status=in.(running,done)&ran_at=gte.${eq(isoTime)}&select=id&limit=100`)) as unknown[]
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
  run?: unknown
  i?: unknown
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
  /** how long one question, or the reading of the answers, may take before it counts as failed */
  askerStepMs?: number
}

const defaultCreate = new MemoryLimiter(5, 60 * 60_000)
const defaultRescan = new MemoryLimiter(6, 10 * 60_000)

type Scan = { scanned_at: string; result: AuditResult }

/** The score of the newest scan made at or before this time (the first scan when there is none that early). */
function scoreAt(scans: ScanSummary[], time: string): number | null {
  const at = new Date(time).getTime()
  const before = scans.filter((s) => new Date(s.scanned_at).getTime() <= at)
  return (before.at(-1) ?? scans[0])?.score ?? null
}

/** What the page needs. The raw requests made during the scan and the prepared code are left out of `latest`. */
async function viewOf(store: SiteStore, site: SiteRow, scan: Scan, asking: { on: boolean; hours: number } = { on: false, hours: 12 }) {
  const [first, history, states, profile, askerRun, askerHistory] = await Promise.all([
    store.firstScan(site.id), store.history(site.id), store.fixStates(site.id),
    store.getProfile(site.id), store.latestAskerRun(site.id), store.askerHistory(site.id),
  ])
  const { fetches: _fetches, fix_drafts: drafts, profile_hint: hint, site_summary: _summary, ...latest } = scan.result as AuditResult & {
    fix_drafts?: Record<string, Record<string, unknown>>
    profile_hint?: { name: string; city: string; country: string; areas: string[] }
    site_summary?: unknown
  }
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
    // what the Fixer hands over for the business card when no access is given: a package to install by hand
    business_card: businessCard(site.platform, drafts, latest.fixes),
    hint: hint ?? null,
    asker: {
      enabled: asking.on, perSiteHours: asking.hours, profile,
      latest: askerRun ? { ran_at: askerRun.ran_at, ...askerRun.result } : null,
      // each time we asked, with the score the website had then, so the two can be read side by side
      history: askerHistory.map((h) => ({ ...h, audit_score: scoreAt(history, h.ran_at) })),
    },
  }
}

export async function handleSite(req: SiteRequest, deps: SiteDeps = {}): Promise<ApiResponse> {
  const store = deps.store
  if (!store) return fail(503, "storage_off", "Saving a page for your website is not switched on yet.")
  const now = deps.now ?? Date.now
  const asking = { on: Boolean(deps.asker), hours: deps.askerLimits?.perSiteHours ?? 12 }
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
      return { status: 200, body: { token, ...(await viewOf(store, site, { scanned_at: scanned.result.scanned_at, result: scanned.result }, asking)) } }
    }

    if (typeof req.token !== "string" || req.token.length < 20 || req.token.length > 200) return fail(404, "not_found", "This page does not exist.")
    const hash = hashToken(req.token)
    const site = await store.findSite(hash)
    if (!site) return fail(404, "not_found", "This page does not exist.")

    if (req.action === "get") {
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, asking) }
    }
    if (req.action === "rescan") {
      const taken = (deps.rescanLimiter ?? defaultRescan).take(hash, now())
      if (!taken.ok) return fail(429, "too_many", "You checked a moment ago. Try again in a few minutes.", { "retry-after": String(taken.retryAfterSeconds) })
      const scanned = await scanAddress({ baseUrl: site.url, host: site.host }, site.platform, deps)
      if (!scanned.ok) return scanned.response
      await store.addScan(site.id, { scanned_at: scanned.result.scanned_at, score: scanned.result.score, label: scanned.result.label, result: scanned.result })
      return { status: 200, body: await viewOf(store, site, { scanned_at: scanned.result.scanned_at, result: scanned.result }, asking) }
    }
    if (req.action === "fix") {
      if (typeof req.check_id !== "string" || !BY_ID[req.check_id]) return fail(400, "bad_check", "Unknown item.")
      if (typeof req.state !== "string" || !(FIX_STATES as readonly string[]).includes(req.state)) return fail(400, "bad_state", "Unknown choice.")
      await store.setFixState(site.id, req.check_id, req.state as FixState)
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      return { status: 200, body: await viewOf(store, site, scan, asking) }
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
      return { status: 200, body: await viewOf(store, site, scan, asking) }
    }
    // Asking is done a question at a time, each in its own request, because one answer from an assistant can take
    // many seconds and a whole run in one request would not fit in the time a function is allowed to run.
    if (req.action === "ask_start") {
      if (!deps.asker) return fail(503, "asker_off", "Asking AI assistants is not switched on yet.")
      let profile = await store.getProfile(site.id)
      const limits = deps.askerLimits ?? { perSiteHours: 12, dailyRuns: 3 }
      const at = now()
      const last = (await store.askerHistory(site.id)).at(-1)
      if (last) {
        const wait = new Date(last.ran_at).getTime() + limits.perSiteHours * 3_600_000 - at
        if (wait > 0) return fail(429, "asked_recently", "You asked a little while ago. Come back later to ask again.", { "retry-after": String(Math.ceil(wait / 1000)) })
      }
      if (await store.askerRunningSince(site.id, new Date(at - 4 * 60_000).toISOString())) return fail(429, "asking_now", "We are already asking. Wait a minute.")
      if ((await store.askerRunsSince(new Date(at - 24 * 3_600_000).toISOString())) >= limits.dailyRuns) {
        return fail(429, "busy_today", "A lot of people asked today. Try again tomorrow.")
      }
      // No form: who and where the business is comes from its own pages, and what it sells is read from its homepage
      if (!profile) {
        const scan = await store.latestScan(site.id)
        const found = scan?.result as (AuditResult & { profile_hint?: { name: string; city: string; country: string; areas: string[] }; site_summary?: Parameters<typeof inferCategories>[0] }) | undefined
        const hint = found?.profile_hint
        const categories = hint?.city && found?.site_summary ? await inferCategories(found.site_summary, hint.name, deps.asker) : []
        if (hint?.city && categories.length) {
          profile = validateProfile({ name: hint.name, city: hint.city, country: hint.country, areas: hint.areas, categories })
          await store.setProfile(site.id, profile)
        } else {
          return { status: 400, body: { error: "need_profile", message: "We could not tell where your business is or what it sells. Tell us, and we will ask.", hint: { name: hint?.name ?? site.host, city: hint?.city ?? "", country: hint?.country ?? "", areas: hint?.areas ?? [], categories } } }
        }
      }
      const questions = buildQuestions(profile)
      const run = await store.startAskerRun(site.id, { ran_at: new Date(at).toISOString(), questions })
      return { status: 200, body: { run, total: questions.length, profile } }
    }
    if (req.action === "ask_step" || req.action === "ask_finish") {
      if (!deps.asker) return fail(503, "asker_off", "Asking AI assistants is not switched on yet.")
      const state = typeof req.run === "string" && req.run.length <= 80 ? await store.askerRunState(site.id, req.run) : null
      if (!state) return fail(404, "not_found", "This run does not exist.")
      const profile = await store.getProfile(site.id)
      if (!profile) return fail(400, "no_profile", "Tell us about your business first.")
      const stepMs = deps.askerStepMs ?? 52_000
      const within = <T>(job: Promise<T>, onTimeout: T): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        return Promise.race([job, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(onTimeout), stepMs)))]).finally(() => clearTimeout(timer))
      }

      if (req.action === "ask_step") {
        if (state.status !== "running") return fail(409, "run_over", "This run is over.")
        const i = req.i
        if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= state.questions.length) return fail(400, "bad_step", "Unknown question.")
        let last: Answered | undefined
        if (!state.answers[i]) {
          const timedOut: Answered = { answer: "", named: false, failed: true, error: "rate", detail: "no answer within the time allowed" }
          const answer = await within(askQuestion(deps.asker, state.questions[i] as string, profile), timedOut)
          await store.saveAskerAnswer(state.id, i, answer)
          state.answers[i] = answer
          last = answer
        }
        return {
          status: 200,
          body: {
            done: Object.keys(state.answers).length, total: state.questions.length, quota: Object.values(state.answers).some((a) => a.error === "quota"),
            // how this question went, so a run that gets no answers can be told apart from one that is only slow
            answered: last ? !last.failed : Boolean(state.answers[i] && !state.answers[i]!.failed), detail: last?.detail ?? "",
          },
        }
      }

      // ask_finish
      const scan = await store.latestScan(site.id)
      if (!scan) return fail(404, "not_found", "This page does not exist.")
      if (state.status === "done") return { status: 200, body: await viewOf(store, site, scan, { ...asking, on: true }) }
      if (state.status === "failed") return fail(409, "run_over", "This run is over.")
      const answers = state.questions.map((_, i) => state.answers[i] ?? { answer: "", named: false, failed: true, error: "other" as const })
      const noReading: AskProvider = { model: deps.asker.model, ask: deps.asker.ask, complete: async () => { throw new Error("no time") } }
      const result = await within(finishRun(profile, state.questions, answers, deps.asker), await finishRun(profile, state.questions, answers, noReading))
      if (result.answered === 0) {
        await store.finishAskerRun(state.id, "failed", null)
        return fail(503, "asker_unavailable", result.quota ? "The AI assistants are not answering more questions today. Try again tomorrow." : "The AI assistants did not answer. Try again in a moment.")
      }
      await store.finishAskerRun(state.id, "done", result)
      return { status: 200, body: await viewOf(store, site, scan, { ...asking, on: true }) }
    }
    return fail(400, "bad_action", "Unknown request.")
  } catch (err) {
    if (err instanceof StoreError) {
      const res = fail(502, "storage", "We could not reach the place where pages are kept. Try again in a moment.")
      return { ...res, body: { ...res.body, detail: err.detail } }
    }
    return fail(500, "failed", "Something went wrong.")
  }
}
