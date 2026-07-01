import { useState } from 'react'
import type { AnyLap } from '../lib/analysis'
import type { Segment } from '../lib/segments'
import { segmentStat } from '../lib/segments'

interface Props {
  corners: Segment[]
  sectors: Segment[]
  laps: AnyLap[] // pokazane okrążenia; laps[0] = referencja delty
  colors: string[]
  focusId: string | null
  onFocus: (seg: Segment | null) => void
}

function secs(ms: number): string {
  return (ms / 1000).toFixed(3)
}

/** Podział toru na sektory/zakręty + analiza per segment (czas, delta, min. prędkość). */
export default function SegmentsPanel({ corners, sectors, laps, colors, focusId, onFocus }: Props) {
  const [view, setView] = useState<'sectors' | 'corners'>('sectors')
  const list = view === 'sectors' ? sectors : corners
  const ref = laps[0]

  return (
    <div className="segments">
      <div className="seg-head">
        <div className="seg-toggle">
          <button className={view === 'sectors' ? 'on' : ''} onClick={() => setView('sectors')}>
            Sektory
          </button>
          <button className={view === 'corners' ? 'on' : ''} onClick={() => setView('corners')}>
            Zakręty ({corners.length})
          </button>
        </div>
        <button className={focusId ? '' : 'on'} onClick={() => onFocus(null)}>
          Cały tor
        </button>
      </div>

      {list.length === 0 ? (
        <p className="muted small">Brak wykrytych zakrętów (za mało danych bocznych).</p>
      ) : (
        <table className="seg-table">
          <thead>
            <tr>
              <th></th>
              {laps.map((lap, i) => (
                <th key={i}>
                  <span className="dot" style={{ background: colors[i] }} /> L{lap.lapNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((seg) => {
              const refStat = ref ? segmentStat(ref, seg) : null
              return (
                <tr
                  key={seg.id}
                  className={focusId === seg.id ? 'focus' : ''}
                  onClick={() => onFocus(focusId === seg.id ? null : seg)}
                >
                  <td className="seg-label">
                    {seg.label}
                    {seg.dir && <span className="muted small"> {seg.dir}</span>}
                  </td>
                  {laps.map((lap, i) => {
                    const st = segmentStat(lap, seg)
                    const d = refStat ? (st.timeMs - refStat.timeMs) / 1000 : 0
                    return (
                      <td key={i}>
                        <div>{secs(st.timeMs)}s</div>
                        {i > 0 && refStat && (
                          <div className="small" style={{ color: d > 0 ? '#ff6b6b' : '#37d67a' }}>
                            {d >= 0 ? '+' : ''}{d.toFixed(3)}
                          </div>
                        )}
                        <div className="muted small">{Math.round(st.minSpeed)} km/h</div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
