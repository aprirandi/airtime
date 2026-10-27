import { useEffect, useState } from "react"
import { Activity, CircleAlert, Moon, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { countdown, fmtTime, nextShift } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import type { Live, Site } from "@/lib/types"

export function ago(t: T, iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return t("ago.never")
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return t("ago.s", { n: s })
  if (s < 3600) return t("ago.m", { n: Math.round(s / 60) })
  if (s < 86400) return t("ago.h", { n: Math.round(s / 3600) })
  return t("ago.d", { n: Math.round(s / 86400) })
}

export function useTick(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Live status of the agent, from docs/data/live.json (checked every 30 s). */
export function LiveBanner({ live, site, checkedAt }: { live: Live | null; site: Site; checkedAt: Date | null }) {
  const { t, pick } = useI18n()
  const now = useTick(1000)
  const next = nextShift(site.schedule.utc_hour, site.schedule.utc_minute, now, site.schedule.weekdays)
  const checked = (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
      <RefreshCw className="size-3" /> {t("live.checked", { ago: ago(t, checkedAt, now) })}
    </span>
  )

  if (live?.status === "running") {
    const current = live.steps.find((s) => s.name === live.current)
    const done = live.steps.filter((s) => s.status === "done").length
    const p = live.progress
    return (
      <Card className="border-success/50 bg-success/5 gap-3 py-4">
        <CardContent className="space-y-3 px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" className="gap-1.5">
              <span className="bg-success size-1.5 animate-pulse rounded-full" /> {t("live.on")}
            </Badge>
            {live.agent_now && (
              <span className={`rounded px-1.5 py-px text-[11px] font-semibold text-white bg-agent-${live.agent_now}`}>
                {t(`agent.${live.agent_now}`)}
              </span>
            )}
            <span className="text-sm font-medium">
              {t("live.step", {
                n: current?.step ?? done + 1,
                total: live.steps.length || 7,
                title: current ? pick<string>(current, "title") : t("live.working"),
              })}
            </span>
            <span className="ml-auto">{checked}</span>
          </div>
          <p className="text-sm">{pick<string>(live, "last_event")}</p>
          {p && (
            <div className="space-y-1">
              <Progress value={(100 * p.done) / Math.max(1, p.total)} indicatorClassName="bg-success" />
              <p className="text-muted-foreground text-xs">
                {t("live.progress", { done: p.done, total: p.total, unit: t(`unit.${p.unit}`) })}
                {p.ok !== undefined && t("live.answered", { ok: p.ok, no: p.no_answer ?? 0 })}
              </p>
            </div>
          )}
          <p className="text-muted-foreground text-[11px]">
            {t("live.started", { t: live.started_at ? fmtTime(live.started_at) : "?", ago: ago(t, live.updated_at, now) })}
          </p>
        </CardContent>
      </Card>
    )
  }

  const failed = live?.status === "failed" || live?.last_run_status === "failed"
  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 text-sm">
        {failed ? (
          <Badge variant="destructive">
            <CircleAlert /> {t("live.stopped")}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <Moon /> {t("live.off")}
          </Badge>
        )}
        <span className="text-muted-foreground">
          {live?.last_finished_at ? t("live.lastFinished", { ago: ago(t, live.last_finished_at, now) }) : ""}
          {t("live.next", { t: fmtTime(next.toISOString()), in: countdown(next, now) })}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Activity className="text-muted-foreground size-3.5" />
          {checked}
        </span>
      </CardContent>
    </Card>
  )
}
