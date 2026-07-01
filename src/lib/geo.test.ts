import { describe, it, expect } from 'vitest'
import { haversine, cumulativeDistance, normalizedDistance, sampleAt, delta, searchIndex } from './geo'
import type { Lap, Sample } from './types'

function line(n: number, t0 = 0, dt = 0.05): Lap {
  const samples: Sample[] = []
  for (let i = 0; i < n; i++) {
    samples.push({ t: t0 + i * dt, lat: 52 + i * 0.0001, lon: 16, v: 100, ax: 0 })
  }
  const cum = cumulativeDistance(samples)
  const nd = normalizedDistance(cum)
  return {
    lapNumber: 1, timeMs: (n - 1) * dt * 1000, isBest: false, isValid: true,
    beaconStartS: t0, beaconEndS: t0 + (n - 1) * dt,
    samples, cum, nd, totalDist: cum[cum.length - 1],
  }
}

describe('haversine', () => {
  it('~111 km na stopień szerokości', () => {
    const d = haversine(52, 16, 53, 16)
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_600)
  })
})

describe('normalizedDistance', () => {
  it('zaczyna od 0, kończy na 1', () => {
    const lap = line(10)
    expect(lap.nd[0]).toBe(0)
    expect(lap.nd[lap.nd.length - 1]).toBeCloseTo(1, 9)
  })
})

describe('searchIndex', () => {
  it('binary search zwraca segment', () => {
    const nd = [0, 0.25, 0.5, 0.75, 1]
    expect(searchIndex(nd, 0)).toBe(0)
    expect(searchIndex(nd, 0.3)).toBe(1)
    expect(searchIndex(nd, 1)).toBe(3)
  })
})

describe('delta', () => {
  it('delta na 100% = różnica czasów okrążeń', () => {
    const a = line(100, 0, 0.05) // ~4.95s
    const b = line(100, 0, 0.06) // ~5.94s
    const d = delta(a, b, 1)
    expect(d).toBeCloseTo((99 * 0.06) - (99 * 0.05), 6)
    expect(d).toBeGreaterThan(0) // B wolniejsze -> tracisz
  })

  it('sampleAt na 50% ~ w połowie dystansu', () => {
    const a = line(101)
    const s = sampleAt(a, 0.5)
    expect(s.lat).toBeCloseTo(52 + 50 * 0.0001, 6)
  })
})
