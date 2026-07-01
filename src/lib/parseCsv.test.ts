import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  parseTimeToSeconds,
  buildLaps,
  pickBestLap,
  ParseError,
  EXPORT_ENGLISH_MSG,
} from './parseCsv'
import { delta } from './geo'
import { makeFixtureCsv } from './testFixture'
import type { Sample, SessionMeta } from './types'

describe('parseTimeToSeconds', () => {
  it('parsuje mm:ss.mmm i sekundy', () => {
    expect(parseTimeToSeconds('1:58.214')).toBeCloseTo(118.214, 3)
    expect(parseTimeToSeconds('118.214')).toBeCloseTo(118.214, 3)
    expect(parseTimeToSeconds('')).toBeNaN()
  })
})

describe('parseCsv — format AiM', () => {
  const csv = makeFixtureCsv({ hz: 20, lapTimes: [120.5, 118.214, 119.739] })
  const parsed = parseCsv(csv)

  it('wykrywa 20 Hz', () => {
    expect(parsed.meta.sampleRateHz).toBe(20)
  })

  it('dzieli na okrążenia z beacon markers', () => {
    expect(parsed.laps.length).toBe(3)
  })

  it('best lap = najniższy czas', () => {
    expect(parsed.bestLapIndex).toBe(1) // 118.214 najniższy
    expect(parsed.laps[1].timeMs).toBe(118214)
    expect(parsed.laps[1].isBest).toBe(true)
  })

  it('martwe kanały ukryte', () => {
    for (const dead of ['SPEED', 'GPS LateralAcc', 'GPS InlineAcc', 'GPS Yaw Rate']) {
      expect(parsed.deadChannels).toContain(dead)
      expect(parsed.activeChannels).not.toContain(dead)
    }
  })

  it('GPS Speed aktywny (używamy GPS LatAcc, nie GPS LateralAcc)', () => {
    expect(parsed.activeChannels).toContain('GPS Speed')
    expect(parsed.activeChannels).toContain('GPS LatAcc')
  })

  it('delta na 100% = różnica czasów okrążeń (best vs następne)', () => {
    const best = parsed.laps[1]
    const next = parsed.laps[2]
    const d = delta(best, next, 1)
    expect(d).toBeCloseTo(119.739 - 118.214, 2) // ~+1.525
  })
})

// Realne metadane z eksportu Poznan (sample/4.csv) — 15 beaconów, 15 segment times.
const REAL_BEACONS = [
  4.405, 151.434, 285.661, 411.592, 534.398, 655.733, 776.731, 897.099, 1017.83,
  1137.51, 1258.54, 1377.34, 1495.55, 1615.29, 1732.99,
]
const REAL_SEGMENTS = [
  '0:04.405', '2:27.029', '2:14.227', '2:05.931', '2:02.806', '2:01.335', '2:00.998',
  '2:00.368', '2:00.734', '1:59.674', '2:01.028', '1:58.801', '1:58.214', '1:59.739', '1:57.705',
].map(parseTimeToSeconds)

function realSamples(): Sample[] {
  const s: Sample[] = []
  for (let t = 0; t <= 1732.99 + 1e-9; t += 0.05) {
    const a = (t / 50) * 2 * Math.PI
    s.push({ t: +t.toFixed(3), lat: 52.42 + 0.005 * Math.sin(a), lon: 16.806 + 0.007 * Math.cos(a), v: 100, ax: 0, ay: 0 })
  }
  return s
}

describe('buildLaps — realne beacon/segment (Poznan)', () => {
  const meta: SessionMeta = {
    sampleRateHz: 20,
    beaconMarkers: REAL_BEACONS,
    segmentTimes: REAL_SEGMENTS,
    durationS: 1732.99,
  }
  const laps = buildLaps(realSamples(), meta)

  it('14 okrążeń z 15 beaconów', () => {
    expect(laps.length).toBe(14)
  })

  it('wyrównuje Segment Times (offset out-lap): L1=2:27.029, L12=1:58.214', () => {
    expect(laps[0].lapNumber).toBe(1)
    expect(laps[0].timeMs).toBe(147029)
    expect(laps[11].lapNumber).toBe(12)
    expect(laps[11].timeMs).toBe(118214)
  })

  it('ostatnie okrążenie (koniec = Duration) = in-lap, nieważne', () => {
    expect(laps[13].lapNumber).toBe(14)
    expect(laps[13].timeMs).toBe(117705)
    expect(laps[13].isValid).toBe(false)
  })

  it('best = L12 (1:58.214), mimo że in-lap L14 jest szybszy', () => {
    const bi = pickBestLap(laps)
    expect(laps[bi].lapNumber).toBe(12)
    expect(laps[bi].timeMs).toBe(118214)
  })

  it('delta na 100% L13−L12 ≈ +1.525 s', () => {
    const d = delta(laps[11], laps[12], 1)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeCloseTo(1.525, 1)
  })
})

describe('guard', () => {
  it('rzuca komunikat gdy brak kanałów GPS', () => {
    const bad = 'Format,"X"\r\n\r\nfoo,bar\r\nx,y\r\n\r\n1,2\r\n'
    expect(() => parseCsv(bad)).toThrow(ParseError)
    try {
      parseCsv(bad)
    } catch (e) {
      expect((e as Error).message).toBe(EXPORT_ENGLISH_MSG)
    }
  })
})
