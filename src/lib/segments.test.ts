import { describe, it, expect } from 'vitest'
import { detectCorners, splitSectors, segmentStat, analyzeTrack } from './segments'
import { cumulativeDistance, normalizedDistance } from './geo'
import type { Lap, Sample } from './types'

/** Prosta → zakręt (wysokie |ay|, niższa prędkość) w środku → prosta. */
function lapWithCorner(): Lap {
  const n = 300
  const samples: Sample[] = []
  for (let i = 0; i < n; i++) {
    const f = i / n
    const inCorner = f > 0.4 && f < 0.6
    samples.push({
      t: i * 0.05,
      lat: 52 + i * 0.0002,
      lon: 16 + (inCorner ? 0.0002 * (i - 120) : 0),
      v: inCorner ? 80 : 150,
      ax: 0,
      ay: inCorner ? 0.6 : 0.0,
    })
  }
  const cum = cumulativeDistance(samples)
  return {
    lapNumber: 1, timeMs: n * 50, isBest: true, isValid: true,
    beaconStartS: 0, beaconEndS: n * 0.05, samples,
    cum, nd: normalizedDistance(cum), totalDist: cum[cum.length - 1],
  }
}

describe('detectCorners', () => {
  it('wykrywa jeden zakręt w środku okrążenia', () => {
    const corners = detectCorners(lapWithCorner())
    expect(corners.length).toBe(1)
    const c = corners[0]
    expect(c.label).toBe('T1')
    expect(c.f0).toBeGreaterThan(0.3)
    expect(c.f1).toBeLessThan(0.7)
    expect(c.apexF).toBeGreaterThan(0.35)
    expect(c.apexF).toBeLessThan(0.65)
  })
})

describe('splitSectors', () => {
  it('3 sektory pokrywają cały tor', () => {
    const s = splitSectors(3)
    expect(s.length).toBe(3)
    expect(s[0].f0).toBe(0)
    expect(s[2].f1).toBe(1)
  })
})

describe('segmentStat', () => {
  it('czas segmentu dodatni, min. prędkość w zakręcie', () => {
    const lap = lapWithCorner()
    const { corners } = analyzeTrack(lap)
    const st = segmentStat(lap, corners[0])
    expect(st.timeMs).toBeGreaterThan(0)
    expect(st.minSpeed).toBeLessThan(100) // spadek prędkości w zakręcie
  })
})
