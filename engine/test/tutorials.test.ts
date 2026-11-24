import { describe, expect, it } from "vitest"
import { buildGuide } from "../src/guide"
import { REGISTRY } from "../src/registry"
import { TUTORIALS } from "../src/tutorials"

const built = REGISTRY.checks.filter((c) => c.status === "built" && c.group !== 4).map((c) => c.id)
// words a business owner should not have to meet in a tutorial they can do themselves
const TECHNICAL = [/json/i, /curl/i, /https?\b/i, /\bheaders?\b/i, /markdown/i, /oauth/i, /\bmcp\b/i, /\bapi\b/i, /javascript/i, /\bdns\b/i, /\bschema\b/i, /\bhtml\b/i, /\bhead tag/i]

describe("every fix has a tutorial in plain words", () => {
  it("covers exactly the checks that are built", () => {
    expect(Object.keys(TUTORIALS).sort()).toEqual([...built].sort())
  })

  it.each(built)("%s: has English and Indonesian for every step, and they are different texts", (id) => {
    const t = TUTORIALS[id]!
    const all = [...t.steps, ...Object.values(t.platforms ?? {}).flat()]
    expect(all.length).toBeGreaterThanOrEqual(2)
    for (const s of all) {
      expect(s.en.trim().length).toBeGreaterThan(20)
      expect(s.id.trim().length).toBeGreaterThan(20)
      expect(s.id).not.toBe(s.en)
    }
  })

  it("never uses technical words in a tutorial an owner does themselves", () => {
    for (const [id, t] of Object.entries(TUTORIALS)) {
      if (!t.owner) continue
      const all = [...t.steps, ...Object.values(t.platforms ?? {}).flat()]
      for (const s of all) for (const re of TECHNICAL) expect(`${s.en} ${s.id}`, `${id}: ${s.en}`).not.toMatch(re)
    }
  })

  it("says plainly when something needs a developer, and how to hand it over", () => {
    const needs = Object.entries(TUTORIALS).filter(([, t]) => !t.owner)
    expect(needs.length).toBeGreaterThanOrEqual(10)
    for (const [id, t] of needs) {
      const text = t.steps.map((s) => s.en).join(" ")
      expect(text, id).toMatch(/developer/i)
      expect(text, id).toMatch(/prompt/i)
    }
  })

  it("gives the steps of the client's platform when there are some, the general ones otherwise", () => {
    const wp = buildGuide("not_noindex", "wordpress")!
    const shop = buildGuide("not_noindex", "shopify")!
    const other = buildGuide("not_noindex", "wix")!
    expect(wp.steps[0]!.en).toContain("Settings, then Reading")
    expect(shop.steps[0]!.en).toContain("Shopify")
    expect(other.steps[0]!.en).toContain("tells search engines")
    expect(buildGuide("not_noindex", "woocommerce")!.steps[0]!.en).toBe(wp.steps[0]!.en)
  })

  it("keeps the technical instruction for the developer, apart from the steps", () => {
    const g = buildGuide("raw_html_content", "shopify")!
    expect(g.owner).toBe(false)
    expect(g.developer?.en.length).toBeGreaterThan(20)
    expect(g.steps.map((s) => s.en).join(" ")).not.toContain(g.developer!.en)
    expect(buildGuide("sitemap", "wordpress")!.owner).toBe(true)
  })

  it("adds the prepared code after the owner's own steps, and the re-check step only for what an owner does", () => {
    const g = buildGuide("organization_completeness", "wordpress", { "@type": "Organization" })!
    expect(g.code?.text).toContain("Organization")
    expect(g.steps.some((s) => /Rank Math/.test(s.en))).toBe(true)
    expect(g.steps.at(-1)!.en).toContain("Re-check")
    // a developer's item already tells them to press it; no second copy
    const dev = buildGuide("link_headers", "")!
    expect(dev.steps.filter((s) => /Re-check/.test(s.en)).length).toBe(0)
  })
})
