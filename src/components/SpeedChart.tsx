import { useMemo } from 'react'
import type { AnyLap } from '../lib/analysis'
import { lapColor, speedRange } from '../lib/analysis'
import { sampleAt } from '../lib/geo'

interface Props {
  laps: AnyLap[]
  cursorF: number
  onScrub?: (f: number) => void
}

const W = 800
const H = 200
const PAD = { l: 40, r: 10, t: 10, b: 24 }
const N = 300

/** Prędkość vs dystans dla wszystkich pokazanych okrążeń + pionowy kursor. */
export default function SpeedChart({ laps, cursorF, onScrub }: Props) {
  const [vmin, vmax] = useMemo(() => {
    const [lo, hi] = speedRange(laps)
    return [Math.min(0, lo), Math.ceil((hi + 5) / 10) * 10]
  }, [laps])

  const paths = useMemo(() => {
    const innerW = W - PAD.l - PAD.r
    const innerH = H - PAD.t - PAD.b
    return laps.map((lap, i) => {
      let d = ''
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1)
        const s = sampleAt(lap, f)
        const x = PAD.l + f * innerW
        const y = PAD.t + innerH * (1 - (s.v - vmin) / (vmax - vmin || 1))
        d += `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      }
      return { d, color: lapColor(lap, i) }
    })
  }, [laps, vmin, vmax])

  const cx = PAD.l + cursorF * (W - PAD.l - PAD.r)

  function handle(e: React.MouseEvent<SVGSVGElement>) {
    if (!onScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const f = (x - PAD.l) / (W - PAD.l - PAD.r)
    onScrub(Math.max(0, Math.min(1, f)))
  }

  const ticks = [vmin, (vmin + vmax) / 2, vmax]

  return (
    <div className="chart">
      <div className="chart-title">Prędkość [km/h] vs dystans</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseDown={handle}
        onMouseMove={(e) => e.buttons === 1 && handle(e)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#111820" />
        {ticks.map((t, i) => {
          const y = PAD.t + (H - PAD.t - PAD.b) * (1 - (t - vmin) / (vmax - vmin || 1))
          return (
            <g key={i}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#2a3644" />
              <text x={4} y={y + 4} fill="#7a8a99" fontSize={11}>
                {Math.round(t)}
              </text>
            </g>
          )
        })}
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={1.6} />
        ))}
        <line x1={cx} y1={PAD.t} x2={cx} y2={H - PAD.b} stroke="#fff" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
    </div>
  )
}
