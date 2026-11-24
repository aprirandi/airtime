import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Check, Copy, Loader2, Minus, RefreshCw } from "lucide-react"

import { AuditView, CopyButton } from "@/components/Audit"
import { AskerSection } from "@/components/AskerSection"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import { ScanFailure } from "@/lib/scan"
import { getSite, rescanSite, setFix } from "@/lib/site"
import type { Fix, FixChoice, Guide, SiteView } from "@/lib/types"
import { FixList, mostImportant, type FixMeta } from "@/components/FixList"
import { cn } from "@/lib/utils"
import { FixCard } from "@/pages/Overview"

type State = { kind: "loading" } | { kind: "ready"; view: SiteView } | { kind: "error"; code: string; message: string }

const SCORE_TONE = { strong: "text-success", needs_work: "text-warning", blockers: "text-destructive", none: "" } as const

function Steps({ guide, lang, t }: { guide: Guide; lang: "en" | "id"; t: T }) {
  const say = (b: { en: string; id: string }) => (lang === "id" ? b.id : b.en)
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {guide.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="bg-secondary text-muted-foreground grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium">{i + 1}</span>
            <span>{say(s)}</span>
          </li>
        ))}
      </ol>
      {guide.code && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs font-medium">{say(guide.code.label)}</span>
            <CopyButton text={guide.code.text} label={t("site.copyCode")} t={t} />
          </div>
          <pre className="bg-muted max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap break-all">{guide.code.text}</pre>
        </div>
      )}
    </div>
  )
}

/** Up, down or the same, with the number and what it is measured from. */
function Delta({ now, before, text, same, small }: { now: number; before: number; text: (d: string, b: number) => string; same: string; small?: boolean }) {
  const diff = Math.round((now - before) * 10) / 10
  const tone = diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : "text-muted-foreground"
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus
  return (
    <p className={cn("flex items-center gap-1 font-medium", tone, small ? "text-xs" : "text-sm")}>
      <Icon className="size-3.5" aria-hidden="true" />
      {diff === 0 ? same : text(`${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}`, before)}
    </p>
  )
}

function SiteFix({ fix, meta, view, busy, onChoose }: { fix: Fix; meta: FixMeta; view: SiteView; busy: boolean; onChoose: (c: FixChoice) => void }) {
  const { t, lang } = useI18n()
  const done = view.done.includes(fix.check_id)
  const choice = view.states[fix.check_id] ?? "open"
  const held = fix.status === "platform_held"
  const guide = view.guides[fix.check_id]
  const prompt = view.latest.checks.find((c) => c.id === fix.check_id)?.[lang === "id" ? "prompt_id" : "prompt"]
  const check = view.latest.checks.find((c) => c.id === fix.check_id)
  const partial = !done && check?.result === "partial" ? check : undefined
  const badge = done
    ? { label: t("site.state.done"), variant: "success" as const }
    : partial
      ? { label: t("site.state.partial", { p: partial.percent }), variant: "warning" as const }
    : choice === "self"
      ? { label: t("site.state.self"), variant: "secondary" as const }
      : choice === "asked_fixer"
        ? { label: t("site.state.asked_fixer"), variant: "secondary" as const }
        : undefined
  return (
    <FixCard fix={fix} meta={meta} badge={badge} hideSummary={!held}>
      {!held && !done && (
        <div className="flex flex-wrap gap-2">
          {choice !== "self" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onChoose("self")}>
              {t("site.btn.self")}
            </Button>
          )}
          {choice !== "asked_fixer" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onChoose("asked_fixer")}>
              {t("site.btn.fixer")}
            </Button>
          )}
          {choice !== "open" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChoose("open")}>
              {t("site.btn.reset")}
            </Button>
          )}
        </div>
      )}
      {partial && <p className="text-muted-foreground text-xs">{t("site.lastCheck", { e: partial.evidence })}</p>}
      {choice === "asked_fixer" && !done && <p className="text-muted-foreground text-xs">{t("site.fixerNote")}</p>}
      {guide && !done && (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("site.how")}</summary>
          <div className="space-y-4 border-t p-3">
            <Badge variant={guide.owner ? "success" : "secondary"}>{guide.owner ? t("site.owner.yes") : t("site.owner.no")}</Badge>
            <Steps guide={guide} lang={lang} t={t} />
            {guide.owner && <p className="text-muted-foreground text-xs">{t("site.menuNote")}</p>}
            {prompt && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-xs font-medium">{t("site.promptTitle")}</div>
                <CopyButton text={prompt} label={t("audit.copy")} t={t} />
              </div>
            )}
            {(guide.developer || guide.verify) && (
              <details>
                <summary className="text-muted-foreground cursor-pointer text-xs">{t("site.devTitle")}</summary>
                {guide.developer && <p className="mt-1 text-xs">{lang === "id" ? guide.developer.id : guide.developer.en}</p>}
                {guide.verify && <p className="mt-2 text-xs font-medium">{t("site.verify")}</p>}
                {guide.verify && <p className="mt-1 text-xs">{lang === "id" ? guide.verify.id : guide.verify.en}</p>}
                {guide.verify && (
                  <pre className="bg-muted mt-1 overflow-auto rounded p-2 text-xs whitespace-pre-wrap break-all">
                    {guide.verify.command.split("{site}").join(view.site.url)}
                  </pre>
                )}
              </details>
            )}
          </div>
        </details>
      )}
    </FixCard>
  )
}

