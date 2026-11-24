import { describe, expect, it } from "vitest"
import golden from "./golden.json"
import { draftFor, planAll, siteName, type FactsSource } from "../src/fixer"
import { parsePage } from "../src/html"
import type { Row } from "../src/types"

// golden.json is written by the Python engine (python -m airtime.agents.auditor.golden): what the Fixer prepared from
// pages a business keeps its facts on, and how it sorted the gaps of random audits. The same answers are required here.

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe("the Fixer reads the owner's own pages as the Python Fixer does", () => {
  golden.fixer.forEach((c) => {
    it(c.name, () => {
      const trust = (html: string | null) => (html === null ? null : ([{}, parsePage(html)] as [unknown, ReturnType<typeof parsePage>]))
      const snap: FactsSource = {
        base: c.base,
        homePage: parsePage(c.home),
        trust: { about: trust(c.about), contact: trust(c.contact), privacy: null },
      }
      const name = siteName(snap)
      expect(name).toBe(c.site_name)
      expect(plain(draftFor("organization_completeness", snap, name))).toEqual(c.organization_completeness)
      expect(plain(draftFor("jsonld_organization", snap, name))).toEqual(c.jsonld_organization)
      expect(draftFor("content_signals", snap, name)).toBeNull()
    })
  })
})

describe("the Fixer sorts and labels gaps as the Python Fixer does", () => {
  golden.plans.forEach((c, i) => {
    it(`case ${i}: ${c.platform || "no platform"}`, () => {
      const got = planAll(c.rows as Row[], c.platform).map(({ draft, confirm, ...fix }) => {
        expect(draft).toBeNull()
        expect(confirm).toEqual([])
        return fix
      })
      expect(got).toEqual(c.fixes)
    })
  })
})
