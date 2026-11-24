/**
 * "How to do it" for one fix, in the owner's words: what to do, the step for their platform, the text we already
 * prepared from their own pages (when there is some), and how to check it. Built from the check registry, so every
 * check has a guide. Until the Fixer can change a website itself, this is how a fix gets done.
 */
import { BY_ID } from "./registry"
import { TUTORIALS } from "./tutorials"

export interface Bilingual {
  en: string
  id: string
}

export interface Guide {
  /** true when an owner with no technical skills can do it; false when it needs a developer or an AI assistant */
  owner: boolean
  steps: Bilingual[]
  /** What the check asks for, in technical words, for whoever does the work */
  developer?: Bilingual
  /** Text to paste, when the Fixer prepared one */
  code?: { label: Bilingual; text: string }
  /** For a developer: a command that shows the result */
  verify?: { command: string; en: string; id: string }
}

const WHERE_TO_PASTE: Record<string, Bilingual> = {
  wordpress: {
    en: "In WordPress, open your SEO plugin (for example Yoast or Rank Math), find its organization or schema settings and enter these details. If your plugin has no such place, paste the code below into the header of your theme, before the closing head tag.",
    id: "Di WordPress, buka plugin SEO Anda (misalnya Yoast atau Rank Math), cari pengaturan organisasi atau skema, lalu isi detail ini. Kalau plugin Anda tidak punya tempatnya, tempel kode di bawah ke header tema Anda, sebelum tag head ditutup.",
  },
  shopify: {
    en: "In Shopify, open Online Store, Themes, Edit code, and open theme.liquid. Paste the code below just before the closing head tag, then save.",
    id: "Di Shopify, buka Online Store, Themes, Edit code, lalu buka theme.liquid. Tempel kode di bawah tepat sebelum tag head ditutup, lalu simpan.",
  },
  other: {
    en: "Paste the code below into the header of every page, before the closing head tag. Most website builders have a custom code or header scripts box for this.",
    id: "Tempel kode di bawah ke header setiap halaman, sebelum tag head ditutup. Kebanyakan pembuat website punya kotak kode kustom atau skrip header untuk ini.",
  },
}
WHERE_TO_PASTE["woocommerce"] = WHERE_TO_PASTE["wordpress"] as Bilingual

const CHECK_FIRST: Bilingual = {
  en: "Read the details we prepared from your own pages and correct anything that is wrong. Nothing is published until you paste it.",
  id: "Baca detail yang kami siapkan dari halaman Anda sendiri dan perbaiki yang salah. Tidak ada yang terbit sampai Anda menempelkannya.",
}
const THEN_RECHECK: Bilingual = {
  en: "Press Re-check at the top of this page. When the check passes, this item is marked as done on its own.",
  id: "Tekan Periksa ulang di bagian atas halaman ini. Begitu pemeriksaannya lulus, item ini ditandai selesai dengan sendirinya.",
}
const CODE_LABEL: Bilingual = { en: "Code to paste", id: "Kode untuk ditempel" }

/** JSON-LD as a script tag. "<" is escaped so no text from a page can close the tag early. */
export function scriptTag(jsonld: Record<string, unknown>): string {
  const body = JSON.stringify(jsonld, null, 2).replace(/</g, "\\u003c")
  return `<script type="application/ld+json">\n${body}\n</script>`
}

export function buildGuide(checkId: string, platform: string, draft?: Record<string, unknown>): Guide | null {
  const check = BY_ID[checkId]
  if (!check) return null
  const tutorial = TUTORIALS[checkId]
  const key = platform === "woocommerce" ? "wordpress" : platform
  const own = (tutorial?.platforms as Record<string, Bilingual[] | undefined> | undefined)?.[key]
  const steps: Bilingual[] = [...(own ?? tutorial?.steps ?? [{ en: check.fix, id: check.fix_id }])]
  const guide: Guide = { owner: tutorial?.owner ?? false, steps, developer: { en: check.fix, id: check.fix_id } }
  const hint = check.platform_fix[platform]
  if (hint) guide.developer = { en: `${check.fix} ${hint.en}`, id: `${check.fix_id} ${hint.id}` }
  if (draft) {
    steps.push(CHECK_FIRST, WHERE_TO_PASTE[platform] ?? (WHERE_TO_PASTE["other"] as Bilingual))
    guide.code = { label: CODE_LABEL, text: scriptTag(draft) }
  }
  if (tutorial?.owner !== false) steps.push(THEN_RECHECK)
  if (check.verify) guide.verify = check.verify
  return guide
}
