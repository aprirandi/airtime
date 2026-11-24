import { describe, expect, it } from "vitest"
import { buildQuestions, containsTerm, geminiProvider, ProfileError, ProviderError, runAsker, validateProfile, type AskProvider, type Profile } from "../src/asker"

const profile: Profile = { name: "Handworks", aliases: ["Hand Works"], city: "Melbourne", country: "Australia", areas: ["Prahran", "Brighton"], categories: ["stationery", "greeting cards", "gifts"] }

describe("what the client types", () => {
  it("is cleaned up and given the same shape every time", () => {
    const p = validateProfile({ name: "  Hand\u0000works <b>  ", aliases: "Hand Works, Hand Works,  HW ", city: " Melbourne ", areas: "Prahran\nBrighton, ", categories: ["stationery", "", "gifts"] })
    expect(p).toEqual({ name: "Hand works b", aliases: ["Hand Works", "HW"], city: "Melbourne", country: "", areas: ["Prahran", "Brighton"], categories: ["stationery", "gifts"] })
  })
  it("caps how much is kept", () => {
    const p = validateProfile({ name: "x".repeat(500), city: "c", categories: Array.from({ length: 20 }, (_, i) => `cat${i}`), areas: Array.from({ length: 20 }, (_, i) => `a${i}`) })
    expect(p.name.length).toBe(80)
    expect(p.categories).toHaveLength(4)
    expect(p.areas).toHaveLength(4)
  })
  it.each([[{}, /name/], [{ name: "A" }, /city/], [{ name: "A", city: "B" }, /sell/], [null, /name/], ["x", /name/]])("refuses %j", (raw, message) => {
    expect(() => validateProfile(raw)).toThrow(ProfileError)
    expect(() => validateProfile(raw)).toThrow(message)
  })
})

describe("the questions", () => {
  it("never name the business, never repeat, and are the same for the same profile", () => {
    const q = buildQuestions(profile)
    expect(q.length).toBe(6)
    expect(new Set(q).size).toBe(6)
    expect(q.every((x) => !/handworks|hand works/i.test(x))).toBe(true)
    expect(buildQuestions(profile)).toEqual(q)
    expect(q[0]).toBe("Best stationery shops in Melbourne")
  })
  it("still make enough questions for one category and no area", () => {
    const q = buildQuestions({ ...profile, areas: [], categories: ["bikes"], country: "Australia" })
    expect(q).toHaveLength(4)
    expect(q.every((x) => x.includes("Melbourne"))).toBe(true)
    expect(q[0]).toBe("Best bikes shops in Melbourne, Australia")
  })
})

describe("finding a name in an answer", () => {
  it.each([
    ["Try Handworks in Prahran.", "Handworks", true],
    ["try HAND-WORKS stationery", "Hand Works", true],
    ["Café Münch is great", "cafe munch", true],
    ["Handworksmith is another shop", "Handworks", false],
    ["Mr Handworks Jr", "Handworks", true],
    ["nothing here", "Handworks", false],
    ["anything", "", false],
  ])("%j has %j: %s", (text, term, yes) => expect(containsTerm(text, term)).toBe(yes))
})

function fake(answers: Record<string, string | Error>, extraction: (n: number) => unknown = () => ({ answers: [] })): AskProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    model: "fake-ask", calls,
    async ask(q) {
      calls.push(q)
      const a = answers[q] ?? "Some shops exist."
      if (a instanceof Error) throw a
      return a
    },
    async complete(prompt) {
      calls.push("complete")
      return JSON.stringify(extraction(prompt.split("ANSWER ").length - 1))
    },
  }
}

