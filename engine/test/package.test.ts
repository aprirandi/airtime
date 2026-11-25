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
    expect(r.ready && r.package.jsonld?.description).toBe("Hello")
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

import { llmsPackage, packagesFor } from "../src/package"
import { llmsText, type FactsSource } from "../src/fixer"

describe("llms.txt for WordPress", () => {
  const home = `<html><head><meta name="description" content="We make scented candles by hand in Melbourne and ship them across Australia."></head><body><h1>Paper Plane</h1></body></html>`
  const ok = (url: string, body: string) => [{ status: 200, finalUrl: url, url }, parsePage(`<html><body>${body}</body></html>`)]
  const snap = { base: "https://paper.example", homePage: parsePage(home), trust: { about: ok("https://paper.example/about", "<h1>About</h1>"), contact: ok("https://paper.example/contact", "<p>Visit us at 12 Chapel St Prahran VIC 3181 or call (03) 9123 4567. Email hello@paperplane.example.com.</p>"), privacy: null } } as unknown as FactsSource
  const text = llmsText(snap, "Paper Plane")

  it("is written from the site's own pages and passes the llms_txt check", () => {
    expect(text).toContain("# Paper Plane")
    expect(text).toContain("> We make scented candles by hand in Melbourne and ship them across Australia.")
    expect(text).toContain("[About us](https://paper.example/about)")
    expect(text).not.toContain("privacy")
    expect(text).toContain("Phone: (03) 9123 4567")
    const s = { llms: { ok: true, text, status: 200 }, llmsLinks: [] } as never
    expect((CHECKS.llms_txt!(s) as { result: string }).result).toBe("pass")
  })
  it("is empty when the pages say nothing", () => {
    const bare = { base: "https://x.example", homePage: parsePage("<html><body></body></html>"), trust: {} } as unknown as FactsSource
    expect(llmsText(bare, "x.example")).toBe("")
  })
  it("says why there is no package", () => {
    const f = [{ check_id: "llms_txt", status: "needs_owner", confirm: [] }] as never
    expect(llmsPackage("shopify", text, f)).toMatchObject({ ready: false, reason: "platform" })
    expect(llmsPackage("wordpress", "", f)).toMatchObject({ ready: false, reason: "nothing_found" })
    expect(llmsPackage("wordpress", text, [])).toMatchObject({ ready: false, reason: "already_done" })
    const all = packagesFor("shopify", {}, [fix("organization_completeness"), ...(f as never[])], text)
    expect(Object.keys(all).sort()).toEqual(["llms_txt", "organization_completeness"])
  })
  it.skipIf(!hasBin("php"))("answers /llms.txt with the text, and only there", () => {
    const hostile = text + "\n- [x](https://paper.example/)\nAIRTIME_TXT;\n<?php echo 1; ?>\n"
    const r = llmsPackage("wordpress", hostile, [{ check_id: "llms_txt", status: "needs_owner", confirm: [] }] as never)
    if (!r.ready) throw new Error("not ready")
    const dir = mkdtempSync(join(tmpdir(), "airtime-"))
    const file = join(dir, "plugin.php")
    writeFileSync(file, r.package.files[1]!.content)
    expect(spawnSync("php", ["-l", file]).status).toBe(0)
    const run = (uri: string) => {
      const runner = join(dir, "run.php")
      writeFileSync(runner, `<?php define('ABSPATH','/'); $_SERVER['REQUEST_URI']=${JSON.stringify(uri)}; function wp_parse_url($u,$c=-1){return parse_url($u,$c);} function wp_unslash($v){return $v;} function home_url($p){return 'https://paper.example'.$p;} function status_header($c){} function add_action($h,$f,$p){$f();} include ${JSON.stringify(file)}; echo "[fell through]";`)
      return execFileSync("php", [runner]).toString()
    }
    const served = run("/llms.txt?x=1")
    expect(served).toContain("# Paper Plane")
    expect(served).toContain("<?php echo 1; ?>")
    expect(served).not.toContain("fell through")
    expect(run("/shop/")).toBe("[fell through]")
  })
})

import { detectPlatform } from "../src/platform"

describe("platform when the client did not say", () => {
  it("reads WordPress and Shopify from the homepage, and nothing else", () => {
    expect(detectPlatform('<html><head><meta name="generator" content="WordPress 6.5"></head></html>')).toBe("wordpress")
    expect(detectPlatform('<link rel="stylesheet" href="https://x.example/wp-content/themes/a/style.css">')).toBe("wordpress")
    expect(detectPlatform('<script src="https://cdn.shopify.com/s/files/1/a.js"></script>')).toBe("shopify")
    expect(detectPlatform("<html><body>Hello</body></html>")).toBe("")
  })
  it("treats WooCommerce as WordPress for packages", () => {
    const r = packagesFor("woocommerce", { organization_completeness: card }, [fix("organization_completeness")], "")
    expect(r["organization_completeness"]).toMatchObject({ ready: true })
  })
})
