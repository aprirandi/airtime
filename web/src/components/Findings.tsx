import { CalendarDays, ChevronRight, MessageSquareQuote, Quote, Search, Store as StoreIcon, Users } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { fmtDate, pct } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import type { RunQuestion, Store, Summary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function StatStrip({ store }: { store: Store }) {
  const { t } = useI18n()
  const tot = store.totals
  const items = [
    { icon: CalendarDays, label: t("stat.days"), value: tot.days_on_duty, hint: tot.first_day ? t("stat.since", { d: fmtDate(tot.first_day) }) : "" },
    { icon: Search, label: t("stat.asked"), value: tot.questions_asked, hint: t("stat.toGemini") },
    { icon: MessageSquareQuote, label: t("stat.read"), value: tot.answers_read, hint: t("stat.everyWord") },
    { icon: Quote, label: t("stat.quotes"), value: tot.quotes_verified, hint: t("stat.wordForWord") },
    { icon: StoreIcon, label: t("stat.shops"), value: tot.shops_seen, hint: t("stat.inAnswers") },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ icon: Icon, label, value, hint }) => (
        <Card key={label} className="gap-1 py-4">
          <CardContent className="px-4">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Icon className="size-3.5" /> {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
            <div className="text-muted-foreground text-[11px]">{hint}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Tile({ title, num, den, sub, accent }: { title: string; num: number; den: number; sub: string; accent?: boolean }) {
  const { lang } = useI18n()
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{title}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn("text-3xl font-semibold tabular-nums", accent && "text-chart-1")}>{num}</span>
        <span className="text-muted-foreground text-sm">{lang === "id" ? "dari" : "of"} {den}</span>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{pct(num, den)}</span>
      </div>
      <div className="text-muted-foreground mt-1 text-xs">{sub}</div>
    </div>
  )
}

/** Indonesian owner summary, written by code from the stored counts (the AI summary is English). */
export function summaryId(s: Summary, store: Store): string {
  const top = s.top_competitor_mentions
    ? `Toko lain yang paling sering disebut adalah ${s.top_competitor}, di ${s.top_competitor_mentions} dari ${s.total_answers} jawaban.`
    : "Tidak ada toko lain yang disebut di jawaban yang dihitung."
  return (
    `${store.name} disebut di ${s.our_mentions} dari ${s.total_answers} jawaban ${s.label} yang dihitung ` +
    `(${s.no_answer} tanpa jawaban dan ${s.needs_review} disisihkan untuk dicek). ${top} ` +
    `Untuk pertanyaan yang menyebut ${store.areas.join(" atau ")}, ${store.name} disebut di ${s.area_mentions} dari ` +
    `${s.area_answers} jawaban, dibanding ${s.no_area_mentions} dari ${s.no_area_answers} untuk pertanyaan lain.`
  )
}

export function SummaryText({ s, store, t }: { s: Summary; store: Store; t: T }) {
  const { lang } = useI18n()
  if (lang === "id") {
    return (
      <>
        {summaryId(s, store)}
        <footer className="text-muted-foreground mt-2 text-xs">{t("find.summaryNote")}</footer>
      </>
    )
  }
  return (
    <>
      {s.text}
      <footer className="text-muted-foreground mt-2 text-xs">{s.text_source === "ai" ? t("find.byAgent") : t("find.byCode")}</footer>
    </>
  )
}

export function LatestFindings({ store, latest, onOpen }: { store: Store; latest: Summary; onOpen: (runId: number) => void }) {
  const { t } = useI18n()
  const range = store.ranges[`${latest.provider}:${latest.channel}`]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("find.title", { d: fmtDate(latest.date) })}</CardTitle>
        <CardDescription>
          {latest.label}
          {latest.channel === "api" && latest.web_search_answers === 0 && t("find.noSearch")}
          {t("find.counts", { asked: latest.asked, no: latest.no_answer, review: latest.needs_review })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest.text && (
          <blockquote className="bg-muted/50 rounded-lg border-l-4 border-l-chart-1 p-4 text-sm leading-relaxed">
            <SummaryText s={latest} store={store} t={t} />
          </blockquote>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile title={t("find.recommended", { store: store.name })} num={latest.our_mentions} den={latest.total_answers} sub={t("find.nameStore")} accent />
          <Tile title={t("find.topOther", { name: latest.top_competitor ?? t("common.none") })} num={latest.top_competitor_mentions} den={latest.total_answers} sub={t("find.nameIt")} />
          <Tile title={t("find.areaQ", { areas: store.areas.join(" / ") })} num={latest.area_mentions} den={latest.area_answers} sub={t("find.namingStore", { store: store.name })} />
          <Tile title={t("find.otherQ")} num={latest.no_area_mentions} den={latest.no_area_answers} sub={t("find.namingStore", { store: store.name })} />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {range && range.runs > 1
              ? t("find.range", { n: range.runs, min: range.min_pct, max: range.max_pct, store: store.name })
              : t("find.rangeSoon")}
          </span>
          {latest.run_id && (
            <button onClick={() => onOpen(latest.run_id!)} className="text-foreground inline-flex items-center gap-1 font-medium hover:underline">
              {t("find.seeAll")} <ChevronRight className="size-3.5" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Competitors({ store, latest }: { store: Store; latest: Summary }) {
  const { t } = useI18n()
  const top = latest.competitors.slice(0, 8)
  const max = Math.max(1, latest.total_answers)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("comp.title")}</CardTitle>
        <CardDescription>{t("comp.sub", { d: fmtDate(latest.date) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row name={store.name} n={latest.our_mentions} total={max} ours />
        {top.map((c) => (
          <Row key={c.name} name={c.name} n={c.mentions} total={max} />
        ))}
        <p className="text-muted-foreground pt-1 text-xs">
          {t("comp.total", { n: latest.competitors.length })}
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ name, n, total, ours }: { name: string; n: number; total: number; ours?: boolean }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={cn("truncate", ours && "font-semibold")}>
          {name} {ours && <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{t("comp.yours")}</Badge>}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {t("common.of", { n, d: total })}
        </span>
      </div>
      <Progress value={(100 * n) / total} indicatorClassName={ours ? "bg-chart-1" : "bg-muted-foreground/60"} />
    </div>
  )
}

type Point = { date: string; ours: number | null; rival: number | null; oursN: string; rivalN: string }

function ChartTip({ active, payload, label, storeName, rivalName }: TooltipProps<number, string> & { storeName: string; rivalName: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as Point
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground mb-1">{fmtDate(String(label))}</div>
      {[
        { color: "var(--chart-1)", name: storeName, v: p.ours, n: p.oursN },
        { color: "var(--chart-2)", name: rivalName, v: p.rival, n: p.rivalN },
      ].map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded" style={{ background: r.color }} />
          <span className="font-semibold tabular-nums">{r.v === null ? "n/a" : `${r.v}%`}</span>
          <span className="text-muted-foreground">
            {r.name} ({r.n})
          </span>
        </div>
      ))}
    </div>
  )
}

export function Trend({ store, series }: { store: Store; series: Summary[] }) {
  const { t, lang } = useI18n()
  const last = series[series.length - 1]
  const rivalName = last?.top_competitor ?? t("trend.topOther")
  const of = lang === "id" ? "dari" : "of"
  const data: Point[] = series.map((s) => {
    const rival = s.competitors.find((c) => c.name === rivalName)
    const rn = rival?.mentions ?? 0
    return {
      date: s.date,
      ours: s.total_answers ? Math.round((100 * s.our_mentions) / s.total_answers) : null,
      rival: s.total_answers ? Math.round((100 * rn) / s.total_answers) : null,
      oursN: `${s.our_mentions} ${of} ${s.total_answers}`,
      rivalN: `${rn} ${of} ${s.total_answers}`,
    }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("trend.title")}</CardTitle>
        <CardDescription>{t("trend.sub")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-chart-1 h-0.5 w-4 rounded" /> {store.name}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-chart-2 h-0.5 w-4 rounded" /> {rivalName}
          </span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { weekday: undefined })} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip content={<ChartTip storeName={store.name} rivalName={rivalName} />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
              <Line dataKey="rival" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} isAnimationActive={false} />
              <Line dataKey="ours" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {series.length < 3 && (
          <p className="text-muted-foreground mt-2 text-xs">{t("trend.soon")}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function WorkDiary({ store, onOpen }: { store: Store; onOpen: (runId: number) => void }) {
  const { t } = useI18n()
  const rows = [...store.series].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> {t("diary.title")}
        </CardTitle>
        <CardDescription>{t("diary.sub")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {rows.map((s) => {
          const clickable = Boolean(s.run_id)
          return (
            <button
              key={s.id}
              disabled={!clickable}
              onClick={() => s.run_id && onOpen(s.run_id)}
              className="hover:bg-muted/50 flex w-full items-center gap-4 px-6 py-3 text-left transition-colors disabled:cursor-default disabled:hover:bg-transparent"
            >
              <div className="w-16 shrink-0 text-xs">
                <div className="font-medium">{fmtDate(s.date, { weekday: undefined })}</div>
                <div className="text-muted-foreground">{fmtDate(s.date, { day: undefined, month: undefined })}</div>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate">
                  <span className="font-medium">{store.name}</span> {t("common.of", { n: s.our_mentions, d: s.total_answers })}
                  <span className="text-muted-foreground">
                    {" "}· {s.top_competitor ?? t("diary.noOther")} {t("common.of", { n: s.top_competitor_mentions, d: s.total_answers })}
                  </span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {t("diary.meta", { label: s.label, asked: s.asked, no: s.no_answer, review: s.needs_review })}
                </div>
              </div>
              {s.text_source === "manual" ? (
                <Badge variant="outline">{t("diary.manual")}</Badge>
              ) : (
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              )}
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** The questions of one shift: the core ones (same every day) and the new ones written that day. */
export function QuestionsToday({ store, latest }: { store: Store; latest: Summary }) {
  const { t } = useI18n()
  const run = store.runs.find((r) => r.id === latest.run_id)
  const qs = run?.questions ?? []
  if (!qs.length) return null
  const core = qs.filter((q) => q.kind !== "daily")
  const daily = qs.filter((q) => q.kind === "daily")
  const group = (title: string, items: typeof qs, accent: boolean) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Badge variant={accent ? "default" : "outline"} className={cn(accent && "bg-chart-1")}>
          {title}
        </Badge>
      </div>
      <ul className="divide-y rounded-lg border">
        {items.map((q) => {
          const counted = q.counted ?? 0
          const ours = q.ours ?? 0
          return (
            <li key={q.text} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block">{q.text}</span>
                {!!q.topics?.length && (
                  <span className="flex flex-wrap gap-1">
                    {q.topics.map((tp) => (
                      <Badge key={tp} variant="outline" className="h-4 px-1.5 text-[10px] font-normal">{tp}</Badge>
                    ))}
                  </span>
                )}
                {q.reason && <span className="text-muted-foreground block text-xs">{whyText(t, store.name, q.reason)}</span>}
              </span>
              <span className="text-muted-foreground shrink-0 text-right text-xs">
                {counted === 0 ? (
                  t("qt.noAnswer")
                ) : ours > 0 ? (
                  <span className="text-chart-1 font-medium">{t("qt.named", { store: store.name })} · {t("qt.counts", { n: ours, d: counted })}</span>
                ) : (
                  <>
                    {t("qt.notNamed")} · {t("qt.counts", { n: 0, d: counted })}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("qt.title")}</CardTitle>
        <CardDescription>{t("qt.sub", { core: core.length, daily: daily.length, d: fmtDate(latest.date) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {group(t("qt.core"), core, false)}
        {daily.length ? (
          group(daily.some((q) => q.reason) ? t("qt.explore") : t("qt.daily"), daily, true)
        ) : (
          <p className="text-muted-foreground text-xs">{t("qt.none")}</p>
        )}
        {(latest.daily_answers ?? 0) > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("qt.split", {
              store: store.name,
              cn: latest.core_mentions ?? 0,
              cd: latest.core_answers ?? 0,
              dn: latest.daily_mentions ?? 0,
              dd: latest.daily_answers ?? 0,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function whyText(t: T, storeName: string, r: NonNullable<RunQuestion["reason"]>): string {
  if (!r.answers) return t("qt.whyNew", { topic: r.topic, days: r.window_days })
  let text = t("qt.why", { store: storeName, n: r.ours, d: r.answers, topic: r.topic, days: r.window_days })
  if (r.competitor) text += t("qt.whyRival", { rival: r.competitor, m: r.competitor_mentions })
  return text + "."
}

export function Topics({ store, latest }: { store: Store; latest: Summary }) {
  const { t } = useI18n()
  const rows = store.topics ?? []
  if (!rows.length) return null
  const days = store.setup?.explore_window_days ?? 28
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("topic.title")}</CardTitle>
        <CardDescription>{t("topic.sub", { days, d: fmtDate(latest.date), store: store.name })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.topic} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium">{r.topic}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {r.answers ? t("qt.counts", { n: r.ours, d: r.answers }) : t("topic.notAsked")}
              </span>
            </div>
            <Progress value={r.answers ? (100 * r.ours) / r.answers : 0} indicatorClassName="bg-chart-1" />
            <p className="text-muted-foreground text-xs">
              {t("topic.questions", { n: r.question_count })}
              {r.competitor && <> · {t("topic.rival", { rival: r.competitor, m: r.competitor_mentions })}</>}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
