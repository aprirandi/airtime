import { ArrowRight, Bot, CalendarClock, ShieldCheck, UserCheck, UserPlus } from "lucide-react"

import { agentFor } from "@/components/office/stations"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtDate, fmtTime, nextShift } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Live, Site, Store, TeamMember } from "@/lib/types"
import { cn } from "@/lib/utils"

const AVATAR: Record<string, string> = {
  asker: "bg-agent-asker",
  analyst: "bg-agent-analyst",
  master: "bg-agent-master",
}

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

function InOut({ m }: { m: TeamMember }) {
  const { t, pick } = useI18n()
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground w-20">{t("team.gets")}</span>
        <Chips items={pick<string[]>(m, "inputs")} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground w-20">{t("team.delivers")}</span>
        <Chips items={pick<string[]>(m, "outputs")} />
      </div>
    </div>
  )
}

function stats(id: string, store: Store, t: (k: string) => string): [string, number][] {
  const tot = store.totals
  if (id === "asker") return [[t("stat.days"), tot.days_on_duty], [t("stat.asked"), tot.questions_asked]]
  if (id === "analyst") return [[t("stat.read"), tot.answers_read], [t("stat.quotes"), tot.quotes_verified], [t("stat.shops"), tot.shops_seen]]
  const passed = store.runs.flatMap((r) => r.steps).filter((s) => s.agent === "master" && s.status === "ok").length
  return [[t("team.masterChecks"), passed]]
}

function ActiveCard({ m, site, store, live }: { m: TeamMember; site: Site; store: Store; live: Live | null }) {
  const { t, pick } = useI18n()
  const latest = store.runs.find((r) => r.kind === "shift")
  const working = live?.status === "running" && live.agent_now === m.id
  const next = nextShift(site.schedule.utc_hour, site.schedule.utc_minute)
  const mine = latest?.steps.filter((s) => agentFor(s) === m.id) ?? []
  const last = mine.at(-1)
  const Icon = m.id === "master" ? ShieldCheck : Bot
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className={cn("relative grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-sm", AVATAR[m.id])}>
            <Icon className="size-6" />
            <span
              className={cn(
                "ring-card absolute -right-1 -bottom-1 size-3.5 rounded-full ring-2",
                working ? "bg-success animate-pulse" : "bg-muted-foreground/40"
              )}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{m.name}</CardTitle>
              {working ? <Badge variant="success">{t("team.working")}</Badge> : <Badge variant="secondary">{t("team.off")}</Badge>}
            </div>
            <CardDescription>{pick<string>(m, "title")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{pick<string>(m, "job")}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CalendarClock className="size-3.5" /> {t("team.shift", { t: fmtTime(next.toISOString()) })}
          {store.totals.first_day && t("team.since", { d: fmtDate(store.totals.first_day) })}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {stats(m.id, store, t).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-2">
              <div className="text-muted-foreground text-[11px] leading-tight">{k}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <InOut m={m} />
        <div className="bg-muted/40 rounded-lg p-3 text-xs">
          <div className="text-muted-foreground mb-0.5">{working ? t("team.doingNow") : t("team.lastShift")}</div>
          {working && live ? pick<string>(live, "last_event") : last ? pick<string>(last, "description") : t("team.noShift")}
        </div>
      </CardContent>
    </Card>
  )
}

function OtherCard({ m, index }: { m: TeamMember; index: number }) {
  const { t, pick } = useI18n()
  const human = m.status === "human"
  return (
    <Card className={cn("shadow-none", human ? "border-warning/60" : "border-dashed")}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className={cn("grid size-10 place-items-center rounded-xl", human ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
            {human ? <UserCheck className="size-5" /> : <UserPlus className="size-5" />}
          </div>
          <div>
            <CardTitle className="text-base">{m.name}</CardTitle>
            <CardDescription>{human ? pick<string>(m, "title") : t("team.joins", { title: pick<string>(m, "title"), n: index })}</CardDescription>
          </div>
          <Badge variant="outline" className={cn("ml-auto", human ? "border-warning text-warning" : "border-dashed")}>
            {human ? t("team.human") : t("team.open")}
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
  const active = site.team.filter((m) => m.status === "active")
  const others = site.team.filter((m) => m.status !== "active")
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {active.map((m) => (
          <ActiveCard key={m.id} m={m} site={site} store={store} live={live} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {others.map((m) => (
          <OtherCard key={m.id} m={m} index={site.team.indexOf(m) + 1} />
        ))}
      </div>
    </div>
  )
}
