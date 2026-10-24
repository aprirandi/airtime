import { CalendarDays, ChevronRight, MessageSquareQuote, Quote, Search, Store as StoreIcon, Users } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { fmtDate, pct } from "@/lib/format"
import type { Store, Summary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function StatStrip({ store }: { store: Store }) {
  const t = store.totals
  const items = [
    { icon: CalendarDays, label: "Days on duty", value: t.days_on_duty, hint: t.first_day ? `since ${fmtDate(t.first_day)}` : "" },
    { icon: Search, label: "Questions asked", value: t.questions_asked, hint: "to Gemini" },
    { icon: MessageSquareQuote, label: "Answers read", value: t.answers_read, hint: "every word" },
    { icon: Quote, label: "Quotes checked", value: t.quotes_verified, hint: "word for word" },
    { icon: StoreIcon, label: "Shops spotted", value: t.shops_seen, hint: "in answers" },
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
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{title}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn("text-3xl font-semibold tabular-nums", accent && "text-chart-1")}>{num}</span>
        <span className="text-muted-foreground text-sm">of {den}</span>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{pct(num, den)}</span>
      </div>
      <div className="text-muted-foreground mt-1 text-xs">{sub}</div>
    </div>
  )
}

export function LatestFindings({ store, latest, onOpen }: { store: Store; latest: Summary; onOpen: (runId: number) => void }) {
  const range = store.ranges[`${latest.provider}:${latest.channel}`]
  return (
    <Card>
      <CardHeader>
        <CardTitle>What I found on {fmtDate(latest.date)}</CardTitle>
        <CardDescription>
          {latest.label}
          {latest.channel === "api" && latest.web_search_answers === 0 && " · answers without web search"} · {latest.asked} asked,{" "}
          {latest.no_answer} no answer, {latest.needs_review} set aside for review
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest.text && (
          <blockquote className="bg-muted/50 rounded-lg border-l-4 border-l-chart-1 p-4 text-sm leading-relaxed">
            {latest.text}
            <footer className="text-muted-foreground mt-2 text-xs">
              {latest.text_source === "ai" ? "Written by the agent; every number checked by code." : "Written from the counts by code."}
            </footer>
          </blockquote>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile title={`${store.name} recommended`} num={latest.our_mentions} den={latest.total_answers} sub="answers that name the store" accent />
          <Tile title={`Top other shop: ${latest.top_competitor ?? "none"}`} num={latest.top_competitor_mentions} den={latest.total_answers} sub="answers that name it" />
          <Tile title={`Questions naming ${store.areas.join(" or ")}`} num={latest.area_mentions} den={latest.area_answers} sub={`answers naming ${store.name}`} />
          <Tile title="Other questions" num={latest.no_area_mentions} den={latest.no_area_answers} sub={`answers naming ${store.name}`} />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {range && range.runs > 1
              ? `Over the last ${range.runs} days: ${range.min_pct}% to ${range.max_pct}% of answers named ${store.name}.`
              : "AI answers change a lot from day to day. A range appears here after a few days."}
          </span>
          {latest.run_id && (
            <button onClick={() => onOpen(latest.run_id!)} className="text-foreground inline-flex items-center gap-1 font-medium hover:underline">
              See every answer and quote <ChevronRight className="size-3.5" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Competitors({ store, latest }: { store: Store; latest: Summary }) {
  const top = latest.competitors.slice(0, 8)
  const max = Math.max(1, latest.total_answers)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who gets recommended</CardTitle>
        <CardDescription>Share of {fmtDate(latest.date)} answers that name each shop</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row name={store.name} n={latest.our_mentions} total={max} ours />
        {top.map((c) => (
          <Row key={c.name} name={c.name} n={c.mentions} total={max} />
        ))}
        <p className="text-muted-foreground pt-1 text-xs">
          {latest.competitors.length} shops named in total. Counted once per answer.
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ name, n, total, ours }: { name: string; n: number; total: number; ours?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={cn("truncate", ours && "font-semibold")}>
          {name} {ours && <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">your store</Badge>}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {n} of {total}
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
  const last = series[series.length - 1]
  const rivalName = last?.top_competitor ?? "Top other shop"
  const data: Point[] = series.map((s) => {
    const rival = s.competitors.find((c) => c.name === rivalName)
    const rn = rival?.mentions ?? 0
    return {
      date: s.date,
      ours: s.total_answers ? Math.round((100 * s.our_mentions) / s.total_answers) : null,
      rival: s.total_answers ? Math.round((100 * rn) / s.total_answers) : null,
      oursN: `${s.our_mentions} of ${s.total_answers}`,
      rivalN: `${rn} of ${s.total_answers}`,
    }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Day by day</CardTitle>
        <CardDescription>Share of Gemini answers naming each shop</CardDescription>
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
          <p className="text-muted-foreground mt-2 text-xs">The line fills in as the agent works each day. One day alone says little.</p>
        )}
      </CardContent>
    </Card>
  )
}

export function WorkDiary({ store, onOpen }: { store: Store; onOpen: (runId: number) => void }) {
  const rows = [...store.series].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Work diary
        </CardTitle>
        <CardDescription>Every shift, newest first</CardDescription>
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
                  <span className="font-medium">{store.name}</span> {s.our_mentions} of {s.total_answers}
                  <span className="text-muted-foreground"> · {s.top_competitor ?? "no other shop"} {s.top_competitor_mentions} of {s.total_answers}</span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {s.label} · {s.asked} asked · {s.no_answer} no answer · {s.needs_review} for review
                </div>
              </div>
              {s.text_source === "manual" ? (
                <Badge variant="outline">manual baseline</Badge>
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
