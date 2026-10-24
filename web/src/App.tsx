import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { AgentHQ } from "@/components/AgentHQ"
import { Competitors, LatestFindings, StatStrip, Trend, WorkDiary } from "@/components/Findings"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useSite } from "@/lib/data"
import { fmtDate } from "@/lib/format"
import { Day } from "@/pages/Day"

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const on = () => {
      setHash(location.hash)
      window.scrollTo({ top: 0 })
    }
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])
  const m = hash.match(/^#\/run\/(\d+)/)
  return { runId: m ? Number(m[1]) : null, go: (h: string) => (location.hash = h) }
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => {
        const next = !dark
        setDark(next)
        document.documentElement.classList.toggle("dark", next)
        try {
          localStorage.setItem("theme", next ? "dark" : "light")
        } catch {
          /* storage can be unavailable; the toggle still works for this visit */
        }
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}

export default function App() {
  const { data: site, error } = useSite()
  const { runId, go } = useHashRoute()
  const store = site?.stores[0]
  const apiSeries = store?.series.filter((s) => s.provider === "gemini" && s.channel === "api") ?? []
  const latest = apiSeries[apiSeries.length - 1] ?? store?.series[store.series.length - 1]

  return (
    <div className="min-h-screen">
      <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-chart-1 grid size-7 place-items-center rounded-lg text-xs text-white">A</span>
            Airtime
          </a>
          {store && (
            <span className="text-muted-foreground truncate text-sm">
              / {store.name} <span className="hidden sm:inline">· {store.domain}</span>
            </span>
          )}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error && (
          <Card>
            <CardContent className="text-destructive text-sm">Could not load the report data: {error}</CardContent>
          </Card>
        )}
        {!site && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
        {site && store && runId !== null && <Day runId={runId} onBack={() => go("#/")} />}
        {site && store && runId === null && (
          <>
            <AgentHQ site={site} store={store} />
            <StatStrip store={store} />
            {latest && <LatestFindings store={store} latest={latest} onOpen={(id) => go(`#/run/${id}`)} />}
            <div className="grid gap-6 lg:grid-cols-2">
              {apiSeries.length > 0 && <Trend store={store} series={apiSeries} />}
              {latest && <Competitors store={store} latest={latest} />}
            </div>
            <WorkDiary store={store} onOpen={(id) => go(`#/run/${id}`)} />
            <Card>
              <CardContent className="text-muted-foreground space-y-2 text-xs leading-relaxed">
                <p>
                  <span className="text-foreground font-medium">How to read this.</span> Each morning the agent asks Gemini the same buyer
                  questions three times, reads every answer, and counts a shop only when a quote naming it appears word for word in the
                  answer. Answers it is unsure about are set aside, never guessed. These are counts of what an AI said, not rankings or
                  sales.
                </p>
                <p>
                  Gemini answers here come from the API without web search, so they can differ from the Gemini app. The {fmtDate("2026-10-14")}{" "}
                  baseline mixes ChatGPT, Gemini and Claude app answers and is a reference point only.
                </p>
                <p>Data updated {new Date(site.generated_at).toLocaleString("en-AU")}.</p>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
