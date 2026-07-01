import { useMemo } from 'react'
import type { AnyLap } from '../lib/analysis'
import { delta } from '../lib/geo'
import { formatDelta } from '../lib/format'

interface Props {
  lapA: AnyLap
  lapB: AnyLap
  cursorF: number
  onScrub?: (f: number) => void
}

const W = 800
const H = 140
const PAD = { l: 40, r: 10, t: 10, b: 20 }
const N = 300

/** Delta-time B−A po dystansie. Dodatnia (tracisz) = czerwony, ujemna (zyskujesz) = zielony. */
export default function DeltaChart({ lapA, lapB, cursorF, onScrub }: Props) {
  const series = useMemo(() => {
    const arr: { f: number; d: number }[] = []
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1)
      arr.push({ f, d: delta(lapA, lapB, f) })
    }
    return arr
  }, [lapA, lapB])

  const maxAbs = useMemo(() => {
    const m = Math.max(0.001, ...series.map((s) => Math.abs(s.d)))
    return Math.ceil(m * 10) / 10
  }, [series])

  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const yFor = (d: number) => PAD.t + innerH * (1 - (d + maxAbs) / (2 * maxAbs))
  const zeroY = yFor(0)

  // segmenty per-kolor (czerwony/zielony) — rysujemy jako obszar do zera.
  const areas = useMemo(() => {
    const pos: string[] = []
    const neg: string[] = []
    series.forEach((s) => {
      const x = PAD.l + s.f * innerW
      const y = yFor(s.d)
      if (s.d >= 0) pos.push(`${x.toFixed(1)},${y.toFixed(1)}`)
      else neg.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    })
    return { pos, neg }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, maxAbs])

  const linePath = useMemo(() => {
    let d = ''
    series.forEach((s, k) => {
      const x = PAD.l + s.f * innerW
      const y = yFor(s.d)
      d += `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, maxAbs])

  const cx = PAD.l + cursorF * innerW
  const dAtCursor = delta(lapA, lapB, cursorF)

  function handle(e: React.MouseEvent<SVGSVGElement>) {
    if (!onScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const f = (x - PAD.l) / innerW
    onScrub(Math.max(0, Math.min(1, f)))
  }

  return (
    <div className="chart">
      <div className="chart-title">
        Delta B−A [s] po dystansie ·{' '}
        <span style={{ color: dAtCursor >= 0 ? '#ff6b6b' : '#37d67a' }}>
          {formatDelta(dAtCursor)} s
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseDown={handle}
        onMouseMove={(e) => e.buttons === 1 && handle(e)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#111820" />
        <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="#2a3644" />
        <text x={4} y={zeroY - 3} fill="#7a8a99" fontSize={10}>0</text>
        <text x={4} y={PAD.t + 10} fill="#ff6b6b" fontSize={10}>+{maxAbs}</text>
        <text x={4} y={H - PAD.b - 2} fill="#37d67a" fontSize={10}>-{maxAbs}</text>
        {/* obszar strat (czerwony) i zysków (zielony) jako punkty pod linią */}
        <path
          d={`M${PAD.l},${zeroY} ${areas.pos.map((p) => 'L' + p).join(' ')} L${W - PAD.r},${zeroY} Z`}
          fill="rgba(255,107,107,0.18)"
        />
        <path
          d={`M${PAD.l},${zeroY} ${areas.neg.map((p) => 'L' + p).join(' ')} L${W - PAD.r},${zeroY} Z`}
          fill="rgba(55,214,122,0.18)"
        />
        <path d={linePath} fill="none" stroke="#e8eef4" strokeWidth={1.6} />
        <line x1={cx} y1={PAD.t} x2={cx} y2={H - PAD.b} stroke="#fff" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
    </div>
  )
}
