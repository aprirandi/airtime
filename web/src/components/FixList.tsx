import { useMemo, useState } from "react"
import { Flag, SlidersHorizontal, Wrench, FileCheck2, FileX2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { AuditCheck, Fix } from "@/lib/types"
import { cn } from "@/lib/utils"

export type Priority = "high" | "medium" | "low"
export type Effort = "easy" | "medium" | "hard"

const PRIORITY_OF: Record<Fix["tier"], Priority> = { essential: "high", recommended: "medium", bonus: "low" }
const PRIORITIES: Priority[] = ["high", "medium", "low"]
const EFFORTS: Effort[] = ["easy", "medium", "hard"]
const CATEGORIES = ["1", "2", "3"] as const

export interface FixMeta {
  priority: Priority
  effort: Effort
  /** the category: a group number, or "held" when the platform decides */
  category: string
}

/** Priority, effort and category for each fix. The effort comes from the check; one that is missing counts as medium. */
export function metaOf(fix: Fix, checks: AuditCheck[]): FixMeta {
  const check = checks.find((c) => c.id === fix.check_id)
  return {
    priority: PRIORITY_OF[fix.tier],
    effort: (check?.effort as Effort | undefined) ?? "medium",
    category: fix.status === "platform_held" ? "held" : String(check?.group ?? 3),
  }
}

const PRIORITY_VARIANT = { high: "destructive", medium: "warning", low: "outline" } as const
const EFFORT_VARIANT = { easy: "success", medium: "secondary", hard: "outline" } as const

export function FixMetaBadges({ meta, file }: { meta: FixMeta; file?: "ready" | "none" }) {
  const { t } = useI18n()
  if (meta.category === "held") return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={PRIORITY_VARIANT[meta.priority]} title={t("fix.priority.hint")}>
        <Flag className="size-3" /> {t(`fix.badge.${meta.priority}`)}
      </Badge>
      <Badge variant={EFFORT_VARIANT[meta.effort]} title={t("fix.effort.hint")}>
        <Wrench className="size-3" /> {t(meta.effort === "medium" ? "fix.badge.medium_effort" : `fix.badge.${meta.effort}`)}
      </Badge>
      {file && (
        <Badge variant={file === "ready" ? "success" : "outline"} className={file === "none" ? "border-dashed" : undefined} title={t(`fix.file.${file}.hint`)}>
          {file === "ready" ? <FileCheck2 className="size-3" /> : <FileX2 className="size-3" />} {t(`fix.file.${file}`)}
        </Badge>
      )}
    </div>
  )
}

/** A row of choices joined into one control: "All" and one choice for each value, with how many each would leave. */
function Segmented<T extends string>({ label, options, value, counts, text, mark, onChange }: {
  label: string
  options: T[]
  value: T | "all"
  counts: Record<string, number>
  text: (o: T) => string
  mark?: (o: T) => React.ReactNode
  onChange: (v: T | "all") => void
}) {
  const { t } = useI18n()
  const all = Object.values(counts).reduce((a, b) => a + b, 0)
  const entries: [T | "all", string, number][] = [["all", t("fix.filter.all"), all], ...options.map((o): [T, string, number] => [o, text(o), counts[o] ?? 0])]
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div role="group" aria-label={label} className="bg-muted inline-flex max-w-full flex-wrap gap-0.5 rounded-lg p-0.5">
        {entries.map(([key, name, n]) => {
          const on = value === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={n === 0 && !on}
              onClick={() => onChange(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                on ? "bg-background text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {key !== "all" && mark?.(key as T)}
              {name}
              <span className={cn("text-xs tabular-nums", on ? "text-muted-foreground" : "opacity-70")}>{n}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const PRIORITY_DOT: Record<Priority, string> = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-slate-300 dark:bg-slate-500" }

const PriorityMark = ({ p }: { p: Priority }) => <span className={cn("size-2 rounded-full", PRIORITY_DOT[p])} aria-hidden="true" />

/** Easy is one filled dot, medium two, hard three: how much work it is. */
const EffortMark = ({ e }: { e: Effort }) => {
  const filled = e === "easy" ? 1 : e === "medium" ? 2 : 3
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i < filled ? "bg-foreground/70" : "bg-foreground/20")} />
      ))}
    </span>
  )
}

const rank = (list: readonly string[], v: string) => list.indexOf(v)

/** The things to do that matter most, most important first and the easiest among equals. */
export function mostImportant(fixes: Fix[], checks: AuditCheck[], skip: (fix: Fix) => boolean = () => false) {
  return fixes
    .filter((f) => f.status !== "platform_held" && !skip(f))
    .map((fix) => ({ fix, meta: metaOf(fix, checks) }))
    .sort((a, b) => rank(PRIORITIES, a.meta.priority) - rank(PRIORITIES, b.meta.priority) || rank(EFFORTS, a.meta.effort) - rank(EFFORTS, b.meta.effort) || a.fix.position - b.fix.position)
}

