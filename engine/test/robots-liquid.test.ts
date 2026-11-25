import { Liquid } from "liquidjs"
import { describe, expect, it } from "vitest"
import { CHECKS } from "../src/checks"
import { robotsLiquid, SIGNALS_PLACEHOLDER } from "../src/package"

// The template is rendered here with a stand-in for Shopify's `robots` object. Shopify's own objects print a whole line
// (and maybe its line break); both are tried, so the new line is shown never to be glued to another one.
class Line {
  constructor(private text: string, readonly value: string = "") {}
  toString() {
    return this.text
  }
}
const robotsObject = (nl: string) => ({
  robots: {
    default_groups: [
      { user_agent: new Line("User-agent: *" + nl, "*"), rules: [new Line("Disallow: /admin" + nl), new Line("Disallow: /cart" + nl)], sitemap: new Line("Sitemap: https://shop.example/sitemap.xml" + nl) },
      { user_agent: new Line("User-agent: Googlebot" + nl, "Googlebot"), rules: [new Line("Disallow: /search" + nl)], sitemap: "" },
    ],
  },
})
const answered = robotsLiquid().split(SIGNALS_PLACEHOLDER).join("ai-train=no, search=yes, ai-input=yes")
const render = (nl: string) => new Liquid().parseAndRender(answered, robotsObject(nl))

const linesOf = (out: string): string[] => out.split("\n").map((l: string) => l.trim()).filter(Boolean)
const SIGNAL = "Content-Signal: ai-train=no, search=yes, ai-input=yes"

describe("the Shopify robots.txt template, rendered", () => {
  describe("when Shopify's lines end with a line break (as its own default template relies on)", () => {
    it("keeps every Shopify line, once, on a line of its own", async () => {
      const out = await render("\n")
      const lines = linesOf(out)
      for (const want of ["User-agent: *", "Disallow: /admin", "Disallow: /cart", "Sitemap: https://shop.example/sitemap.xml", "User-agent: Googlebot", "Disallow: /search"]) {
        expect(lines.filter((l: string) => l === want), `${want}\n${out}`).toHaveLength(1)
      }
    })
    it("adds the Content-Signal line once, inside the group for every crawler, before its rules", async () => {
      const lines = linesOf(await render("\n"))
      expect(lines.filter((l: string) => l.startsWith("Content-Signal:"))).toEqual([SIGNAL])
      const star = lines.indexOf("User-agent: *")
      const sig = lines.indexOf(SIGNAL)
      const next = lines.indexOf("User-agent: Googlebot")
      expect(star).toBeGreaterThanOrEqual(0)
      expect(sig).toBeGreaterThan(star)
      expect(sig).toBeLessThan(next)
      expect(lines.slice(star, next)).toContain("Disallow: /admin")
    })
    it("gives a robots.txt that passes the check", async () => {
      const snap = { robots: { ok: true, text: await render("\n") } } as never
      expect((CHECKS.content_signals!(snap) as { result: string }).result).toBe("pass")
    })
    it("leaves the group of a named crawler as it was", async () => {
      const out = await render("\n")
      expect(out.slice(out.indexOf("User-agent: Googlebot"))).not.toContain("Content-Signal")
    })
  })

  describe("even if Shopify's lines carried no line break at all", () => {
    // Shopify's own lines would then run together with or without this file; what must hold is that the new line is never one of them.
    it("keeps the Content-Signal line whole and alone on its line, and passing", async () => {
      const out = await render("")
      expect(linesOf(out).filter((l: string) => l.startsWith("Content-Signal:"))).toEqual([SIGNAL])
      expect((CHECKS.content_signals!({ robots: { ok: true, text: out } } as never) as { result: string }).result).toBe("pass")
    })
  })
})
