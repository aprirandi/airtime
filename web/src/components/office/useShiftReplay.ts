import { useCallback, useEffect, useMemo, useState } from "react"

import type { T } from "@/lib/i18n"
import type { Step } from "@/lib/types"

import { stationFor, type StationId } from "./stations"

export const WALK_MS = 1400
export const WORK_MS = 3800

export interface Beat {
  station: StationId
  step: Step | null // null for the closing beats (publish, rest)
  text: string
}

export function beatsFor(steps: Step[], storeName: string, failed: boolean, t: T, lang: "en" | "id"): Beat[] {
  const beats: Beat[] = steps.map((s) => ({
    station: stationFor(s),
    step: s,
    text: (lang === "id" && s.description_id) || s.description,
  }))
  if (!failed) beats.push({ station: "publish", step: null, text: t("hq.published", { store: storeName }) })
  beats.push({ station: "lounge", step: null, text: failed ? t("hq.stoppedEarly") : t("hq.rest") })
  return beats
}

/** Plays a shift back beat by beat: walk to the station, then work there. */
export function useShiftReplay(beats: Beat[]) {
  const reduced = useMemo(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  )
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<"walk" | "work">("walk")
  const [playing, setPlaying] = useState(true)
  const last = beats.length - 1
  const done = index >= last && phase === "work"

  useEffect(() => {
    if (!playing || done || beats.length === 0) return
    const ms = phase === "walk" ? (reduced ? 0 : WALK_MS) : WORK_MS
    const t = setTimeout(() => {
      if (phase === "walk") setPhase("work")
      else {
        setIndex((i) => Math.min(i + 1, last))
        setPhase("walk")
      }
    }, ms)
    return () => clearTimeout(t)
  }, [playing, phase, index, done, last, reduced, beats.length])

  const replay = useCallback(() => {
    setIndex(0)
    setPhase("walk")
    setPlaying(true)
  }, [])

  const jump = useCallback((i: number) => {
    setIndex(i)
    setPhase("walk")
  }, [])

  return { index, phase, playing, done, reduced, setPlaying, replay, jump, beat: beats[index] }
}
