import { describe, it, expect } from 'vitest'
import { orientLongitudinalG } from './parseCsv'
import { buildLongModel, pedalAt } from './analysis'
import { cumulativeDistance, normalizedDistance } from './geo'
import type { Lap, Sample } from './types'

/** Okrążenie: przyspiesza w pierwszej połowie, hamuje w drugiej (po dystansie). */
function accelBrakeLap(axSign: number): Lap {
  const n = 200
  const samples: Sample[] = []
  let v = 50
  for (let i = 0; i < n; i++) {
    const t = i * 0.05
    // v rośnie do połowy, potem maleje
    v += i < n / 2 ? 1.2 : -1.2
    samples.push({ t, lat: 52 + i * 0.0002, lon: 16, v, ax: axSign * (i < n / 2 ? 0.4 : -0.5), ay: 0 })
  }
  const cum = cumulativeDistance(samples)
  return {
    lapNumber: 1, timeMs: n * 50, isBest: true, isValid: true,
    beaconStartS: 0, beaconEndS: n * 0.05, samples,
    cum, nd: normalizedDistance(cum), totalDist: cum[cum.length - 1],
  }
}

describe('orientLongitudinalG', () => {
  it('poprawny znak: gaz na starcie, hamulec na końcu', () => {
    const lap = accelBrakeLap(1)
    orientLongitudinalG(lap.samples)
    expect(lap.samples[10].ax).toBeGreaterThan(0) // przyspiesza
    expect(lap.samples[190].ax).toBeLessThan(0) // hamuje
  })

  it('odwrócony akcelerometr zostaje skorygowany do dv/dt', () => {
    const lap = accelBrakeLap(-1) // ax ma odwrotny znak niż fizyka
    orientLongitudinalG(lap.samples)
    expect(lap.samples[10].ax).toBeGreaterThan(0) // po korekcie znów +
    expect(lap.samples[190].ax).toBeLessThan(0)
  })
})

describe('pedalAt (model mocy)', () => {
  it('gaz>0 na starcie, hamulec>0 na końcu', () => {
    const lap = accelBrakeLap(1)
    orientLongitudinalG(lap.samples)
    const model = buildLongModel([lap])
    const start = pedalAt(lap, 0.1, model)
    const end = pedalAt(lap, 0.9, model)
    expect(start.throttle).toBeGreaterThan(0)
    expect(start.brake).toBe(0)
    expect(end.brake).toBeGreaterThan(0)
    expect(end.throttle).toBe(0)
  })

  it('pełny gaz na prostej mimo małego przyspieszenia przy dużej prędkości', () => {
    // Auto trzyma ~stałą, wysoką prędkość: a≈0, ale to pełny gaz (opór = moc).
    const n = 300
    const samples: Sample[] = []
    for (let i = 0; i < n; i++) {
      const t = i * 0.05
      let v: number, ax: number
      if (i < 100) {
        v = 60 + i * 1.1 // rozpędzanie
        ax = 0.35
      } else {
        v = 170 // top speed, stała
        ax = 0.0
      }
      samples.push({ t, lat: 52 + i * 0.0003, lon: 16, v, ax, ay: 0 })
    }
    const cum = cumulativeDistance(samples)
    const lap: Lap = {
      lapNumber: 1, timeMs: n * 50, isBest: true, isValid: true,
      beaconStartS: 0, beaconEndS: n * 0.05, samples,
      cum, nd: normalizedDistance(cum), totalDist: cum[cum.length - 1],
    }
    const model = buildLongModel([lap])
    const topSpeed = pedalAt(lap, 0.95, model) // fragment ze stałą 170 km/h
    expect(topSpeed.throttle).toBeGreaterThan(0.7) // ~pełny gaz mimo a≈0
    expect(topSpeed.brake).toBe(0)
  })
})
