/**
 * One audit, start to finish: fetch the pages, run every check, score, list the gaps and write the fix prompts.
 * The result has the same shape as the Python engine's export, so the website draws it with the same code.
 */
import { CHECKS, type Outcome } from "./checks"
import type { Fetcher } from "./http"
import { allPrompt, fixPrompt } from "./prompts"
import { REGISTRY } from "./registry"
import { coverage, gaps, limitedGaps, scoreRows } from "./score"
import { buildFixes, fixDrafts, profileHint, llmsText, siteName, siteSummary } from "./fixer"
import { collect, type ScanConfig, type Snapshot } from "./snapshot"
import type { RegistryCheck, Row } from "./types"

export const ENGINE = "airtime-auditor/2"

export interface StoredRow extends Row {
  source: string
  details: Record<string, unknown>
}

function runOne(id: string, snapshot: Snapshot): Outcome {
  try {
    return (CHECKS[id] as (s: Snapshot) => Outcome)(snapshot)
  } catch (err) {
    // a crashing check is our bug: record it, never blame the site
    return { result: "na", percent: 0, evidence: "The check could not run.", details: { error: `${(err as Error).name}: ${(err as Error).message}`.slice(0, 200) } }
  }
}

/** One result. A platform-controlled check is scored like any other; controlled_by marks that the owner cannot fix it. */
export function buildRow(d: RegistryCheck, outcome: Outcome | null, platform: string): StoredRow {
  const base = { check_id: d.id, group: d.group, tier: d.tier, source: d.source }
  if (d.group === 4) return { ...base, result: "na", percent: 0, evidence: d.na_reason, details: {}, controlled_by: "", scored: false }
  if (d.status !== "built" || !outcome) return { ...base, result: "planned", percent: 0, evidence: "", details: {}, controlled_by: "", scored: false }
  const controlled = platform in d.controlled ? platform : ""
  return { ...base, result: outcome.result, percent: outcome.percent, evidence: outcome.evidence, details: outcome.details, controlled_by: controlled, scored: outcome.result !== "na" }
}

export function rowsFor(snapshot: Snapshot, platform: string): StoredRow[] {
  return REGISTRY.checks.map((d) => buildRow(d, d.status === "built" && d.group !== 4 ? runOne(d.id, snapshot) : null, platform))
}

export interface AuditOptions extends ScanConfig {
  scannedAt?: string
}

export async function runAudit(fetch: Fetcher, options: AuditOptions) {
  const snapshot = await collect(fetch, options)
  const rows = rowsFor(snapshot, options.platform)
  const result = scoreRows(rows)
  const platform = options.platform
  const target = snapshot.base
  const scannedAt = options.scannedAt ?? new Date().toISOString()
  const fixable = gaps(rows)
  const limited = limitedGaps(rows)
  const gapRows = fixable.map((g) => ({ check_id: g.check_id, tier: g.tier, evidence: g.evidence, details: (g as StoredRow).details }))
  const byId = Object.fromEntries(REGISTRY.checks.map((c) => [c.id, c]))
  const gapIds = new Set(fixable.map((g) => g.check_id))

  const checks = rows.map((r) => {
    const d = byId[r.check_id] as RegistryCheck
    const hint = d.platform_fix[platform]
    const controlled = r.controlled_by ? d.controlled[r.controlled_by] : undefined
    const gap = gapRows.find((g) => g.check_id === r.check_id)
    return {
      id: r.check_id, group: r.group, tier: r.tier, source: r.source, effort: d.effort, result: r.result, percent: r.percent, scored: r.scored,
      name: d.name, name_id: d.name_id, evidence: r.evidence, fix: d.fix, fix_id: d.fix_id,
      platform_fix: hint?.en ?? "", platform_fix_id: hint?.id ?? "",
      controlled_by: r.controlled_by, controlled_note: controlled?.en ?? "", controlled_note_id: controlled?.id ?? "",
      details: r.details,
      prompt: gap && gapIds.has(r.check_id) ? fixPrompt(r.check_id, gap, target, platform, "en") : "",
      prompt_id: gap && gapIds.has(r.check_id) ? fixPrompt(r.check_id, gap, target, platform, "id") : "",
      external: null,
    }
  })
  const scanned = scannedAt.slice(0, 10)
  return {
    engine: ENGINE, scanned_at: scannedAt, target, platform,
    score: result.score, label: result.label, breakdown: result.tiers, groups: result.groups,
    group_names: REGISTRY.groups, coverage: coverage(rows), checks,
    gaps: fixable.map((g) => g.check_id), limited_gaps: limited.map((g) => g.check_id),
    fixes: buildFixes(rows, platform, snapshot, siteName(snapshot)),
    fix_drafts: fixDrafts(rows, snapshot, siteName(snapshot)),
    profile_hint: profileHint(snapshot),
    llms_draft: llmsText(snapshot, siteName(snapshot)),
    site_summary: siteSummary(snapshot),
    prompt_all: allPrompt(gapRows, target, platform, "en", scanned),
    prompt_all_id: allPrompt(gapRows, target, platform, "id", scanned),
    fetches: snapshot.fetches.map((f) => f.summary()),
  }
}

export type AuditResult = Awaited<ReturnType<typeof runAudit>>
