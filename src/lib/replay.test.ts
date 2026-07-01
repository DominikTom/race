import { describe, it, expect } from 'vitest'
import { cumulativeDistance, normalizedDistance, delta } from './geo'
import { fractionAtTime } from './analysis'
import type { Lap, Sample } from './types'

/** Okrążenie po tym samym owalu, ale przebyte w zadanym czasie (różne prędkości). */
function lapOfDuration(durSec: number, lapNumber: number): Lap {
  const n = 240
  const samples: Sample[] = []
  const dt = durSec / (n - 1)
  for (let i = 0; i < n; i++) {
    const ang = (i / (n - 1)) * 2 * Math.PI
    samples.push({
      t: i * dt,
      lat: 52 + 0.005 * Math.sin(ang),
      lon: 16 + 0.007 * Math.cos(ang),
      v: 100,
      ax: 0,
      ay: 0,
    })
  }
  const cum = cumulativeDistance(samples)
  return {
    lapNumber, timeMs: Math.round(durSec * 1000), isBest: false, isValid: true,
    beaconStartS: 0, beaconEndS: durSec, samples,
    cum, nd: normalizedDistance(cum), totalDist: cum[cum.length - 1],
  }
}

describe('licznik/delta NIE są odwrócone', () => {
  const fast = lapOfDuration(118.0, 12) // szybsze (zielone)
  const slow = lapOfDuration(120.0, 13) // wolniejsze (czerwone)

  it('delta na 100% (szybkie vs wolne) jest ujemna = szybkie wygrywa', () => {
    // A = szybkie, B = wolne -> delta(A,B) = tB - tA > 0 (B traci)
    expect(delta(fast, slow, 1)).toBeCloseTo(2.0, 1)
    // A = wolne, B = szybkie -> delta ujemna (B zyskuje)
    expect(delta(slow, fast, 1)).toBeCloseTo(-2.0, 1)
  })

  it('w trybie CZASOWYM szybsze okrążenie dociera na metę wcześniej', () => {
    // po 118 s szybkie jest już na mecie (f=1), wolne jeszcze nie
    expect(fractionAtTime(fast, 118.0)).toBeCloseTo(1, 5)
    expect(fractionAtTime(slow, 118.0)).toBeLessThan(1)
    // po połowie czasu każdego, oba w ~połowie dystansu (owal równomierny)
    expect(fractionAtTime(fast, 59.0)).toBeCloseTo(0.5, 1)
    expect(fractionAtTime(slow, 60.0)).toBeCloseTo(0.5, 1)
  })
})
