import { useEffect, useState, type ReactNode } from "react"
import {
  Archive, BookOpenText, Bot, Calculator, CheckCheck, FileText, GitCompareArrows, LayoutDashboard,
  ListChecks, Loader2, Pause, Play, RotateCcw, Send, Store as StoreIcon, UserPlus,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRun } from "@/lib/data"
import { fmtDate } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import type { AnswerDetail, Live, RunDetail, Site, Store } from "@/lib/types"
import { cn } from "@/lib/utils"

type Kind = "Data" | "AI" | "Code" | "Gemini" | "Output"

interface Node {
  id: string
  icon: typeof Bot
  kind: Kind
  title: string
  who: string
  lines: ReactNode[]
  steps?: string[] // run-log step names this node covers, for live highlighting
  source?: string
}

const KIND_STYLE: Record<Kind, string> = {
  Data: "bg-secondary text-secondary-foreground",
  AI: "bg-primary text-primary-foreground",
  Code: "border bg-background text-foreground",
  Gemini: "bg-chart-1 text-white",
  Output: "bg-success/15 text-success",
}

type NodeState = "done" | "active" | "todo"

const STEP_MS = 2600
const HOLD_MS = 3500

/** Walks the pipeline one box at a time, then starts over, so the flow reads as running. */
function useFlowReplay(count: number) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing || count === 0) return
    const atEnd = index >= count
    const t = setTimeout(() => setIndex(atEnd ? 0 : index + 1), atEnd ? HOLD_MS : STEP_MS)
    return () => clearTimeout(t)
  }, [index, playing, count])
  return { index, playing, setPlaying, restart: () => { setIndex(0); setPlaying(true) } }
}

function Connector({ state }: { state: NodeState }) {
  return (
    <div className={cn("relative ml-[26px] h-7 w-0.5 transition-colors duration-500", state === "todo" ? "bg-border" : "bg-chart-1/60")} aria-hidden>
      {state === "active" && <span className="flow-packet bg-chart-1 absolute -left-[3px] size-2 rounded-full shadow-[0_0_0_3px] shadow-chart-1/25" />}
    </div>
  )
}

function FlowNode({ n, state, live }: { n: Node; state: NodeState; live: boolean }) {
  const { t } = useI18n()
  const Icon = n.icon
  const active = state === "active"
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border p-3 transition-all duration-500",
        active && (live ? "border-success bg-success/5 ring-success/30 ring-2" : "border-chart-1 bg-chart-1/5 ring-chart-1/25 ring-2 scale-[1.01]"),
        state === "todo" && "opacity-55"
      )}
    >
      <div className={cn("grid size-[38px] shrink-0 place-items-center rounded-lg", KIND_STYLE[n.kind])}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{n.title}</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
            {t(`flow.kind.${n.kind}`)}
          </Badge>
          {active && live && (
            <Badge variant="success" className="h-4 gap-1 px-1.5 text-[10px]">
              <span className="bg-success size-1.5 animate-pulse rounded-full" /> {t("flow.workingNow")}
            </Badge>
          )}
          {active && !live && (
            <Badge className="bg-chart-1 h-4 gap-1 px-1.5 text-[10px] text-white">
              <Loader2 className="animate-spin" /> {t("flow.processing")}
            </Badge>
          )}
          {state === "done" && <span className="text-success text-[11px]">{t("flow.done")}</span>}
          <span className="text-muted-foreground ml-auto text-[11px]">{n.who}</span>
        </div>
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {n.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {n.source && (
          <p className="text-muted-foreground/80 font-mono text-[10px]">{/^\d/.test(n.source) ? `step ${n.source}` : n.source}</p>
        )}
      </div>
    </div>
  )
}