/**
 * The things to do, in one column, grouped by category, with filters for priority, how hard and category.
 * Within a category the most important comes first, and among equals the easiest.
 */
export function FixList({ fixes, checks, card }: { fixes: Fix[]; checks: AuditCheck[]; card: (fix: Fix, meta: FixMeta) => React.ReactNode }) {
  const { t } = useI18n()
  const [priority, setPriority] = useState<Priority | "all">("all")
  const [effort, setEffort] = useState<Effort | "all">("all")
  const [category, setCategory] = useState<string>("all")

  const rows = useMemo(() => fixes.map((fix) => ({ fix, meta: metaOf(fix, checks) })), [fixes, checks])
  const actionable = rows.filter((r) => r.meta.category !== "held")
  const held = rows.filter((r) => r.meta.category === "held")

  const matches = (r: (typeof rows)[number], skip?: "priority" | "effort" | "category") =>
    (skip === "priority" || priority === "all" || r.meta.priority === priority) &&
    (skip === "effort" || effort === "all" || r.meta.effort === effort) &&
    (skip === "category" || category === "all" || r.meta.category === category)
  // each filter shows how many there would be with the other two applied
  const count = (key: "priority" | "effort" | "category", of: (r: (typeof rows)[number]) => string) => {
    const out: Record<string, number> = {}
    for (const r of actionable) if (matches(r, key)) out[of(r)] = (out[of(r)] ?? 0) + 1
    return out
  }

  const shown = actionable
    .filter((r) => matches(r))
    .sort((a, b) => rank(PRIORITIES, a.meta.priority) - rank(PRIORITIES, b.meta.priority) || rank(EFFORTS, a.meta.effort) - rank(EFFORTS, b.meta.effort) || a.fix.position - b.fix.position)
  const showHeld = held.filter((r) => (priority === "all" || r.meta.priority === priority) && effort === "all" && (category === "all" || category === "held"))
  const filtered = priority !== "all" || effort !== "all" || category !== "all"
  const sections = [...CATEGORIES.filter((c) => shown.some((r) => r.meta.category === c)), ...(showHeld.length ? ["held"] : [])]
  const reset = () => {
    setPriority("all")
    setEffort("all")
    setCategory("all")
  }

  return (
    <div className="space-y-5">
      {actionable.length > 0 && (
        <div className="bg-card space-y-4 rounded-xl border p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal className="size-4" aria-hidden="true" /> {t("fix.filter.title")}
              <span className="text-muted-foreground font-normal">· {t("fix.showing", { n: shown.length, total: actionable.length })}</span>
            </div>
            {filtered && (
              <Button type="button" variant="ghost" size="sm" onClick={reset} className="h-7 gap-1 px-2 text-xs">
                <X className="size-3.5" /> {t("fix.filter.reset")}
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Segmented label={t("fix.filter.priority")} options={PRIORITIES} value={priority} counts={count("priority", (r) => r.meta.priority)} text={(o) => t(`fix.p.${o}`)} mark={(o) => <PriorityMark p={o} />} onChange={setPriority} />
            <Segmented label={t("fix.filter.effort")} options={EFFORTS} value={effort} counts={count("effort", (r) => r.meta.effort)} text={(o) => t(`fix.e.${o}`)} mark={(o) => <EffortMark e={o} />} onChange={setEffort} />
          </div>
          <Segmented label={t("fix.filter.category")} options={[...CATEGORIES]} value={category} counts={count("category", (r) => r.meta.category)} text={(o) => t(`fix.cat.${o}`)} onChange={setCategory} />
        </div>
      )}
      {sections.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {t("fix.none")}{" "}
          {filtered && (
            <button type="button" className="text-chart-1 underline" onClick={reset}>
              {t("fix.reset")}
            </button>
          )}
        </p>
      )}
      {sections.map((c) => {
        const list = c === "held" ? showHeld : shown.filter((r) => r.meta.category === c)
        return (
          <section key={c} className="space-y-3">
            <h3 className="flex items-baseline gap-2 text-base font-semibold">
              {t(`fix.cat.${c}`)} <span className="text-muted-foreground text-sm font-normal">{c === "held" ? list.length : t("fix.count", { n: list.length })}</span>
            </h3>
            <div className="space-y-3">
              {list.map((r) => (
                <div key={r.fix.check_id}>{card(r.fix, r.meta)}</div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
