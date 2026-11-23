// One-off: what could a fixer draft from a site's own public pages? Prints facts, with where each came from.
// Usage: npx tsx scripts/probe-facts.mts https://www.handworks.com.au
import { jsonldItems, parsePage } from "../src/html"
import { httpFetcher } from "../src/http"
import { collect } from "../src/snapshot"

const url = process.argv[2] ?? "https://example.com"
const snap = await collect(httpFetcher(), { baseUrl: url, platform: "shopify" })
const [items] = jsonldItems(snap.homePage)
console.log("=== JSON-LD entities on the homepage:")
for (const it of items) console.log(" ", JSON.stringify(it).slice(0, 400))

const phone = /(?:\+?61|0)[\s-]?\(?\d\)?[\s-]?\d{4}[\s-]?\d{4}|\b\d{2}\s?\d{4}\s?\d{4}\b/g
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const postcode = /\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}\b/g
for (const kind of ["about", "contact", "privacy"] as const) {
  const t = snap.trust[kind]
  console.log(`\n=== ${kind}: ${t ? t[0].url : "not found"}`)
  if (!t) continue
  const text = t[1].text
  console.log("  chars:", [...text].length)
  console.log("  first 300:", text.slice(0, 300))
  console.log("  phones:", [...new Set(text.match(phone) ?? [])].slice(0, 5), "emails:", [...new Set(text.match(email) ?? [])].slice(0, 5), "state+postcode:", [...new Set(text.match(postcode) ?? [])].slice(0, 5))
}
const home = snap.home.text
console.log("\n=== homepage footer-ish facts")
console.log("  phones:", [...new Set(snap.homePage.text.match(phone) ?? [])].slice(0, 5), "emails:", [...new Set(snap.homePage.text.match(email) ?? [])].slice(0, 5), "state+postcode:", [...new Set(snap.homePage.text.match(postcode) ?? [])].slice(0, 6))
console.log("\n=== where the empty or out-of-order headings are (first 3 empty headings, 160 chars of HTML before each)")
let n = 0
for (const m of home.matchAll(/<h([1-6])[^>]*>\s*(?:<[^>]+>\s*)*<\/h\1>/gi)) {
  if (n++ >= 3) break
  const at = m.index ?? 0
  console.log(`  H${m[1]} at byte ${at}:`, home.slice(Math.max(0, at - 160), at + (m[0]?.length ?? 0)).replace(/\s+/g, " "))
}
console.log("\n=== sameAs / social links in JSON-LD:", items.map((i) => i["sameAs"]).filter(Boolean))
