import { useMemo } from 'react'
import type { AnyLap } from '../lib/analysis'
import { lapColor, pedalScale, pedalAt } from '../lib/analysis'

interface Props {
  laps: AnyLap[]
  cursorF: number
  onScrub?: (f: number) => void
}

const W = 800
const H = 150
const PAD = { l: 40, r: 10, t: 12, b: 18 }
const N = 300

/**
 * Symulacja gazu/hamulca z podłużnych przeciążeń.
 * Gaz = obszar w górę (zielony), hamulec = obszar w dół (czerwony), per okrążenie.
 * Wartości znormalizowane 0..100% względem p90 przeciążeń pokazanych okrążeń.
 */
export default function PedalChart({ laps, cursorF, onScrub }: Props) {
  const scale = useMemo(() => pedalScale(laps), [laps])
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const midY = PAD.t + innerH / 2

  const series = useMemo(() => {
    return laps.map((lap) => {
      let throttle = ''
      let brake = ''
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1)
        const p = pedalAt(lap, f, scale)
        const x = PAD.l + f * innerW
        const yT = midY - p.throttle * (innerH / 2)
        const yB = midY + p.brake * (innerH / 2)
        throttle += `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${yT.toFixed(1)}`
        brake += `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${yB.toFixed(1)}`
      }
      return { throttle, brake }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps, scale])

  const cx = PAD.l + cursorF * innerW

  function handle(e: React.MouseEvent<SVGSVGElement>) {
    if (!onScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    onScrub(Math.max(0, Math.min(1, (x - PAD.l) / innerW)))
  }

  return (
    <div className="chart">
      <div className="chart-title">
        Gaz / Hamulec (z przeciążeń) ·{' '}
        <span style={{ color: '#37d67a' }}>gaz ↑</span> /{' '}
        <span style={{ color: '#ff6b6b' }}>hamulec ↓</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseDown={handle}
        onMouseMove={(e) => e.buttons === 1 && handle(e)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#111820" />
        <line x1={PAD.l} y1={midY} x2={W - PAD.r} y2={midY} stroke="#2a3644" />
        <text x={4} y={PAD.t + 8} fill="#37d67a" fontSize={10}>100%</text>
        <text x={4} y={H - PAD.b - 1} fill="#ff6b6b" fontSize={10}>100%</text>
        {laps.map((lap, i) => {
          const c = lapColor(lap, i)
          return (
            <g key={i}>
              <path d={series[i].throttle} fill="none" stroke={c} strokeWidth={1.4} opacity={0.5} />
              <path d={series[i].brake} fill="none" stroke={c} strokeWidth={1.4} opacity={0.9} strokeDasharray="3 2" />
            </g>
          )
        })}
        <line x1={cx} y1={PAD.t} x2={cx} y2={H - PAD.b} stroke="#fff" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
    </div>
  )
}
