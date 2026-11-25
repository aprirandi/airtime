/**
 * The Fixer's package for a Shopify store: what a client installs by hand to fix the business card (the Organization
 * data) without giving us any access. Nothing here touches a website. It takes the draft the Fixer already prepared from
 * the client's own pages and turns it into one theme snippet, the one line that renders it, and the steps to install and
 * undo it.
 *
 * Two things about the snippet matter. The page's data is untrusted text, so it is written so that neither the browser
 * (no "<") nor Shopify's template language (no braces or percent signs inside strings) can read anything into it. And the
 * audit takes the first Organization it meets in the page, so the line that renders the snippet goes right after the
 * opening head tag, ahead of whatever a theme already prints.
 */
import type { Bilingual } from "./guide"
import type { Fix } from "./fixer"

export const SNIPPET_NAME = "airtime-business-card"
export const RENDER_LINE = `{% render '${SNIPPET_NAME}' %}`
const COVERS = ["jsonld_organization", "organization_completeness"] as const

/** JSON for a template: characters a browser or Liquid could act on are written as \uXXXX inside the strings. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/"(?:[^"\\]|\\.)*"/g, (lit) =>
    lit.replace(/[{}<>%&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
  )
}

export function liquidSnippet(jsonld: Record<string, unknown>): string {
  return [
    "{% comment %}",
    "  Added by Airtime: the business card AI assistants read (name, description, contact, address).",
    `  To undo it, delete the line ${RENDER_LINE} from layout/theme.liquid.`,
    "{% endcomment %}",
    "{% raw %}",
    '<script type="application/ld+json">',
    safeJson(jsonld),
    "</script>",
    "{% endraw %}",
    "",
  ].join("\n")
}

const b = (en: string, id: string): Bilingual => ({ en, id })

export const SHOPIFY_STEPS: Bilingual[] = [
  b("Safer first: in Online Store, Themes, open the three dots (…) of your current theme and choose Duplicate. Do the steps below on the copy, look at it with Preview, and publish it only when it looks right.",
    "Lebih aman dulu: di Online Store, Themes, buka titik tiga (…) tema Anda yang aktif dan pilih Duplicate. Kerjakan langkah di bawah pada salinannya, lihat dengan Preview, dan terbitkan hanya kalau sudah benar."),
  b("On that theme, open the three dots (…) and choose Edit code.", "Pada tema itu, buka titik tiga (…) dan pilih Edit code."),
  b(`In the left column, next to Snippets click Add a new snippet. Name it ${SNIPPET_NAME} and confirm.`, `Di kolom kiri, di samping Snippets klik Add a new snippet. Beri nama ${SNIPPET_NAME} dan konfirmasi.`),
  b("Delete anything in the new file, paste the code from the box below (or from the downloaded file), and click Save.", "Hapus isi apa pun di berkas baru, tempel kode dari kotak di bawah (atau dari berkas yang diunduh), lalu klik Save."),
  b(`Open layout, then theme.liquid. Find the line with <head> near the top and add this line directly below it, before anything else: ${RENDER_LINE}`,
    `Buka layout, lalu theme.liquid. Cari baris dengan <head> di dekat bagian atas dan tambahkan baris ini tepat di bawahnya, sebelum yang lain: ${RENDER_LINE}`),
  b("Click Save. Then press Re-check at the top of this page. When the check passes, the item is marked done on its own.", "Klik Save. Lalu tekan Periksa ulang di bagian atas halaman ini. Begitu pemeriksaannya lulus, item ini ditandai selesai dengan sendirinya."),
]

export const SHOPIFY_UNDO: Bilingual[] = [
  b(`Open layout, then theme.liquid, delete the line ${RENDER_LINE}, and click Save. Nothing else changes.`, `Buka layout, lalu theme.liquid, hapus baris ${RENDER_LINE}, dan klik Save. Tidak ada yang lain yang berubah.`),
  b(`If you want, also delete the snippet ${SNIPPET_NAME} from the Snippets list.`, `Kalau mau, hapus juga snippet ${SNIPPET_NAME} dari daftar Snippets.`),
]

export interface PackageFact {
  kind: string
  value: string
  source: string
  label: string
  label_id: string
}

export interface BusinessCardPackage {
  id: "business_card"
  platform: "shopify"
  /** the checks still open that this package is meant to fix */
  covers: string[]
  /** what the package will not fix yet, in the data's own words: description, contactPoint, address */
  missing: string[]
  jsonld: Record<string, unknown>
  snippetName: string
  renderLine: string
  files: { name: string; content: string }[]
  steps: Bilingual[]
  undo: Bilingual[]
  facts: PackageFact[]
}

export type BusinessCard =
  | { ready: true; package: BusinessCardPackage }
  | { ready: false; reason: "platform" | "nothing_found" | "already_done"; platform?: string }

type Drafts = Record<string, Record<string, unknown>>
const filled = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : Boolean(v))

/** The package for this scan, or why there is none. `fixes` is the Fixer's list, `drafts` what it prepared. */
export function businessCard(platform: string, drafts: Drafts | undefined, fixes: Fix[]): BusinessCard {
  const covers = COVERS.filter((id) => fixes.some((f) => f.check_id === id && f.status !== "platform_held"))
  if (covers.length === 0) return { ready: false, reason: "already_done" }
  if (platform !== "shopify") return { ready: false, reason: "platform", platform }
  const card = drafts?.["organization_completeness"] ?? drafts?.["jsonld_organization"]
  if (!card) return { ready: false, reason: "nothing_found" }
  const jsonld: Record<string, unknown> = { ...card }
  const description = drafts?.["jsonld_organization"]?.["description"]
  if (!filled(jsonld["description"]) && filled(description)) jsonld["description"] = description
  const missing = (["description", "contactPoint", "address"] as const).filter((k) => !filled(jsonld[k]))
  const seen = new Set<string>()
  const facts: PackageFact[] = []
  for (const f of fixes) {
    if (!(COVERS as readonly string[]).includes(f.check_id)) continue
    for (const c of f.confirm ?? []) {
      const key = `${c.kind}|${c.value}`
      if (!seen.has(key)) {
        seen.add(key)
        facts.push(c)
      }
    }
  }
  return {
    ready: true,
    package: {
      id: "business_card", platform: "shopify", covers: [...covers], missing, jsonld, snippetName: SNIPPET_NAME, renderLine: RENDER_LINE,
      files: [{ name: `${SNIPPET_NAME}.liquid`, content: liquidSnippet(jsonld) }], steps: SHOPIFY_STEPS, undo: SHOPIFY_UNDO, facts,
    },
  }
}
