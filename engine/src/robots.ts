/**
 * robots.txt as RFC 9309 describes it, the way Python 3.13's urllib.robotparser reads it: the group of the
 * crawler's own name wins, else a group whose name is part of it, else "*"; rules may use * and a final $;
 * the longest matching rule wins, and Allow wins a tie.
 */
import { pyStrip, splitLines } from "./util"

class Rule {
  path: string
  allowance: boolean
  fullmatch: boolean

  constructor(path: string, allowance: boolean) {
    if (path === "" && !allowance) allowance = true
    path = path.replace(/\*{2,}/g, "*").replace(/\$[$*]+/g, "$")
    path = normalizePattern(path)
    this.fullmatch = path.endsWith("$")
    path = path.replace(/\$+$/, "")
    if (path.includes("$")) throw new Error("$ not at the end of path")
    this.path = path
    this.allowance = allowance
  }

  /** The matching length plus 1, or 0 when the rule does not match. */
  appliesTo(filename: string): number {
    if (!this.path.includes("*")) {
      if (this.fullmatch) return filename === this.path ? this.path.length + 1 : 0
      return filename.startsWith(this.path) ? this.path.length + 1 : 0
    }
    const parts = this.path.split("*")
    const first = parts[0] as string
    if (!filename.startsWith(first)) return 0
    let pos = first.length
    for (const mid of parts.slice(1, -1)) {
      const at = filename.indexOf(mid, pos) // the earliest place: the middle pieces do not backtrack
      if (at < 0) return 0
      pos = at + mid.length
    }
    const last = parts[parts.length - 1] as string
    if (this.fullmatch) {
      return filename.length - last.length >= pos && filename.endsWith(last) ? filename.length + 1 : 0
    }
    const at = filename.lastIndexOf(last) // the last piece is greedy
    return at >= pos ? at + last.length + 1 : 0
  }
}

class Entry {
  useragents: string[] = []
  rules: Rule[] = []

  appliesTo(useragent: string): boolean {
    const name = (useragent.split("/")[0] as string).toLowerCase()
    return this.useragents.some((a) => a !== "*" && name.includes(a.toLowerCase()))
  }

  allowance(filename: string): boolean {
    let best = -1
    let allowance = true
    for (const rule of this.rules) {
      const m = rule.appliesTo(filename)
      if (m) {
        if (m > best) {
          best = m
          allowance = rule.allowance
        } else if (m === best && !allowance) allowance = rule.allowance
      }
    }
    return allowance
  }
}

const UNRESERVED = /[A-Za-z0-9_.\-~/]/

function unquote(s: string): string {
  const bytes: number[] = []
  for (let i = 0; i < s.length; ) {
    if (s[i] === "%" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 3
    } else {
      bytes.push(...Buffer.from(String.fromCodePoint(s.codePointAt(i) as number), "utf8"))
      i += (s.codePointAt(i) as number) > 0xffff ? 2 : 1
    }
  }
  return Buffer.from(bytes).toString("utf8")
}

function quote(s: string): string {
  let out = ""
  for (const ch of s) {
    if (UNRESERVED.test(ch)) out += ch
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0")
  }
  return out
}

const normalize = (s: string) => quote(unquote(s))

function normalizePattern(path: string): string {
  const q = path.indexOf("?")
  let head = q < 0 ? path : path.slice(0, q)
  head = head.replace(/[^*$]+/g, (m) => normalize(m))
  if (q < 0) return head
  const query = path.slice(q + 1).replace(/[^=&*$]+/g, (m) => normalize(m))
  return head + "?" + query
}

function normalizeUri(path: string): string {
  const q = path.indexOf("?")
  const head = normalize(q < 0 ? path : path.slice(0, q))
  if (q < 0) return head
  return head + "?" + path.slice(q + 1).replace(/[^=&]+/g, (m) => normalize(m))
}

export class Robots {
  private groups = new Map<string, Entry>()

  constructor(text: string) {
    let entry = new Entry()
    let state = 0 // 0 start, 1 saw user-agent, 2 saw allow or disallow
    for (let line of splitLines(text)) {
      const hash = line.indexOf("#")
      if (hash >= 0) line = line.slice(0, hash)
      line = pyStrip(line)
      if (!line) continue
      const colon = line.indexOf(":")
      if (colon < 0) continue
      const key = pyStrip(line.slice(0, colon)).toLowerCase()
      const value = pyStrip(line.slice(colon + 1))
      if (key === "user-agent") {
        if (state === 2) {
          this.add(entry)
          entry = new Entry()
        }
        entry.useragents.push(value)
        state = 1
      } else if (key === "disallow" || key === "allow") {
        if (state !== 0) {
          state = 2
          try {
            entry.rules.push(new Rule(value, key === "allow"))
          } catch {
            /* a rule with a misplaced $ is ignored */
          }
        }
      } else if ((key === "crawl-delay" || key === "request-rate") && state !== 0) {
        state = 2
      }
    }
    if (state !== 0) this.add(entry)
  }

  private add(entry: Entry) {
    for (const raw of entry.useragents) {
      const agent = raw.toLowerCase()
      const existing = this.groups.get(agent)
      if (!existing) this.groups.set(agent, entry)
      else {
        const merged = new Entry()
        merged.useragents = existing.useragents.filter((a) => entry.useragents.includes(a))
        merged.rules = [...existing.rules, ...entry.rules]
        this.groups.set(agent, merged)
      }
    }
  }

  private find(useragent: string): Entry | undefined {
    const exact = this.groups.get(useragent.toLowerCase())
    if (exact) return exact
    for (const entry of this.groups.values()) if (entry.appliesTo(useragent)) return entry
    return this.groups.get("*")
  }

  canFetch(useragent: string, path: string): boolean {
    let url = normalizeUri(path)
    if (!url) url = "/"
    if (url === "/robots.txt") return true
    const entry = this.find(useragent)
    return entry ? entry.allowance(url) : true
  }
}
