import { useMemo } from 'react'
import type { AnyLap } from '../lib/analysis'
import { sampleAt } from '../lib/geo'

interface Props {
  laps: AnyLap[]
  colors: string[]
  cursorFs: number[]
}

const SIZE = 260
const C = SIZE / 2

function axArr(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.ax) : lap.ax
}
function ayArr(lap: AnyLap): number[] {
  return 'samples' in lap ? lap.samples.map((s) => s.ay) : lap.ay
}

/**
 * Miernik przeciążeń G (koło przyczepności / traction circle).
 * Oś X = boczne g (lewo/prawo), oś Y = wzdłużne g (gaz w górę, hamowanie w dół).
 * Chmura punktów okrążenia referencyjnego + kropka bieżąca per okrążenie.
 */
export default function GMeter({ laps, colors, cursorFs }: Props) {
  const maxG = useMemo(() => {
    let m = 1
    for (const lap of laps) {
      for (const a of axArr(lap)) m = Math.max(m, Math.abs(a))
      for (const a of ayArr(lap)) m = Math.max(m, Math.abs(a))
    }
    return Math.min(2.5, Math.ceil(m * 2) / 2) // zaokrąglij do 0.5, max 2.5
  }, [laps])

  const scale = (C - 18) / maxG
  const toX = (ay: number) => C + ay * scale
  const toY = (ax: number) => C - ax * scale // + = w górę (przyspieszanie)

  // chmura g-g okrążenia referencyjnego (pierwsze pokazane)
  const cloud = useMemo(() => {
    const ref = laps[0]
    if (!ref) return ''
    const n = 400
    let pts = ''
    for (let i = 0; i < n; i++) {
      const s = sampleAt(ref, i / (n - 1))
      pts += `${toX(s.ay).toFixed(1)},${toY(s.ax).toFixed(1)} `
    }
    return pts.trim()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps, maxG])

  const rings = [maxG, maxG * 0.66, maxG * 0.33]

  return (
    <div className="gmeter">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="gmeter-svg">
        <rect x={0} y={0} width={SIZE} height={SIZE} fill="#111820" rx={10} />
        {rings.map((g, i) => (
          <circle key={i} cx={C} cy={C} r={g * scale} fill="none" stroke="#263241" strokeWidth={1} />
        ))}
        <line x1={C} y1={10} x2={C} y2={SIZE - 10} stroke="#263241" />
        <line x1={10} y1={C} x2={SIZE - 10} y2={C} stroke="#263241" />
        <text x={C + 4} y={16} fill="#7a8a99" fontSize={10}>gaz</text>
        <text x={C + 4} y={SIZE - 6} fill="#7a8a99" fontSize={10}>hamowanie</text>
        <text x={SIZE - 26} y={C - 4} fill="#7a8a99" fontSize={10}>{maxG}g</text>
        {/* chmura referencyjna */}
        <polyline points={cloud} fill="none" stroke="#2a3644" strokeWidth={1} opacity={0.7} />
        {/* kropki bieżące per okrążenie */}
        {laps.map((lap, i) => {
          const s = sampleAt(lap, cursorFs[i] ?? 0)
          return (
            <circle
              key={i}
              cx={toX(s.ay)}
              cy={toY(s.ax)}
              r={6}
              fill={colors[i]}
              stroke="#000"
              strokeWidth={1.5}
            />
          )
        })}
      </svg>
      <div className="gmeter-readouts">
        {laps.map((lap, i) => {
          const s = sampleAt(lap, cursorFs[i] ?? 0)
          const total = Math.hypot(s.ax, s.ay)
          return (
            <div key={i} className="greadout">
              <span className="dot" style={{ background: colors[i] }} /> L{lap.lapNumber}
              <span className="gvals">
                wzdł. <strong>{s.ax >= 0 ? '+' : ''}{s.ax.toFixed(2)}g</strong> ·
                bok <strong>{s.ay.toFixed(2)}g</strong> ·
                total <strong>{total.toFixed(2)}g</strong>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
