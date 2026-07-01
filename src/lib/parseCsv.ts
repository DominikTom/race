import type { Sample, SessionMeta, Lap, ParsedSession } from './types'
import { cumulativeDistance, normalizedDistance } from './geo'

export class ParseError extends Error {}

/** Rzucany gdy brakuje kanałów GPS — eksport nie po angielsku / zły format. */
export const EXPORT_ENGLISH_MSG = 'Wyeksportuj z RS3 po angielsku'

/** Rozbija jedną linię CSV na pola, respektując cudzysłowy. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** "1:58.214" → 118.214; "118.214" → 118.214; puste → NaN. */
export function parseTimeToSeconds(raw: string): number {
  const s = raw.trim()
  if (!s) return NaN
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseFloat(p))
    if (parts.some((p) => Number.isNaN(p))) return NaN
    // mm:ss(.mmm) lub hh:mm:ss(.mmm)
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  const n = parseFloat(s)
  return Number.isNaN(n) ? NaN : n
}

function numericValues(fields: string[]): number[] {
  return fields
    .slice(1)
    .map((f) => parseTimeToSeconds(f))
    .filter((n) => !Number.isNaN(n))
}

/** Czy linia jest wierszem nazw kanałów. */
function isHeaderRow(fields: string[]): boolean {
  if (fields.length < 4) return false
  const first = fields[0].trim()
  if (first !== 'Time') return false
  const joined = fields.join('')
  return /GPS Latitude/i.test(joined) && /GPS Speed/i.test(joined)
}

interface HeaderLocation {
  headerIdx: number
  unitsIdx: number
  dataIdx: number
  names: string[]
}

function locateHeader(rows: string[][]): HeaderLocation {
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (isHeaderRow(rows[i])) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) {
    throw new ParseError(EXPORT_ENGLISH_MSG)
  }
  // następny niepusty wiersz = jednostki
  let unitsIdx = headerIdx + 1
  while (unitsIdx < rows.length && rows[unitsIdx].every((c) => c === '')) {
    unitsIdx++
  }
  // dane = pierwszy niepusty wiersz po jednostkach
  let dataIdx = unitsIdx + 1
  while (dataIdx < rows.length && rows[dataIdx].every((c) => c === '')) {
    dataIdx++
  }
  return { headerIdx, unitsIdx, dataIdx, names: rows[headerIdx].map((n) => n.trim()) }
}

function buildNameIndex(names: string[]): Map<string, number> {
  const map = new Map<string, number>()
  names.forEach((name, i) => {
    // pierwsze wystąpienie wygrywa (duplikat "GPS LateralAcc" itd. nie nadpisze)
    if (!map.has(name)) map.set(name, i)
  })
  return map
}

/** Czy kolumna jest martwa: (prawie) wszystkie wartości ~0 lub puste. */
function isDeadColumn(rows: string[][], col: number, eps = 1e-9): boolean {
  let nonZero = 0
  let counted = 0
  for (const r of rows) {
    const raw = r[col]
    if (raw === undefined || raw === '') continue
    const v = parseFloat(raw)
    if (Number.isNaN(v)) continue
    counted++
    if (Math.abs(v) > eps) nonZero++
  }
  if (counted === 0) return true
  return nonZero / counted < 0.001 // <0.1% niezerowych => martwa
}

function parseMeta(
  metaRows: string[][],
  dataRows: string[][],
  timeCol: number,
): SessionMeta {
  const kv = new Map<string, string[]>()
  for (const r of metaRows) {
    if (r.length === 0 || r[0] === '') continue
    kv.set(r[0].toLowerCase(), r.slice(1))
  }
  const first = (k: string) => kv.get(k)?.[0]?.trim()

  // Sample rate: z metadanych, w razie potrzeby z mediany dt.
  let sampleRateHz = NaN
  const srRaw = first('sample rate')
  if (srRaw) sampleRateHz = parseFloat(srRaw)
  if (!sampleRateHz || Number.isNaN(sampleRateHz)) {
    sampleRateHz = deriveSampleRate(dataRows, timeCol)
  }

  const beaconMarkers = kv.has('beacon markers')
    ? numericValues(['', ...(kv.get('beacon markers') as string[])])
    : []
  const segmentTimes = kv.has('segment times')
    ? numericValues(['', ...(kv.get('segment times') as string[])])
    : []

  return {
    format: first('format'),
    session: first('session'),
    vehicle: first('vehicle'),
    racer: first('racer'),
    championship: first('championship'),
    date: first('date'),
    time: first('time'),
    sampleRateHz,
    durationS: first('duration') ? parseTimeToSeconds(first('duration')!) : undefined,
    beaconMarkers,
    segmentTimes,
  }
}

