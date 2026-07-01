import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type ColorMode } from './components/MapView'
import SpeedChart from './components/SpeedChart'
import DeltaChart from './components/DeltaChart'
import GMeter from './components/GMeter'
import SegmentsPanel from './components/SegmentsPanel'
import Auth from './components/Auth'
import SessionList from './components/SessionList'
import { analyzeTrack, type Segment } from './lib/segments'
import { parseCsv, ParseError } from './lib/parseCsv'
import { formatLapTime, formatClock } from './lib/format'
import { supabase, supabaseConfigured } from './lib/supabase'
import { uploadSession, loadProcessed, findExistingSession, type SessionRow } from './lib/sessionStore'
import type { AnyLap, Offset } from './lib/analysis'
import { cursorAt, BEST_COLOR, LAP_PALETTE } from './lib/analysis'
import { sampleAt } from './lib/geo'
import type { SessionMeta } from './lib/types'

interface Analysis {
  laps: AnyLap[]
  bestLapIndex: number
  meta: SessionMeta
  deadChannels: string[]
  label: string
}

type Tab = 'speed' | 'delta' | 'g' | 'segments'

function offsetKey(laps: AnyLap[]): string {
  const first = laps[0]
  const lat = 'samples' in first ? first.samples[0].lat : first.lat[0]
  const lon = 'samples' in first ? first.samples[0].lon : first.lon[0]
  return `sat-offset:${lat.toFixed(2)},${lon.toFixed(2)}`
}

function defaultLapColor(orderIndex: number, isBest: boolean): string {
  if (isBest) return BEST_COLOR
  return LAP_PALETTE[orderIndex % LAP_PALETTE.length]
}

