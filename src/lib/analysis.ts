import type { Lap, CompactLap, Sample } from './types'
import { sampleAt } from './geo'

export type AnyLap = Lap | CompactLap

export interface Offset {
  dLat: number
  dLon: number
}

export const NO_OFFSET: Offset = { dLat: 0, dLon: 0 }

/** Kolory linii wg okrążenia (best zawsze zielony). */
export const BEST_COLOR = '#37d67a'
export const LAP_PALETTE = ['#4aa3ff', '#ffb347', '#e15fed', '#f4d35e', '#ff6b6b']

export function lapColor(lap: AnyLap, orderIndex: number): string {
  if (lap.isBest) return BEST_COLOR
  return LAP_PALETTE[orderIndex % LAP_PALETTE.length]
}

/** Zwraca [lon, lat] próbek okrążenia z offsetem satelity dodanym do GPS. */
export function lapCoords(lap: AnyLap, offset: Offset = NO_OFFSET): [number, number][] {
  if ('samples' in lap) {
    return lap.samples.map((s) => [s.lon + offset.dLon, s.lat + offset.dLat])
  }
  const out: [number, number][] = []
  for (let i = 0; i < lap.lon.length; i++) {
    out.push([lap.lon[i] + offset.dLon, lap.lat[i] + offset.dLat])
  }
  return out
}

/** Prędkości okrążenia (do heatmapy / zakresu). */
export function lapSpeeds(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.v) : lap.v
}

/** nd okrążenia. */
export function lapNd(lap: AnyLap): number[] {
  return lap.nd
}

export function speedRange(laps: AnyLap[]): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const lap of laps) {
    for (const v of lapSpeeds(lap)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min)) return [0, 1]
  return [min, max]
}

/** Pozycja kursora {lon,lat,v,t} na okrążeniu w ułamku dystansu f, z offsetem. */
export function cursorAt(lap: AnyLap, f: number, offset: Offset = NO_OFFSET): Sample {
  const s = sampleAt(lap, f)
  return { ...s, lat: s.lat + offset.dLat, lon: s.lon + offset.dLon }
}
