import data from "./registry.generated.json"
import type { Registry, RegistryCheck } from "./types"

/** The registry as data, written by the Python side (python -m airtime.agents.auditor.golden). */
export const REGISTRY = data as unknown as Registry
export const TIERS = ["essential", "recommended", "bonus"] as const
export const BY_ID: Record<string, RegistryCheck> = Object.fromEntries(REGISTRY.checks.map((c) => [c.id, c]))
