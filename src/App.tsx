import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type ColorMode } from './components/MapView'
import SpeedChart from './components/SpeedChart'
import DeltaChart from './components/DeltaChart'
import PedalChart from './components/PedalChart'
import SegmentsPanel from './components/SegmentsPanel'
import Auth from './components/Auth'
import SessionList from './components/SessionList'
import { analyzeTrack, type Segment } from './lib/segments'
import { parseCsv, ParseError } from './lib/parseCsv'
import { delta } from './lib/geo'
import { formatLapTime, formatDelta } from './lib/format'
import { supabase, supabaseConfigured } from './lib/supabase'
import { uploadSession, loadProcessed, type SessionRow } from './lib/sessionStore'
import type { AnyLap, Offset } from './lib/analysis'
import { cursorAt, lapColor as colorFor, buildLongModel, pedalAt } from './lib/analysis'
import type { SessionMeta } from './lib/types'

interface Analysis {
  laps: AnyLap[]
  bestLapIndex: number
  meta: SessionMeta
  deadChannels: string[]
  label: string
}

function offsetKey(laps: AnyLap[]): string {
  const first = laps[0]
  const lat = 'samples' in first ? first.samples[0].lat : first.lat[0]
  const lon = 'samples' in first ? first.samples[0].lon : first.lon[0]
  return `sat-offset:${lat.toFixed(2)},${lon.toFixed(2)}`
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [cursorF, setCursorF] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [colorMode, setColorMode] = useState<ColorMode>('lap')
  const [offset, setOffset] = useState<Offset>({ dLat: 0, dLon: 0 })
  const [follow, setFollow] = useState(false)
  const [focusSeg, setFocusSeg] = useState<Segment | null>(null)
  const [fitToken, setFitToken] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // auto-schowanie potwierdzenia zapisu
  useEffect(() => {
    if (!saved) return
    const id = setTimeout(() => setSaved(null), 3000)
    return () => clearTimeout(id)
  }, [saved])

  // auth state
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
  // model podłużny (gaz/hamulec) budowany z CAŁEJ sesji — stabilne obwiednie
  const longModel = useMemo(() => buildLongModel(analysis?.laps ?? []), [analysis])

  // podział toru (sektory/zakręty) z okrążenia referencyjnego (pierwsze pokazane)
  const track = useMemo(
    () => (shownLaps[0] ? analyzeTrack(shownLaps[0]) : { corners: [], segments: [], sectors: [] }),
    [shownLaps],
  )

  function focusSegment(seg: Segment | null) {
    setFocusSeg(seg)
    if (seg) {
      setFollow(false) // fokus na segment wyłącza podążanie
      setCursorF(seg.apexF ?? (seg.f0 + seg.f1) / 2)
    }
    setFitToken((t) => t + 1)
  }

  // wczytaj analizę i ustaw domyślne 2 okrążenia (best + sąsiednie)
  const startAnalysis = useCallback((a: Analysis) => {
    setAnalysis(a)
    const best = a.bestLapIndex >= 0 ? a.bestLapIndex : 0
    const other = best + 1 < a.laps.length ? best + 1 : Math.max(0, best - 1)
    const sel = other === best ? [best] : [best, other]
    setSelected(sel)
    setCursorF(0)
    setError(null)

    // offset per tor z localStorage
    try {
      const saved = localStorage.getItem(offsetKey(a.laps))
      setOffset(saved ? JSON.parse(saved) : { dLat: 0, dLon: 0 })
    } catch {
      setOffset({ dLat: 0, dLon: 0 })
    }

    // KAMIEŃ MILOWY #1: log do konsoli
    const bestLap = a.laps[best]
    const nextLap = a.laps[other]
    // eslint-disable-next-line no-console
    console.log(
      `[analiza] okrążeń: ${a.laps.length} | best: ${formatLapTime(bestLap?.timeMs ?? 0)} (lap ${bestLap?.lapNumber}) | ` +
        (nextLap && nextLap !== bestLap
          ? `delta na 100% (L${nextLap.lapNumber}−L${bestLap.lapNumber}): ${formatDelta(delta(bestLap, nextLap, 1))} s`
          : 'delta: brak drugiego okrążenia') +
        ` | martwe kanały: ${a.deadChannels.join(', ') || '—'} | ${a.meta.sampleRateHz} Hz`,
    )
    setFitToken((t) => t + 1)
  }, [])

  // --- wczytanie pliku CSV lokalnie ---
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

        // auto-zapis do Supabase (od razu, gdy zalogowany)
        if (supabaseConfigured && email) {
          setBusy('Zapisywanie w chmurze…')
          try {
            await uploadSession(parsed, file)
            setReloadToken((t) => t + 1)
            setBusy(null)
            setSaved('Zapisano w chmurze ✓ — dostępne w historii sesji')
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

  // --- Play: przesuwaj kursor po dystansie (bazując na czasie okrążenia A) ---
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

  return (
    <div className="app">
      <header>
        <h1>Race Telemetry Analyzer</h1>
        <div className="header-right">
          {analysis && (
            <button onClick={() => setAnalysis(null)}>← Nowa sesja</button>
          )}
          {supabaseConfigured ? (
            <Auth email={email} />
          ) : (
            <span className="muted">tryb lokalny (bez Supabase)</span>
          )}
        </div>
      </header>

      {error && <div className="banner err">{error}</div>}
      {busy && <div className="banner">{busy}</div>}
      {saved && <div className="banner ok">{saved}</div>}

      {!analysis ? (
        <Home
          onFile={handleFile}
          reloadToken={reloadToken}
          onOpen={openSession}
          showList={supabaseConfigured && !!email}
          needLogin={supabaseConfigured && !email}
        />
      ) : (
        <div className="analyze">
          <aside className="sidebar">
            <h3>Okrążenia</h3>
            <p className="muted">Zaznacz min. 2, aby porównać.</p>
            <ul className="lap-list">
              {analysis.laps.map((lap, i) => (
                <li key={i}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(i)}
                      onChange={() => toggleLap(i)}
                    />
                    <span>L{lap.lapNumber}</span>
                    <span className={'time' + (lap.isBest ? ' best' : '')}>
                      {formatLapTime(lap.timeMs)}
                    </span>
                    {lap.isValid === false && <span className="muted small">in</span>}
                  </label>
                </li>
              ))}
            </ul>

            <h3>Widok</h3>
            <label className="row">
              Kolor linii:
              <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
                <option value="lap">wg okrążenia</option>
                <option value="speed">heatmapa prędkości</option>
                <option value="sector">wg sektorów / zakrętów</option>
              </select>
            </label>
            <label className="row checkbox">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              Kamera podąża za autem
            </label>
            <button onClick={() => { setFocusSeg(null); setFitToken((t) => t + 1) }}>
              Cały tor / Fit
            </button>

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

            {analysis.deadChannels.length > 0 && (
              <>
                <h3>Ukryte kanały (martwe)</h3>
                <p className="muted small">{analysis.deadChannels.join(', ')}</p>
              </>
            )}
          </aside>

          <main className="viewport">
            <MapView
              laps={shownLaps}
              cursorF={cursorF}
              offset={offset}
              colorMode={colorMode}
              segments={track.segments}
              follow={follow}
              focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
              fitToken={fitToken}
            />

            <div className="scrub">
              <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸' : '▶'}</button>
              <input
                type="range" min={0} max={1} step={0.001}
                value={cursorF}
                onChange={(e) => setCursorF(parseFloat(e.target.value))}
              />
              <span className="muted">{(cursorF * 100).toFixed(1)}%</span>
            </div>

            {/* Odczyt prędkości + gaz/hamulec KAŻDEGO pokazanego okrążenia */}
            <div className="readouts">
              {shownLaps.map((lap, i) => {
                const p = cursorAt(lap, cursorF, offset)
                const pedal = pedalAt(lap, cursorF, longModel)
                return (
                  <div key={i} className="readout">
                    <span className="dot" style={{ background: colorFor(lap, i) }} />
                    L{lap.lapNumber}: <strong>{p.v.toFixed(1)} km/h</strong>
                    <span className="pedals" title="gaz / hamulec">
                      <span className="pedal-bar gas">
                        <span style={{ height: `${Math.round(pedal.throttle * 100)}%` }} />
                      </span>
                      <span className="pedal-bar brk">
                        <span style={{ height: `${Math.round(pedal.brake * 100)}%` }} />
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>

            <SpeedChart
              laps={shownLaps}
              cursorF={cursorF}
              focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
              onScrub={setCursorF}
            />
            <PedalChart laps={shownLaps} model={longModel} cursorF={cursorF} onScrub={setCursorF} />
            {lapA && lapB && (
              <DeltaChart lapA={lapA} lapB={lapB} cursorF={cursorF} onScrub={setCursorF} />
            )}

            <SegmentsPanel
              corners={track.corners}
              sectors={track.sectors}
              laps={shownLaps}
              focusId={focusSeg?.id ?? null}
              onFocus={focusSegment}
            />
          </main>
        </div>
      )}
    </div>
  )
}

interface HomeProps {
  onFile: (f: File) => void
  reloadToken: number
  onOpen: (row: SessionRow) => void
  showList: boolean
  needLogin: boolean
}

function Home({ onFile, reloadToken, onOpen, showList, needLogin }: HomeProps) {
  const [drag, setDrag] = useState(false)
  return (
    <div className="home">
      <div
        className={'dropzone' + (drag ? ' over' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
      >
        <p>Przeciągnij plik CSV z AiM Solo 2 DL tutaj</p>
        <p className="muted">lub</p>
        <label className="btn">
          Wybierz plik
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      </div>
      {showList && (
        <div className="sessions">
          <h3>Twoje sesje</h3>
          <SessionList reloadToken={reloadToken} onOpen={onOpen} />
        </div>
      )}
      {needLogin && (
        <div className="sessions">
          <h3>Historia w chmurze</h3>
          <p className="muted">
            Zaloguj się (magic-link u góry), aby każdy wrzucony CSV zapisywał się automatycznie
            i był dostępny w historii sesji na każdym urządzeniu.
          </p>
        </div>
      )}
    </div>
  )
}
