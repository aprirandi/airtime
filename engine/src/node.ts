/** The Node.js side of the service: reads a request, calls handleAudit, writes the JSON. Works as a Vercel function. */
import type { IncomingMessage, ServerResponse } from "node:http"
import { handleAudit, type Deps } from "./api"

const MAX_BODY = 4096

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) reject(new Error("body too large"))
      else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

export function clientOf(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"]
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim()
  const real = req.headers["x-real-ip"]
  return first || (Array.isArray(real) ? real[0] : real) || req.socket.remoteAddress || "unknown"
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  })
  res.end(JSON.stringify(body))
}

export function makeHandler(deps: Deps = {}) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return send(res, 204, {})
    if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "method", message: "Use GET or POST." }, { allow: "GET, POST, OPTIONS" })
    let url: unknown
    let platform: unknown
    try {
      if (req.method === "GET") {
        const q = new URL(req.url ?? "/", "http://local").searchParams
        url = q.get("url")
        platform = q.get("platform") ?? undefined
      } else {
        const given = (req as IncomingMessage & { body?: unknown }).body // Vercel has already read a JSON body
        const body = typeof given === "string" ? JSON.parse(given) : given !== undefined && given !== null ? given : JSON.parse((await readBody(req)) || "{}")
        url = (body as Record<string, unknown>)["url"]
        platform = (body as Record<string, unknown>)["platform"]
      }
    } catch {
      return send(res, 400, { error: "bad_request", message: "The request could not be read." })
    }
    const out = await handleAudit({ url, platform, client: clientOf(req) }, deps)
    send(res, out.status, out.body, out.headers)
  }
}

export default makeHandler()
