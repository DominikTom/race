import { describe, it, expect } from 'vitest'
import { buildSessionTimeline, sampleTimelineAt } from './analysis'
import { cumulativeDistance, normalizedDistance } from './geo'
import type { Lap, Sample } from './types'

/** Dwa okrążenia po sobie (absolutny czas), prosta linia — łatwa weryfikacja interpolacji. */
function makeLaps(): Lap[] {
  const laps: Lap[] = []
  let tAbs = 0
  for (let lapNo = 1; lapNo <= 2; lapNo++) {
    const samples: Sample[] = []
    for (let i = 0; i < 50; i++) {
      samples.push({ t: tAbs, lat: 52 + tAbs * 0.001, lon: 16 + tAbs * 0.002, v: 100 + i, ax: 0, ay: 0 })
      tAbs += 0.05
    }
    const cum = cumulativeDistance(samples)
    laps.push({
      lapNumber: lapNo, timeMs: 2500, isBest: lapNo === 1, isValid: true,
      beaconStartS: samples[0].t, beaconEndS: samples[samples.length - 1].t,
      samples, cum, nd: normalizedDistance(cum), totalDist: cum[cum.length - 1],
    })
    tAbs += 0.05 // mała przerwa między okrążeniami
  }
  return laps
}

describe('buildSessionTimeline / sampleTimelineAt', () => {
  const laps = makeLaps()
  const tl = buildSessionTimeline(laps)

  it('scala próbki obu okrążeń i sortuje po czasie', () => {
    expect(tl.t.length).toBe(100)
    expect(tl.tMin).toBeCloseTo(0, 6)
    for (let i = 1; i < tl.t.length; i++) expect(tl.t[i]).toBeGreaterThanOrEqual(tl.t[i - 1])
  })

  it('interpoluje pozycję w absolutnym czasie sesji', () => {
    const at0 = sampleTimelineAt(tl, 0)!
    expect(at0.lat).toBeCloseTo(52, 6)
    expect(at0.lapNumber).toBe(1)
    // punkt w 2. okrążeniu
    const mid2 = sampleTimelineAt(tl, tl.tMax - 0.1)!
    expect(mid2.lapNumber).toBe(2)
    expect(mid2.inRange).toBe(true)
  })

  it('clampuje poza zakresem i oznacza inRange=false', () => {
    const before = sampleTimelineAt(tl, -5)!
    expect(before.inRange).toBe(false)
    expect(before.lat).toBeCloseTo(tl.lat[0], 6)
    const after = sampleTimelineAt(tl, tl.tMax + 100)!
    expect(after.inRange).toBe(false)
    expect(after.lat).toBeCloseTo(tl.lat[tl.lat.length - 1], 6)
  })
})
