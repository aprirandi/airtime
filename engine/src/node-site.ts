/** The Node.js side of the site pages: reads a JSON request, calls handleSite, writes the JSON. A Vercel function. */
import type { IncomingMessage, ServerResponse } from "node:http"
import { clientOf } from "./node"
import { handleSite, storeFromEnv, type SiteDeps } from "./sites"

const MAX_BODY = 8192

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

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  })
  res.end(JSON.stringify(body))
}

export function makeSiteHandler(deps: SiteDeps | (() => SiteDeps) = () => ({ store: storeFromEnv() })) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return send(res, 204, {})
    if (req.method !== "POST") return send(res, 405, { error: "method", message: "Use POST." }, { allow: "POST, OPTIONS" })
    let body: Record<string, unknown>
    try {
      const given = (req as IncomingMessage & { body?: unknown }).body
      const parsed = typeof given === "string" ? JSON.parse(given) : given !== undefined && given !== null ? given : JSON.parse((await readBody(req)) || "{}")
      body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>
    } catch {
      return send(res, 400, { error: "bad_request", message: "The request could not be read." })
    }
    const d = typeof deps === "function" ? deps() : deps
    const out = await handleSite({ ...body, action: body["action"], client: clientOf(req) }, d)
    send(res, out.status, out.body, out.headers)
  }
}

export default makeSiteHandler()
