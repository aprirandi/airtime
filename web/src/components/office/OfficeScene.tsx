import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { boxFaces, GRID, iso, pct, pts, tile, VIEW, WALL_H } from "./iso"
import { FUTURE_AGENTS, STATIONS, type StationId } from "./stations"
import { WALK_MS, type Beat } from "./useShiftReplay"

type Tone = "wood" | "metal"

function Box({ x, y, w, d, h, z = 0, tone = "wood" }: { x: number; y: number; w: number; d: number; h: number; z?: number; tone?: Tone }) {
  const f = boxFaces(x, y, w, d, h, z)
  const v = tone === "wood" ? "wood" : "metal"
  return (
    <g>
      <polygon points={f.left} fill={`var(--${v}-left)`} />
      <polygon points={f.right} fill={`var(--${v}-right)`} />
      <polygon points={f.top} fill={`var(--${v}-top)`} />
    </g>
  )
}

/** A desk with a monitor; the screen glows while the agent works at it. */
function Desk({ x, y, w = 2, d = 1, on = false, empty = false }: { x: number; y: number; w?: number; d?: number; on?: boolean; empty?: boolean }) {
  const H = 18
  const chair = iso(x + w / 2, y + d + 0.45)
  const screen = boxFaces(x + w / 2 - 0.35, y + 0.15, 0.7, 0.08, 16, H)
  return (
    <g opacity={empty ? 0.75 : 1}>
      <Box x={x + 0.08} y={y + 0.08} w={0.12} d={0.12} h={H} tone="metal" />
      <Box x={x + w - 0.2} y={y + 0.08} w={0.12} d={0.12} h={H} tone="metal" />
      <Box x={x} y={y} w={w} d={d} h={4} z={H - 4} />
      <Box x={x + w / 2 - 0.08} y={y + 0.2} w={0.16} d={0.1} h={4} z={H} tone="metal" />
      <polygon points={screen.left} fill="var(--metal-left)" />
      <polygon points={screen.top} fill="var(--metal-top)" />
      <polygon points={screen.right} fill={on ? "var(--chart-1)" : "var(--screen)"} className={on ? "screen-on" : undefined} />
      <ellipse cx={chair.x} cy={chair.y} rx={9} ry={4.5} fill="var(--metal-right)" opacity={0.9} />
      <rect x={chair.x - 7} y={chair.y - 16} width={14} height={12} rx={3} fill="var(--metal-left)" />
    </g>
  )
}

