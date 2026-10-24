import { useEffect, useMemo, useState } from "react"
import { Bot, Check, CircleAlert, Pause, Play, RotateCcw, ArrowRight } from "lucide-react"

import { OfficeScene } from "@/components/office/OfficeScene"
import { FUTURE_AGENTS, stationFor } from "@/components/office/stations"
import { beatsFor, useShiftReplay, type Beat } from "@/components/office/useShiftReplay"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { countdown, fmtDate, fmtTime, minutesBetween, nextShift, todayIn } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Live, Run, Site, Step, Store } from "@/lib/types"
import { cn } from "@/lib/utils"

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function ShiftStatus({ site, latest, live }: { site: Site; latest: Run | undefined; live: Live | null }) {
  const { t } = useI18n()
  const now = useNow()
  const next = nextShift(site.schedule.utc_hour, site.schedule.utc_minute, now)
  const today = todayIn()
  let badge = <Badge variant="secondary">{t("shift.off")}</Badge>
  if (live?.status === "running") {
    badge = (
      <Badge variant="success" className="gap-1.5">
        <span className="bg-success size-1.5 animate-pulse rounded-full" /> {t("shift.onNow")}
      </Badge>
    )
  } else if (latest && latest.run_date === today && latest.status === "ok") {
    badge = (
      <Badge variant="success">
        <Check /> {t("shift.doneToday")}
      </Badge>
    )
  } else if (latest?.status === "failed") {
    badge = (
      <Badge variant="destructive">
        <CircleAlert /> {t("shift.stopped")}
      </Badge>
    )
  }
  return (
    <div className="space-y-1.5">
      {badge}
      <p className="text-muted-foreground text-xs">
        {t("shift.next", {
          d: fmtDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(next)),
          t: fmtTime(next.toISOString()),
          in: countdown(next, now),
        })}
      </p>
    </div>
  )
}

function liveBeat(live: Live, lang: "en" | "id"): Beat {
  const cur = live.steps.find((s) => s.name === live.current)
  const text = (lang === "id" && live.last_event_id) || live.last_event
  const step = cur ? ({ ...cur, description: text, status: "ok" } as Step) : null
  return { station: step ? stationFor(step) : "board", step, text }
}

export function AgentHQ({ site, store, live }: { site: Site; store: Store; live: Live | null }) {
  const { t, lang, pick } = useI18n()
  const latest = store.runs.find((r) => r.agent === "visibility") ?? store.runs[0]
  const beats = useMemo(
    () => (latest ? beatsFor(latest.steps, store.name, latest.status === "failed", t, lang) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latest, store.name, lang]
  )
  const replay = useShiftReplay(beats)
  const isLive = live?.status === "running"
  const mins = latest ? minutesBetween(latest.started_at, latest.finished_at) : null

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-chart-1 relative grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-sm">
            <Bot className="size-6" />
            {isLive && (
              <span className="bg-success ring-card absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full ring-2" />
            )}
          </div>
          <div className="min-w-0 max-w-xl space-y-1">
            <h2 className="leading-tight font-semibold">{site.agent.name}</h2>
            <p className="text-muted-foreground text-xs leading-snug">{pick<string>(site.agent, "role")}</p>
          </div>
        </div>
        <ShiftStatus site={site} latest={latest} live={live} />
      </div>

      <div className="bg-gradient-to-b from-sky-50/80 to-transparent px-2 pt-3 pb-1 sm:px-6 dark:from-sky-950/30">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold tracking-tight">{t("hq.title")}</p>
          {isLive ? (
            <Badge variant="success" className="gap-1.5">
              <span className="bg-success size-1.5 animate-pulse rounded-full" /> {t("hq.liveNow")}
            </Badge>
          ) : latest && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1 hidden text-xs sm:inline">
                {t("hq.replaying", { d: fmtDate(latest.run_date) })}
              </span>
              <Button size="sm" variant="outline" onClick={() => replay.setPlaying(!replay.playing)} disabled={replay.done}>
                {replay.playing && !replay.done ? <Pause /> : <Play />}
                {replay.playing && !replay.done ? t("hq.pause") : t("hq.play")}
              </Button>
              <Button size="sm" variant="ghost" onClick={replay.replay}>
                <RotateCcw /> {t("hq.replay")}
              </Button>
            </div>
          )}
        </div>
        {latest ? (
          <div className="mx-auto max-w-[960px]">
            {isLive && live ? (
              <OfficeScene beat={liveBeat(live, lang)} phase="work" done={false} agentName={site.agent.name} />
            ) : (
              <OfficeScene beat={replay.beat} phase={replay.phase} done={replay.done} agentName={site.agent.name} />
            )}
          </div>
        ) : (
          <p className="text-muted-foreground p-10 text-center text-sm">{t("hq.none")}</p>
        )}
      </div>

      {latest && !isLive && (
        <div className="border-t p-5">
          <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {beats.map((b, i) => {
              const state = i < replay.index ? "done" : i === replay.index ? "now" : "todo"
              return (
                <li key={i}>
                  <button
                    onClick={() => replay.jump(i)}
                    className={cn(
                      "hover:bg-accent flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      state === "now" && "bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-[9px] font-semibold",
                        state === "done" && "border-chart-1 bg-chart-1 text-white",
                        state === "now" && "border-chart-1 text-chart-1",
                        b.step?.status === "failed" && "border-destructive bg-destructive text-white"
                      )}
                    >
                      {state === "done" ? <Check className="size-2.5" /> : (b.step?.step ?? "·")}
                    </span>
                    <span className={cn("min-w-0 flex-1", state === "todo" && "text-muted-foreground")}>{b.text}</span>
                    {b.step && (
                      <Badge variant={b.step.kind === "AI" ? "default" : "outline"} className="h-4 px-1 text-[9px]">
                        {b.step.kind === "AI" ? t("common.ai") : t("common.code")}
                      </Badge>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="text-muted-foreground mt-3 px-2 text-[11px] leading-snug">
            {t("hq.realTime", {
              from: fmtTime(latest.started_at),
              to: latest.finished_at ? `–${fmtTime(latest.finished_at)}` : "",
              mins: mins ? t("hq.mins", { n: mins }) : "",
            })}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t px-5 py-3 text-xs">
        <span className="text-muted-foreground mr-1">{t("hq.team")}</span>
        <Badge variant="default" className="gap-1">
          <Bot /> {t("hq.onDuty")}
        </Badge>
        {[...FUTURE_AGENTS.map((a) => a.name), "Master check"].map((n) => (
          <span key={n} className="text-muted-foreground flex items-center gap-1.5">
            <ArrowRight className="size-3" />
            <Badge variant="outline" className="border-dashed font-normal">
              {t("hq.planned", { name: n })}
            </Badge>
          </span>
        ))}
      </div>
    </Card>
  )
}
