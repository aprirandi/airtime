/** Read what the Auditor needs from raw HTML (no JavaScript is run, as an AI agent would see it). */
import { Parser } from "htmlparser2"
import { collapse, isDict, pyIter } from "./util"

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"])
const SCRIPT_REDIRECT = /(location\s*\.\s*(href|replace|assign)\s*[=(]|window\.location\s*=)/

export interface Page {
  lang: string
  headings: [number, string][]
  meta: Record<string, string>[]
  linkTags: Record<string, string>[]
  anchors: [string, string][]
  jsonldRaw: string[]
  text: string
  htmlBytes: number
  hasPasswordInput: boolean
  scriptRedirect: boolean
}

export const emptyPage = (): Page => ({
  lang: "", headings: [], meta: [], linkTags: [], anchors: [], jsonldRaw: [], text: "", htmlBytes: 0,
  hasPasswordInput: false, scriptRedirect: false,
})

export function metaContent(page: Page, ...names: string[]): string {
  const wanted = new Set(names.map((n) => n.toLowerCase()))
  for (const attrs of page.meta) {
    const key = (attrs["name"] || attrs["property"] || attrs["http-equiv"] || "").toLowerCase()
    if (wanted.has(key)) return attrs["content"] ?? ""
  }
  return ""
}

export function linkHref(page: Page, rel: string): string {
  for (const attrs of page.linkTags) {
    if ((attrs["rel"] ?? "").toLowerCase().split(/\s+/).filter(Boolean).includes(rel)) return attrs["href"] ?? ""
  }
  return ""
}

export const contentRatio = (page: Page) => (page.htmlBytes ? [...page.text].length / page.htmlBytes : 0)

/**
 * htmlparser2 is used only to cut the HTML into tags and text. The rules below follow the Python parser: text
 * between two tags in the source is one piece, and only end tags that are written count as closing a tag.
 */
export function parsePage(html: string): Page {
  const page = emptyPage()
  const parts: string[] = []
  let chunk = ""
  let skip = 0
  let scriptBuf: string[] = []
  let scriptIsLd = false
  let heading: number | null = null
  let headingBuf: string[] = []
  let href: string | null = null
  let anchorBuf: string[] = []

  const flush = () => {
    if (!chunk) return
    const data = chunk
    chunk = ""
    if (skip) {
      scriptBuf.push(data)
      return
    }
    parts.push(data)
    if (heading) headingBuf.push(data)
    if (href !== null) anchorBuf.push(data)
  }

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        flush()
        const a: Record<string, string> = {}
        for (const [k, v] of Object.entries(attrs)) a[k.toLowerCase()] = v ?? ""
        if (name === "html") page.lang = a["lang"] ?? ""
        else if (name === "meta") page.meta.push(a)
        else if (name === "link") page.linkTags.push(a)
        else if (name === "input" && (a["type"] ?? "").toLowerCase() === "password") page.hasPasswordInput = true
        else if (name === "a" && "href" in a) {
          href = a["href"] as string
          anchorBuf = []
        } else if (/^h[1-6]$/.test(name)) {
          heading = Number(name[1])
          headingBuf = []
        }
        if (SKIP_TAGS.has(name)) {
          skip += 1
          if (name === "script") {
            scriptIsLd = (a["type"] ?? "").toLowerCase().includes("ld+json")
            scriptBuf = []
          }
        }
      },
      onclosetag(name, isImplied) {
        if (isImplied) return
        flush()
        if (SKIP_TAGS.has(name) && skip) {
          skip -= 1
          if (name === "script") {
            const body = scriptBuf.join("")
            if (scriptIsLd) page.jsonldRaw.push(body)
            else if (SCRIPT_REDIRECT.test(body)) page.scriptRedirect = true
            scriptIsLd = false
          }
        } else if (name === "a" && href !== null) {
          page.anchors.push([href, collapse(anchorBuf.join(""))])
          href = null
        } else if (heading && name === `h${heading}`) {
          page.headings.push([heading, collapse(headingBuf.join(""))])
          heading = null
        }
      },
      ontext(data) {
        chunk += data
      },
      oncomment() {
        flush()
      },
      onprocessinginstruction() {
        flush()
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true }
  )
  try {
    parser.write(html)
    parser.end()
  } catch {
    /* malformed HTML must not stop an audit: keep what was read */
  }
  flush()
  page.text = collapse(parts.join(" "))
  page.htmlBytes = Buffer.byteLength(html, "utf8")
  return page
}

type Dict = Record<string, unknown>

/** Every JSON-LD object on the page (flattening @graph and lists), and how many blocks were invalid. */
export function jsonldItems(page: Page): [Dict[], number] {
  const items: Dict[] = []
  let invalid = 0
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (isDict(node)) {
      items.push(node)
      walk(node["@graph"] ?? [])
    }
  }
  for (const raw of page.jsonldRaw) {
    try {
      walk(JSON.parse(raw))
    } catch {
      invalid += 1
    }
  }
  return [items, invalid]
}

export function typesOf(item: Dict): string[] {
  const t = "@type" in item ? item["@type"] : []
  if (typeof t === "string") return [t]
  return pyIter(t).filter((x): x is string => typeof x === "string")
}
