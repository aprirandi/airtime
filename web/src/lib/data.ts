import { useEffect, useState } from "react"

import type { RunDetail, Site } from "./types"

type State<T> = { data: T | null; error: string | null }

function useJson<T>(url: string | null): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null })
  useEffect(() => {
    if (!url) return
    let alive = true
    setState({ data: null, error: null })
    fetch(url, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<T>
      })
      .then((data) => alive && setState({ data, error: null }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [url])
  return state
}

export const useSite = () => useJson<Site>("./data/site.json")
export const useRun = (id: number | null) => useJson<RunDetail>(id ? `./data/runs/${id}.json` : null)
