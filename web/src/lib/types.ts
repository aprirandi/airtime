// Shapes of docs/data/*.json, written by airtime/export.py.

export type StepKind = "AI" | "CODE"

export interface Step {
  step: number
  name: string
  kind: StepKind
  status: "ok" | "failed" | string
  started_at?: string
  finished_at?: string
  error?: string
  description: string
  result?: Record<string, unknown>
}

export interface Run {
  id: number
  agent: string
  run_date: string
  started_at: string
  finished_at: string | null
  status: "ok" | "failed" | "running" | string
  error: string | null
  steps: Step[]
  quotes_verified: number
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
  series: Summary[]
  ranges: Record<string, Range | null>
  runs: Run[]
  totals: {
    days_on_duty: number
    first_day: string | null
    questions_asked: number
    answers_read: number
    quotes_verified: number
    shops_seen: number
  }
}

export interface Site {
  generated_at: string
  schedule: { cron: string; utc_hour: number; utc_minute: number }
  agent: { name: string; role: string }
  stores: Store[]
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
  answers: AnswerDetail[]
}
