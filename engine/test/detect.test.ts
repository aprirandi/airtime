import { describe, expect, it } from "vitest"
import { runAudit } from "../src/audit"
import { Response, type Fetcher } from "../src/http"

// A site whose pages show what it is built on gets the same audit whether the client said so or not.
const serving = (home: string): Fetcher => async (url) => {
  const path = new URL(url).pathname
  if (path !== "/") return new Response(url, { status: 404, finalUrl: url })
  return new Response(url, { status: 200, finalUrl: url, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(home), chain: [], error: "" })
}
const page = (head: string) => `<html lang="en"><head><title>Shop</title>${head}</head><body><h1>Shop</h1><p>${"We sell things. ".repeat(40)}</p></body></html>`

describe("the platform is read from the page when none is given", () => {
  const cases: [string, string, string][] = [
    ["shopify", '<script src="https://cdn.shopify.com/s/files/1/a.js"></script>', "shopify"],
    ["wordpress", '<link rel="stylesheet" href="/wp-content/themes/a/style.css">', "wordpress"],
    ["woocommerce", '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/a.css">', "wordpress"],
    ["wix", '<img src="https://static.wixstatic.com/media/a.png">', "wix"],
    ["squarespace", '<meta name="generator" content="Squarespace 7.1">', "squarespace"],
  ]
  for (const [said, head, read] of cases) {
    it(`${said}: blank is read as ${read} and audited the same as when told`, async () => {
      const f = serving(page(head))
      const opts = { baseUrl: "https://shop.example", scannedAt: "2026-01-01T00:00:00Z" }
      const blank = await runAudit(f, { ...opts, platform: "" })
      const told = await runAudit(f, { ...opts, platform: read })
      expect(blank.platform).toBe(read)
      expect(blank.platform_guess).toBe(read)
      expect(blank.score).toBe(told.score)
      expect(blank.gaps).toEqual(told.gaps)
      expect(blank.limited_gaps).toEqual(told.limited_gaps)
    })
  }
  it("leaves a site it cannot read as unknown, and a stated platform as stated", async () => {
    const f = serving(page(""))
    const blank = await runAudit(f, { baseUrl: "https://shop.example", platform: "" })
    expect(blank.platform).toBe("")
    expect(blank.platform_guess).toBe("")
    const told = await runAudit(serving(page('<script src="https://cdn.shopify.com/a.js"></script>')), { baseUrl: "https://shop.example", platform: "wix" })
    expect(told.platform).toBe("wix")
    expect(told.platform_guess).toBe("")
  })
})
