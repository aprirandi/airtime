import { useState } from "react"
import { Check, Copy, ShieldAlert } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { fmtDate } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import type { Audit, AuditCheck, AuditTier, ExternalIssue, Store } from "@/lib/types"

export function ResultBadge({ c, t }: { c: AuditCheck; t: T }) {
  if (c.result === "pass") return <Badge variant="success">{t("audit.result.pass")}</Badge>
  if (c.result === "partial") return <Badge variant="warning">{t("audit.result.partial", { p: c.percent })}</Badge>
  if (c.result === "fail") return <Badge variant="destructive">{t("audit.result.fail")}</Badge>
  return <Badge variant="outline">{t("audit.result.na")}</Badge>
}

function TierRow({ label, line, value }: { label: string; line: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{line}</span>
      </div>
      <Progress value={value} indicatorClassName="bg-chart-1" />
    </div>
  )
}

/** Copy text to the clipboard. Some in-app views refuse the Clipboard API, so fall back to a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement("textarea")
      el.value = text
      el.style.position = "fixed"
      el.style.opacity = "0"
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }
}

function CopyButton({ text, label, t }: { text: string; label: string; t: T }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async (e) => {
        e.stopPropagation()
        setState((await copyText(text)) ? "copied" : "failed")
        setTimeout(() => setState("idle"), 2500)
      }}
    >
      {state === "copied" ? <Check /> : <Copy />}
      {state === "copied" ? t("audit.copied") : state === "failed" ? t("audit.copyFailed") : label}
    </Button>
  )
}

function ExternalIssueItem({ i, t }: { i: ExternalIssue; t: T }) {
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(`audit.tier.${i.tier}`)}</Badge>
        <span className="min-w-0 font-medium">{i.name}</span>
        <Badge variant={i.result === "partial" ? "warning" : "destructive"}>
          {i.result === "partial" ? t("audit.result.partialShort") : t("audit.result.fail")}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">{i.details}</p>
    </li>
  )
}

function ExternalSection({ audit, t }: { audit: Audit; t: T }) {
  const ext = audit.external
  if (!ext) return null
  if (ext.status !== "ok") {
    return (
      <div className="space-y-1">
        <div className="text-sm font-medium">{t("audit.ext.title")}</div>
        <p className="text-muted-foreground text-xs">{t("audit.ext.unavailable", { e: ext.error })}</p>
      </div>
    )
  }
  const extra = ext.issues.filter((i) => i.kind === "extra")
  const api = ext.issues.filter((i) => i.kind === "api_product")
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("audit.ext.title")}</div>
        <a href={ext.report_url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
          {t("audit.ext.open")}
        </a>
      </div>
      <p className="text-muted-foreground text-xs">{t("audit.ext.sub")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("audit.ext.theirScore")}</div>
          <div className="text-xl font-semibold tabular-nums">{ext.score ?? "—"}</div>
          <div className="text-muted-foreground text-xs">{ext.label}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("audit.ext.agree")}</div>
          <div className="text-xl font-semibold tabular-nums">
            {ext.agreement ? `${ext.agreement.agree} / ${ext.agreement.compared}` : "—"}
          </div>
          <div className="text-muted-foreground text-xs">{t("audit.ext.agreeSub")}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{t("audit.ext.extra")}</div>
          <div className="text-xl font-semibold tabular-nums">{extra.length}</div>
          <div className="text-muted-foreground text-xs">{t("audit.ext.extraSub")}</div>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t("audit.ext.why")}</p>
      {extra.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">{t("audit.ext.extraTitle")}</div>
          <ul className="divide-y rounded-lg border text-sm">
            {extra.map((i) => (
              <ExternalIssueItem key={i.id} i={i} t={t} />
            ))}
          </ul>
        </div>
      )}
      {api.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium">{t("audit.ext.apiTitle", { n: api.length })}</summary>
          <ul className="mt-2 divide-y rounded-lg border">
            {api.map((i) => (
              <ExternalIssueItem key={i.id} i={i} t={t} />
            ))}
          </ul>
        </details>
      )}
      <p className="text-muted-foreground text-xs">{t("audit.ext.credit", { d: fmtDate(ext.scanned_at.slice(0, 10)) })}</p>
    </div>
  )
}

const pctOf = (earned = 0, available = 0) => (available ? (100 * earned) / available : 0)

function tierLine(t: T, tier: AuditTier) {
  return t("audit.tierLine", { earned: tier.earned ?? 0, available: tier.available ?? 0, passing: tier.passing, total: tier.total })
}

function GapItem({ c, t, pick, audit }: { c: AuditCheck; t: T; pick: <V>(o: object, f: string) => V; audit: Audit }) {
  const hint = pick<string>(c, "platform_fix")
  const prompt = pick<string>(c, "prompt")
  return (
    <AccordionItem value={c.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`audit.tier.${c.tier}`)}</Badge>
          <span className="min-w-0">{pick<string>(c, "name")}</span>
          <ResultBadge c={c} t={t} />
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3">
        <div>
          <div className="text-muted-foreground text-xs font-medium">{t("audit.evidence")}</div>
          <p>{c.evidence}</p>
        </div>
        <div>
          <div className="text-muted-foreground text-xs font-medium">{t("audit.how")}</div>
          <p>{pick<string>(c, "fix")}</p>
          {hint && (
            <p className="text-muted-foreground mt-1">
              {audit.platform ? `${audit.platform.charAt(0).toUpperCase()}${audit.platform.slice(1)}: ` : ""}
              {hint}
            </p>
          )}
        </div>
        {prompt && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={prompt} label={t("audit.copy")} t={t} />
              <span className="text-muted-foreground text-xs">{t("audit.source", { s: t(`audit.source.${c.source}`) })}</span>
            </div>
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs">{t("audit.showPrompt")}</summary>
              <pre className="bg-muted/50 mt-2 max-h-72 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">{prompt}</pre>
            </details>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

export function AuditCard({ store }: { store: Store }) {
  const { t, pick, lang } = useI18n()
  const audit = store.audit
  if (!audit) return null
  const byId = new Map(audit.checks.map((c) => [c.id, c]))
  const gaps = audit.gaps.map((id) => byId.get(id)).filter((c): c is AuditCheck => Boolean(c))
  const controlled = (audit.limited_gaps ?? []).map((id) => byId.get(id)).filter((c): c is AuditCheck => Boolean(c))
  const passed = audit.checks.filter((c) => c.scored && c.result === "pass")
  const { essential, recommended, bonus } = audit.breakdown
  const platform = audit.platform ? `${audit.platform.charAt(0).toUpperCase()}${audit.platform.slice(1)}` : ""
  const built = audit.checks.filter((c) => c.result !== "planned" && c.group !== 4).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4" /> {t("audit.title")}
        </CardTitle>
        <CardDescription>{t("audit.sub", { store: store.name, d: fmtDate(audit.scanned_at.slice(0, 10)) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs">{t("audit.score")}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-semibold tabular-nums">{audit.score ?? "—"}</span>
              <span className="text-muted-foreground text-sm">/ 100</span>
            </div>
            <Badge variant={audit.label === "strong" ? "success" : audit.label === "needs_work" ? "warning" : "destructive"}>
              {t(`audit.label.${audit.label}`)}
            </Badge>
          </div>
          <div className="space-y-3">
            <TierRow label={t("audit.tier.essential")} line={tierLine(t, essential)} value={pctOf(essential.earned, essential.available)} />
            <TierRow label={t("audit.tier.recommended")} line={tierLine(t, recommended)} value={pctOf(recommended.earned, recommended.available)} />
            <TierRow
              label={t("audit.tier.bonus")}
              line={t("audit.bonusLine", { points: bonus.points ?? 0, positive: bonus.positive ?? 0 })}
              value={pctOf(bonus.points, 5)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">{t("audit.groups")}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["1", "2", "3"].map((g) => {
              const grp = audit.groups[g]
              return (
                <div key={g} className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs">{audit.group_names[g]?.[lang]}</div>
                  <div className="text-xl font-semibold tabular-nums">{grp?.percent == null ? "—" : `${grp.percent}%`}</div>
                  <div className="text-muted-foreground text-xs">
                    {t("audit.groupLine", { p: grp?.passing ?? 0, n: grp?.scored ?? 0 })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{t("audit.gaps")}</div>
            {gaps.length > 0 && <CopyButton text={pick<string>(audit, "prompt_all")} label={t("audit.copyAll", { n: gaps.length })} t={t} />}
          </div>
          <p className="text-muted-foreground text-xs">{t("audit.gapsSub")} {gaps.length > 0 && t("audit.promptNote")}</p>
          {gaps.length ? (
            <Accordion type="multiple" className="rounded-lg border px-4 text-sm">
              {gaps.map((c) => (
                <GapItem key={c.id} c={c} t={t} pick={pick} audit={audit} />
              ))}
            </Accordion>
          ) : (
            <p className="text-sm">{t("audit.noGaps")}</p>
          )}
        </div>

        <ExternalSection audit={audit} t={t} />

        {controlled.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("audit.platform")}</div>
            <p className="text-muted-foreground text-xs">{t("audit.platformSub", { platform })}</p>
            <ul className="divide-y rounded-lg border text-sm">
              {controlled.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    {pick<string>(c, "name")}
                    <span className="text-muted-foreground block text-xs">{pick<string>(c, "controlled_note")}</span>
                  </span>
                  <ResultBadge c={c} t={t} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {passed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{t("audit.passed", { n: passed.length })}</summary>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
              {passed.map((c) => (
                <li key={c.id}>{pick<string>(c, "name")}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("audit.foot", {
            done: built,
            planned: audit.coverage.planned.length,
            d: fmtDate(audit.scanned_at.slice(0, 10)),
            platform: platform ? t("audit.onPlatform", { platform }) : "",
            engine: audit.engine,
          })}
        </p>
      </CardContent>
    </Card>
  )
}
