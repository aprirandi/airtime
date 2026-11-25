import { useState } from "react"
import { Check, Loader2, MessageCircleQuestion, RefreshCw, X } from "lucide-react"

import { mostImportant } from "@/components/FixList"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fmtDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { ScanFailure } from "@/lib/scan"
import { saveProfile } from "@/lib/site"
import type { SiteView } from "@/lib/types"

/** Where the asking stands on the page: it starts by itself, so the page keeps the state and both tabs read it. */
export type AskState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "error"; code: string; message: string }
  | { kind: "need"; hint: { name: string; city: string; country: string; areas: string[]; categories: string[] } }

const field = "border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"

/** Only shown when the pages did not tell us where the business is or what it sells, or when the client wants to change it. */
function ProfileForm({ initial, busy, error, onSave }: {
  initial: { name: string; aliases?: string[]; city: string; areas: string[]; categories?: string[] }
  busy: boolean
  error: string
  onSave: (p: Record<string, string>) => void
}) {
  const { t } = useI18n()
  const [v, setV] = useState({
    name: initial.name,
    aliases: (initial.aliases ?? []).join(", "),
    city: initial.city,
    areas: initial.areas.join(", "),
    categories: (initial.categories ?? []).join(", "),
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

/** The Ask AI tab: whether AI assistants name the business, and how that sits next to the audit. */
export function AskerSection({ token, view, ask, onAsk, onView, goAudit }: {
  token: string
  view: SiteView
  ask: AskState
  onAsk: () => void
  onView: (v: SiteView) => void
  goAudit: () => void
}) {
  const { t, pick } = useI18n()
  const { profile, latest, history } = view.asker
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState("")

  const running = ask.kind === "running"
  const needForm = ask.kind === "need" || editing
  const formInitial = ask.kind === "need" ? ask.hint : profile ?? { name: view.site.host, city: "", areas: [] as string[] }

  const save = async (p: Record<string, string>) => {
    setBusy(true)
    setFormError("")
    try {
      onView(await saveProfile(token, p))
      setEditing(false)
      onAsk()
    } catch (err) {
      setFormError(err instanceof ScanFailure ? err.message : t("ask.error.failed"))
    } finally {
      setBusy(false)
    }
  }

  const errorText =
    ask.kind === "error"
      ? ["asked_recently", "busy_today", "asking_now", "asker_unavailable", "timeout"].includes(ask.code)
        ? t(`ask.error.${ask.code}`)
        : t("ask.error.failed")
      : ""

  const open = mostImportant(view.latest.fixes ?? [], view.latest.checks, (f) => view.done.includes(f.check_id)).filter((r) => r.meta.priority === "high")
  const first = history[0]
  const lastRun = history.at(-1)

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
          {needForm ? (
            <>
              {ask.kind === "need" && <p className="font-medium">{t("ask.needTitle")}</p>}
              <ProfileForm key={ask.kind + (editing ? "e" : "")} initial={formInitial} busy={busy} error={formError} onSave={save} />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>
                  {profile && t("ask.about", { name: profile.name, city: profile.city, what: profile.categories.join(", ") })}{" "}
                  {profile && (
                    <button type="button" className="text-chart-1 underline" onClick={() => setEditing(true)}>
                      {t("ask.edit")}
                    </button>
                  )}
                </p>
                <Button onClick={onAsk} disabled={running} variant={latest ? "outline" : "default"} className="gap-2">
                  {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {running ? t("ask.going", { done: ask.done, total: ask.total }) : latest ? t("ask.again") : t("ask.go")}
                </Button>
              </div>
              {errorText && <p className="text-destructive" role="alert">{errorText}</p>}
              {running && !latest && <p className="text-muted-foreground">{t("ask.auto")}</p>}

              {latest && (
                <div className="space-y-4">
                  <div>
                    <div className="text-2xl font-semibold">{t("ask.named", { named: latest.named, answered: latest.answered })}</div>
                    <p className="text-muted-foreground text-xs">{t("ask.lastRun", { d: fmtDate(latest.ran_at.slice(0, 10)) })}</p>
                  </div>
                  {latest.named === 0 && <p>{t("ask.none")}</p>}

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

                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="font-medium">{t("ask.link.title")}</div>
                    <ul className="space-y-1">
                      {history.map((h, i) => (
                        <li key={h.ran_at} className={i === history.length - 1 ? "font-medium" : "text-muted-foreground"}>
                          {t("ask.link.row", { d: fmtDate(h.ran_at.slice(0, 10)), s: h.audit_score ?? "–", n: h.named, a: h.answered })}
                        </li>
                      ))}
                    </ul>
                    {history.length > 1 && first && lastRun && first.audit_score !== null && lastRun.audit_score !== null && (
                      <p>{t("ask.link.sum", { s1: first.audit_score, n1: first.named, s2: lastRun.audit_score, n2: lastRun.named })}</p>
                    )}
                    <p className="text-muted-foreground text-xs">{t("ask.link.caveat")}</p>
                  </div>

                  <div className="space-y-1 rounded-lg border p-3">
                    <div className="font-medium">{t("ask.hint.title")}</div>
                    {open.length > 0 ? (
                      <p>
                        {t("ask.hint.todo", { n: open.length, names: open.slice(0, 3).map((r) => pick<string>(r.fix, "title")).join(", ") })}{" "}
                        <button type="button" className="text-chart-1 underline" onClick={goAudit}>
                          {t("ask.hint.open")}
                        </button>
                      </p>
                    ) : (
                      <p>{t("ask.hint.clear")}</p>
                    )}
                    <p className="text-muted-foreground text-xs">{t("ask.vary")}</p>
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
