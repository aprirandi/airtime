export const STORE_TZ = "Australia/Melbourne"

export function pct(num: number, den: number): string {
  return den ? `${Math.round((100 * num) / den)}%` : "n/a"
}

export function fmtDate(isoDate: string, opts: Intl.DateTimeFormatOptions = {}): string {
  // isoDate is a calendar date (YYYY-MM-DD); format it without shifting time zones.
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...opts,
  })
}

export function fmtTime(iso: string, tz = STORE_TZ): string {
  return new Date(iso).toLocaleTimeString("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit" })
}

export function minutesBetween(a: string, b: string | null): number | null {
  return b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null
}

export function todayIn(tz = STORE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())
}

export function nextShift(utcHour: number, utcMinute: number, now = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function countdown(to: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
}
