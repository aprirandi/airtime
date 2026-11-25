import { describe, expect, it } from "vitest"
import { businessCard, liquidSnippet, safeJson, RENDER_LINE } from "../src/package"
import { CHECKS } from "../src/checks"
import { parsePage } from "../src/html"

const card = {
  "@context": "https://schema.org", "@type": "Organization", name: "Shop", url: "https://shop.example/",
  description: "We sell {{ shop.secrets }} and <b>bread</b> {% raw %} 100% & more",
  contactPoint: [{ "@type": "ContactPoint", telephone: "+61 2 5550 1234", contactType: "customer service" }],
  address: [{ "@type": "PostalAddress", streetAddress: "1 High St", addressLocality: "Sydney", addressCountry: "AU" }],
}
const fix = (id: string) => ({ check_id: id, status: "open", confirm: [{ kind: "phone", value: "+61 2 5550 1234", source: "contact", label: "Phone", label_id: "Telepon" }] }) as never

describe("business card package for Shopify", () => {
  it("escapes what Liquid or a browser could act on, and keeps the data", () => {
    const out = liquidSnippet(card)
    const body = out.split("{% raw %}")[1]!.split("{% endraw %}")[0]!
    expect(body).not.toMatch(/\{\{|\{%|%\}|<b>/)
    const json = body.replace(/<\/?script[^>]*>/g, "")
    expect(JSON.parse(json)).toEqual(card)
    expect(safeJson({ a: "</script>" })).not.toContain("</script>")
  })
  it("renders a head that passes both checks", () => {
    const r = businessCard("shopify", { organization_completeness: card, jsonld_organization: card }, [fix("jsonld_organization"), fix("organization_completeness")])
    if (!r.ready) throw new Error("not ready")
    expect(r.package.missing).toEqual([])
    const snippet = r.package.files[0]!.content.replace(/\{% (raw|endraw) %\}/g, "").replace(/\{% comment %\}[\s\S]*?\{% endcomment %\}/, "")
    const page = parsePage(`<html><head><title>Shop</title>${snippet}</head><body></body></html>`)
    const snap = { homePage: page, base: "https://shop.example", trust: {} } as never
    expect((CHECKS.jsonld_organization!(snap) as { result: string }).result).toBe("pass")
    expect((CHECKS.organization_completeness!(snap) as { result: string }).result).toBe("pass")
    expect(r.package.steps.some((s) => s.en.includes(RENDER_LINE))).toBe(true)
  })
  it("merges the description from the other draft and reports what is missing", () => {
    const { description: _d, ...bare } = card
    const r = businessCard("shopify", { organization_completeness: bare, jsonld_organization: { description: "Hello" } }, [fix("organization_completeness")])
    expect(r.ready && r.package.jsonld.description).toBe("Hello")
    const r2 = businessCard("shopify", { organization_completeness: { ...bare, address: [] } }, [fix("organization_completeness")])
    expect(r2.ready && r2.package.missing).toEqual(["description", "address"])
  })
  it("says why there is no package", () => {
    expect(businessCard("wordpress", { organization_completeness: card }, [fix("organization_completeness")])).toMatchObject({ ready: false, reason: "platform" })
    expect(businessCard("shopify", {}, [fix("organization_completeness")])).toMatchObject({ ready: false, reason: "nothing_found" })
    expect(businessCard("shopify", { organization_completeness: card }, [])).toMatchObject({ ready: false, reason: "already_done" })
  })
})
