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
    expect(businessCard("wix", { organization_completeness: card }, [fix("organization_completeness")])).toMatchObject({ ready: false, reason: "platform" })
    expect(businessCard("shopify", {}, [fix("organization_completeness")])).toMatchObject({ ready: false, reason: "nothing_found" })
    expect(businessCard("shopify", { organization_completeness: card }, [])).toMatchObject({ ready: false, reason: "already_done" })
  })
})

import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const hasBin = (b: string) => spawnSync("which", [b]).status === 0

describe("business card package for WordPress", () => {
  const r = businessCard("wordpress", { organization_completeness: card }, [fix("organization_completeness")])
  if (!r.ready) throw new Error("not ready")
  const pkg = r.package
  const dir = mkdtempSync(join(tmpdir(), "airtime-"))

  it("hands over a zip with the plugin inside", () => {
    expect(pkg.download?.name).toBe("airtime-business-card.zip")
    const zip = join(dir, "p.zip")
    writeFileSync(zip, Buffer.from(pkg.download!.base64, "base64"))
    if (!hasBin("unzip")) return
    expect(execFileSync("unzip", ["-t", zip]).toString()).toContain("No errors")
    expect(execFileSync("unzip", ["-p", zip, "airtime-business-card/airtime-business-card.php"]).toString()).toBe(pkg.files[0]!.content)
  })

  it.skipIf(!hasBin("php"))("is valid PHP and prints a head that passes both checks, whatever the text says", () => {
    const hostile = { ...card, description: "x\nAIRTIME_JSON;\n<?php system('id'); ?> $a {$b} ${c} </script><script>alert(1)</script>" }
    const h = businessCard("wordpress", { organization_completeness: hostile }, [fix("organization_completeness")])
    if (!h.ready) throw new Error("not ready")
    const file = join(dir, "plugin.php")
    writeFileSync(file, h.package.files[0]!.content)
    expect(spawnSync("php", ["-l", file]).status).toBe(0)
    const runner = join(dir, "run.php")
    writeFileSync(runner, `<?php define('ABSPATH','/'); function is_front_page(){return true;} function add_action($h,$f,$p){$f();} include ${JSON.stringify(file)};`)
    const out = execFileSync("php", [runner]).toString()
    expect(out.match(/<\/?script/gi)).toHaveLength(2)
    const page = parsePage(`<html><head><title>S</title>${out}</head><body></body></html>`)
    const snap = { homePage: page, base: "https://shop.example", trust: {} } as never
    expect((CHECKS.jsonld_organization!(snap) as { result: string }).result).toBe("pass")
    expect((CHECKS.organization_completeness!(snap) as { result: string }).result).toBe("pass")
    const json = JSON.parse(out.replace(/<\/?script[^>]*>/g, ""))
    expect(json.description).toBe(hostile.description)
  })
})
