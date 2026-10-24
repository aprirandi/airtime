import { useEffect, useRef, useState } from "react"

import { DATA_ROOT } from "./i18n"
import type { Live, RunDetail, Site } from "./types"

type State<T> = { data: T | null; error: string | null; loadedAt: Date | null }

/** Fetch JSON, and fetch it again every `pollMs` (0 = once). Keeps showing old data while refreshing. */
function useJson<T>(url: string | null, pollMs = 0, refreshKey: unknown = null): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loadedAt: null })
  useEffect(() => {
    if (!url) return
    let alive = true
    const load = () =>
      fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
          return r.json() as Promise<T>
        })
        .then((data) => alive && setState({ data, error: null, loadedAt: new Date() }))
        .catch((e: Error) => alive && setState((s) => ({ ...s, error: s.data ? null : e.message })))
    load()
    const t = pollMs ? setInterval(load, pollMs) : undefined
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [url, pollMs, refreshKey])
  return state
}

/** Live status of the agent; checked every 30 seconds. */
export const useLive = () => useJson<Live>(`${DATA_ROOT}/live.json`, 30_000)

/** All report data; re-read every 2 minutes and whenever a live shift ends. */
export function useSite(live: Live | null) {
  const ended = useRef(0)
  const last = useRef<string | null>(null)
  if (live && last.current === "running" && live.status !== "running") ended.current += 1
  if (live) last.current = live.status
  return useJson<Site>(`${DATA_ROOT}/site.json`, 120_000, ended.current)
}

export const useRun = (id: number | null) => useJson<RunDetail>(id ? `${DATA_ROOT}/runs/${id}.json` : null)
