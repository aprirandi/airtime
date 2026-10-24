import { ArrowRight, Bot, CalendarClock, UserPlus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtDate, fmtTime, nextShift } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Live, Site, Store, TeamMember } from "@/lib/types"
import { cn } from "@/lib/utils"

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => (
        <Badge key={i} variant="outline" className="font-normal">
          {i}
        </Badge>
      ))}
    </span>
  )
}

function ActiveCard({ m, site, store, live }: { m: TeamMember; site: Site; store: Store; live: Live | null }) {
  const { t, pick } = useI18n()
  const latest = store.runs.find((r) => r.agent === "visibility")
  const s = store.series.filter((x) => x.provider === "gemini").at(-1)
  const working = live?.status === "running"
  const next = nextShift(site.schedule.utc_hour, site.schedule.utc_minute)
  return (
    <Card className="border-chart-1/40 md:col-span-2 lg:col-span-3">
      <CardContent className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <div className="flex gap-4">
          <div className="bg-chart-1 relative grid size-16 shrink-0 place-items-center rounded-2xl text-white shadow-sm">
            <Bot className="size-8" />
            <span
              className={cn(
                "ring-card absolute -right-1 -bottom-1 size-4 rounded-full ring-2",
                working ? "bg-success animate-pulse" : "bg-muted-foreground/40"
              )}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{m.name}</h3>
              {working ? <Badge variant="success">{t("team.working")}</Badge> : <Badge variant="secondary">{t("team.off")}</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">
              {pick<string>(m, "title")} · {pick<string>(m, "job")}
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> {t("team.shift", { t: fmtTime(next.toISOString()) })}
              {store.totals.first_day && t("team.since", { d: fmtDate(store.totals.first_day) })}
            </p>
            <div className="space-y-1.5 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground w-20">{t("team.gets")}</span>
                <Chips items={pick<string[]>(m, "inputs")} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground w-20">{t("team.delivers")}</span>
                <Chips items={pick<string[]>(m, "outputs")} />
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [t("team.daysWorked"), store.totals.days_on_duty],
            [t("stat.asked"), store.totals.questions_asked],
            [t("stat.read"), store.totals.answers_read],
            [t("stat.quotes"), store.totals.quotes_verified],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">{k}</div>
              <div className="text-xl font-semibold tabular-nums">{v}</div>
            </div>
          ))}
          <div className="bg-muted/40 col-span-2 rounded-lg p-3 text-xs sm:col-span-4 md:col-span-2 xl:col-span-4">
            <div className="text-muted-foreground mb-0.5">{working ? t("team.doingNow") : t("team.lastShift")}</div>
            {working && live
              ? pick<string>(live, "last_event")
              : latest && s
                ? t("team.lastResult", {
                    d: fmtDate(latest.run_date), store: store.name, n: s.our_mentions, total: s.total_answers,
                    top: s.top_competitor ?? "-", topN: s.top_competitor_mentions,
                  })
                : t("team.noShift")}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PlannedCard({ m, index }: { m: TeamMember; index: number }) {
  const { t, pick } = useI18n()
  return (
    <Card className="border-dashed shadow-none">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-xl">
            <UserPlus className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">{m.name}</CardTitle>
            <CardDescription>
              {t("team.joins", { title: pick<string>(m, "title"), n: index + 2 })}
            </CardDescription>
          </div>
          <Badge variant="outline" className="ml-auto border-dashed">
            {t("team.open")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{pick<string>(m, "job")}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Chips items={pick<string[]>(m, "inputs")} />
          <ArrowRight className="text-muted-foreground size-3" />
          <Chips items={pick<string[]>(m, "outputs")} />
        </div>
      </CardContent>
    </Card>
  )
}

export function Team({ site, store, live }: { site: Site; store: Store; live: Live | null }) {
  const planned = site.team.filter((m) => m.status === "planned")
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {site.team
        .filter((m) => m.status === "active")
        .map((m) => (
          <ActiveCard key={m.id} m={m} site={site} store={store} live={live} />
        ))}
      {planned.map((m, i) => (
        <PlannedCard key={m.id} m={m} index={i} />
      ))}
    </div>
  )
}
