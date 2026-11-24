// A local stand-in for Vercel, for trying the page with the real engine: npx tsx scripts/serve.mts [port]
//   - /api/audit is the real handler
//   - everything else is the built site in ../web/dist
//   - there is no internet in the sandbox, so addresses like demo-3.example.com are answered from the recorded
//     sites in test/replay.json (scenario number 3), by the real engine
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import replay from "../test/replay.json" with { type: "json" }
import { MemoryLimiter } from "../src/api"
import { Response, type Fetcher } from "../src/http"
import { makeHandler } from "../src/node"
import { makeSiteHandler } from "../src/node-site"
import { memoryStore } from "../src/sites"

const bodies = replay.bodies as Record<string, string>
const maps = replay.scenarios.map((s) => new Map(s.calls.map((c) => [`${c.url}|${c.accept}|${c.ua}`, c])))

const fake: Fetcher = async (rawUrl, o) => {
  const m = rawUrl.match(/^https?:\/\/demo-(\d+)\.example\.com/)
  const n = m ? Number(m[1]) : rawUrl.includes("shop.test") ? currentScenario : -1
  if (m) currentScenario = n
  const calls = maps[n]
  if (!calls) return new Response(rawUrl, { error: "ConnectionRefusedError: nothing here" })
  const url = rawUrl.replace(/^https?:\/\/demo-\d+\.example\.com/, "https://shop.test")
  const c = calls.get(`${url}|${o?.headers?.["Accept"] ?? ""}|${o?.userAgent ?? ""}`)
  if (!c) return new Response(rawUrl, { status: 404, finalUrl: rawUrl })
  return new Response(c.url, {
    status: c.status, finalUrl: c.final_url, headers: c.headers as Record<string, string>,
    body: new Uint8Array(Buffer.from(bodies[c.body] as string, "base64")), chain: c.chain as [number, string][], error: c.error,
  })
}
let currentScenario = 0

const api = makeHandler({ fetcher: fake, limiter: new MemoryLimiter(1000) })
const siteApi = makeSiteHandler({ store: memoryStore(), fetcher: fake, createLimiter: new MemoryLimiter(1000), rescanLimiter: new MemoryLimiter(1000) })
const root = join(import.meta.dirname, "..", "..", "web", "dist")
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" }

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0] as string
  if (path.startsWith("/api/audit")) return void api(req, res)
  if (path.startsWith("/api/site")) return void siteApi(req, res)
  let file = normalize(join(root, path === "/id" ? "/id/index.html" : path))
  if (!file.startsWith(root)) return void res.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  if (!existsSync(file)) return void res.writeHead(404).end("not found")
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file))
}).listen(Number(process.argv[2] ?? 8790), () => console.log(`http://localhost:${process.argv[2] ?? 8790}`))
