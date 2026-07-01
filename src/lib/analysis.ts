import type { Lap, CompactLap, Sample } from './types'
import { sampleAt } from './geo'

export type AnyLap = Lap | CompactLap

export interface Offset {
  dLat: number
  dLon: number
}

export const NO_OFFSET: Offset = { dLat: 0, dLon: 0 }

// --- Oś absolutnego czasu sesji (do synchronizacji z wideo) ---

export interface SessionTimeline {
  t: number[] // absolutny czas sesji [s], rosnąco
  lat: number[]
  lon: number[]
  v: number[]
  ax: number[]
  ay: number[]
  lapNumber: number[]
  tMin: number
  tMax: number
}

export interface TimelineSample {
  lat: number
  lon: number
  v: number
  ax: number
  ay: number
  lapNumber: number
  inRange: boolean // false gdy czas poza nagranymi okrążeniami (wynik zaklampowany)
}

/** Skleja próbki wszystkich okrążeń w jedną oś czasu absolutnego (Lap i CompactLap). */
export function buildSessionTimeline(laps: AnyLap[]): SessionTimeline {
  const rows: {
    t: number; lat: number; lon: number; v: number; ax: number; ay: number; ln: number
  }[] = []
  for (const lap of laps) {
    if ('samples' in lap) {
      for (const s of lap.samples)
        rows.push({ t: s.t, lat: s.lat, lon: s.lon, v: s.v, ax: s.ax, ay: s.ay, ln: lap.lapNumber })
    } else {
      for (let i = 0; i < lap.t.length; i++)
        rows.push({ t: lap.t[i], lat: lap.lat[i], lon: lap.lon[i], v: lap.v[i], ax: lap.ax[i], ay: lap.ay[i], ln: lap.lapNumber })
    }
  }
  rows.sort((a, b) => a.t - b.t)
  const n = rows.length
  const tl: SessionTimeline = {
    t: new Array(n), lat: new Array(n), lon: new Array(n), v: new Array(n),
    ax: new Array(n), ay: new Array(n), lapNumber: new Array(n),
    tMin: n ? rows[0].t : 0, tMax: n ? rows[n - 1].t : 0,
  }
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    tl.t[i] = r.t; tl.lat[i] = r.lat; tl.lon[i] = r.lon
    tl.v[i] = r.v; tl.ax[i] = r.ax; tl.ay[i] = r.ay; tl.lapNumber[i] = r.ln
  }
  return tl
}

/** Interpolacja pozycji/telemetrii w absolutnym czasie sesji tAbs (clamp poza zakresem). */
export function sampleTimelineAt(tl: SessionTimeline, tAbs: number): TimelineSample | null {
  const n = tl.t.length
  if (n === 0) return null
  const inRange = tAbs >= tl.tMin && tAbs <= tl.tMax
  const c = Math.max(tl.tMin, Math.min(tl.tMax, tAbs))
  const at = (i: number): TimelineSample => ({
    lat: tl.lat[i], lon: tl.lon[i], v: tl.v[i], ax: tl.ax[i], ay: tl.ay[i],
    lapNumber: tl.lapNumber[i], inRange,
  })
  if (c <= tl.t[0]) return at(0)
  if (c >= tl.t[n - 1]) return at(n - 1)
  let lo = 0, hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tl.t[mid] <= c) lo = mid
    else hi = mid
  }
  const t0 = tl.t[lo], t1 = tl.t[hi]
  const u = t1 > t0 ? (c - t0) / (t1 - t0) : 0
  const L = (a: number, b: number) => a + (b - a) * u
  return {
    lat: L(tl.lat[lo], tl.lat[hi]), lon: L(tl.lon[lo], tl.lon[hi]),
    v: L(tl.v[lo], tl.v[hi]), ax: L(tl.ax[lo], tl.ax[hi]), ay: L(tl.ay[lo], tl.ay[hi]),
    lapNumber: tl.lapNumber[lo], inRange,
  }
}

/** Kolory linii wg okrążenia (best zawsze zielony). */
export const BEST_COLOR = '#37d67a'
export const LAP_PALETTE = ['#4aa3ff', '#ffb347', '#e15fed', '#f4d35e', '#ff6b6b']

export function lapColor(lap: AnyLap, orderIndex: number): string {
  if (lap.isBest) return BEST_COLOR
  return LAP_PALETTE[orderIndex % LAP_PALETTE.length]
}

