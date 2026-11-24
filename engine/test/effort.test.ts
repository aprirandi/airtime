import { describe, expect, it } from "vitest"
import { REGISTRY } from "../src/registry"
import { TUTORIALS } from "../src/tutorials"

const built = REGISTRY.checks.filter((c) => c.status === "built" && c.group !== 4)

describe("how much work each fix is", () => {
  it("is easy, medium or hard for every check", () => {
    for (const c of REGISTRY.checks) expect(["easy", "medium", "hard"], c.id).toContain(c.effort)
  })

  it("agrees with who can do it: an owner never faces a hard fix alone, and a developer's job is never easy", () => {
    for (const c of built) {
      const owner = TUTORIALS[c.id]!.owner
      if (owner) expect(c.effort, c.id).not.toBe("hard")
      else expect(c.effort, c.id).not.toBe("easy")
    }
  })

  it("has some of each, so the filter has something to choose", () => {
    const count = (e: string) => built.filter((c) => c.effort === e).length
    expect([count("easy") > 0, count("medium") > 0, count("hard") > 0]).toEqual([true, true, true])
  })

  it("is on every check an audit returns", async () => {
    const { runAudit } = await import("../src/audit")
    const replay = (await import("./replay.json")).default
    const { Response } = await import("../src/http")
    const sc = replay.scenarios[0]!
    const byKey = new Map(sc.calls.map((c) => [`${c.url}|${c.accept}|${c.ua}`, c]))
    const bodies = replay.bodies as Record<string, string>
    const result = await runAudit(async (url, o) => {
      const c = byKey.get(`${url}|${o?.headers?.["Accept"] ?? ""}|${o?.userAgent ?? ""}`)
      if (!c) return new Response(url, { status: 404, finalUrl: url })
      return new Response(c.url, { status: c.status, finalUrl: c.final_url, headers: c.headers as Record<string, string>, body: new Uint8Array(Buffer.from(bodies[c.body] as string, "base64")), chain: c.chain as [number, string][], error: c.error })
    }, { baseUrl: sc.base_url, platform: "" })
    expect(result.checks.length).toBe(37)
    for (const c of result.checks) expect(["easy", "medium", "hard"], c.id).toContain(c.effort)
    expect(result.checks.find((c) => c.id === "robots_txt")!.effort).toBe("easy")
  })
})