describe("a run", () => {
  it("counts the answers that name the business, by looking for its name", async () => {
    const q = buildQuestions(profile)
    const p = fake({ [q[0]!]: "Handworks and Kikki are good.", [q[1]!]: "Try Kikki." })
    const r = await runAsker(profile, p)
    expect([r.asked, r.answered, r.named]).toEqual([6, 6, 1])
    expect(r.items[0]!.named).toBe(true)
    expect(r.items[1]!.named).toBe(false)
  })

  it("keeps another shop only when its quote is really in the answer, and never lists the business itself", async () => {
    const q = buildQuestions(profile)
    const p = fake(
      { [q[0]!]: "Handworks is nice, but Kikki K on Chapel St sells journals too.", [q[1]!]: "Visit Milligram for cards." },
      () => ({ answers: [
        { n: 1, stores: [{ name: "Handworks", quote: "Handworks is nice" }, { name: "Kikki K", quote: "Kikki K on Chapel St sells journals" }, { name: "Invented Co", quote: "Invented Co is the best" }] },
        { n: 2, stores: [{ name: "Milligram", quote: "Visit Milligram for cards" }, { name: "milligram", quote: "Visit Milligram" }] },
        { n: 99, stores: [{ name: "Ghost", quote: "x" }] },
      ] })
    )
    const r = await runAsker(profile, p)
    expect(r.readOthers).toBe(true)
    expect(r.items[0]!.others.map((o) => o.name)).toEqual(["Kikki K"])
    expect(r.items[1]!.others.map((o) => o.name)).toEqual(["Milligram"])
    expect(r.rivals).toEqual([{ name: "Kikki K", count: 1 }, { name: "Milligram", count: 1 }])
  })

  it("still reports the counts when the other shops cannot be read", async () => {
    const p = fake({}, () => "not an object")
    ;(p as { complete: unknown }).complete = async () => "this is not json"
    const r = await runAsker(profile, p)
    expect(r.readOthers).toBe(false)
    expect(r.answered).toBe(6)
  })

  it("does not break when an assistant fails, and stops at once when the daily quota is gone", async () => {
    const q = buildQuestions(profile)
    const some = await runAsker(profile, fake({ [q[2]!]: new ProviderError("x", "rate") }))
    expect([some.asked, some.answered]).toEqual([6, 5])
    expect(some.items[2]!.failed).toBe(true)
    const calls: string[] = []
    const quota: AskProvider = { model: "m", ask: async (x) => { calls.push(x); throw new ProviderError("q", "quota") }, complete: async () => "{}" }
    const r = await runAsker(profile, quota, 1)
    expect(r.answered).toBe(0)
    expect(calls.length).toBe(1)
  })

  it("asks no more than two questions at once", async () => {
    let live = 0
    let peak = 0
    const p: AskProvider = {
      model: "m",
      ask: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return "ok" },
      complete: async () => "{}",
    }
    await runAsker(profile, p)
    expect(peak).toBe(2)
  })
})

describe("Gemini over REST", () => {
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })

  it("sends the key in a header, asks for low thinking, and drops the model's thoughts", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = []
    const g = geminiProvider("KEY", { ask: "ask-model", work: "work-model" }, async (url, init) => {
      seen.push({ url, headers: init.headers, body: init.body })
      return reply(200, { candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "Try Handworks." }] } }] })
    })
    expect(await g.ask("Best shops?")).toBe("Try Handworks.")
    expect(seen[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/ask-model:generateContent")
    expect(seen[0]!.headers["x-goog-api-key"]).toBe("KEY")
    expect(seen[0]!.url).not.toContain("KEY")
    expect(JSON.parse(seen[0]!.body).generationConfig.thinkingConfig.thinkingLevel).toBe("low")
    await g.complete("p", { type: "OBJECT" }, "sys")
    expect(seen[1]!.url).toContain("work-model")
    expect(JSON.parse(seen[1]!.body).generationConfig).toMatchObject({ temperature: 0, responseMimeType: "application/json" })
  })

  it("tries once more after a busy answer, and gives up after that", async () => {
    let n = 0
    const waits: number[] = []
    const busy = geminiProvider("K", { ask: "a", work: "w" }, async () => (n++, reply(503, "busy")), async (ms) => { waits.push(ms) })
    await expect(busy.ask("q")).rejects.toMatchObject({ kind: "rate" })
    expect([n, waits]).toEqual([2, [2000]])
    let m = 0
    const flaky = geminiProvider("K", { ask: "a", work: "w" }, async () => (m++ === 0 ? reply(429, "slow down") : reply(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] })), async () => {})
    expect(await flaky.ask("q")).toBe("ok")
  })

  it("tells the daily quota from a short wait, and a refusal from both", async () => {
    const daily = geminiProvider("K", { ask: "a", work: "w" }, async () => reply(429, "Quota exceeded for metric ... PerDay"))
    await expect(daily.ask("q")).rejects.toMatchObject({ kind: "quota" })
    const denied = geminiProvider("K", { ask: "a", work: "w" }, async () => reply(403, "no"))
    await expect(denied.ask("q")).rejects.toMatchObject({ kind: "other" })
  })
})
