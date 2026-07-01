import { useEffect, useState } from 'react'
import type { SessionRow } from '../lib/sessionStore'
import { listSessions } from '../lib/sessionStore'
import { formatLapTime } from '../lib/format'

interface Props {
  reloadToken: number
  onOpen: (row: SessionRow) => void
}

/** Lista zapisanych sesji (Postgres = indeks). */
export default function SessionList({ reloadToken, onOpen }: Props) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    listSessions()
      .then(setRows)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [reloadToken])

  if (err) return <div className="err">Błąd listy sesji: {err}</div>
  if (loading) return <div className="muted">Ładowanie sesji…</div>
  if (rows.length === 0) return <div className="muted">Brak zapisanych sesji.</div>

  return (
    <ul className="session-list">
      {rows.map((r) => (
        <li key={r.id}>
          <button onClick={() => onOpen(r)}>
            <strong>{r.vehicle || 'Sesja'}</strong>{' '}
            <span className="muted">{r.session_date || ''}</span>
            <span className="best">best {formatLapTime(r.best_lap_ms ?? 0)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
