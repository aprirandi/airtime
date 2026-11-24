export type Tier = "essential" | "recommended" | "bonus"
export type CheckResult = "pass" | "partial" | "fail" | "na" | "planned"
export type Lang = "en" | "id"

/** One stored result: what a check found on the site. */
export interface Row {
  check_id: string
  group: number
  tier: Tier
  result: CheckResult
  percent: number
  scored: boolean
  controlled_by: string
  evidence: string
}

export interface RegistryCheck {
  id: string
  group: number
  tier: Tier
  source: "is_agentic" | "cloudflare" | "both"
  effort: "easy" | "medium" | "hard"
  status: "built" | "planned" | "na"
  name: string
  name_id: string
  fix: string
  fix_id: string
  na_reason: string
  na_reason_id: string
  controlled: Record<string, { en: string; id: string }>
  platform_fix: Record<string, { en: string; id: string }>
  verify: { command: string; en: string; id: string } | null
  external_id: string
  ask: { en: string; id: string } | null
}

export interface Registry {
  groups: Record<string, { en: string; id: string }>
  checks: RegistryCheck[]
}