function Floor({ active }: { active: StationId | null }) {
  const lines = []
  for (let i = 1; i < GRID.w; i++) {
    const a = iso(i, 0), b = iso(i, GRID.d)
    lines.push(<line key={`x${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)
  }
  for (let j = 1; j < GRID.d; j++) {
    const a = iso(0, j), b = iso(GRID.w, j)
    lines.push(<line key={`y${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)
  }
  return (
    <g>
      <polygon points={pts([iso(0, 0), iso(GRID.w, 0), iso(GRID.w, GRID.d), iso(0, GRID.d)])} fill="var(--office-floor)" />
      <g stroke="var(--office-floor-line)" strokeWidth={1}>{lines}</g>
      {Object.values(STATIONS).map((s) => (
        <polygon
          key={s.id}
          points={tile(s.stand[0], s.stand[1], 1)}
          fill="var(--chart-1)"
          opacity={active === s.id ? 0.28 : 0}
          style={{ transition: "opacity 400ms" }}
        />
      ))}
    </g>
  )
}

function Walls() {
  const back = pts([iso(0, 0), iso(GRID.w, 0), iso(GRID.w, 0, WALL_H), iso(0, 0, WALL_H)])
  const side = pts([iso(0, 0), iso(0, GRID.d), iso(0, GRID.d, WALL_H), iso(0, 0, WALL_H)])
  const board = pts([iso(1.4, 0, 22), iso(3.8, 0, 22), iso(3.8, 0, 62), iso(1.4, 0, 62)])
  const win = (x0: number) => pts([iso(x0, 0, 30), iso(x0 + 1.6, 0, 30), iso(x0 + 1.6, 0, 66), iso(x0, 0, 66)])
  const art = pts([iso(0, 5.4, 30), iso(0, 6.8, 30), iso(0, 6.8, 60), iso(0, 5.4, 60)])
  return (
    <g>
      <polygon points={side} fill="var(--office-wall-b)" />
      <polygon points={back} fill="var(--office-wall-a)" />
      <line x1={iso(0, 0).x} y1={iso(0, 0).y} x2={iso(0, 0, WALL_H).x} y2={iso(0, 0, WALL_H).y} stroke="var(--office-trim)" strokeWidth={2} />
      {/* question board */}
      <polygon points={board} fill="#ffffff" stroke="var(--office-trim)" strokeWidth={2} />
      {[0, 1, 2, 3].map((i) => {
        const a = iso(1.65, 0, 54 - i * 8), b = iso(1.65 + 1.2 + (i % 2) * 0.6, 0, 54 - i * 8)
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" />
      })}
      {[6.2, 9.2].map((x0) => (
        <polygon key={x0} points={win(x0)} fill="#bfdbfe" stroke="var(--office-trim)" strokeWidth={2} opacity={0.85} />
      ))}
      <polygon points={art} fill="var(--chart-2)" opacity={0.55} stroke="var(--office-trim)" strokeWidth={2} />
    </g>
  )
}

function Plant({ x, y }: { x: number; y: number }) {
  const p = iso(x, y)
  return (
    <g>
      <Box x={x - 0.18} y={y - 0.18} w={0.36} d={0.36} h={12} tone="metal" />
      <circle cx={p.x} cy={p.y - 22} r={9} fill="#3f9a5c" />
      <circle cx={p.x - 6} cy={p.y - 16} r={6} fill="#4caf6a" />
      <circle cx={p.x + 6} cy={p.y - 17} r={6} fill="#358a50" />
    </g>
  )
}

function Robot({ at, walking, working }: { at: [number, number]; walking: boolean; working: boolean }) {
  const p = iso(at[0], at[1])
  return (
    <g
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: `transform ${WALK_MS}ms ease-in-out` }}
      className={cn(walking && "robot-walking", working && "robot-working")}
    >
      <ellipse cx={0} cy={0} rx={11} ry={4.5} fill="#000" opacity={0.18} />
      <rect className="leg-a" x={-6} y={-8} width={4} height={8} rx={2} fill="var(--robot-line)" />
      <rect className="leg-b" x={2} y={-8} width={4} height={8} rx={2} fill="var(--robot-line)" />
      <g className="robot-body">
        <rect x={-9} y={-22} width={18} height={15} rx={5} fill="var(--chart-1)" />
        <rect x={-4} y={-18} width={8} height={5} rx={1.5} fill="#ffffff" opacity={0.85} />
        <rect x={-10} y={-38} width={20} height={16} rx={6} fill="var(--robot-head)" stroke="var(--robot-line)" strokeWidth={1.5} />
        <circle cx={-4} cy={-30} r={2} fill="var(--robot-line)" />
        <circle cx={4} cy={-30} r={2} fill="var(--robot-line)" />
        <line x1={0} y1={-38} x2={0} y2={-44} stroke="var(--robot-line)" strokeWidth={1.5} />
        <circle className="antenna-light" cx={0} cy={-46} r={2.6} fill={working ? "var(--chart-2)" : "var(--chart-1)"} />
        {working && (
          <g className="work-spark">
            <text x={12} y={-40} fontSize={10} fill="var(--chart-2)">✦</text>
          </g>
        )}
      </g>
    </g>
  )
}

function StationLabel({ id, active }: { id: StationId; active: boolean }) {
  const { t } = useI18n()
  const s = STATIONS[id]
  const p = iso(s.stand[0], s.stand[1])
  return (
    <div
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 translate-y-2 rounded-full border px-2 py-0.5 text-[9px] font-medium whitespace-nowrap shadow-xs transition-colors sm:text-xs",
        active ? "border-chart-1 bg-chart-1 text-white" : "bg-background/90 text-muted-foreground hidden sm:block"
      )}
      style={pct(p)}
    >
      {t(`station.${id}`)}
    </div>
  )
}

