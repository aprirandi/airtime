import { describe, expect, it } from "vitest"
import replay from "./replay.json"
import { rowsFor } from "../src/audit"
import { Response, type Fetcher } from "../src/http"
import { allPrompt } from "../src/prompts"
import { coverage, gaps, limitedGaps, scoreRows } from "../src/score"
import { collect } from "../src/snapshot"

// replay.json is written by the Python engine (python tests/engine_replay.py): recorded visits to fake sites and
// what the Python engine concluded from them. The TypeScript engine sees the same responses and must conclude the same.

type Call = (typeof replay.scenarios)[number]["calls"][number]

function replayer(calls: Call[]): { fetch: Fetcher; missing: string[] } {
  const byKey = new Map(calls.map((c) => [`${c.url}|${c.accept}|${c.ua}`, c]))
  const missing: string[] = []
  const fetch: Fetcher = async (url, options) => {
    const key = `${url}|${options?.headers?.["Accept"] ?? ""}|${options?.userAgent ?? ""}`
    const c = byKey.get(key)
    if (!c) {
      missing.push(key)
      return new Response(url, { error: "not recorded" })
    }
    const bodies = replay.bodies as Record<string, string>
    return new Response(c.url, {
      status: c.status, finalUrl: c.final_url, headers: c.headers as Record<string, string>,
      body: new Uint8Array(Buffer.from(bodies[c.body] as string, "base64")),
      chain: c.chain as [number, string][], error: c.error, truncated: c.truncated,
    })
  }
  return { fetch, missing }
}

describe("the TypeScript engine reaches the Python engine's conclusions", () => {
  for (const sc of replay.scenarios) {
    it(sc.name, async () => {
      const { fetch, missing } = replayer(sc.calls)
      const snap = await collect(fetch, { baseUrl: sc.base_url, platform: sc.platform, productUrl: sc.product_url })
      expect(missing, "requests the Python engine never made").toEqual([])
      expect(snap.base).toBe(sc.expected.base)
      const rows = rowsFor(snap, sc.platform)
      // one assertion per check so a failure names the check
      sc.expected.rows.forEach((want, i) => {
        const got = rows[i]
        expect({ id: got?.check_id, result: got?.result, percent: got?.percent, evidence: got?.evidence, details: JSON.parse(JSON.stringify(got?.details)), scored: got?.scored, controlled_by: got?.controlled_by }, want.check_id)
          .toEqual({ id: want.check_id, result: want.result, percent: want.percent, evidence: want.evidence, details: want.details, scored: want.scored, controlled_by: want.controlled_by })
      })
      expect(scoreRows(rows)).toEqual(sc.expected.score)
      expect(gaps(rows).map((r) => r.check_id)).toEqual(sc.expected.gaps)
      expect(limitedGaps(rows).map((r) => r.check_id)).toEqual(sc.expected.limited)
      expect(coverage(rows)).toEqual(sc.expected.coverage)
      const gapRows = gaps(rows).map((g) => ({ check_id: g.check_id, tier: g.tier, evidence: g.evidence, details: (g as (typeof rows)[number]).details }))
      expect(allPrompt(gapRows, snap.base, sc.platform, "en", "2026-11-23")).toBe(sc.expected.prompt_all)
    })
  }
})
