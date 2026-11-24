import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Loader2, RefreshCw } from "lucide-react"

import { AuditView, CopyButton } from "@/components/Audit"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import { ScanFailure } from "@/lib/scan"
import { getSite, rescanSite, setFix } from "@/lib/site"
import type { Fix, FixChoice, Guide, SiteView } from "@/lib/types"
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
            <CopyButton text={guide.code.text} label={t("audit.copy")} t={t} />
          </div>
          <pre className="bg-muted max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap break-all">{guide.code.text}</pre>
        </div>
      )}
    </div>
  )
}

function SiteFix({ fix, view, busy, onChoose }: { fix: Fix; view: SiteView; busy: boolean; onChoose: (c: FixChoice) => void }) {
  const { t, lang } = useI18n()
  const done = view.done.includes(fix.check_id)
  const choice = view.states[fix.check_id] ?? "open"
  const held = fix.status === "platform_held"
  const guide = view.guides[fix.check_id]
  const prompt = view.latest.checks.find((c) => c.id === fix.check_id)?.[lang === "id" ? "prompt_id" : "prompt"]
  const badge = done
    ? { label: t("site.state.done"), variant: "success" as const }
    : choice === "self"
      ? { label: t("site.state.self"), variant: "secondary" as const }
      : choice === "asked_fixer"
        ? { label: t("site.state.asked_fixer"), variant: "secondary" as const }
        : undefined
  return (
    <FixCard fix={fix} badge={badge} hideSummary={!held}>
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

export function SitePage({ token, go }: { token: string; go: (hash: string) => void }) {
  const { t } = useI18n()
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
  const baselineTotal = first ? first.gaps.length : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{view.site.host}</h1>
          <p className="text-muted-foreground text-sm">{t("site.checked", { d: fmtDate(audit.scanned_at.slice(0, 10)) })}</p>
        </div>
        <Button onClick={() => act(() => rescanSite(token))} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ? t("site.rechecking") : t("site.recheck")}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className={`text-5xl font-semibold tabular-nums ${SCORE_TONE[audit.label]}`}>
            {audit.score ?? "–"}
            <span className="text-muted-foreground text-xl">/100</span>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <div className="font-medium">{t(`site.verdict.${audit.label}`)}</div>
            {rechecked && first?.score !== null && first?.score !== undefined && (
              <p className="text-muted-foreground text-sm">{t("site.before", { a: first.score, b: audit.score ?? "–" })}</p>
            )}
            {rechecked && baselineTotal > 0 && (
              <p className="text-muted-foreground text-sm">{t("site.progress", { done: doneCount, total: baselineTotal })}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <div className="min-w-60 flex-1">
            <div className="font-medium">{t("site.linkTitle")}</div>
            <p className="text-muted-foreground text-xs">{t("site.linkSub")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
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
          <div className="grid gap-3 lg:grid-cols-2">
            {fixes.map((f) => (
              <SiteFix key={f.check_id} fix={f} view={view} busy={busy} onChoose={(c) => act(() => setFix(token, f.check_id, c))} />
            ))}
          </div>
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

      <div className="text-center">
        <Button variant="outline" onClick={() => go("#/")}>
          {t("site.again")}
        </Button>
      </div>
    </div>
  )
}