function buildNodes(store: Store, d: RunDetail, t: T, comparison: string[]): Node[] {
  const a = d.answers
  const s = d.summary
  const setup = store.setup
  const questions = [...new Set(a.map((x) => x.question))]
  const areaQ = [...new Set(a.filter((x) => x.names_area).map((x) => x.question))].length
  const coreQ = [...new Set(a.filter((x) => x.kind !== "daily").map((x) => x.question))]
  const dailyQ = [...new Set(a.filter((x) => x.kind === "daily").map((x) => x.question))]
  const answered = a.filter((x) => x.status !== "no_answer")
  const mentions = a.reduce((n, x) => n + x.mentions.length, 0)
  const words = answered.length ? Math.round(answered.reduce((n, x) => n + x.text.split(/\s+/).length, 0) / answered.length) : 0
  const model = a.find((x) => x.model)?.model ?? setup?.ask_model ?? "Gemini"
  const tries = Math.max(1, ...a.map((x) => x.attempt))
  const codeNotAi = t("flow.codeNotAi")
  return [
    {
      id: "store", icon: StoreIcon, kind: "Data", title: t("flow.store.title"), who: t("flow.store.who"),
      lines: [`${store.name} · ${store.domain}`, t("flow.store.l2", { areas: store.areas.join(", "), n: store.categories.length }),
        t("flow.store.l3")],
      source: `config/stores/${store.slug}.toml`,
    },
    {
      id: "questions", icon: ListChecks, kind: "AI", title: t("flow.q.title"), who: "Visibility Agent",
      lines: dailyQ.length
        ? [t("flow.q.l1b", { core: coreQ.length, daily: dailyQ.length, a: areaQ, areas: store.areas.join(" / ") }),
            t("flow.q.l2", { q: dailyQ[0] }), t("flow.q.l3b")]
        : [t("flow.q.l1", { n: questions.length, a: areaQ, areas: store.areas.join(" / ") }),
            t("flow.q.l2", { q: questions[0] ?? "" }), t("flow.q.l3")],
      steps: ["write_questions", "validate_questions"], source: "1–2",
    },
    {
      id: "gemini", icon: Send, kind: "Gemini", title: t("flow.g.title"), who: "Google Gemini API",
      lines: [`${model}${setup?.use_search ? t("flow.g.withSearch") : t("flow.g.noSearch")}`,
        t("flow.g.l2", { n: a.length, tries, ok: answered.length, no: a.length - answered.length })],
      steps: ["ask_questions"], source: "3",
    },
    {
      id: "archive", icon: Archive, kind: "Data", title: t("flow.a.title"), who: "SQLite",
      lines: [t("flow.a.l1", { n: a.length }), t("flow.a.l2", { w: words })],
      source: "data/airtime.sqlite · answers",
    },
    {
      id: "read", icon: BookOpenText, kind: "AI", title: t("flow.r.title"), who: setup?.work_model ?? "Gemini",
      lines: [t("flow.r.l1", { n: answered.length }), t("flow.r.l2", { n: mentions })],
      steps: ["extract_mentions"], source: "4",
    },
    {
      id: "check", icon: CheckCheck, kind: "Code", title: t("flow.c.title"), who: codeNotAi,
      lines: [t("flow.c.l1", { n: d.run.quotes_verified }), t("flow.c.l2", { n: s?.needs_review ?? 0 })],
      steps: ["verify_and_count"], source: "5",
    },
    {
      id: "count", icon: Calculator, kind: "Code", title: t("flow.n.title"), who: codeNotAi,
      lines: s
        ? [t("flow.n.l1", { store: store.name, n: s.our_mentions, d: s.total_answers }),
            t("flow.n.l1", { store: s.top_competitor ?? "-", n: s.top_competitor_mentions, d: s.total_answers }),
            t("flow.n.l3", { n: s.competitors.length })]
        : [t("flow.n.none")],
      steps: ["verify_and_count"], source: "data/airtime.sqlite · daily_summary",
    },
    {
      id: "compare", icon: GitCompareArrows, kind: "Code", title: t("flow.cmp.title"), who: codeNotAi,
      lines: [comparison[1] ?? comparison[0] ?? ""], steps: ["compare_previous"], source: "6",
    },
    {
      id: "summary", icon: FileText, kind: "AI", title: t("flow.s.title"), who: t("flow.s.who"),
      lines: [s?.text_source === "ai" ? t("flow.s.ai") : t("flow.s.code")],
      steps: ["write_summary"], source: "7",
    },
    {
      id: "dashboard", icon: LayoutDashboard, kind: "Output", title: t("flow.d.title"), who: t("flow.d.who"),
      lines: [t("flow.d.l1")],
    },
  ]
}

function pickTrace(answers: AnswerDetail[]): AnswerDetail | undefined {
  const ok = answers.filter((a) => a.status === "ok" && a.mentions.length)
  return ok.find((a) => a.mentions.some((m) => m.is_ours)) ?? ok[0]
}

/** Which stage of the traced answer each pipeline box corresponds to. */
const TRACE_STAGE: Record<string, number> = { store: 0, questions: 1, gemini: 2, archive: 2, read: 3, check: 4, count: 5, compare: 6, summary: 6, dashboard: 6 }

