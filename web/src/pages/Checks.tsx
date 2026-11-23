import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n, type T } from "@/lib/i18n"
import { ResultBadge } from "@/components/Audit"
import type { AuditCheck, RegistryCheck, Site, Store } from "@/lib/types"

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function Stat({ label, value, tone, sub }: { label: string; value: number; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`text-3xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status, t }: { status: RegistryCheck["status"]; t: T }) {
  if (status === "built") return <Badge variant="success">{t("checks.status.built")}</Badge>
  if (status === "planned") return <Badge variant="warning">{t("checks.status.planned")}</Badge>
  return <Badge variant="outline">{t("checks.status.na")}</Badge>
}

function Command({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="bg-muted hover:bg-muted/70 flex w-full items-start gap-2 rounded-md p-2 text-left font-mono text-xs break-all"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } catch {
          /* clipboard can be refused; the command is still readable */
        }
      }}
    >
      <span className="min-w-0 flex-1">{text}</span>
      {done ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
    </button>
  )
}

function Row({ c, result, platform, t, pick, site }: {
  c: RegistryCheck; result?: AuditCheck; platform: string; t: T; pick: <V>(o: object, f: string) => V; site: string
}) {
  const controlled = platform ? c.controlled[platform] : undefined
  const hint = platform ? c.platform_fix[platform] : undefined
  const { lang } = useI18n()
  return (
    <AccordionItem value={c.id}>
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="min-w-0">{pick<string>(c, "name")}</span>
          <Badge variant="outline">{t(`audit.tier.${c.tier}`)}</Badge>
          {result && result.result !== "planned" ? <ResultBadge c={result} t={t} /> : <StatusBadge status={c.status} t={t} />}
          {controlled && <Badge variant="secondary">{t("checks.controlled", { p: cap(platform) })}</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3">
        <div className="text-muted-foreground text-xs">
          <code>{c.id}</code> · {t("audit.source", { s: t(`audit.source.${c.source}`) })}
          {c.external_id && (
            <>
              {" · "}
              {t("checks.externalId", { id: c.external_id })}
            </>
          )}
        </div>
        {c.status === "na" && <p>{pick<string>(c, "na_reason")}</p>}
        {result && result.result !== "planned" && result.evidence && (
          <div>
            <div className="text-muted-foreground text-xs font-medium">{t("audit.evidence")}</div>
            <p>{result.evidence}</p>
          </div>
        )}
        {c.fix && (
          <div>
            <div className="text-muted-foreground text-xs font-medium">{t("audit.how")}</div>
            <p>{pick<string>(c, "fix")}</p>
          </div>
        )}
        {controlled && (
          <div>
            <div className="text-muted-foreground text-xs font-medium">{t("checks.notScored", { p: cap(platform) })}</div>
            <p>{controlled[lang]}</p>
          </div>
        )}
        {hint && (
          <div>
            <div className="text-muted-foreground text-xs font-medium">{t("checks.where", { p: cap(platform) })}</div>
            <p>{hint[lang]}</p>
          </div>
        )}
        {c.verify && (
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium">{t("checks.verify")}</div>
            <Command text={c.verify.command.replace("{site}", site)} />
            <p className="text-muted-foreground text-xs">
              {t("checks.expect")}: {c.verify[lang]}
            </p>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

export function Checks({ site, store }: { site: Site; store: Store }) {
  const { t, lang, pick } = useI18n()
  const reg = site.registry
  const platform = store.audit?.platform ?? ""
  const target = store.audit?.target ?? `https://${store.domain}`
  if (!reg) return <p className="text-muted-foreground text-sm">{t("checks.none")}</p>
  const n = (f: (c: RegistryCheck) => boolean) => reg.checks.filter(f).length
  const rules = [1, 2, 3, 4, 5, 6]
  const audit = store.audit
  const results = new Map((audit?.checks ?? []).map((c) => [c.id, c]))
  const scored = (audit?.checks ?? []).filter((c) => c.group !== 4)
  const count = (r: string) => scored.filter((c) => c.result === r).length
  const heldBack = (r: string) => scored.filter((c) => c.result === r && c.controlled_by).length
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("checks.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("checks.sub")}</p>
      </div>

      {audit && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border p-3 sm:col-span-1">
            <div className="text-muted-foreground text-xs">{t("audit.score")}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-semibold tabular-nums">{audit.score ?? "—"}</span>
              <span className="text-muted-foreground text-sm">/ 100</span>
            </div>
            <Badge variant={audit.label === "strong" ? "success" : audit.label === "needs_work" ? "warning" : "destructive"}>
              {t(`audit.label.${audit.label}`)}
            </Badge>
          </div>
          {["1", "2", "3"].map((g) => {
            const grp = audit.groups[g]
            return (
              <div key={g} className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{audit.group_names[g]?.[lang]}</div>
                <div className="text-2xl font-semibold tabular-nums">{grp?.percent == null ? "—" : `${grp.percent}%`}</div>
                <div className="text-muted-foreground text-xs">
                  {t("audit.groupLine", { p: grp?.passing ?? 0, n: grp?.scored ?? 0 })}
                </div>
              </div>
            )
          })}
          <p className="text-muted-foreground text-xs sm:col-span-4">
            {t("checks.resultsNote", { d: fmtDate(audit.scanned_at.slice(0, 10)), site: audit.target })}
          </p>
        </div>
      )}

      {audit ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={t("checks.pass")} value={count("pass")} tone="text-success" />
            <Stat
              label={t("checks.partial")}
              value={count("partial")}
              tone="text-warning"
              sub={heldBack("partial") ? t("checks.heldSub", { n: heldBack("partial"), p: cap(platform) }) : undefined}
            />
            <Stat
              label={t("checks.failed")}
              value={count("fail")}
              tone="text-destructive"
              sub={heldBack("fail") ? t("checks.heldSub", { n: heldBack("fail"), p: cap(platform) }) : undefined}
            />
            <Stat label={t("checks.notRun")} value={n((c) => c.status === "planned")} sub={t("checks.notRunSub")} />
            <Stat label={t("checks.status.na")} value={n((c) => c.status === "na")} />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("checks.totalNote", { n: reg.checks.length, b: n((c) => c.status === "built") })}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={t("checks.total")} value={reg.checks.length} />
          <Stat label={t("checks.status.built")} value={n((c) => c.status === "built")} tone="text-success" />
          <Stat label={t("checks.status.planned")} value={n((c) => c.status === "planned")} tone="text-warning" />
          <Stat label={t("checks.status.na")} value={n((c) => c.status === "na")} />
          <Stat
            label={platform ? t("checks.controlledStat", { p: cap(platform) }) : t("checks.noPlatform")}
            value={platform ? n((c) => !!c.controlled[platform]) : 0}
          />
        </div>
      )}

      {Object.entries(reg.groups).map(([g, name]) => {
        const rows = reg.checks.filter((c) => String(c.group) === g)
        return (
          <Card key={g}>
            <CardHeader>
              <CardTitle>
                {t("checks.group", { g })}: {name[lang]}
              </CardTitle>
              <CardDescription>{t(`checks.groupSub.${g}`, { n: rows.length })}</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="rounded-lg border px-4 text-sm">
                {rows.map((c) => (
                  <Row key={c.id} c={c} result={results.get(c.id)} platform={platform} t={t} pick={pick} site={target} />
                ))}
              </Accordion>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader>
          <CardTitle>{t("checks.rules")}</CardTitle>
          <CardDescription>{t("checks.rulesSub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {rules.map((i) => (
              <li key={i}>{t(`checks.rule.${i}`)}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
