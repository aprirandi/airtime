// Runs api/audit.js (the file Vercel serves) in a plain Node server and scans a real site through it.
// Usage: node scripts/try-bundle.mjs https://example.com shopify
import http from "node:http"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const m = require("../../api/audit.js")
const handler = m.default || m
const [url = "example.com", platform = ""] = process.argv.slice(2)

const server = http.createServer(handler).listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (body) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const started = Date.now()
  const res = await post({ url, platform })
  const data = await res.json()
  console.log(`POST ${url} -> HTTP ${res.status} in ${Date.now() - started} ms`)
  if (data.error) console.log("error:", data)
  else {
    console.log({ engine: data.engine, target: data.target, platform: data.platform, score: data.score, label: data.label, cached: data.cached, checks: data.checks.length })
    console.log("gaps:", data.gaps.join(", ") || "none", "| held back:", data.limited_gaps.join(", ") || "none")
    const again = await (await post({ url, platform })).json()
    console.log("second request cached:", again.cached)
  }
  for (const bad of ["10.0.0.1", "localhost", "http://169.254.169.254/", "https://example.com:8080"]) {
    const r = await post({ url: bad })
    console.log(`bad address ${bad} -> HTTP ${r.status}`)
  }
  server.close()
})
