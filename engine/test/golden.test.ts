import { describe, expect, it } from "vitest"
import golden from "./golden.json"
import { allPrompt, fixPrompt } from "../src/prompts"
import { coverage, gaps, limitedGaps, scoreRows } from "../src/score"
import type { Row } from "../src/types"

// golden.json is written by the Python engine (python -m airtime.agents.auditor.golden).

describe("scoring matches the Python engine", () => {
  golden.score.forEach((c, i) => {
    it(`case ${i}`, () => {
      const rows = c.rows as Row[]
      expect(scoreRows(rows)).toEqual(c.score)
      expect(gaps(rows).map((r) => r.check_id)).toEqual(c.gaps)
      expect(limitedGaps(rows).map((r) => r.check_id)).toEqual(c.limited)
      expect(coverage(rows)).toEqual(c.coverage)
    })
  })
})

describe("fix prompts match the Python engine character by character", () => {
  golden.prompts.forEach((c, i) => {
    it(`case ${i}: ${c.platform || "no platform"} ${c.lang}`, () => {
      const lang = c.lang as "en" | "id"
      expect(allPrompt(c.gaps, c.site, c.platform, lang, c.scanned)).toBe(c.all)
      expect(allPrompt([], c.site, c.platform, lang, c.scanned)).toBe(c.none)
      c.gaps.forEach((g, j) => expect(fixPrompt(g.check_id, g, c.site, c.platform, lang)).toBe(c.single[j]))
    })
  })
})

describe("rounding is Python's", () => {
  it("rounds half to even on exact ties and to the nearest tenth otherwise", async () => {
    const { round1 } = await import("../src/score")
    expect([0.25, 0.75, 2.25, 15.35, 53.333333, 1.05].map(round1)).toEqual([0.2, 0.8, 2.2, 15.3, 53.3, 1.1]) // the values Python gives
  })
})