function TraceCard({ a, storeName, stage }: { a: AnswerDetail; storeName: string; stage: number }) {
  const { t } = useI18n()
  const ours = a.mentions.some((m) => m.is_ours)
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base">{t("trace.title")}</CardTitle>
        <CardDescription>{t("trace.sub", { id: a.id })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <Stage n={1} at={stage} title={t("trace.s1")}>
          "{a.question}" <span className="text-muted-foreground">{t("trace.try", { n: a.attempt })}</span>
        </Stage>
        <Stage n={2} at={stage} title={t("trace.s2", { n: a.text.split(/\s+/).length })}>
          <span className="text-muted-foreground">{a.text.replace(/[#*_`>]/g, "").slice(0, 220)}…</span>
        </Stage>
        <Stage n={3} at={stage} title={t("trace.s3", { n: a.mentions.length })}>
          <ul className="space-y-1">
            {a.mentions.slice(0, 4).map((m) => (
              <li key={m.position}>
                <span className="font-medium">{m.store_name}</span>{" "}
                <span className="text-muted-foreground">"{m.quote.slice(0, 70)}{m.quote.length > 70 ? "…" : ""}"</span>
              </li>
            ))}
            {a.mentions.length > 4 && <li className="text-muted-foreground">{t("trace.more", { n: a.mentions.length - 4 })}</li>}
          </ul>
        </Stage>
        <Stage n={4} at={stage} title={t("trace.s4")}>
          <span className="text-success">{t("trace.allFound", { n: a.mentions.length })}</span>
        </Stage>
        <Stage n={5} at={stage} title={t("trace.s5")}>
          {ours ? t("trace.ours", { store: storeName }) : t("trace.notOurs", { store: storeName })} ·{" "}
          {t("trace.others", { n: a.mentions.filter((m) => !m.is_ours).length })}
        </Stage>
      </CardContent>
    </Card>
  )
}

function Stage({ n, at, title, children }: { n: number; at: number; title: string; children: ReactNode }) {
  return (
    <div className={cn("flex gap-2.5 rounded-md p-1 transition-all duration-500", n === at && "bg-chart-1/10", n > at && "opacity-40")}>
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors",
          n < at ? "bg-chart-1 text-white" : n === at ? "border-chart-1 text-chart-1 border" : "bg-muted"
        )}
      >
        {n < at ? "✓" : n}
      </span>
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium">{title}</div>
        <div>{children}</div>
      </div>
    </div>
  )
}

export function DataFlow({ site, store, live }: { site: Site; store: Store; live: Live | null }) {
  const { t } = useI18n()
  const latest = store.runs.find((r) => r.agent === "visibility")
  const { data, error } = useRun(latest?.id ?? null)
  if (!latest) return <p className="text-muted-foreground text-sm">{t("team.noShift")}</p>
  if (error) return <p className="text-destructive text-sm">{t("day.loadError", { e: error })}</p>
  if (!data) return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
  return <FlowView site={site} store={store} live={live} data={data} runDate={latest.run_date} />
}

function FlowView({ site, store, live, data, runDate }: { site: Site; store: Store; live: Live | null; data: RunDetail; runDate: string }) {
  const { t, pick } = useI18n()
  const nodes = buildNodes(store, data, t, pick<string[]>(data, "comparison") ?? data.comparison)
  const replay = useFlowReplay(nodes.length)
  const current = live?.status === "running" ? live.current : null
  const liveIndex = current ? nodes.findIndex((n) => n.steps?.includes(current)) : -1
  const activeIndex = current ? Math.max(0, liveIndex) : replay.index
  const stateOf = (i: number): NodeState => (i < activeIndex ? "done" : i === activeIndex ? "active" : "todo")
  const trace = pickTrace(data.answers)
  const planned = site.team.filter((m) => m.status === "planned")
  const stage = activeIndex >= nodes.length ? 6 : TRACE_STAGE[nodes[activeIndex]?.id] ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("flow.intro", { d: fmtDate(runDate) })}
        </p>
        {current ? (
          <Badge variant="success" className="gap-1.5">
            <span className="bg-success size-1.5 animate-pulse rounded-full" /> {t("flow.liveBadge")}
          </Badge>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground mr-1 text-xs">
              {replay.index >= nodes.length ? t("flow.complete") : t("flow.replaying", { n: replay.index + 1, total: nodes.length })}
            </span>
            <Button size="sm" variant="outline" onClick={() => replay.setPlaying(!replay.playing)}>
              {replay.playing ? <Pause /> : <Play />} {replay.playing ? t("hq.pause") : t("hq.play")}
            </Button>
            <Button size="sm" variant="ghost" onClick={replay.restart}>
              <RotateCcw /> {t("flow.restart")}
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          {nodes.map((n, i) => (
            <div key={n.id}>
              <FlowNode n={n} state={stateOf(i)} live={Boolean(current)} />
              {i < nodes.length - 1 && <Connector state={stateOf(i)} />}
            </div>
          ))}
          <div className="mt-6 rounded-xl border border-dashed p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <UserPlus className="size-4" /> {t("flow.next")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="default">{t("flow.visCounts")}</Badge>
              {planned.map((m) => (
                <span key={m.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="outline" className="border-dashed font-normal">
                    {m.name}: {pick<string[]>(m, "outputs").join(", ")}
                  </Badge>
                </span>
              ))}
            </div>
          </div>
        </div>
        {trace && <TraceCard a={trace} storeName={store.name} stage={stage} />}
      </div>
    </div>
  )
}