/** Zwraca [lon, lat] próbek okrążenia z offsetem satelity dodanym do GPS. */
export function lapCoords(lap: AnyLap, offset: Offset = NO_OFFSET): [number, number][] {
  if ('samples' in lap) {
    return lap.samples.map((s) => [s.lon + offset.dLon, s.lat + offset.dLat])
  }
  const out: [number, number][] = []
  for (let i = 0; i < lap.lon.length; i++) {
    out.push([lap.lon[i] + offset.dLon, lap.lat[i] + offset.dLat])
  }
  return out
}

/** Prędkości okrążenia (do heatmapy / zakresu). */
export function lapSpeeds(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.v) : lap.v
}

/** nd okrążenia. */
export function lapNd(lap: AnyLap): number[] {
  return lap.nd
}

export function speedRange(laps: AnyLap[]): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const lap of laps) {
    for (const v of lapSpeeds(lap)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min)) return [0, 1]
  return [min, max]
}

/** Pozycja kursora {lon,lat,v,t} na okrążeniu w ułamku dystansu f, z offsetem. */
export function cursorAt(lap: AnyLap, f: number, offset: Offset = NO_OFFSET): Sample {
  const s = sampleAt(lap, f)
  return { ...s, lat: s.lat + offset.dLat, lon: s.lon + offset.dLon }
}

/**
 * Ułamek dystansu (0..1), przy którym CZAS okrążenia od startu = elapsedSec.
 * Do odtwarzania w czasie rzeczywistym: szybsze okrążenie osiąga f=1 wcześniej.
 * Binary search po monotonicznym czasie t(f).
 */
export function fractionAtTime(lap: AnyLap, elapsedSec: number): number {
  const t0 = sampleAt(lap, 0).t
  const tEnd = sampleAt(lap, 1).t
  const target = t0 + elapsedSec
  if (target <= t0) return 0
  if (target >= tEnd) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (sampleAt(lap, mid).t < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// --- Symulacja gazu/hamulca (model mocy na kołach, korelacja z prędkością) ---
//
// Fizyka (potwierdzona diagramem g-g-v): przy niskiej prędkości auto jest ograniczone
// PRZYCZEPNOŚCIĄ, przy wysokiej — MOCĄ (siła napędowa ≈ P/v). Dlatego samo przeciążenie
// wzdłużne kłamie: słabe 120-konne auto na 170 km/h przy pełnym gazie ma prawie zerowe
// przyspieszenie, a mimo to jedzie „na full".
//
// Rozwiązanie: liczymy WŁAŚCIWĄ MOC NA KOŁACH (na jednostkę masy):
//   P(v) = v·a  +  K·v³     [człon bezwładności + człon oporu aero]
// przy pełnym gazie moc jest ~stała względem prędkości, więc gaz% = P / Pmax.
//   • stała prędkość na prostej (a≈0, duże v):  P ≈ K·v³ ≈ Pmax  → gaz ~100%
//   • luz/coasting (a = −K·v² od oporu):         P ≈ 0            → gaz 0%
//   • hamowanie (a mocno ujemne):                P < 0            → gaz 0%
// K kalibrujemy z danych tak, by moc oporu przy Vmax zrównała się z max mocą bezwładności.

const G = 9.81

export interface LongModel {
  K: number // współczynnik oporu (na jednostkę masy), w jednostkach m/s
  pMax: number // sufit mocy na kołach (pełny gaz) [W/kg]
  brakeMax: number // sufit hamowania powyżej oporu [g]
  vmaxMs: number // prędkość maksymalna [m/s]
  aWot: number[] // obwiednia przyspieszenia na pełnym gazie wg przedziału prędkości [g]
  binMs: number // szerokość przedziału prędkości [m/s]
}

function axArray(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.ax) : lap.ax
}
function vArray(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.v) : lap.v
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[i]
}

const NBINS = 24

