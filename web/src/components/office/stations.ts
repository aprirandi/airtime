import type { Step } from "@/lib/types"

export type StationId = "board" | "gemini" | "reading" | "check" | "archive" | "writing" | "publish" | "lounge"

export interface Station {
  id: StationId
  label: string
  /** Where the agent stands while working here (grid units). */
  stand: [number, number]
}

export const STATIONS: Record<StationId, Station> = {
  board: { id: "board", label: "Question board", stand: [2.6, 1.5] },
  gemini: { id: "gemini", label: "Ask Gemini", stand: [6, 2.5] },
  reading: { id: "reading", label: "Reading desk", stand: [9.5, 2.5] },
  archive: { id: "archive", label: "Archive", stand: [1.7, 4] },
  check: { id: "check", label: "Fact-check desk", stand: [5.5, 5.3] },
  writing: { id: "writing", label: "Writing desk", stand: [9, 5.3] },
  publish: { id: "publish", label: "Publish report", stand: [10.6, 6.9] },
  lounge: { id: "lounge", label: "Lounge", stand: [2.9, 7.1] },
}

const STEP_STATION: Record<string, StationId> = {
  write_questions: "board",
  validate_questions: "board",
  ask_questions: "gemini",
  import_answers: "gemini",
  extract_mentions: "reading",
  verify_and_count: "check",
  compare_previous: "archive",
  write_summary: "writing",
}

export function stationFor(step: Step): StationId {
  return STEP_STATION[step.name.replace(/^recheck_/, "")] ?? "board"
}

/** The agents planned after this one. They get an empty desk until they are built. */
export const FUTURE_AGENTS = [
  { name: "Auditor", job: "Audits the store's site", desk: [3.9, 6.75] as [number, number] },
  { name: "Planner", job: "Plans what to change", desk: [5.5, 6.75] as [number, number] },
  { name: "Fixer", job: "Makes the changes", desk: [7.1, 6.75] as [number, number] },
  { name: "Reporter", job: "Writes the owner report", desk: [8.7, 6.75] as [number, number] },
]
