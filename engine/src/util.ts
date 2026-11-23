/** Small helpers that reproduce what Python does, so the two engines give the same answers. */

const TIE_PROBE = 25

/**
 * Python's round(x, n): the nearest value to the exact number, and on an exact tie the even digit.
 * toFixed() rounds the exact value as well, but sends ties up, so ties are found from the exact expansion.
 */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x
  const long = Math.abs(x).toFixed(Math.min(100, n + TIE_PROBE))
  const dot = long.indexOf(".")
  const tail = dot < 0 ? "" : long.slice(dot + 1 + n)
  const isTie = tail.length > 0 && tail[0] === "5" && /^50*$/.test(tail)
  if (!isTie) return Number(x.toFixed(n))
  // exact tie: choose the even last digit
  const scaled = Number(Math.abs(x).toFixed(n + 1).replace(".", "")) // digits of the tie, last digit is 5
  const down = Math.floor(scaled / 10)
  const result = (down % 2 === 0 ? down : down + 1) / 10 ** n
  return x < 0 ? -result : result
}

/** Python's "{x:.{n}f}" */
export const fixed = (x: number, n: number) => pyRound(x, n).toFixed(n)

/** Python's len() on text counts code points, JavaScript's length counts UTF-16 units. */
export const cpLen = (s: string) => {
  let n = 0
  for (const _ of s) n++
  return n
}

const SPACE = "\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
const STRIP_RE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "g")
const SPACES_RE = new RegExp(`[${SPACE}]+`, "g")

/** Python's str.strip(): like trim(), but a byte order mark is not whitespace. */
export const pyStrip = (s: string) => s.replace(STRIP_RE, "")

/** Python's re.sub(r"\s+", " ", s).strip() */
export const collapse = (s: string) => pyStrip(s.replace(SPACES_RE, " "))

/** Python's str.splitlines() */
export const splitLines = (s: string) => {
  const parts = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)
  if (parts.length && parts[parts.length - 1] === "") parts.pop()
  return parts
}

/** Python truthiness of a parsed JSON value. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === "object") return Object.keys(v as object).length > 0
  return true
}

/** Python's `a or b` */
export const pyOr = <T, U>(a: T, b: U): T | U => (truthy(a) ? a : b)

export const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Iterating a JSON value in Python: lists give items, dicts their keys, strings their characters, others raise. */
export function pyIter(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === "string") return [...v]
  if (isDict(v)) return Object.keys(v)
  throw new TypeError(`'${v === null ? "NoneType" : typeof v}' object is not iterable`)
}
