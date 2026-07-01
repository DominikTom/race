/** ms → "1:58.214" (m:ss.mmm). */
export function formatLapTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalMs = Math.round(ms)
  const m = Math.floor(totalMs / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const millis = totalMs % 1000
  return `${m}:${s.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

/** sekundy delta → "+1.525" / "-0.312". */
export function formatDelta(sec: number): string {
  const sign = sec >= 0 ? '+' : '-'
  return `${sign}${Math.abs(sec).toFixed(3)}`
}