export function OfficeScene({ beat, phase, done, agentName }: { beat: Beat | undefined; phase: "walk" | "work"; done: boolean; agentName: string }) {
  const { t } = useI18n()
  const station = beat?.station ?? "lounge"
  const at = STATIONS[station].stand
  const working = phase === "work" && !done
  const walking = phase === "walk"
  const head = iso(at[0], at[1], 52)
  const failed = beat?.step?.status === "failed"

  return (
    <div className="relative w-full select-none" style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${agentName} at the ${STATIONS[station].label}`}>
        <Walls />
        <Floor active={phase === "work" ? station : null} />
        {/* back row */}
        <Desk x={5} y={0.9} on={station === "gemini" && working} />
        <Desk x={8.5} y={0.9} on={station === "reading" && working} />
        <Plant x={0.6} y={0.6} />
        <Plant x={11.4} y={0.6} />
        {/* archive cabinets on the side wall */}
        <Box x={0.15} y={2.9} w={0.8} d={0.9} h={46} tone="metal" />
        <Box x={0.15} y={3.85} w={0.8} d={0.9} h={46} tone="metal" />
        {/* master check podium */}
        <Box x={11.1} y={3.4} w={0.7} d={0.8} h={24} />
        {/* middle row */}
        <Desk x={4.5} y={3.8} on={station === "check" && working} />
        <Desk x={8} y={3.8} on={station === "writing" && working} />
        {/* lounge */}
        <Box x={0.3} y={6.2} w={0.7} d={1.6} h={16} tone="metal" />
        <Box x={1.6} y={6.6} w={0.8} d={0.8} h={9} />
        {/* future agents' desks */}
        {FUTURE_AGENTS.map((a) => (
          <Desk key={a.name} x={a.desk[0]} y={a.desk[1]} w={1.2} d={0.6} empty />
        ))}
        {/* publish: printer */}
        <Box x={11.1} y={6.2} w={0.7} d={0.7} h={18} tone="metal" />
        <Box x={11.2} y={6.3} w={0.5} d={0.4} h={3} z={18} />
        <Robot at={at} walking={walking} working={working} />
      </svg>

      {(Object.keys(STATIONS) as StationId[]).map((id) => (
        <StationLabel key={id} id={id} active={station === id && phase === "work"} />
      ))}
      {FUTURE_AGENTS.map((a) => (
        <div
          key={a.name}
          className="text-muted-foreground bg-background/80 pointer-events-none absolute hidden sm:block -translate-x-1/2 -translate-y-1/2 rounded-md border border-dashed px-1.5 py-0.5 text-[9px] whitespace-nowrap sm:text-[10px]"
          style={pct(iso(a.desk[0] + 0.6, a.desk[1] + 1.05, 8))}
        >
          {t("hq.soon", { name: a.name })}
        </div>
      ))}
      <div
        className="text-muted-foreground bg-background/80 pointer-events-none absolute hidden sm:block -translate-x-1/2 translate-y-1 rounded-md border border-dashed px-1.5 py-0.5 text-[9px] whitespace-nowrap sm:text-[10px]"
        style={pct(iso(11.45, 4.4))}
      >
        {t("hq.soon", { name: "Master check" })}
      </div>

      {beat && phase === "work" && (
        <div
          key={`${station}-${beat.text}`}
          className={cn(
            "animate-in fade-in-0 zoom-in-95 bg-popover text-popover-foreground absolute z-10 w-[min(240px,46%)] -translate-x-1/2 -translate-y-full rounded-lg border p-2.5 text-xs leading-snug shadow-md",
            failed && "border-destructive"
          )}
          style={pct(head)}
        >
          {beat.step && (
            <Badge variant={beat.step.kind === "AI" ? "default" : "secondary"} className="mb-1 h-4 px-1.5 text-[10px]">
              {beat.step.kind === "AI" ? t("common.aiStep") : t("common.codeStep")}
            </Badge>
          )}
          <p>{beat.text}</p>
          <span className="bg-popover absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b" />
        </div>
      )}
    </div>
  )
}
