export const STORE_TZ = "Australia/Melbourne"

let LOCALE = "en-AU"
/** Set by the language switch so dates and times follow the chosen language. */
export function setLocale(lang: "en" | "id") {
  LOCALE = lang === "id" ? "id-ID" : "en-AU"
}

export function pct(num: number, den: number): string {
  return den ? `${Math.round((100 * num) / den)}%` : "n/a"
}

export function fmtDate(isoDate: string, opts: Intl.DateTimeFormatOptions = {}): string {
  // isoDate is a calendar date (YYYY-MM-DD); format it without shifting time zones.
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...opts,
  })
}

export function fmtTime(iso: string, tz = STORE_TZ): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit" })
}

export function minutesBetween(a: string, b: string | null): number | null {
  return b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null
}

export function todayIn(tz = STORE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())
}

const weekdayIn = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, weekday: "short" })

/** Next shift start. `weekdays` (mon..sun, in the store's timezone) skips the days off. */
export function nextShift(utcHour: number, utcMinute: number, now = new Date(), weekdays?: string[] | null): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  if (weekdays?.length) {
    for (let i = 0; i < 7 && !weekdays.includes(weekdayIn.format(next).toLowerCase().slice(0, 3)); i++) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
  }
  return next
}

export function countdown(to: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60000))
  const h = Math.floor(mins / 60)
  const [hu, mu] = LOCALE === "id-ID" ? ["j", "m"] : ["h", "m"]
  return h ? `${h}${hu} ${mins % 60}${mu}` : `${mins}${mu}`
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE)
}
