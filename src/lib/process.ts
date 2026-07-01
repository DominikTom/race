import type { Lap, CompactLap, ParsedSession, ProcessedSession } from './types'
import { sampleAt } from './geo'

/**
 * Przesamplowanie okrążenia do N punktów równomiernie po dystansie (nd 0..1).
 * ~1500 pkt / okrążenie -> kompaktowy JSON do Storage (processed).
 */
export function resampleLap(lap: Lap, n = 1500): CompactLap {
  const nd = new Array<number>(n)
  const lat = new Array<number>(n)
  const lon = new Array<number>(n)
  const v = new Array<number>(n)
  const t = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1)
    const s = sampleAt(lap, f)
    nd[i] = f
    lat[i] = round(s.lat, 7)
    lon[i] = round(s.lon, 7)
    v[i] = round(s.v, 2)
    t[i] = round(s.t, 3)
  }
  return {
    lapNumber: lap.lapNumber,
    timeMs: lap.timeMs,
    isBest: lap.isBest,
    isValid: lap.isValid,
    nd,
    lat,
    lon,
    v,
    t,
  }
}

function round(x: number, d: number): number {
  const p = 10 ** d
  return Math.round(x * p) / p
}

/** Buduje kompakt processed JSON dla całej sesji. */
export function buildProcessed(parsed: ParsedSession, pointsPerLap = 1500): ProcessedSession {
  return {
    meta: parsed.meta,
    bestLapIndex: parsed.bestLapIndex,
    laps: parsed.laps.map((l) => resampleLap(l, pointsPerLap)),
  }
}
