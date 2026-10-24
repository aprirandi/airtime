// Isometric projection for the HQ scene. Grid units: x runs right-down, y runs left-down.

export const TILE_W = 64
export const TILE_H = 32
export const GRID = { w: 12, d: 8 }
export const WALL_H = 80
export const ORIGIN = { x: 276, y: 100 }
export const VIEW = { w: 680, h: 440 }

export interface Pt {
  x: number
  y: number
}

export function iso(gx: number, gy: number, z = 0): Pt {
  return {
    x: ORIGIN.x + ((gx - gy) * TILE_W) / 2,
    y: ORIGIN.y + ((gx + gy) * TILE_H) / 2 - z,
  }
}

export const pts = (list: Pt[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")

/** The three visible faces of a box standing on the floor (or at height z0). */
export function boxFaces(gx: number, gy: number, w: number, d: number, h: number, z0 = 0) {
  const b = (x: number, y: number) => iso(x, y, z0)
  const t = (x: number, y: number) => iso(x, y, z0 + h)
  return {
    top: pts([t(gx, gy), t(gx + w, gy), t(gx + w, gy + d), t(gx, gy + d)]),
    right: pts([b(gx + w, gy), b(gx + w, gy + d), t(gx + w, gy + d), t(gx + w, gy)]),
    left: pts([b(gx, gy + d), b(gx + w, gy + d), t(gx + w, gy + d), t(gx, gy + d)]),
  }
}

export function tile(gx: number, gy: number, size = 1): string {
  const h = size / 2
  return pts([iso(gx - h, gy - h), iso(gx + h, gy - h), iso(gx + h, gy + h), iso(gx - h, gy + h)])
}

/** Position in percent of the scene box, for HTML overlays (labels, speech bubble). */
export function pct(p: Pt): { left: string; top: string } {
  return { left: `${(100 * p.x) / VIEW.w}%`, top: `${(100 * p.y) / VIEW.h}%` }
}
