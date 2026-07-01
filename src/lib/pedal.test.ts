import { describe, it, expect } from 'vitest'
import { orientLongitudinalG } from './parseCsv'
import { pedalScale, pedalAt } from './analysis'
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
    samples.push({ t, lat: 52 + i * 0.0002, lon: 16, v, ax: axSign * (i < n / 2 ? 0.4 : -0.5) })
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

describe('pedalAt', () => {
  it('gaz>0 na starcie, hamulec>0 na końcu', () => {
    const lap = accelBrakeLap(1)
    orientLongitudinalG(lap.samples)
    const scale = pedalScale([lap])
    const start = pedalAt(lap, 0.1, scale)
    const end = pedalAt(lap, 0.9, scale)
    expect(start.throttle).toBeGreaterThan(0)
    expect(start.brake).toBe(0)
    expect(end.brake).toBeGreaterThan(0)
    expect(end.throttle).toBe(0)
  })
})
