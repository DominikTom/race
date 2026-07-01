import { describe, it, expect } from 'vitest'
import { parseCsv, parseTimeToSeconds, ParseError, EXPORT_ENGLISH_MSG } from './parseCsv'
import { delta } from './geo'
import { makeFixtureCsv } from './testFixture'

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
