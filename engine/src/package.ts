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
import { makeZip, toBase64 } from "./zip"

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


export const PLUGIN_SLUG = "airtime-business-card"

/** A one-file WordPress plugin that prints the business card first in the page head. Data sits in a nowdoc: PHP reads it as plain text. */
export function wordpressPlugin(jsonld: Record<string, unknown>): string {
  return [
    "<?php",
    "/**",
    " * Plugin Name: Airtime Business Card",
    " * Description: Adds the business card AI assistants read (name, description, contact, address) to the head of every page. Added by Airtime. To undo it, deactivate and delete this plugin.",
    " * Version: 1.0.0",
    " */",
    "",
    "if ( ! defined( 'ABSPATH' ) ) {",
    "\texit;",
    "}",
    "",
    "add_action( 'wp_head', function () {",
    "\tif ( ! is_front_page() ) {",
    "\t\treturn;",
    "\t}",
    "\t$card = <<<'AIRTIME_JSON'",
    safeJson(jsonld),
    "AIRTIME_JSON;",
    "\techo \"<script type=\\\"application/ld+json\\\">\\n\" . $card . \"\\n</script>\\n\";",
    "}, 1 );",
    "",
  ].join("\n")
}

export const WORDPRESS_STEPS: Bilingual[] = [
  b("If you use Yoast SEO or Rank Math, the steps under How to do it are the tidier way, since they keep one business card. Use this plugin when you do not use one of them, or when those steps do not work for you.",
    "Kalau Anda memakai Yoast SEO atau Rank Math, langkah di Cara mengerjakannya lebih rapi karena kartu bisnisnya tetap satu. Pakai plugin ini kalau Anda tidak memakai salah satunya, atau langkah itu tidak berhasil."),
  b("Download the plugin file below (airtime-business-card.zip).", "Unduh berkas plugin di bawah (airtime-business-card.zip)."),
  b("In your WordPress dashboard open Plugins, then Add New Plugin, then Upload Plugin. Choose the zip file and click Install Now.", "Di dashboard WordPress buka Plugins, lalu Add New Plugin, lalu Upload Plugin. Pilih berkas zip dan klik Install Now."),
  b("Click Activate Plugin.", "Klik Activate Plugin."),
  b("Press Re-check at the top of this page. When the check passes, the item is marked done on its own.", "Tekan Periksa ulang di bagian atas halaman ini. Begitu pemeriksaannya lulus, item ini ditandai selesai dengan sendirinya."),
]

export const WORDPRESS_UNDO: Bilingual[] = [
  b("Open Plugins, find Airtime Business Card, click Deactivate, then Delete. Nothing else changes.", "Buka Plugins, cari Airtime Business Card, klik Deactivate, lalu Delete. Tidak ada yang lain yang berubah."),
]

export interface PackageChoice {
  key: string
  label: Bilingual
  options: { value: "yes" | "no"; label: Bilingual }[]
}

export interface PackageFact {
  kind: string
  value: string
  source: string
  label: string
  label_id: string
}

export interface BusinessCardPackage {
  id: "business_card" | "llms_txt" | "content_signals"
  platform: "shopify" | "wordpress"
  /** the checks still open that this package is meant to fix */
  covers: string[]
  /** what the package will not fix yet, in the data's own words: description, contactPoint, address */
  missing: string[]
  jsonld?: Record<string, unknown>
  snippetName: string
  renderLine: string
  files: { name: string; content: string }[]
  steps: Bilingual[]
  undo: Bilingual[]
  facts: PackageFact[]
  /** questions only the owner can answer; the file is complete once each has an answer, and `placeholder` is replaced by them */
  choices?: PackageChoice[]
  placeholder?: string
  /** a file to hand over as it is, when the platform wants a zip */
  download?: { name: string; type: string; base64: string }
}

export type PackageResult =
  | { ready: true; package: BusinessCardPackage }
  | { ready: false; reason: "platform" | "nothing_found" | "already_done"; platform?: string }

type Drafts = Record<string, Record<string, unknown>>
const filled = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : Boolean(v))

