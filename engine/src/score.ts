/**
 * Turn check results into a score. Same rules as the Python engine (airtime/agents/auditor/score.py):
 * essential checks are worth up to 80 points, recommended up to 20, bonus up to 5 more without lowering the
 * score. A partial check earns its percentage. Checks that do not apply or are planned are left out. A check
 * the platform controls still counts: the platform only decides who can fix it.
 */
import { TIERS } from "./registry"
import type { Row, Tier } from "./types"

const POOLS: Record<string, number> = { essential: 80, recommended: 20 }
const BONUS_CAP = 5
const STRONG = 80
const NEEDS_WORK = 60
const SCORED = ["pass", "partial", "fail"]

/**
 * Python's round(x, 1): the nearest tenth of the exact value, and on an exact tie (only x.25 and x.75 can be one
 * in binary) the even tenth. toFixed(1) rounds the exact value too, but sends ties up.
 */
export function round1(x: number): number {
  const frac = Math.abs(x) - Math.floor(Math.abs(x))
  if (frac === 0.25 || frac === 0.75) {
    const tenths = Math.floor(x * 10)
    return (tenths % 2 === 0 ? tenths : tenths + 1) / 10
  }
  return Number(x.toFixed(1))
}

/** Python's round(x) for the group percentages. */
function round0(x: number): number {
  const floor = Math.floor(x)
  if (x - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1
  return Math.round(x)
}

export function fraction(r: Row): number {
  if (r.result === "pass") return 1
  return r.result === "partial" ? r.percent / 100 : 0
}

const scoredRows = (rows: Row[]) => rows.filter((r) => r.scored && SCORED.includes(r.result))

export function labelFor(score: number | null): "none" | "strong" | "needs_work" | "blockers" {
  if (score === null) return "none"
  return score >= STRONG ? "strong" : score >= NEEDS_WORK ? "needs_work" : "blockers"
}

interface TierEntry {
  total: number
  passing: number
  partial: number
  failed: number
  available?: number
  earned?: number
  points?: number
  positive?: number
}

export interface ScoreResult {
  score: number | null
  label: ReturnType<typeof labelFor>
  tiers: Record<Tier, TierEntry>
  groups: Record<string, {
    percent: number | null
    scored: number
    passing: number
    partial: number
    failed: number
    platform_controlled: number
    planned: number
  }>
}

export function scoreRows(rows: Row[]): ScoreResult {
  const scored = scoredRows(rows)
  const tiers = {} as Record<Tier, TierEntry>
  let baseEarned = 0
  let baseAvailable = 0
  for (const tier of TIERS) {
    const mine = scored.filter((r) => r.tier === tier)
    const total = mine.length
    const frac = mine.reduce((a, r) => a + fraction(r), 0)
    const entry: TierEntry = {
      total,
      passing: mine.filter((r) => r.result === "pass").length,
      partial: mine.filter((r) => r.result === "partial").length,
      failed: mine.filter((r) => r.result === "fail").length,
    }
    if (tier === "bonus") {
      entry.points = total ? round1((BONUS_CAP * frac) / total) : 0
      entry.positive = entry.passing + entry.partial
    } else {
      const pool = POOLS[tier] as number
      entry.available = total ? pool : 0
      entry.earned = total ? round1((pool * frac) / total) : 0
      baseEarned += total ? (pool * frac) / total : 0
      baseAvailable += total ? pool : 0
    }
    tiers[tier] = entry
  }
  let score: number | null = null
  if (baseAvailable) score = round1(Math.min(100, (100 * baseEarned) / baseAvailable + (tiers.bonus.points as number)))

  const groups: ScoreResult["groups"] = {}
  for (const g of [1, 2, 3]) {
    const inGroup = rows.filter((r) => r.group === g)
    const mine = scored.filter((r) => r.group === g)
    groups[String(g)] = {
      percent: mine.length ? round0((100 * mine.reduce((a, r) => a + fraction(r), 0)) / mine.length) : null,
      scored: mine.length,
      passing: mine.filter((r) => r.result === "pass").length,
      partial: mine.filter((r) => r.result === "partial").length,
      failed: mine.filter((r) => r.result === "fail").length,
      platform_controlled: inGroup.filter((r) => r.controlled_by && SCORED.includes(r.result)).length,
      planned: inGroup.filter((r) => r.result === "planned").length,
    }
  }
  return { score, label: labelFor(score), tiers, groups }
}

function ordered(found: Row[]): Row[] {
  const order = (t: Tier) => TIERS.indexOf(t)
  return [...found].sort(
    (a, b) =>
      order(a.tier) - order(b.tier) || a.group - b.group || a.percent - b.percent || (a.check_id < b.check_id ? -1 : a.check_id > b.check_id ? 1 : 0)
  )
}

/** The gaps the owner can fix, most important first. */
export const gaps = (rows: Row[]) =>
  ordered(scoredRows(rows).filter((r) => (r.result === "fail" || r.result === "partial") && !r.controlled_by))

/** Gaps that count against the score but that the platform controls. */
export const limitedGaps = (rows: Row[]) =>
  ordered(scoredRows(rows).filter((r) => (r.result === "fail" || r.result === "partial") && r.controlled_by))

export function coverage(rows: Row[]) {
  return {
    implemented: rows.filter((r) => [...SCORED, "na"].includes(r.result) && r.group !== 4).length,
    planned: rows.filter((r) => r.result === "planned").map((r) => r.check_id),
    not_applicable: rows.filter((r) => r.group === 4).map((r) => r.check_id),
    platform_controlled: rows.filter((r) => r.controlled_by).map((r) => r.check_id),
  }
}
