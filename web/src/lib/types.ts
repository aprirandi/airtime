// Shapes of docs/data/*.json, written by airtime/export.py.

export type StepKind = "AI" | "CODE"

export interface Step {
  step: number | string
  name: string
  agent?: string
  kind: StepKind
  status: "ok" | "failed" | string
  started_at?: string
  finished_at?: string
  error?: string
  description: string
  description_id?: string
  result?: Record<string, unknown>
}

export type CheckResult = "pass" | "partial" | "fail" | "na" | "planned"

export interface ExternalIssue {
  id: string
  name: string
  tier: "essential" | "recommended" | "bonus"
  result: "failed" | "partial"
  details: string
  recommendation: string
  kind: "mapped" | "api_product" | "extra"
  maps_to: string
}

export interface ExternalReport {
  source: "is-agentic"
  status: "ok" | "unavailable"
  error: string
  fetched_at: string
  report_url: string
  score: number | null
  label: string
  scanned_at: string
  eligible_checks: number | null
  issues: ExternalIssue[]
  agreement: { compared: number; agree: number } | null
}

export interface AuditCheck {
  external?: { id: string; result: "partial" | "failed" | "not_listed"; details: string } | null
  id: string
  group: number
  tier: "essential" | "recommended" | "bonus"
  source: "is_agentic" | "cloudflare" | "both"
  effort?: "easy" | "medium" | "hard"
  result: CheckResult
  percent: number
  scored: boolean
  name: string
  name_id: string
  evidence: string
  fix: string
  fix_id: string
  platform_fix: string
  platform_fix_id: string
  controlled_by: string
  controlled_note: string
  controlled_note_id: string
  prompt: string
  prompt_id: string
}

export interface AuditTier {
  total: number
  passing: number
  partial: number
  failed: number
  available?: number
  earned?: number
  points?: number
  positive?: number
}

export interface AuditGroup {
  percent: number | null
  scored: number
  passing: number
  partial: number
  failed: number
  platform_controlled: number
  planned: number
}

export type FixStatus = "not_started" | "needs_owner" | "draft_ready" | "platform_held" | "in_progress" | "done"

/** One thing the Fixer tracks for the owner. Plain words only; the technical detail stays in the check list. */
export interface Fix {
  check_id: string
  position: number
  status: FixStatus
  tier: "essential" | "recommended" | "bonus"
  title: string
  title_id: string
  why: string
  why_id: string
  summary: string
  summary_id: string
  questions: { en: string; id: string }[]
  /** Facts the Fixer found on the owner's own pages, for the owner to confirm. */
  confirm?: { kind: string; value: string; source: "contact" | "about" | "home"; label: string; label_id: string }[]
}

export interface ChangeTally {
  shifts: number
  mentions: number
  answers: number
  pct: number | null
  from: string | null
  to: string | null
}

/** A fix that went live and what the Asker saw before and after. Never a claim about cause. */
export interface Change {
  check_id: string
  title: string
  title_id: string
  applied_on: string
  note: string
  before: ChangeTally
  after: ChangeTally
  score_before: number | null
  score_after: number | null
  needed: number
  enough: boolean
  result: "up" | "down" | "same" | null
}

export interface Audit {
  id?: number
  run_id?: number | null
  scanned_at: string
  target: string
  platform: string
  engine: string
  score: number | null
  label: "strong" | "needs_work" | "blockers" | "none"
  breakdown: { essential: AuditTier; recommended: AuditTier; bonus: AuditTier }
  groups: Record<string, AuditGroup>
  group_names: Record<string, { en: string; id: string }>
  coverage: { planned: string[]; not_applicable: string[]; platform_controlled: string[] }
  checks: AuditCheck[]
  gaps: string[]
  limited_gaps?: string[]
  fixes?: Fix[]
  prompt_all: string
  prompt_all_id: string
  external?: ExternalReport | null
  history?: { scanned_at: string; score: number | null; engine: string }[]
}

export type FixChoice = "open" | "self" | "asked_fixer"

/** "How to do it" for one fix, written by the service from the check registry and the site's own pages. */
export interface Guide {
  /** true when an owner with no technical skills can do it; false when it needs a developer or an AI assistant */
  owner: boolean
  steps: { en: string; id: string }[]
  developer?: { en: string; id: string }
  code?: { label: { en: string; id: string }; text: string }
  verify?: { command: string; en: string; id: string }
}

export interface BusinessProfile {
  name: string
  aliases: string[]
  city: string
  country: string
  areas: string[]
  categories: string[]
}

export interface AskedItem {
  question: string
  answer: string
  named: boolean
  others: { name: string; quote: string }[]
  failed: boolean
}

export interface AskerRunView {
  ran_at: string
  model: string
  asked: number
  answered: number
  named: number
  items: AskedItem[]
  rivals: { name: string; count: number }[]
  readOthers: boolean
}

