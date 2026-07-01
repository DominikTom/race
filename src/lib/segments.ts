import type { AnyLap } from './analysis'
import { sampleAt } from './geo'

export type SegmentKind = 'sector' | 'corner' | 'straight'

export interface Segment {
  id: string
  kind: SegmentKind
  label: string
  f0: number // początek w ułamku dystansu (0..1)
  f1: number // koniec
  dir?: 'L' | 'R' // kierunek zakrętu
  apexF?: number // ułamek dystansu w apexie (min prędkość)
}

export interface TrackAnalysis {
  corners: Segment[] // T1..Tn
  segments: Segment[] // ciągła sekwencja prosta/zakręt pokrywająca 0..1 (do kolorowania mapy)
  sectors: Segment[] // S1..Sn (podział na równe dystansowo sektory)
}

export interface SegmentStat {
  timeMs: number
  minSpeed: number
  entrySpeed: number
  exitSpeed: number
}

const SECTOR_PALETTE = ['#d4c02a', '#37a24a', '#e0322b', '#2f6fe0', '#e08f2b', '#8b5cf6']

export function segmentColor(index: number): string {
  return SECTOR_PALETTE[index % SECTOR_PALETTE.length]
}

/**
 * Detekcja zakrętów z bocznego przeciążenia |ay| (histereza + minimalna długość).
 * Próg skalowany do maksimum |ay| na okrążeniu, więc działa dla różnych torów/aut.
 */
export function detectCorners(lap: AnyLap, n = 500): Segment[] {
  const ay = new Array<number>(n)
  const v = new Array<number>(n)
  let maxAy = 0
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1)
    const s = sampleAt(lap, f)
    ay[i] = s.ay
    v[i] = s.v
    if (Math.abs(s.ay) > maxAy) maxAy = Math.abs(s.ay)
  }

  const enter = Math.max(0.18, 0.35 * maxAy)
  const exit = 0.6 * enter
  const minLen = Math.round(0.008 * n) // ~0.8% dystansu

  const corners: Segment[] = []
  let inCorner = false
  let start = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(ay[i])
    if (!inCorner && a > enter) {
      inCorner = true
      start = i
    } else if (inCorner && a < exit) {
      if (i - start >= minLen) corners.push(makeCorner(corners.length, start, i, n, ay, v))
      inCorner = false
    }
  }
  if (inCorner && n - 1 - start >= minLen) corners.push(makeCorner(corners.length, start, n - 1, n, ay, v))

  return corners
}

function makeCorner(
  idx: number,
  i0: number,
  i1: number,
  n: number,
  ay: number[],
  v: number[],
): Segment {
  let apex = i0
  let vmin = Infinity
  let aySum = 0
  for (let i = i0; i <= i1; i++) {
    if (v[i] < vmin) {
      vmin = v[i]
      apex = i
    }
    aySum += ay[i]
  }
  return {
    id: `T${idx + 1}`,
    kind: 'corner',
    label: `T${idx + 1}`,
    f0: i0 / (n - 1),
    f1: i1 / (n - 1),
    dir: aySum >= 0 ? 'R' : 'L',
    apexF: apex / (n - 1),
  }
}

/** Ciągła sekwencja prosta/zakręt pokrywająca całe okrążenie (do kolorowania mapy). */
export function buildContiguous(corners: Segment[]): Segment[] {
  const out: Segment[] = []
  let cursor = 0
  let straightIdx = 0
  for (const c of corners) {
    if (c.f0 > cursor + 1e-4) {
      out.push({ id: `str${straightIdx}`, kind: 'straight', label: 'Prosta', f0: cursor, f1: c.f0 })
      straightIdx++
    }
    out.push(c)
    cursor = c.f1
  }
  if (cursor < 1 - 1e-4) {
    out.push({ id: `str${straightIdx}`, kind: 'straight', label: 'Prosta', f0: cursor, f1: 1 })
  }
  return out
}

/** Podział na równe dystansowo sektory S1..Sn. */
export function splitSectors(n = 3): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `S${i + 1}`,
      kind: 'sector',
      label: `S${i + 1}`,
      f0: i / n,
      f1: (i + 1) / n,
    })
  }
  return out
}

export function analyzeTrack(refLap: AnyLap, nSectors = 3): TrackAnalysis {
  const corners = detectCorners(refLap)
  return {
    corners,
    segments: buildContiguous(corners),
    sectors: splitSectors(nSectors),
  }
}

/** Statystyki okrążenia w zakresie dystansu segmentu (czas liczony po dystansie). */
export function segmentStat(lap: AnyLap, seg: Segment): SegmentStat {
  const s0 = sampleAt(lap, seg.f0)
  const s1 = sampleAt(lap, seg.f1)
  let minSpeed = Infinity
  const steps = 40
  for (let k = 0; k <= steps; k++) {
    const f = seg.f0 + ((seg.f1 - seg.f0) * k) / steps
    const v = sampleAt(lap, f).v
    if (v < minSpeed) minSpeed = v
  }
  return {
    timeMs: Math.round((s1.t - s0.t) * 1000),
    minSpeed,
    entrySpeed: s0.v,
    exitSpeed: s1.v,
  }
}
