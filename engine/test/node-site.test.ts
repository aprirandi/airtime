import { describe, expect, it } from "vitest"
import { depsFromEnv } from "../src/node-site"

const base = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }

describe("what the service reads from its environment", () => {
  it("asks nothing without a Gemini key", () => {
    expect(depsFromEnv(base).asker).toBeNull()
    expect(depsFromEnv({}).store).toBeNull()
  })
  it("allows one run a day by default, so a key shared with the daily shift is not used up", () => {
    const d = depsFromEnv({ ...base, GEMINI_API_KEY: "g" })
    expect(d.asker).not.toBeNull()
    expect(d.askerLimits).toEqual({ perSiteHours: 12, dailyRuns: 1 })
  })
  it.each([["5", 5], ["", 1], ["abc", 1], ["-2", 1], ["1.5", 1], [" 3 ", 3]])("reads ASKER_DAILY_RUNS=%j as %i", (raw, runs) => {
    expect(depsFromEnv({ ...base, GEMINI_API_KEY: "g", ASKER_DAILY_RUNS: raw }).askerLimits?.dailyRuns).toBe(runs)
  })
  it("switches asking off with 0, even with a key", () => {
    expect(depsFromEnv({ ...base, GEMINI_API_KEY: "g", ASKER_DAILY_RUNS: "0" }).asker).toBeNull()
  })
})
