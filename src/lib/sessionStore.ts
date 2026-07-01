import { supabase, BUCKET_RAW, BUCKET_PROCESSED } from './supabase'
import type { ParsedSession, ProcessedSession } from './types'
import { buildProcessed } from './process'

export interface SessionRow {
  id: string
  vehicle: string | null
  racer: string | null
  championship: string | null
  session_date: string | null
  sample_rate_hz: number | null
  duration_s: number | null
  best_lap_ms: number | null
  raw_path: string | null
  processed_path: string | null
  created_at: string
}

function requireClient() {
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany (uzupełnij .env).')
  return supabase
}

/**
 * KAMIEŃ MILOWY #1 pipeline:
 * upload raw CSV → processed JSON do Storage → insert do sessions + laps.
 */
export async function uploadSession(
  parsed: ParsedSession,
  file: File,
): Promise<string> {
  const sb = requireClient()
  const { data: userData } = await sb.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Zaloguj się, aby zapisać sesję.')

  // 1) insert session (dostajemy id)
  const { data: session, error: sErr } = await sb
    .from('sessions')
    .insert({
      vehicle: parsed.meta.vehicle,
      racer: parsed.meta.racer,
      championship: parsed.meta.championship,
      session_date: normalizeDate(parsed.meta.date),
      sample_rate_hz: Math.round(parsed.meta.sampleRateHz),
      duration_s: parsed.meta.durationS,
      best_lap_ms: parsed.laps[parsed.bestLapIndex]?.timeMs ?? null,
    })
    .select()
    .single()
  if (sErr) throw sErr
  const sessionId = session.id as string

  const rawPath = `${userId}/${sessionId}.csv`
  const processedPath = `${userId}/${sessionId}.json`

  // 2) raw CSV → Storage
  const { error: rawErr } = await sb.storage
    .from(BUCKET_RAW)
    .upload(rawPath, file, { contentType: 'text/csv', upsert: true })
  if (rawErr) throw rawErr

  // 3) processed compact JSON → Storage (surowe wiersze NIE idą do Postgresa)
  const processed = buildProcessed(parsed)
  const blob = new Blob([JSON.stringify(processed)], { type: 'application/json' })
  const { error: procErr } = await sb.storage
    .from(BUCKET_PROCESSED)
    .upload(processedPath, blob, { contentType: 'application/json', upsert: true })
  if (procErr) throw procErr

  // 4) update ścieżek
  await sb
    .from('sessions')
    .update({ raw_path: rawPath, processed_path: processedPath })
    .eq('id', sessionId)

  // 5) insert laps (tylko podsumowania)
  const lapsPayload = parsed.laps.map((l) => ({
    session_id: sessionId,
    lap_number: l.lapNumber,
    lap_time_ms: l.timeMs,
    is_best: l.isBest,
    is_valid: l.isValid,
    beacon_start_s: l.beaconStartS,
    beacon_end_s: l.beaconEndS,
  }))
  if (lapsPayload.length) {
    const { error: lErr } = await sb.from('laps').insert(lapsPayload)
    if (lErr) throw lErr
  }

  return sessionId
}

export async function listSessions(): Promise<SessionRow[]> {
  const sb = requireClient()
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SessionRow[]
}

export async function loadProcessed(row: SessionRow): Promise<ProcessedSession> {
  const sb = requireClient()
  if (!row.processed_path) throw new Error('Sesja bez processed JSON.')
  const { data, error } = await sb.storage.from(BUCKET_PROCESSED).download(row.processed_path)
  if (error) throw error
  const text = await data.text()
  return JSON.parse(text) as ProcessedSession
}

function normalizeDate(raw?: string): string | null {
  if (!raw) return null
  // "01/07/2026" (dd/mm/yyyy) → "2026-07-01"
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = Date.parse(raw)
  return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10)
}