/** The package for this scan, or why there is none. `fixes` is the Fixer's list, `drafts` what it prepared. */
export function businessCard(platform: string, drafts: Drafts | undefined, fixes: Fix[]): PackageResult {
  const covers = COVERS.filter((id) => fixes.some((f) => f.check_id === id && f.status !== "platform_held"))
  if (covers.length === 0) return { ready: false, reason: "already_done" }
  if (platform !== "shopify" && platform !== "wordpress") return { ready: false, reason: "platform", platform }
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
  if (platform === "wordpress") {
    const php = { name: `${PLUGIN_SLUG}/${PLUGIN_SLUG}.php`, content: wordpressPlugin(jsonld) }
    return {
      ready: true,
      package: {
        id: "business_card", platform, covers: [...covers], missing, jsonld, snippetName: PLUGIN_SLUG, renderLine: "",
        files: [php], steps: WORDPRESS_STEPS, undo: WORDPRESS_UNDO, facts,
        download: { name: `${PLUGIN_SLUG}.zip`, type: "application/zip", base64: toBase64(makeZip([php])) },
      },
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

export const LLMS_SLUG = "airtime-llms-txt"

/** A one-file WordPress plugin that answers /llms.txt with the text written from the site's own pages. */
export function llmsPlugin(text: string): string {
  // the closing word of the nowdoc must not appear in the text at all, whatever the text is
  let mark = "AIRTIME_TXT"
  for (let i = 1; text.includes(mark); i++) mark = `AIRTIME_TXT_${i}`
  return [
    "<?php",
    "/**",
    " * Plugin Name: Airtime llms.txt",
    " * Description: Answers /llms.txt with a short introduction of the business for AI assistants. Added by Airtime. To undo it, deactivate and delete this plugin.",
    " * Version: 1.0.0",
    " */",
    "",
    "if ( ! defined( 'ABSPATH' ) ) {",
    "\texit;",
    "}",
    "",
    "add_action( 'init', function () {",
    "\t$path = isset( $_SERVER['REQUEST_URI'] ) ? wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH ) : '';",
    "\tif ( wp_parse_url( home_url( '/llms.txt' ), PHP_URL_PATH ) !== $path ) {",
    "\t\treturn;",
    "\t}",
    `\t$text = <<<'${mark}'`,
    text.replace(/\r/g, "").replace(/\n+$/, ""),
    `${mark};`,
    "\tstatus_header( 200 );",
    "\theader( 'Content-Type: text/plain; charset=utf-8' );",
    "\techo $text . \"\\n\";",
    "\texit;",
    "}, 1 );",
    "",
  ].join("\n")
}

export const LLMS_STEPS: Bilingual[] = [
  b("Read the text in the box first. It was written only from your own pages. You can change any line in the file before you install it.", "Baca dulu teks di kotak. Teks itu ditulis hanya dari halaman Anda sendiri. Anda boleh mengubah baris mana pun di berkas sebelum memasangnya."),
  b("Download the plugin file below (airtime-llms-txt.zip).", "Unduh berkas plugin di bawah (airtime-llms-txt.zip)."),
  b("In your WordPress dashboard open Plugins, then Add New Plugin, then Upload Plugin. Choose the zip file and click Install Now.", "Di dashboard WordPress buka Plugins, lalu Add New Plugin, lalu Upload Plugin. Pilih berkas zip dan klik Install Now."),
  b("Click Activate Plugin. Then open your-site/llms.txt in a browser: you should see the text.", "Klik Activate Plugin. Lalu buka situs-anda/llms.txt di browser: Anda akan melihat teksnya."),
  b("Press Re-check at the top of this page. When the check passes, the item is marked done on its own.", "Tekan Periksa ulang di bagian atas halaman ini. Begitu pemeriksaannya lulus, item ini ditandai selesai dengan sendirinya."),
]

export const LLMS_UNDO: Bilingual[] = [
  b("Open Plugins, find Airtime llms.txt, click Deactivate, then Delete. Nothing else changes.", "Buka Plugins, cari Airtime llms.txt, klik Deactivate, lalu Delete. Tidak ada yang lain yang berubah."),
]

export function llmsPackage(platform: string, text: string | undefined, fixes: Fix[]): PackageResult {
  if (!fixes.some((f) => f.check_id === "llms_txt" && f.status !== "platform_held")) return { ready: false, reason: "already_done" }
  // Shopify cannot answer at /llms.txt, so there is nothing honest to hand over there.
  if (platform !== "wordpress") return { ready: false, reason: "platform", platform }
  if (!text) return { ready: false, reason: "nothing_found" }
  const php = { name: `${LLMS_SLUG}/${LLMS_SLUG}.php`, content: llmsPlugin(text) }
  return {
    ready: true,
    package: {
      id: "llms_txt", platform: "wordpress", covers: ["llms_txt"], missing: [], snippetName: LLMS_SLUG, renderLine: "",
      files: [{ name: "llms.txt", content: text.endsWith("\n") ? text : text + "\n" }, php], steps: LLMS_STEPS, undo: LLMS_UNDO, facts: [],
      download: { name: `${LLMS_SLUG}.zip`, type: "application/zip", base64: toBase64(makeZip([php])) },
    },
  }
}

/** For each open check: the package the Fixer can hand over, or why it cannot. Checks with no entry have no package at all. */
export function packagesFor(platformGiven: string, drafts: Drafts | undefined, fixes: Fix[], llms: string | undefined): Record<string, PackageResult> {
  const platform = platformGiven === "woocommerce" ? "wordpress" : platformGiven
  const out: Record<string, PackageResult> = {}
  const card = businessCard(platform, drafts, fixes)
  for (const id of COVERS) if (fixes.some((f) => f.check_id === id)) out[id] = card
  if (fixes.some((f) => f.check_id === "llms_txt")) out["llms_txt"] = llmsPackage(platform, llms, fixes)
  if (fixes.some((f) => f.check_id === "content_signals")) out["content_signals"] = signalsPackage(platform, fixes)
  return out
}

export const SIGNALS_PLACEHOLDER = "__CONTENT_SIGNAL_VALUES__"
export const ROBOTS_NAME = "robots.txt.liquid"

/**
 * Shopify's own robots.txt, written out again with one added line in the group for every crawler. The loop is Shopify's
 * documented default for this template; the added line is put between two line breaks of its own, so that whatever Shopify
 * puts after its lines, the new line can never be glued to another one. Deleting the file gives back Shopify's default.
 */
export function robotsLiquid(values: string = SIGNALS_PLACEHOLDER): string {
  return [
    "{% comment %}",
    "  Added by Airtime: tells AI companies what they may do with your content (Content-Signal).",
    `  To undo it, delete this file (${ROBOTS_NAME}). Shopify then goes back to its own default robots.txt.`,
    "{% endcomment %}",
    "{%- capture nl %}",
    "{% endcapture -%}",
    "{%- for group in robots.default_groups -%}",
    "  {{- group.user_agent }}",
    "  {%- if group.user_agent.value == '*' -%}",
    `    {{- nl }}Content-Signal: ${values}{{ nl }}`,
    "  {%- endif -%}",
    "  {%- for rule in group.rules -%}",
    "    {{ rule }}",
    "  {%- endfor -%}",
    "  {%- if group.sitemap != blank -%}",
    "    {{ group.sitemap }}",
    "  {%- endif %}",
    "{% endfor %}",
    "",
  ].join("\n")
}

export const ROBOTS_STEPS: Bilingual[] = [
  b("Answer the three questions above. They are yours to decide, so nothing is chosen for you. The file appears when all three are answered.", "Jawab tiga pertanyaan di atas. Ini keputusan Anda, jadi tidak ada yang dipilihkan. Berkasnya muncul setelah ketiganya dijawab."),
  b("In Online Store, Themes, open the three dots (…) of your LIVE theme and choose Edit code. This file only works on the live theme, so a copy cannot be used to try it first.", "Di Online Store, Themes, buka titik tiga (…) tema yang AKTIF dan pilih Edit code. Berkas ini hanya bekerja di tema yang aktif, jadi salinan tidak bisa dipakai untuk mencobanya dulu."),
  b("Under Templates click Add a new template, choose robots.txt from the list, and confirm. Shopify creates a file called robots.txt.liquid.", "Di bawah Templates klik Add a new template, pilih robots.txt dari daftar, dan konfirmasi. Shopify membuat berkas bernama robots.txt.liquid."),
  b("Delete everything in that file, paste the code from the box below, and click Save.", "Hapus semua isi berkas itu, tempel kode dari kotak di bawah, lalu klik Save."),
  b("Open your-site/robots.txt in a browser. Under User-agent: * you should see a line starting with Content-Signal, and all your other lines still there. If anything looks wrong, delete the file (see How to undo it).", "Buka situs-anda/robots.txt di browser. Di bawah User-agent: * harus ada baris yang diawali Content-Signal, dan semua baris Anda yang lain tetap ada. Kalau ada yang terlihat salah, hapus berkasnya (lihat Cara membatalkannya)."),
  b("Press Re-check at the top of this page. When the check passes, the item is marked done on its own.", "Tekan Periksa ulang di bagian atas halaman ini. Begitu pemeriksaannya lulus, item ini ditandai selesai dengan sendirinya."),
]

export const ROBOTS_UNDO: Bilingual[] = [
  b(`Open Edit code, find ${ROBOTS_NAME} under Templates, and delete the file. Shopify goes back to its own default robots.txt.`, `Buka Edit code, cari ${ROBOTS_NAME} di bawah Templates, dan hapus berkasnya. Shopify kembali ke robots.txt bawaannya.`),
]

const YES_NO: PackageChoice["options"] = [
  { value: "yes", label: b("Yes", "Ya") },
  { value: "no", label: b("No", "Tidak") },
]

export const SIGNAL_CHOICES: PackageChoice[] = [
  { key: "ai-train", label: b("May AI companies train their models on your content?", "Bolehkah perusahaan AI melatih model mereka dengan konten Anda?"), options: YES_NO },
  { key: "search", label: b("May your content appear in AI search results?", "Bolehkah konten Anda muncul di hasil pencarian AI?"), options: YES_NO },
  { key: "ai-input", label: b("May an AI use your content to answer a customer's question?", "Bolehkah AI memakai konten Anda untuk menjawab pertanyaan pelanggan?"), options: YES_NO },
]

export function signalsPackage(platform: string, fixes: Fix[]): PackageResult {
  if (!fixes.some((f) => f.check_id === "content_signals" && f.status !== "platform_held")) return { ready: false, reason: "already_done" }
  // WordPress keeps robots.txt in its SEO plugin, which is a different job; only Shopify has a file for it here.
  if (platform !== "shopify") return { ready: false, reason: "platform", platform }
  return {
    ready: true,
    package: {
      id: "content_signals", platform: "shopify", covers: ["content_signals"], missing: [], snippetName: ROBOTS_NAME, renderLine: "",
      files: [{ name: ROBOTS_NAME, content: robotsLiquid() }], steps: ROBOTS_STEPS, undo: ROBOTS_UNDO, facts: [],
      choices: SIGNAL_CHOICES, placeholder: SIGNALS_PLACEHOLDER,
    },
  }
}