/** A client's page for one website: the latest scan, the first scan as the before, and what they chose per item. */
export interface SiteView {
  token?: string
  site: { host: string; url: string; platform: string; name: string; created_at: string }
  latest: Audit
  baseline: { scanned_at: string; score: number | null; label: string; gaps: string[] } | null
  history: { scanned_at: string; score: number | null; label: string }[]
  states: Record<string, FixChoice>
  done: string[]
  guides: Record<string, Guide>
  asker: {
    enabled: boolean
    profile: BusinessProfile | null
    latest: AskerRunView | null
    history: { ran_at: string; asked: number; answered: number; named: number }[]
  }
}

export interface RegistryCheck {
  id: string
  group: number
  tier: "essential" | "recommended" | "bonus"
  source: "is_agentic" | "cloudflare" | "both"
  effort?: "easy" | "medium" | "hard"
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
  external_id?: string
}

export interface Registry {
  groups: Record<string, { en: string; id: string }>
  checks: RegistryCheck[]
}

export interface Run {
  id: number
  agent: string
  kind?: "shift" | "import" | "audit"
  run_date: string
  started_at: string
  finished_at: string | null
  status: "ok" | "failed" | "running" | string
  error: string | null
  steps: Step[]
  quotes_verified: number
  questions?: RunQuestion[]
}

export interface Reason {
  topic: string
  answers: number
  ours: number
  competitor: string | null
  competitor_mentions: number
  window_days: number
}

export interface TopicRow {
  topic: string
  weight: number
  answers: number
  ours: number
  rate: number | null
  competitor: string | null
  competitor_mentions: number
  question_count: number
  terms: string[]
}

export interface RunQuestion {
  text: string
  kind: "core" | "daily"
  names_area: number
  reason?: Reason | null
  topics?: string[]
  asked: number
  counted: number | null
  ours: number | null
}

export interface Competitor {
  key?: string
  name: string
  mentions: number
  answer_ids?: number[]
}

export interface Summary {
  id: number
  date: string
  provider: string
  channel: string
  label: string
  run_id: number | null
  asked: number
  no_answer: number
  needs_review: number
  our_mentions: number
  total_answers: number
  top_competitor: string | null
  top_competitor_mentions: number
  area_mentions: number
  area_answers: number
  no_area_mentions: number
  no_area_answers: number
  web_search_answers: number
  core_mentions?: number
  core_answers?: number
  daily_mentions?: number
  daily_answers?: number
  competitors: Competitor[]
  our_answer_ids: number[]
  text: string | null
  text_source: "ai" | "code_fallback" | "manual" | null
  note: string | null
}

export interface Range {
  runs: number
  from: string
  to: string
  min_pct: number
  max_pct: number
}

export interface Store {
  slug: string
  name: string
  domain: string
  areas: string[]
  categories: string[]
  setup: {
    provider: string
    ask_model: string
    work_model: string
    use_search: boolean
    attempts_per_day: number
    daily_count?: number
    daily_attempts?: number
    questions: string[]
    daily_mode?: "profile" | "explore"
    weekdays?: string[]
    explore_window_days?: number
  } | null
  series: Summary[]
  ranges: Record<string, Range | null>
  runs: Run[]
  topics?: TopicRow[]
  audit?: Audit | null
  changes?: Change[]
  totals: {
    days_on_duty: number
    first_day: string | null
    questions_asked: number
    answers_read: number
    quotes_verified: number
    shops_seen: number
  }
}

export interface TeamMember {
  id: string
  name: string
  title: string
  title_id?: string
  status: "active" | "planned" | "human"
  steps?: number[]
  job: string
  job_id?: string
  inputs: string[]
  outputs: string[]
  inputs_id?: string[]
  outputs_id?: string[]
}

export interface Site {
  generated_at: string
  schedule: { cron: string; utc_hour: number; utc_minute: number; weekdays?: string[] | null }
  agent: { name: string; role: string; role_id?: string }
  team: TeamMember[]
  registry?: Registry
  stores: Store[]
}

export interface LiveStep {
  step: number
  name: string
  kind: StepKind
  title: string
  title_id?: string
  status: "todo" | "working" | "done" | "failed"
}

export interface Live {
  status: "running" | "idle" | "failed"
  updated_at: string
  run_id?: number | null
  run_date?: string
  started_at?: string
  current: string | null
  progress: { done: number; total: number; unit: string; ok?: number; no_answer?: number } | null
  steps: LiveStep[]
  last_event: string
  last_event_id?: string
  agent_now?: string
  agents?: string[]
  last_run_id?: number | null
  last_run_status?: string | null
  last_finished_at?: string | null
}

export interface Mention {
  store_name: string
  store_key: string
  is_ours: number
  position: number
  rank: number | null
  tone: string | null
  quote: string
}

export interface AnswerDetail {
  id: number
  question: string
  names_area: boolean
  kind?: "core" | "daily"
  attempt: number
  asked_at: string
  provider: string
  channel: string
  model: string | null
  status: "ok" | "no_answer" | "needs_review"
  error: string | null
  our_tone: string | null
  text: string
  sources: string[]
  retries: { at: string; error: string; wait_seconds: number }[]
  used_search: boolean
  mentions: Mention[]
}

export interface RunDetail {
  store: { slug: string; name: string }
  run: Run
  summary: Summary | null
  comparison: string[]
  comparison_id?: string[]
  answers: AnswerDetail[]
}
