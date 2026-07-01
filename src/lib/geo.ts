import type { Sample, Lap, CompactLap } from './types'

const R = 6371008.8 // promień Ziemi [m] (średni, WGS84 mean radius)

/** Odległość haversine [m] między dwoma punktami (lat/lon w stopniach). */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Dystans skumulowany [m] dla ciągu próbek.
 * Zwraca tablicę tej samej długości; cum[0] = 0.
 */
export function cumulativeDistance(samples: Sample[]): number[] {
  const cum = new Array<number>(samples.length)
  cum[0] = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    cum[i] = cum[i - 1] + haversine(a.lat, a.lon, b.lat, b.lon)
  }
  return cum
}

/** Znormalizowany dystans 0..1 z tablicy cum. Ostatni = 1 (chyba że total 0). */
export function normalizedDistance(cum: number[]): number[] {
  const total = cum[cum.length - 1] || 0
  if (total <= 0) return cum.map(() => 0)
  return cum.map((c) => c / total)
}

/**
 * Binary search: największy index i taki że nd[i] <= f.
 * Zwraca index w [0, len-2] gotowy do interpolacji z i+1.
 */
export function searchIndex(nd: number[], f: number): number {
  const n = nd.length
  if (f <= nd[0]) return 0
  if (f >= nd[n - 1]) return n - 2
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (nd[mid] <= f) lo = mid
    else hi = mid
  }
  return lo
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

/**
 * Interpolacja {lat, lon, v, t} w ułamku dystansu f (0..1) po nd.
 * Działa zarówno dla Lap (samples[]) jak i CompactLap (równoległe tablice).
 */
export function sampleAt(lap: Lap | CompactLap, f: number): Sample {
  const nd = lap.nd
  const g = Math.max(0, Math.min(1, f))
  const i = searchIndex(nd, g)
  const j = i + 1
  const d0 = nd[i]
  const d1 = nd[j]
  const u = d1 > d0 ? (g - d0) / (d1 - d0) : 0

  if ('samples' in lap) {
    const a = lap.samples[i]
    const b = lap.samples[j]
    return {
      lat: lerp(a.lat, b.lat, u),
      lon: lerp(a.lon, b.lon, u),
      v: lerp(a.v, b.v, u),
      t: lerp(a.t, b.t, u),
      ax: lerp(a.ax, b.ax, u),
    }
  }
  const c = lap as CompactLap
  return {
    lat: lerp(c.lat[i], c.lat[j], u),
    lon: lerp(c.lon[i], c.lon[j], u),
    v: lerp(c.v[i], c.v[j], u),
    t: lerp(c.t[i], c.t[j], u),
    ax: lerp(c.ax[i], c.ax[j], u),
  }
}

/**
 * Delta czasu B−A w ułamku dystansu f, licząc czas od startu okrążenia.
 * Dodatnia = B wolniejsze na tym dystansie = tracisz.
 */
export function delta(
  lapA: Lap | CompactLap,
  lapB: Lap | CompactLap,
  f: number,
): number {
  const a = sampleAt(lapA, f)
  const b = sampleAt(lapB, f)
  const t0A = sampleAt(lapA, 0).t
  const t0B = sampleAt(lapB, 0).t
  return b.t - t0B - (a.t - t0A)
}

/** bbox [minLon, minLat, maxLon, maxLat] po wielu okrążeniach. */
export function bounds(
  laps: (Lap | CompactLap)[],
): [number, number, number, number] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const lap of laps) {
    const lats = 'samples' in lap ? lap.samples.map((s) => s.lat) : lap.lat
    const lons = 'samples' in lap ? lap.samples.map((s) => s.lon) : lap.lon
    for (let i = 0; i < lats.length; i++) {
      if (lats[i] < minLat) minLat = lats[i]
      if (lats[i] > maxLat) maxLat = lats[i]
      if (lons[i] < minLon) minLon = lons[i]
      if (lons[i] > maxLon) maxLon = lons[i]
    }
  }
  return [minLon, minLat, maxLon, maxLat]
}
