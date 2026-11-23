import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { httpFetcher, isPrivateAddress, MAX_BYTES } from "../src/http"

let server: http.Server
let base = ""

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/"
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/plain", "x-seen-ua": String(req.headers["user-agent"]), "x-seen-accept": String(req.headers["accept"]) })
      res.end("hello")
    } else if (url === "/a") res.writeHead(301, { location: "/b" }).end()
    else if (url === "/b") res.writeHead(302, { location: "/ok" }).end()
    else if (url === "/loop") res.writeHead(302, { location: "/loop" }).end()
    else if (url === "/to-private") res.writeHead(302, { location: "http://10.0.0.5/secret" }).end()
    else if (url === "/big") {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("x".repeat(MAX_BYTES + 5000))
    } else if (url === "/slow") setTimeout(() => res.end("late"), 2000)
    else if (url === "/headers") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Object.keys(req.headers).sort()))
    else if (url === "/404") res.writeHead(404, { "content-type": "text/html" }).end("<h1>no</h1>")
    else res.writeHead(500).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe("the fetcher never reaches private addresses", () => {
  it.each([
    ["127.0.0.1", true], ["10.1.2.3", true], ["172.16.0.1", true], ["172.32.0.1", false], ["192.168.1.1", true],
    ["169.254.169.254", true], ["100.64.0.1", true], ["0.0.0.0", true], ["224.0.0.1", true], ["8.8.8.8", false],
    ["93.184.216.34", false], ["::1", true], ["::", true], ["fd00::1", true], ["fe80::1", true], ["::ffff:10.0.0.1", true],
    ["2606:4700:4700::1111", false],
  ])("%s private: %s", (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected))

  it("refuses a literal private address", async () => {
    const r = await httpFetcher()(`${base}/ok`)
    expect(r.status).toBe(0)
    expect(r.error).toMatch(/refused/)
  })

  it("refuses a name that resolves to a private address, at the moment of connecting", async () => {
    const port = base.split(":").pop()
    const r = await httpFetcher()(`http://localhost:${port}/ok`)
    expect(r.status).toBe(0)
    expect(r.error).toMatch(/refused|not a public address/)
  })

  it("refuses other schemes", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "not a url"]) {
      const r = await httpFetcher()(url)
      expect(r.status, url).toBe(0)
      expect(r.error, url).toMatch(/unsupported URL/)
    }
  })
})

describe("the fetcher reads pages like the Python one", () => {
  const f = httpFetcher({ allowPrivate: true })

  it("sends our user agent and the Accept header it was given", async () => {
    const plain = await f(`${base}/ok`)
    expect(plain.status).toBe(200)
    expect(plain.text).toBe("hello")
    expect(plain.header("x-seen-ua")).toMatch(/^AirtimeAuditor/)
    expect(plain.header("x-seen-accept")).toBe("*/*")
    const custom = await f(`${base}/ok`, { headers: { Accept: "text/markdown" }, userAgent: "Claude-User/1.0" })
    expect(custom.header("x-seen-ua")).toBe("Claude-User/1.0")
    expect(custom.header("x-seen-accept")).toBe("text/markdown")
    expect(custom.contentType).toBe("text/plain")
  })

  it("sends only the headers we choose, so a site is not served differently from how the Python engine saw it", async () => {
    const r = await f(`${base}/headers`)
    const sent = JSON.parse(r.text) as string[]
    expect(sent).toEqual(["accept", "connection", "host", "user-agent"])
  })

  it("follows redirects by hand and records the chain", async () => {
    const r = await f(`${base}/a`)
    expect(r.status).toBe(200)
    expect(r.chain.map(([s]) => s)).toEqual([301, 302])
    expect(r.finalUrl).toBe(`${base}/ok`)
  })

  it("gives up on a redirect loop", async () => {
    const r = await f(`${base}/loop`)
    expect(r.status).toBe(0)
    expect(r.error).toBe("too many redirects")
  })

  it("keeps at most 1.5 MB of a page", async () => {
    const r = await f(`${base}/big`)
    expect(r.body.length).toBe(MAX_BYTES)
    expect(r.truncated).toBe(true)
  })

  it("times out", async () => {
    const r = await httpFetcher({ allowPrivate: true, timeoutMs: 300 })(`${base}/slow`)
    expect(r.status).toBe(0)
    expect(r.error).toBeTruthy()
  })

  it("keeps the body of an error page", async () => {
    const r = await f(`${base}/404`)
    expect(r.status).toBe(404)
    expect(r.text).toBe("<h1>no</h1>")
  })
})
