// Wspólne typy domenowe.

/** Jedna próbka telemetrii (subset kanałów używanych w analizie). */
export interface Sample {
  t: number // Time[s] absolutny w sesji
  lat: number
  lon: number
  v: number // GPS Speed [km/h]
}

/** Metadane z bloku nagłówkowego CSV. */
export interface SessionMeta {
  format?: string
  session?: string
  vehicle?: string
  racer?: string
  championship?: string
  date?: string
  time?: string
  sampleRateHz: number
  durationS?: number
  beaconMarkers: number[] // czasy [s] przecięć linii
  segmentTimes: number[] // czasy okrążeń [s] w kolejności
}

/** Okrążenie po podziale beacon markers + przeliczone dystanse. */
export interface Lap {
  lapNumber: number // 1-based
  timeMs: number // czas okrążenia w ms (z segment times lub beacon diff)
  isBest: boolean
  isValid: boolean // false dla in-lap/out-lap (nie liczy się do best)
  beaconStartS: number
  beaconEndS: number
  samples: Sample[]
  /** dystans skumulowany [m] na próbkę (len === samples.length). */
  cum: number[]
  /** znormalizowany dystans 0..1 (len === samples.length). */
  nd: number[]
  totalDist: number // metry
}

/** Wynik parsowania całego pliku. */
export interface ParsedSession {
  meta: SessionMeta
  laps: Lap[]
  bestLapIndex: number
  /** nazwy aktywnych (nie-martwych) kanałów. */
  activeChannels: string[]
  /** nazwy wykrytych martwych kanałów. */
  deadChannels: string[]
}

/** Kompaktowa reprezentacja okrążenia zapisywana do Storage (processed). */
export interface CompactLap {
  lapNumber: number
  timeMs: number
  isBest: boolean
  isValid: boolean
  nd: number[]
  lat: number[]
  lon: number[]
  v: number[]
  t: number[]
}

export interface ProcessedSession {
  meta: SessionMeta
  bestLapIndex: number
  laps: CompactLap[]
}