/** Buduje model podłużny z CAŁEJ sesji (wszystkich okrążeń) — stabilne obwiednie. */
export function buildLongModel(laps: AnyLap[]): LongModel {
  const vs: number[] = []
  const as: number[] = []
  for (const lap of laps) {
    const v = vArray(lap)
    const a = axArray(lap)
    for (let i = 0; i < v.length; i++) {
      vs.push(v[i])
      as.push(a[i])
    }
  }
  if (vs.length === 0) {
    return { K: 0, pMax: 1, brakeMax: 0.3, vmaxMs: 1, aWot: [0], binMs: 1 }
  }

  const sortedV = [...vs].sort((x, y) => x - y)
  const vmaxKmh = percentile(sortedV, 0.999)
  const vmaxMs = Math.max(1, vmaxKmh / 3.6)
  const binMs = vmaxMs / NBINS

  // Obwiednia przyspieszenia na pełnym gazie: p90 dodatnich ax w przedziale prędkości.
  const binPos: number[][] = Array.from({ length: NBINS }, () => [])
  const inertPos: number[] = []
  for (let i = 0; i < vs.length; i++) {
    const vMs = vs[i] / 3.6
    const b = Math.min(NBINS - 1, Math.floor(vMs / binMs))
    if (as[i] > 0) {
      binPos[b].push(as[i])
      inertPos.push(vMs * as[i] * G) // moc bezwładności [W/kg]
    }
  }
  const aWot = binPos.map((arr) => {
    if (arr.length < 3) return 0
    arr.sort((x, y) => x - y)
    return percentile(arr, 0.9)
  })
  // wypełnij puste przedziały ostatnią znaną wartością (monotoniczny fallback)
  for (let b = 1; b < NBINS; b++) if (aWot[b] === 0) aWot[b] = aWot[b - 1]

  // Kalibracja K i pMax metodą dwupunktową na obwiedni pełnego gazu (WOT):
  //   przy Vmax:  pMax = K·vmax³              (przyspieszenie ≈ 0)
  //   przy vRef:  pMax = vRef·aRef·g + K·vRef³ (obszar ograniczony mocą)
  // stąd K = vRef·aRef·g / (vmax³ − vRef³),  pMax = K·vmax³.
  let K = 0
  let pMax = 1
  const refTarget = Math.floor(0.55 * NBINS)
  let refBin = -1
  for (let d = 0; d < NBINS && refBin < 0; d++) {
    for (const b of [refTarget - d, refTarget + d]) {
      if (b >= 1 && b < NBINS && aWot[b] > 0.03) {
        refBin = b
        break
      }
    }
  }
  if (refBin >= 0) {
    const vRef = (refBin + 0.5) * binMs
    const aRef = aWot[refBin]
    const denom = Math.pow(vmaxMs, 3) - Math.pow(vRef, 3)
    if (denom > 1) {
      K = (vRef * aRef * G) / denom
      pMax = Math.max(1, K * Math.pow(vmaxMs, 3))
    }
  }
  if (K <= 0) {
    // Fallback gdy obwiednia WOT jest uboga: opór przy Vmax = max moc bezwładności.
    inertPos.sort((x, y) => x - y)
    const pInertMax = percentile(inertPos, 0.95) || 1
    K = pInertMax / Math.pow(vmaxMs, 3)
    const powers: number[] = []
    for (let i = 0; i < vs.length; i++) {
      const vMs = vs[i] / 3.6
      powers.push(vMs * as[i] * G + K * vMs * vMs * vMs)
    }
    powers.sort((x, y) => x - y)
    pMax = Math.max(1, percentile(powers, 0.97))
  }

  // Sufit hamowania: nadwyżka deceleracji ponad naturalny opór, p95.
  const brakeEx: number[] = []
  for (let i = 0; i < vs.length; i++) {
    const vMs = vs[i] / 3.6
    const dragG = (K * vMs * vMs) / G
    const ex = -as[i] - dragG
    if (ex > 0) brakeEx.push(ex)
  }
  brakeEx.sort((x, y) => x - y)
  const brakeMax = Math.max(0.15, percentile(brakeEx, 0.95))

  return { K, pMax, brakeMax, vmaxMs, aWot, binMs }
}

/** Gaz/hamulec (0..1) na okrążeniu w ułamku dystansu f, wg modelu mocy. */
export function pedalAt(
  lap: AnyLap,
  f: number,
  model: LongModel,
): { throttle: number; brake: number } {
  const s = sampleAt(lap, f)
  const vMs = s.v / 3.6
  const a = s.ax

  // gaz z mocy na kołach
  const power = vMs * a * G + model.K * vMs * vMs * vMs
  let throttle = clamp01(power / model.pMax)

  // przy niskiej prędkości (obszar przyczepności) dołóż estymatę z obwiedni przyspieszenia
  if (a > 0) {
    const b = Math.min(model.aWot.length - 1, Math.floor(vMs / model.binMs))
    const wot = model.aWot[b]
    if (wot > 0.05) {
      const accelThrottle = clamp01(a / wot)
      const lowFac = clamp01(1 - vMs / (0.5 * model.vmaxMs)) // waży tylko wolne fragmenty
      throttle = Math.max(throttle, lowFac * accelThrottle)
    }
  }

  // hamulec: nadwyżka deceleracji ponad naturalny opór
  const dragG = (model.K * vMs * vMs) / G
  const brakeEx = -a - dragG
  const brake = clamp01(brakeEx / model.brakeMax)

  if (brake > 0.05) throttle = 0 // hamowanie i gaz się wykluczają
  return { throttle, brake }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
