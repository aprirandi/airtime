import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Fix, FixStatus, Site, Store } from "@/lib/types"

/** What the owner sees: the agents at work, in plain words. No check ids, evidence, prompts or code (those stay
 *  on the Dashboard and Checks pages). */

const STATUS_VARIANT: Record<FixStatus, "success" | "warning" | "outline" | "secondary"> = {
  not_started: "outline",
  needs_owner: "warning",
  draft_ready: "success",
  platform_held: "secondary",
  in_progress: "secondary",
  done: "success",
}

function FixCard({ fix }: { fix: Fix }) {
  const { t, pick, lang } = useI18n()
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{pick<string>(fix, "title")}</CardTitle>
          <Badge variant={STATUS_VARIANT[fix.status]}>{t(`ov.status.${fix.status}`)}</Badge>
        </div>
        <CardDescription>{pick<string>(fix, "why")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{pick<string>(fix, "summary")}</p>
        {fix.questions.length > 0 && (
          <div className="bg-muted/50 space-y-1.5 rounded-lg p-3">
            <div className="text-xs font-medium">{t("ov.questions")}</div>
            <ul className="list-disc space-y-1 pl-5">
              {fix.questions.map((q) => (
                <li key={q.en}>{lang === "id" ? q.id : q.en}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Overview({ site, store }: { site: Site; store: Store }) {
  const { t } = useI18n()
  const audit = store.audit
  const fixes = audit?.fixes ?? []
  const waiting = fixes.filter((f) => f.status === "needs_owner").length
  const lastShift = store.runs.find((r) => r.kind === "shift")
  const team = site.team.filter((m) => m.status === "active" && m.id !== "master")
  const recent = store.runs.filter((r) => r.kind === "shift" || r.kind === "audit").slice(0, 6)

  const line = (id: string): string | null => {
    if (id === "auditor") return audit ? t("ov.checked", { d: fmtDate(audit.scanned_at.slice(0, 10)) }) : null
    if (id === "fixer") {
      if (!fixes.length) return null
      const n = t("ov.team.fixerLine", { n: fixes.length })
      return waiting ? `${n} · ${t("ov.team.waiting", { n: waiting })}` : n
    }
    return lastShift ? t("ov.team.lastShift", { d: fmtDate(lastShift.run_date) }) : null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("ov.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("ov.sub", { store: store.name })}</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="text-5xl font-semibold tabular-nums">
            {audit?.score ?? "–"}
            <span className="text-muted-foreground text-xl">/100</span>
          </div>
          <div className="min-w-48 flex-1">
            <div className="font-medium">{t("ov.score")}</div>
            <p className="text-muted-foreground text-sm">
              {audit ? t("ov.scoreSub", { store: store.name }) : t("ov.noAudit")}
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("ov.team")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {team.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-1 text-sm">
                <div className="font-medium">{m.name}</div>
                <p className="text-muted-foreground">{t(`ov.team.${m.id}`)}</p>
                {line(m.id) && <p className="text-xs font-medium">{line(m.id)}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t("ov.fixes")}</h2>
          <p className="text-muted-foreground text-sm">{t("ov.fixesSub")}</p>
        </div>
        {fixes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("ov.noFixes")}</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {fixes.map((f) => (
              <FixCard key={f.check_id} fix={f} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("ov.activity")}</h2>
          <Card>
            <CardContent>
              <ul className="divide-y text-sm">
                {recent.map((r) => (
                  <li key={r.id} className="flex gap-4 py-2">
                    <span className="text-muted-foreground w-28 shrink-0 tabular-nums">{fmtDate(r.run_date)}</span>
                    <span>{t(r.kind === "audit" ? "ov.act.audit" : "ov.act.shift")}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
