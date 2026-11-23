import { useEffect, useRef, useState } from "react"
import { ArrowRight, ClipboardCopy, ListChecks, Loader2, Search, Gauge } from "lucide-react"

import { AuditView } from "@/components/Audit"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import { hostOf, PLATFORM_OPTIONS, scanSite, ScanFailure, type ScanResult } from "@/lib/scan"

type State =
  | { kind: "idle" }
  | { kind: "loading"; host: string }
  | { kind: "done"; result: ScanResult; host: string }
  | { kind: "error"; code: string; message: string; host: string }

export function Scan({ url, platform, go }: { url: string; platform: string; go: (hash: string) => void }) {
  const { t } = useI18n()
  const [address, setAddress] = useState(url)
  const [chosen, setChosen] = useState(platform)
  const [state, setState] = useState<State>({ kind: "idle" })
  const run = useRef(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setAddress(url)
    setChosen(platform)
    if (!url) {
      setState({ kind: "idle" })
      return
    }
    const id = ++run.current
    const host = hostOf(url)
    const controller = new AbortController()
    setState({ kind: "loading", host })
    scanSite(url, platform, controller.signal)
      .then((result) => id === run.current && setState({ kind: "done", result, host }))
      .catch((err: Error) => {
        if (err.name === "AbortError" || id !== run.current) return
        const f = err instanceof ScanFailure ? err : new ScanFailure("failed", "failed")
        setState({ kind: "error", code: f.code, message: f.message, host })
      })
    return () => controller.abort()
  }, [url, platform, attempt])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = address.trim()
    if (!text) return
    const query = chosen ? `?platform=${encodeURIComponent(chosen)}` : ""
    go(`#/check/${encodeURIComponent(text)}${query}`)
  }

  const busy = state.kind === "loading"
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className={state.kind === "idle" ? "space-y-3 pt-6 text-center sm:pt-12" : "space-y-1"}>
        <h1 className={state.kind === "idle" ? "text-3xl font-semibold tracking-tight sm:text-4xl" : "text-2xl font-semibold tracking-tight"}>
          {t("scan.title")}
        </h1>
        {state.kind === "idle" && <p className="text-muted-foreground mx-auto max-w-xl text-sm sm:text-base">{t("scan.sub")}</p>}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={t("scan.address")}
              placeholder={t("scan.placeholder")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-lg border pr-3 pl-9 text-base outline-none focus-visible:ring-2"
            />
          </div>
          <Button type="submit" size="lg" disabled={busy || !address.trim()} className="h-11 gap-2 sm:w-auto">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {t("scan.go")}
          </Button>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("scan.platform")}</span>
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p || "unknown"} value={p}>
                {t(`scan.platform.${p || "unknown"}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-xs">{t("scan.platformNote")}</p>
      </form>

      {state.kind === "idle" && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [Gauge, "scan.point1"],
              [ListChecks, "scan.point2"],
              [ClipboardCopy, "scan.point3"],
            ].map(([Icon, key]) => {
              const I = Icon as typeof Gauge
              return (
                <Card key={key as string}>
                  <CardContent className="space-y-1 text-sm">
                    <I className="text-chart-1 mb-2 size-5" />
                    <div className="font-medium">{t(key as string)}</div>
                    <p className="text-muted-foreground text-xs leading-relaxed">{t(`${key as string}Sub`)}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <p className="text-muted-foreground text-center text-xs">{t("scan.privacy")}</p>
        </>
      )}

      {state.kind === "loading" && (
        <Card>
          <CardContent className="flex items-start gap-3 text-sm" role="status" aria-live="polite">
            <Loader2 className="text-chart-1 mt-0.5 size-5 shrink-0 animate-spin" />
            <div>
              <div className="font-medium">{t("scan.loading", { host: state.host })}</div>
              <p className="text-muted-foreground text-xs">{t("scan.loadingSub")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {state.kind === "error" && (
        <Card>
          <CardContent className="space-y-2 text-sm" role="alert">
            <div className="text-destructive font-medium">
              {["bad_address", "too_many", "unreachable", "timeout", "network", "failed"].includes(state.code) ? t(`scan.error.${state.code}`) : t("scan.error.failed")}
            </div>
            {["unreachable", "bad_address"].includes(state.code) && state.message !== state.code && (
              <p className="text-muted-foreground text-xs">{state.message}</p>
            )}
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t("scan.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {state.kind === "done" && (
        <div className="space-y-3">
          {state.result.cached && <p className="text-muted-foreground text-xs">{t("scan.cached")}</p>}
          <AuditView audit={state.result} name={state.host} variant="public" />
          <div className="text-center">
            <Button variant="outline" onClick={() => go("#/")}>
              {t("scan.again")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
