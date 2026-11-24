import { useState } from "react"
import { Check, Loader2, MessageCircleQuestion, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { ScanFailure } from "@/lib/scan"
import { askFinish, askStart, askStep, saveProfile } from "@/lib/site"
import type { BusinessProfile, SiteView } from "@/lib/types"

const field = "border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"

function ProfileForm({ host, initial, busy, error, onSave }: {
  host: string; initial: BusinessProfile | null; busy: boolean; error: string; onSave: (p: Record<string, string>) => void
}) {
  const { t } = useI18n()
  const [v, setV] = useState({
    name: initial?.name ?? host.replace(/^www\./, ""),
    aliases: (initial?.aliases ?? []).join(", "),
    city: initial?.city ?? "",
    areas: (initial?.areas ?? []).join(", "),
    categories: (initial?.categories ?? []).join(", "),
  })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(v)
      }}
    >
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs">{t("ask.name")}</span>
        <input className={field} value={v.name} onChange={set("name")} maxLength={80} required />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs">{t("ask.aliases")}</span>
        <input className={field} value={v.aliases} onChange={set("aliases")} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs">{t("ask.city")}</span>
        <input className={field} value={v.city} onChange={set("city")} maxLength={60} required />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs">{t("ask.areas")}</span>
        <input className={field} value={v.areas} onChange={set("areas")} />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-muted-foreground text-xs">{t("ask.categories")}</span>
        <input className={field} value={v.categories} onChange={set("categories")} required />
      </label>
      {error && <p className="text-destructive text-sm sm:col-span-2" role="alert">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {t("ask.save")}
        </Button>
      </div>
    </form>
  )
}

/** Step two of the page: do AI assistants name this business? Shown only when the service has an assistant to ask. */
export function AskerSection({ token, view, onView }: { token: string; view: SiteView; onView: (v: SiteView) => void }) {
  const { t } = useI18n()
  const { profile, latest, history, enabled } = view.asker
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  if (!enabled) return null

  const failure = (err: unknown) => {
    const code = err instanceof ScanFailure ? err.code : "failed"
    const known = ["asked_recently", "busy_today", "asking_now", "asker_unavailable", "timeout", "bad_profile"].includes(code)
    setError(code === "bad_profile" && err instanceof ScanFailure ? err.message : t(known ? `ask.error.${code}` : "ask.error.failed"))
  }
  const run = async (job: () => Promise<SiteView>, after?: () => void) => {
    setBusy(true)
    setError("")
    try {
      onView(await job())
      after?.()
    } catch (err) {
      failure(err)
    } finally {
      setBusy(false)
    }
  }
  // The questions are asked one at a time, a few at once, each in its own request, then the answers are put together.
  const ask = async () => {
    setBusy(true)
    setError("")
    try {
      const { run, total } = await askStart(token)
      setProgress({ done: 0, total })
      let next = 0
      let answered = 0
      let quota = false
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < total && !quota) {
            const i = next++
            try {
              const r = await askStep(token, run, i)
              quota = r.quota
            } catch {
              /* an unanswered question counts as not answered; the others go on */
            }
            setProgress({ done: ++answered, total })
          }
        })
      )
      onView(await askFinish(token, run))
    } catch (err) {
      failure(err)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  const first = history[0]

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageCircleQuestion className="size-5" /> {t("ask.title")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("ask.sub")}</p>
      </div>
      <Card>
        <CardContent className="space-y-4 text-sm">
          {!profile || editing ? (
            <>
              {!profile && <div className="font-medium">{t("ask.profileTitle")}</div>}
              <ProfileForm host={view.site.host} initial={profile} busy={busy} error={error} onSave={(p) => run(() => saveProfile(token, p), () => setEditing(false))} />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>
                  {t("ask.about", { name: profile.name, city: profile.city, what: profile.categories.join(", ") })}{" "}
                  <button type="button" className="text-chart-1 underline" onClick={() => setEditing(true)}>
                    {t("ask.edit")}
                  </button>
                </p>
                <Button onClick={ask} disabled={busy} className="gap-2">
                  {busy && <Loader2 className="animate-spin" />} {busy ? t("ask.going", { done: progress?.done ?? 0, total: progress?.total ?? 6 }) : t("ask.go")}
                </Button>
              </div>
              {error && <p className="text-destructive" role="alert">{error}</p>}
              {latest && (
                <div className="space-y-4">
                  <div>
                    <div className="text-2xl font-semibold">{t("ask.named", { named: latest.named, answered: latest.answered })}</div>
                    <p className="text-muted-foreground text-xs">{t("ask.lastRun", { d: fmtDate(latest.ran_at.slice(0, 10)) })}</p>
                    {history.length > 1 && first && (
                      <p className="mt-1">{t("ask.compare", { a1: first.named, b1: first.answered, a2: latest.named, b2: latest.answered })}</p>
                    )}
                  </div>
                  {latest.named === 0 && <p>{t("ask.none")}</p>}
                  <p className="text-muted-foreground text-xs">{t("ask.vary")}</p>
                  <div className="space-y-1">
                    <div className="font-medium">{t("ask.rivals")}</div>
                    {latest.rivals.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {latest.rivals.map((r) => (
                          <Badge key={r.name} variant="outline">
                            {r.name} · {r.count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      !latest.readOthers && <p className="text-muted-foreground">{t("ask.noRivals")}</p>
                    )}
                  </div>
                  <details className="rounded-lg border">
                    <summary className="cursor-pointer px-3 py-2 font-medium">{t("ask.answers")}</summary>
                    <ul className="divide-y border-t">
                      {latest.items.map((i) => (
                        <li key={i.question} className="space-y-1 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{i.question}</span>
                            {i.failed ? (
                              <Badge variant="outline">{t("ask.failed")}</Badge>
                            ) : i.named ? (
                              <Badge variant="success"><Check className="size-3" /> {t("ask.yes")}</Badge>
                            ) : (
                              <Badge variant="outline"><X className="size-3" /> {t("ask.no")}</Badge>
                            )}
                          </div>
                          {!i.failed && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{i.answer}</p>}
                          {i.others.length > 0 && <p className="text-xs">{t("ask.othersIn", { names: i.others.map((o) => o.name).join(", ") })}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
