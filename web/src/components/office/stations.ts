import type { Step } from "@/lib/types"

export type StationId = "board" | "gemini" | "reading" | "check" | "archive" | "writing" | "publish" | "master" | "lounge"
export type AgentId = "asker" | "analyst" | "master"
export const AGENTS: AgentId[] = ["asker", "analyst", "master"]

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
  master: { id: "master", label: "Master check", stand: [10.5, 4.8] },
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
  if (step.name.startsWith("master_")) return "master"
  return STEP_STATION[step.name.replace(/^recheck_/, "")] ?? "board"
}

const STEP_AGENT: Record<string, AgentId> = {
  write_questions: "asker", validate_questions: "asker", ask_questions: "asker", import_answers: "asker",
  extract_mentions: "analyst", verify_and_count: "analyst", compare_previous: "analyst", write_summary: "analyst",
}

/** Which agent did a step (old runs have no agent field, so it is inferred from the step). */
export function agentFor(step: Step): AgentId {
  if (step.agent === "asker" || step.agent === "analyst" || step.agent === "master") return step.agent
  if (step.name.startsWith("master_")) return "master"
  return STEP_AGENT[step.name.replace(/^recheck_/, "")] ?? "analyst"
}

/** Where each agent waits when it is not working, and where it rests after the shift. */
export const HOME: Record<AgentId, [number, number]> = {
  asker: [2.6, 1.5],
  analyst: [9.5, 2.5],
  master: [10.5, 4.8],
}
export const LOUNGE: Record<AgentId, [number, number]> = {
  asker: [2.9, 7.1],
  analyst: [2.6, 6.0],
  master: [3.3, 7.6],
}

/** The agents still to be built. They get an empty desk until then. */
export const FUTURE_AGENTS = [
  { name: "Auditor", job: "Audits the store's site", desk: [3.9, 6.75] as [number, number] },
  { name: "Planner", job: "Plans what to change", desk: [5.5, 6.75] as [number, number] },
  { name: "Fixer", job: "Makes the changes", desk: [7.1, 6.75] as [number, number] },
  { name: "Reporter", job: "Writes the owner report", desk: [8.7, 6.75] as [number, number] },
]