/** ms → licznik "1:58.214" dla biegnącego czasu okrążenia. */
function elapsedMs(lap: AnyLap, f: number): number {
  return (sampleAt(lap, f).t - sampleAt(lap, 0).t) * 1000
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [colorOverrides, setColorOverrides] = useState<Record<number, string>>({})
  const [cursorF, setCursorF] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [colorMode, setColorMode] = useState<ColorMode>('lap')
  const [offset, setOffset] = useState<Offset>({ dLat: 0, dLon: 0 })
  const [follow, setFollow] = useState(false)
  const [focusSeg, setFocusSeg] = useState<Segment | null>(null)
  const [tab, setTab] = useState<Tab>('speed')
  const [fitToken, setFitToken] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!saved) return
    const id = setTimeout(() => setSaved(null), 3500)
    return () => clearTimeout(id)
  }, [saved])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const shownLaps = useMemo(
    () => (analysis ? selected.map((i) => analysis.laps[i]).filter(Boolean) : []),
    [analysis, selected],
  )

  // kolory pokazanych okrążeń (override użytkownika lub domyślny wg kolejności/best)
  const shownColors = useMemo(
    () =>
      selected
        .filter((i) => analysis?.laps[i])
        .map((li, order) => colorOverrides[li] ?? defaultLapColor(order, analysis!.laps[li].isBest)),
    [selected, colorOverrides, analysis],
  )

  const track = useMemo(
    () => (shownLaps[0] ? analyzeTrack(shownLaps[0]) : { corners: [], segments: [], sectors: [] }),
    [shownLaps],
  )

  function focusSegment(seg: Segment | null) {
    setFocusSeg(seg)
    if (seg) {
      setFollow(false)
      setCursorF(seg.apexF ?? (seg.f0 + seg.f1) / 2)
    }
    setFitToken((t) => t + 1)
  }

  const startAnalysis = useCallback((a: Analysis) => {
    setAnalysis(a)
    const best = a.bestLapIndex >= 0 ? a.bestLapIndex : 0
    const other = best + 1 < a.laps.length ? best + 1 : Math.max(0, best - 1)
    setSelected(other === best ? [best] : [best, other])
    setColorOverrides({})
    setFocusSeg(null)
    setCursorF(0)
    setError(null)
    try {
      const s = localStorage.getItem(offsetKey(a.laps))
      setOffset(s ? JSON.parse(s) : { dLat: 0, dLon: 0 })
    } catch {
      setOffset({ dLat: 0, dLon: 0 })
    }
    setFitToken((t) => t + 1)
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      try {
        const text = await file.text()
        const parsed = parseCsv(text)
        startAnalysis({
          laps: parsed.laps,
          bestLapIndex: parsed.bestLapIndex,
          meta: parsed.meta,
          deadChannels: parsed.deadChannels,
          label: file.name,
        })

        if (supabaseConfigured && email) {
          const bestMs = parsed.laps[parsed.bestLapIndex]?.timeMs ?? null
          setBusy('Sprawdzanie bazy…')
          try {
            const existing = await findExistingSession(parsed.meta, bestMs)
            if (existing) {
              setBusy(null)
              setSaved('Ta sesja jest już w bazie ✓ — nie duplikuję')
            } else {
              setBusy('Zapisywanie w chmurze…')
              await uploadSession(parsed, file)
              setReloadToken((t) => t + 1)
              setBusy(null)
              setSaved('Zapisano w chmurze ✓ — dostępne w historii sesji')
            }
          } catch (e) {
            setBusy(null)
            setError('Auto-zapis nieudany: ' + (e as Error).message)
          }
        }
      } catch (e) {
        setError(e instanceof ParseError ? e.message : 'Błąd parsowania: ' + (e as Error).message)
      }
    },
    [email, startAnalysis],
  )

  const openSession = useCallback(
    async (row: SessionRow) => {
      setBusy('Wczytywanie sesji…')
      setError(null)
      try {
        const proc = await loadProcessed(row)
        startAnalysis({
          laps: proc.laps,
          bestLapIndex: proc.bestLapIndex,
          meta: proc.meta,
          deadChannels: [],
          label: row.vehicle || 'Sesja',
        })
      } catch (e) {
        setError('Nie udało się otworzyć sesji: ' + (e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [startAnalysis],
  )

  // Play: przesuwaj kursor po dystansie (bazując na czasie pierwszego okrążenia)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number>(0)
  useEffect(() => {
    if (!playing || shownLaps.length === 0) return
    const durMs = shownLaps[0].timeMs || 120000
    const step = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      setCursorF((f) => {
        const nf = f + dt / durMs
        return nf >= 1 ? 0 : nf
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = 0
    }
  }, [playing, shownLaps])

  function toggleLap(i: number) {
    setSelected((sel) =>
      sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort((a, b) => a - b),
    )
  }

  function updateOffset(next: Offset) {
    setOffset(next)
    if (analysis) {
      try {
        localStorage.setItem(offsetKey(analysis.laps), JSON.stringify(next))
      } catch {
        /* ignore */
      }
    }
  }

  const lapA = shownLaps[0]
  const lapB = shownLaps[1]
  // mapa: indeks okrążenia w tablicy -> kolor (do color-pickera w liście)
  const colorByLapIndex = useMemo(() => {
    const m: Record<number, string> = {}
    selected.forEach((li, order) => {
      if (analysis?.laps[li]) m[li] = colorOverrides[li] ?? defaultLapColor(order, analysis.laps[li].isBest)
    })
    return m
  }, [selected, colorOverrides, analysis])

  return (
    <div className="app">
      <header>
        <h1>🏁 Race Telemetry</h1>
        <div className="header-right">
          {analysis && <button onClick={() => setAnalysis(null)}>← Biblioteka</button>}
          {supabaseConfigured ? <Auth email={email} /> : <span className="muted">tryb lokalny</span>}
        </div>
      </header>

      {error && <div className="banner err">{error}</div>}
      {busy && <div className="banner">{busy}</div>}
      {saved && <div className="banner ok">{saved}</div>}

      {!analysis ? (
        <Home onFile={handleFile} reloadToken={reloadToken} onOpen={openSession} email={email} />
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <div className="side-block">
              <h3>Okrążenia</h3>
              <p className="muted small">Zaznacz ≥2, ustaw kolor per okrążenie.</p>
              <ul className="lap-list">
                {analysis.laps.map((lap, i) => {
                  const on = selected.includes(i)
                  return (
                    <li key={i} className={on ? 'on' : ''}>
                      <input type="checkbox" checked={on} onChange={() => toggleLap(i)} />
                      <span className="lap-n">L{lap.lapNumber}</span>
                      <span className={'time' + (lap.isBest ? ' best' : '')}>
                        {formatLapTime(lap.timeMs)}
                      </span>
                      {lap.isValid === false && <span className="muted tag">in</span>}
                      {on && (
                        <input
                          type="color"
                          className="lap-color"
                          value={colorByLapIndex[i] ?? '#4aa3ff'}
                          onChange={(e) =>
                            setColorOverrides((c) => ({ ...c, [i]: e.target.value }))
                          }
                          title="Kolor okrążenia"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="side-block">
              <h3>Offset satelity (per tor)</h3>
              <label className="row">
                dLat {offset.dLat.toFixed(5)}
                <input
                  type="range" min={-0.0006} max={0.0006} step={0.000005}
                  value={offset.dLat}
                  onChange={(e) => updateOffset({ ...offset, dLat: parseFloat(e.target.value) })}
                />
              </label>
              <label className="row">
                dLon {offset.dLon.toFixed(5)}
                <input
                  type="range" min={-0.0006} max={0.0006} step={0.000005}
                  value={offset.dLon}
                  onChange={(e) => updateOffset({ ...offset, dLon: parseFloat(e.target.value) })}
                />
              </label>
              <button onClick={() => updateOffset({ dLat: 0, dLon: 0 })}>Reset offsetu</button>
            </div>

            {analysis.deadChannels.length > 0 && (
              <div className="side-block">
                <h3>Ukryte kanały (martwe)</h3>
                <p className="muted small">{analysis.deadChannels.join(', ')}</p>
              </div>
            )}
          </aside>

          <section className="stage">
            <div className="map-wrap">
              <MapView
                laps={shownLaps}
                colors={shownColors}
                cursorF={cursorF}
                offset={offset}
                colorMode={colorMode}
                segments={track.segments}
                follow={follow}
                focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
                fitToken={fitToken}
              />
              <div className="map-controls">
                <button
                  className={follow ? 'on' : ''}
                  onClick={() => setFollow((f) => !f)}
                  title="Kamera podąża za autem"
                >
                  🎥 Podążaj{follow ? ' ✓' : ''}
                </button>
                <button onClick={() => { setFocusSeg(null); setFitToken((t) => t + 1) }}>⤢ Cały tor</button>
                <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
                  <option value="lap">kolor: okrążenia</option>
                  <option value="speed">kolor: prędkość</option>
                  <option value="sector">kolor: sektory</option>
                </select>
              </div>
              <div className="lap-timer">
                {shownLaps.map((lap, i) => (
                  <div key={i} className="lt-row">
                    <span className="dot" style={{ background: shownColors[i] }} />
                    <span className="lt-time">{formatClock(elapsedMs(lap, cursorF))}</span>
                    <span className="muted lt-speed">{cursorAt(lap, cursorF, offset).v.toFixed(0)} km/h</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="scrub">
              <button className="play" onClick={() => setPlaying((p) => !p)}>
                {playing ? '⏸' : '▶'}
              </button>
              <input
                type="range" min={0} max={1} step={0.0005}
                value={cursorF}
                onChange={(e) => setCursorF(parseFloat(e.target.value))}
              />
              <span className="muted scrub-pct">{(cursorF * 100).toFixed(1)}%</span>
            </div>

            <div className="dock">
              <div className="tabs">
                <button className={tab === 'speed' ? 'on' : ''} onClick={() => setTab('speed')}>Prędkość</button>
                <button className={tab === 'delta' ? 'on' : ''} onClick={() => setTab('delta')}>Delta</button>
                <button className={tab === 'g' ? 'on' : ''} onClick={() => setTab('g')}>Przeciążenia G</button>
                <button className={tab === 'segments' ? 'on' : ''} onClick={() => setTab('segments')}>Sektory / Zakręty</button>
              </div>
              <div className="dock-body">
                {tab === 'speed' && (
                  <SpeedChart
                    laps={shownLaps}
                    colors={shownColors}
                    cursorF={cursorF}
                    focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
                    onScrub={setCursorF}
                  />
                )}
                {tab === 'delta' &&
                  (lapA && lapB ? (
                    <DeltaChart lapA={lapA} lapB={lapB} cursorF={cursorF} onScrub={setCursorF} />
                  ) : (
                    <p className="muted pad">Zaznacz 2 okrążenia, aby zobaczyć deltę.</p>
                  ))}
                {tab === 'g' && <GMeter laps={shownLaps} colors={shownColors} cursorF={cursorF} />}
                {tab === 'segments' && (
                  <SegmentsPanel
                    corners={track.corners}
                    sectors={track.sectors}
                    laps={shownLaps}
                    colors={shownColors}
                    focusId={focusSeg?.id ?? null}
                    onFocus={focusSegment}
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

interface HomeProps {
  onFile: (f: File) => void
  reloadToken: number
  onOpen: (row: SessionRow) => void
  email: string | null
}

function Home({ onFile, reloadToken, onOpen, email }: HomeProps) {
  const [drag, setDrag] = useState(false)
  return (
    <div className="home">
      <div className="home-col">
        <h2>Dodaj dane z AiM Solo 2 DL</h2>
        <div
          className={'dropzone' + (drag ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f) onFile(f)
          }}
        >
          <p className="big">⤓ Przeciągnij plik CSV</p>
          <p className="muted">z eksportu RS3 (AiM Solo 2 DL)</p>
          <label className="btn">
            Wybierz plik
            <input type="file" accept=".csv,text/csv" hidden
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {email && <p className="muted small">Zalogowany jako {email} — nowe pliki zapisują się automatycznie.</p>}
        </div>
      </div>
      <div className="home-col">
        <h2>Twoje sesje w bazie</h2>
        {email ? (
          <SessionList reloadToken={reloadToken} onOpen={onOpen} />
        ) : (
          <p className="muted">
            Zaloguj się (magic-link u góry), aby zapisywać sesje i mieć do nich dostęp z każdego
            urządzenia. Bez logowania możesz analizować pliki lokalnie.
          </p>
        )}
      </div>
    </div>
  )
}
