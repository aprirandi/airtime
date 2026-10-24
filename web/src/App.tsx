import { useEffect, useState } from "react"
import { Bot, Languages, LayoutDashboard, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLive, useSite } from "@/lib/data"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Agents } from "@/pages/Agents"
import { Dashboard } from "@/pages/Dashboard"
import { Day } from "@/pages/Day"

type Route = { page: "dashboard" } | { page: "run"; id: number } | { page: "agents"; view: "team" | "flow" }

function parse(hash: string): Route {
  const run = hash.match(/^#\/run\/(\d+)/)
  if (run) return { page: "run", id: Number(run[1]) }
  if (hash.startsWith("#/agents")) return { page: "agents", view: hash.endsWith("/flow") ? "flow" : "team" }
  return { page: "dashboard" }
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

function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="bg-muted flex items-center rounded-md p-0.5 text-xs font-medium" role="group" aria-label="Language / Bahasa">
      <Languages className="text-muted-foreground mx-1.5 size-3.5" />
      {(["id", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={cn("rounded px-2 py-1 uppercase transition-colors", lang === l ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  )
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

export default function App() {
  const { t } = useI18n()
  const liveState = useLive()
  const live = liveState.data
  const { data: site, error } = useSite(live)
  const { route, go } = useRoute()
  const store = site?.stores[0]
  const working = live?.status === "running"

  return (
    <div className="min-h-screen">
      <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-chart-1 grid size-7 place-items-center rounded-lg text-xs text-white">A</span>
            <span className="hidden sm:inline">Airtime</span>
          </a>
          {store && <span className="text-muted-foreground hidden truncate text-sm md:inline">{store.name}</span>}
          <nav className="flex items-center gap-1">
            <NavLink href="#/" active={route.page !== "agents"}>
              <LayoutDashboard /> <span className="hidden sm:inline">{t("nav.dashboard")}</span>
            </NavLink>
            <NavLink href="#/agents/team" active={route.page === "agents"}>
              <Bot /> <span className="hidden sm:inline">{t("nav.agents")}</span>
              {working && <span className="bg-success size-1.5 animate-pulse rounded-full" />}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <Card>
            <CardContent className="text-destructive text-sm">{t("common.loadError", { e: error })}</CardContent>
          </Card>
        )}
        {!site && !error && <p className="text-muted-foreground text-sm">{t("common.loading")}</p>}
        {site && store && route.page === "run" && <Day runId={route.id} onBack={() => go("#/")} storeData={store} />}
        {site && store && route.page === "dashboard" && (
          <Dashboard site={site} store={store} live={live} liveCheckedAt={liveState.loadedAt} go={go} />
        )}
        {site && store && route.page === "agents" && <Agents site={site} store={store} live={live} view={route.view} go={go} />}
      </main>
    </div>
  )
}