function deriveSampleRate(dataRows: string[][], timeCol: number): number {
  const dts: number[] = []
  for (let i = 1; i < dataRows.length && dts.length < 200; i++) {
    const a = parseFloat(dataRows[i - 1][timeCol])
    const b = parseFloat(dataRows[i][timeCol])
    if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) dts.push(b - a)
  }
  if (dts.length === 0) return 20 // rozsądny fallback
  dts.sort((x, y) => x - y)
  const median = dts[Math.floor(dts.length / 2)]
  return median > 0 ? Math.round(1 / median) : 20
}

/** Główny parser AiM Solo 2 DL CSV. */
export function parseCsv(text: string): ParsedSession {
  const rawLines = text.split(/\r\n|\r|\n/)
  const rows = rawLines.map(splitLine)

  const { headerIdx, dataIdx, names } = locateHeader(rows)
  const nameIndex = buildNameIndex(names)

  const timeCol = nameIndex.get('Time')
  const latCol = nameIndex.get('GPS Latitude')
  const lonCol = nameIndex.get('GPS Longitude')
  const spdCol = nameIndex.get('GPS Speed')

  if (
    timeCol === undefined ||
    latCol === undefined ||
    lonCol === undefined ||
    spdCol === undefined
  ) {
    throw new ParseError(EXPORT_ENGLISH_MSG)
  }

  const metaRows = rows.slice(0, headerIdx)
  const dataRows = rows
    .slice(dataIdx)
    .filter((r) => r.length > timeCol && r[timeCol] !== '' && !Number.isNaN(parseFloat(r[timeCol])))

  if (dataRows.length === 0) {
    throw new ParseError('Brak danych telemetrii w pliku.')
  }

  const meta = parseMeta(metaRows, dataRows, timeCol)

  // Martwe kanały (po nazwie).
  const activeChannels: string[] = []
  const deadChannels: string[] = []
  names.forEach((name, col) => {
    if (name === '') return
    if (isDeadColumn(dataRows, col)) deadChannels.push(name)
    else activeChannels.push(name)
  })

  // Wszystkie próbki.
  const samples: Sample[] = dataRows.map((r) => ({
    t: parseFloat(r[timeCol]),
    lat: parseFloat(r[latCol]),
    lon: parseFloat(r[lonCol]),
    v: parseFloat(r[spdCol]),
  }))

  const laps = buildLaps(samples, meta)
  let bestLapIndex = -1
  let bestTime = Infinity
  laps.forEach((lap, i) => {
    if (lap.timeMs > 0 && lap.timeMs < bestTime) {
      bestTime = lap.timeMs
      bestLapIndex = i
    }
  })
  if (bestLapIndex >= 0) laps[bestLapIndex].isBest = true

  return { meta, laps, bestLapIndex, activeChannels, deadChannels }
}

/**
 * Podział na okrążenia z beacon markers. Okrążenie i = próbki w [beacon[i], beacon[i+1]).
 * Czas okrążenia z Segment Times gdy dostępne, inaczej różnica beaconów.
 */
export function buildLaps(samples: Sample[], meta: SessionMeta): Lap[] {
  const beacons = [...meta.beaconMarkers].sort((a, b) => a - b)
  const laps: Lap[] = []

  // Fallback: brak beaconów → cała sesja jako jedno "okrążenie".
  const boundaries: Array<[number, number]> = []
  if (beacons.length >= 2) {
    for (let i = 0; i < beacons.length - 1; i++) {
      boundaries.push([beacons[i], beacons[i + 1]])
    }
  } else {
    boundaries.push([samples[0].t, samples[samples.length - 1].t])
  }

  boundaries.forEach(([start, end], i) => {
    const lapSamples = samples.filter((s) => s.t >= start && s.t < end)
    if (lapSamples.length < 2) return
    const cum = cumulativeDistance(lapSamples)
    const nd = normalizedDistance(cum)
    const segT = meta.segmentTimes[i]
    const timeMs = Number.isFinite(segT)
      ? Math.round(segT * 1000)
      : Math.round((end - start) * 1000)
    laps.push({
      lapNumber: i + 1,
      timeMs,
      isBest: false,
      beaconStartS: start,
      beaconEndS: end,
      samples: lapSamples,
      cum,
      nd,
      totalDist: cum[cum.length - 1],
    })
  })

  return laps
}
