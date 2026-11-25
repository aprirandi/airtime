import { describe, expect, it } from "vitest"
import { profileHint, siteSummary, type FactsSource } from "../src/fixer"
import { parsePage } from "../src/html"

const page = (html: string) => [{}, parsePage(html)] as [unknown, ReturnType<typeof parsePage>]
const snap = (home: string, contact?: string): FactsSource => ({ base: "https://shop.example", homePage: parsePage(home), trust: { contact: contact ? page(contact) : null, about: null } })

describe("who and where, from the pages", () => {
  it("takes the name from the site and the places from the addresses on its contact page", () => {
    const s = snap('<html><head><meta property="og:site_name" content="Handworks"></head><body><h1>Handworks</h1></body></html>',
      "<body><p>Prahran 244 Chapel St VIC 3181 ph (03)9533 8566 Brighton 80 Church Street VIC 3186</p></body>")
    expect(profileHint(s)).toEqual({ name: "Handworks", city: "Prahran", country: "Australia", areas: ["Brighton"] })
  })
  it("says nothing about a place the pages do not give", () => {
    expect(profileHint(snap("<body><h1>Shop</h1></body>"))).toEqual({ name: "shop.example", city: "", country: "", areas: [] })
  })
})

describe("a few lines of the homepage", () => {
  it("keeps the title, the description, the main headings and the start of the text, cut to size", () => {
    const html = `<html><head><meta property="og:title" content="${"T".repeat(200)}"><meta name="description" content="Cards   and gifts"></head><body>` +
      "<h1>Cards</h1><h2>Gifts</h2><h3>Small print</h3>" + Array.from({ length: 12 }, (_, i) => `<h2>Heading ${i}</h2>`).join("") + `<p>${"word ".repeat(300)}</p></body></html>`
    const r = siteSummary(snap(html))
    expect(r.title.length).toBe(100)
    expect(r.description).toBe("Cards and gifts")
    expect(r.headings.length).toBe(8)
    expect(r.headings.slice(0, 2)).toEqual(["Cards", "Gifts"])
    expect(r.headings).not.toContain("Small print")
    expect([...r.text].length).toBe(600)
  })
})