export function SitePage({ token, tab, go }: { token: string; tab: "audit" | "ask"; go: (hash: string) => void }) {
  const { t, pick } = useI18n()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const fail = (err: unknown) => {
    const f = err instanceof ScanFailure ? err : new ScanFailure("failed", "failed")
    setState({ kind: "error", code: f.code, message: f.message })
  }

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: "loading" })
    getSite(token, controller.signal)
      .then((view) => setState({ kind: "ready", view }))
      .catch((err: Error) => err.name !== "AbortError" && fail(err))
    return () => controller.abort()
  }, [token])

  const act = useCallback(
    async (job: () => Promise<SiteView>) => {
      setBusy(true)
      try {
        setState({ kind: "ready", view: await job() })
      } catch (err) {
        fail(err)
      } finally {
        setBusy(false)
      }
    },
    []
  )

  if (state.kind === "loading") {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <Card>
        <CardContent className="space-y-3 text-sm" role="alert">
          <div className="text-destructive font-medium">
            {state.code === "not_found" ? t("site.notFound") : t("site.loadError", { e: state.code === "too_many" ? t("scan.error.too_many") : state.message })}
          </div>
          <Button variant="outline" size="sm" onClick={() => go("#/")}>
            {t("site.again")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { view } = state
  const audit = view.latest
  const fixes = audit.fixes ?? []
  const open = fixes.filter((f) => f.status !== "platform_held")
  const link = `${location.origin}${location.pathname}#/s/${token}`
  const first = view.baseline
  const rechecked = view.history.length > 1
  const doneCount = open.filter((f) => view.done.includes(f.check_id)).length

  const asker = view.asker
  const askerOn = asker.enabled
  const ranked = mostImportant(fixes, audit.checks, (f) => view.done.includes(f.check_id))
  const topNames = ranked.slice(0, 3).map((r) => pick<string>(r.fix, "title")).join(", ")
  const easyLeft = ranked.filter((r) => r.meta.effort === "easy").length
  const score = Math.max(0, Math.min(100, audit.score ?? 0))
  const previous = view.history.length > 1 ? view.history[view.history.length - 2] : undefined
  const bd = audit.breakdown
  const tiers: [string, string, typeof bd.essential][] = [
    ["essential", t("fix.badge.high"), bd.essential],
    ["recommended", t("fix.badge.medium"), bd.recommended],
    ["bonus", t("fix.badge.low"), bd.bonus],
  ]
  const sum = tiers.reduce((a, [, , x]) => ({ total: a.total + x.total, passing: a.passing + x.passing, partial: a.partial + x.partial, failed: a.failed + x.failed }), { total: 0, passing: 0, partial: 0, failed: 0 })
  const current = tab === "ask" && askerOn ? "ask" : "audit"
  const openLeft = open.length - doneCount

  const tabLink = (id: "audit" | "ask", label: string, sub: string) => (
    <a
      key={id}
      href={`#/s/${token}${id === "ask" ? "/ask" : ""}`}
      aria-current={current === id ? "page" : undefined}
      className={cn(
        "-mb-px flex flex-col border-b-2 px-4 py-2 text-sm transition-colors sm:flex-row sm:items-baseline sm:gap-2",
        current === id ? "border-chart-1 text-foreground font-semibold" : "text-muted-foreground hover:text-foreground border-transparent"
      )}
    >
      <span>{label}</span>
      <span className="text-muted-foreground text-xs font-normal">{sub}</span>
    </a>
  )

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{view.site.host}</h1>
            <p className="text-muted-foreground text-sm">{t("site.checked", { d: fmtDate(audit.scanned_at.slice(0, 10)) })}</p>
            <p className="text-muted-foreground mt-1 text-xs">{t("site.linkShort")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              title={t("site.linkSub")}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2500)
                } catch {
                  /* the link is in the address bar anyway */
                }
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? t("audit.copied") : t("site.copyLink")}
            </Button>
            {current === "audit" && (
              <Button onClick={() => act(() => rescanSite(token))} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ? t("site.rechecking") : t("site.recheck")}
              </Button>
            )}
          </div>
        </div>
        {askerOn && (
          <nav className="flex flex-wrap border-b" aria-label={view.site.host}>
            {tabLink("audit", t("site.tab.audit"), openLeft > 0 ? t("site.tab.todo", { n: openLeft }) : "")}
            {tabLink("ask", t("site.tab.ask"), asker.latest ? t("site.tab.named", { named: asker.latest.named, answered: asker.latest.answered }) : t("site.tab.notAsked"))}
          </nav>
        )}
      </div>

      {current === "ask" ? (
        <AskerSection token={token} view={view} onView={(v) => setState({ kind: "ready", view: v })} />
      ) : (
        <>
          <Card>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
                <div>
                  <div className={`text-5xl font-semibold tabular-nums ${SCORE_TONE[audit.label]}`}>
                    {audit.score ?? "–"}
                    <span className="text-muted-foreground text-xl">/100</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {first && first.score !== null && audit.score !== null && rechecked ? (
                      <Delta now={audit.score} before={first.score} text={(d, b) => t("site.delta.first", { d, b })} same={t("site.delta.firstSame", { b: first.score })} />
                    ) : (
                      <p className="text-muted-foreground text-xs">{t("site.delta.none")}</p>
                    )}
                    {previous && previous.score !== null && audit.score !== null && view.history.length > 2 && (
                      <Delta now={audit.score} before={previous.score} small text={(d, b) => t("site.delta.prev", { d, b })} same={t("site.delta.prevSame", { b: previous.score })} />
                    )}
                  </div>
                </div>
                <div className="min-w-56 flex-1 space-y-2">
                  <Badge variant={audit.label === "strong" ? "success" : audit.label === "needs_work" ? "warning" : "destructive"}>{t(`site.chip.${audit.label}`)}</Badge>
                  <p className="text-sm">{t("site.sum", { pass: sum.passing, total: sum.total, partial: sum.partial, failed: sum.failed })}</p>
                  {ranked.length > 0 && <p className="text-muted-foreground text-sm">{t("site.verdict.easy", { e: easyLeft, n: ranked.length })}</p>}
                  {rechecked && view.done.length > 0 && <p className="text-success text-sm">{t("site.doneSince", { n: view.done.length })}</p>}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {tiers.map(([key, label, tier]) => (
                  <div key={key} className="rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs">{label}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {tier.passing}
                      <span className="text-muted-foreground text-sm font-normal"> / {tier.total} {t("site.passed")}</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">{t("site.tierRest", { partial: tier.partial, failed: tier.failed })}</div>
                  </div>
                ))}
              </div>

              {audit.score !== null && (
                <div className="space-y-1" aria-hidden="true">
                  <div className="relative h-2 overflow-hidden rounded-full">
                    <div className="absolute inset-y-0 left-0 w-[60%] bg-red-500/70" />
                    <div className="absolute inset-y-0 left-[60%] w-[20%] bg-amber-400/80" />
                    <div className="absolute inset-y-0 left-[80%] w-[20%] bg-emerald-500/70" />
                    <div className="bg-foreground absolute top-[-2px] h-3 w-1 rounded-full" style={{ left: `calc(${score}% - 2px)` }} />
                  </div>
                  <div className="text-muted-foreground relative flex text-[11px]">
                    <span className="w-[60%]">{t("site.scale.low")}</span>
                    <span className="w-[20%]">{t("site.scale.mid")}</span>
                    <span className="w-[20%]">{t("site.scale.high")}</span>
                  </div>
                </div>
              )}
              {audit.label !== "strong" && ranked.length > 0 && <p className="text-sm">{t("site.verdict.top", { names: topNames })}</p>}
            </CardContent>
          </Card>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{t("ov.fixes")}</h2>
              <p className="text-muted-foreground text-sm">{t("site.fixesSub")}</p>
            </div>
            {fixes.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("site.nothing")}</p>
            ) : (
              <FixList
                fixes={fixes}
                checks={audit.checks}
                card={(f, meta) => <SiteFix fix={f} meta={meta} view={view} busy={busy} onChoose={(c) => act(() => setFix(token, f.check_id, c))} />}
              />
            )}
            {view.done.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {view.done.map((id) => (
                  <Badge key={id} variant="success">
                    <Check className="size-3" /> {audit.checks.find((c) => c.id === id)?.name ?? id}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          <details className="rounded-lg border">
            <summary className="cursor-pointer px-4 py-3 font-medium">
              {t("site.technical")} <span className="text-muted-foreground text-sm font-normal">· {t("site.technicalSub")}</span>
            </summary>
            <div className="border-t p-3">
              <AuditView audit={audit} name={view.site.host} variant="public" />
            </div>
          </details>
        </>
      )}

      <div className="text-center">
        <Button variant="outline" onClick={() => go("#/")}>
          {t("site.again")}
        </Button>
      </div>
    </div>
  )
}
