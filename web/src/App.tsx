import { useEffect, useState } from "react"
import { Bot, Home, LayoutDashboard, ListChecks, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLive, useSite } from "@/lib/data"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Agents } from "@/pages/Agents"
import { Checks } from "@/pages/Checks"
import { Dashboard } from "@/pages/Dashboard"
import { Day } from "@/pages/Day"
import { Overview } from "@/pages/Overview"
import { Scan } from "@/pages/Scan"

type Route =
  | { page: "scan"; url: string; platform: string }
  | { page: "overview" }
  | { page: "dashboard" }
  | { page: "run"; id: number }
  | { page: "agents"; view: "team" | "flow" }
  | { page: "checks" }

/** The daily-shift pages (Asker and Analyst results, the agent team, the check list for the store) are kept but
 *  not linked: reach them at #/dashboard, #/agents/team, #/checks. Set VITE_SHOW_ANALYSIS=1 to show them in the menu. */
const SHOW_ANALYSIS = import.meta.env.VITE_SHOW_ANALYSIS === "1"

function parse(hash: string): Route {
  const run = hash.match(/^#\/run\/(\d+)/)
  if (run) return { page: "run", id: Number(run[1]) }
  if (hash.startsWith("#/checks")) return { page: "checks" }
  if (hash.startsWith("#/agents")) return { page: "agents", view: hash.endsWith("/flow") ? "flow" : "team" }
  if (hash.startsWith("#/overview")) return { page: "overview" }
  if (hash.startsWith("#/dashboard")) return { page: "dashboard" }
  const check = hash.match(/^#\/check\/([^?]*)(?:\?(.*))?$/)
  if (check) {
    let url = ""
    try {
      url = decodeURIComponent(check[1] ?? "")
    } catch {
      url = ""
    }
    return { page: "scan", url, platform: new URLSearchParams(check[2] ?? "").get("platform") ?? "" }
  }
  return { page: "scan", url: "", platform: "" }
}

function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash))
      window.scrollTo({ top: 0 })
    }
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])
  return { route, go: (h: string) => (location.hash = h) }
}

function ThemeToggle() {
  const { t } = useI18n()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("theme.toggle")}
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

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors [&_svg]:size-4",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </a>
  )
}

function Header({ route, store, working }: { route: Route; store?: string; working?: boolean }) {
  const { t } = useI18n()
  const analysis = route.page !== "scan"
  return (
    <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
        <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-chart-1 grid size-7 place-items-center rounded-lg text-xs text-white">A</span>
          <span className="hidden sm:inline">Airtime</span>
        </a>
        {analysis && store && <span className="text-muted-foreground hidden truncate text-sm md:inline">{store}</span>}
        {(analysis || SHOW_ANALYSIS) && (
          <nav className="flex items-center gap-1">
            <NavLink href="#/overview" active={route.page === "overview"}>
              <Home /> <span className="hidden sm:inline">{t("nav.overview")}</span>
            </NavLink>
            <NavLink href="#/dashboard" active={route.page === "dashboard" || route.page === "run"}>
              <LayoutDashboard /> <span className="hidden sm:inline">{t("nav.dashboard")}</span>
            </NavLink>
            <NavLink href="#/agents/team" active={route.page === "agents"}>
              <Bot /> <span className="hidden sm:inline">{t("nav.agents")}</span>
              {working && <span className="bg-success size-1.5 animate-pulse rounded-full" />}
            </NavLink>
            <NavLink href="#/checks" active={route.page === "checks"}>
              <ListChecks /> <span className="hidden sm:inline">{t("nav.checks")}</span>
            </NavLink>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

/** The pages that read the daily-shift data. Kept apart so the scan page never loads that data. */
function Analysis({ route, go }: { route: Exclude<Route, { page: "scan" }>; go: (h: string) => void }) {
  const { t } = useI18n()
  const liveState = useLive()
  const live = liveState.data
  const { data: site, error } = useSite(live)
  const store = site?.stores[0]
  return (
    <>
      <Header route={route} store={store?.name} working={live?.status === "running"} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <Card>
            <CardContent className="text-destructive text-sm">{t("common.loadError", { e: error })}</CardContent>
          </Card>
        )}
        {!site && !error && <p className="text-muted-foreground text-sm">{t("common.loading")}</p>}
        {site && store && route.page === "run" && <Day runId={route.id} onBack={() => go("#/dashboard")} storeData={store} />}
        {site && store && route.page === "overview" && <Overview site={site} store={store} />}
        {site && store && route.page === "dashboard" && (
          <Dashboard site={site} store={store} live={live} liveCheckedAt={liveState.loadedAt} go={go} />
        )}
        {site && store && route.page === "checks" && <Checks site={site} store={store} />}
        {site && store && route.page === "agents" && <Agents site={site} store={store} live={live} view={route.view} go={go} />}
      </main>
    </>
  )
}

export default function App() {
  const { route, go } = useRoute()
  return (
    <div className="min-h-screen">
      {route.page === "scan" ? (
        <>
          <Header route={route} />
          <main className="mx-auto max-w-6xl px-4 py-6">
            <Scan url={route.url} platform={route.platform} go={go} />
          </main>
        </>
      ) : (
        <Analysis route={route} go={go} />
      )}
    </div>
  )
}
