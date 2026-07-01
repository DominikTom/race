import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type ColorMode } from './components/MapView'
import SpeedChart from './components/SpeedChart'
import DeltaChart from './components/DeltaChart'
import GMeter from './components/GMeter'
import SegmentsPanel from './components/SegmentsPanel'
import VideoPanel from './components/VideoPanel'
import Auth from './components/Auth'
import SessionList from './components/SessionList'
import AdminPanel from './components/AdminPanel'
import { checkIsAdmin } from './lib/admin'
import { analyzeTrack, type Segment } from './lib/segments'
import { parseCsv, ParseError } from './lib/parseCsv'
import { formatLapTime, formatClock } from './lib/format'
import { supabase, supabaseConfigured } from './lib/supabase'
import { uploadSession, loadProcessed, findExistingSession, type SessionRow } from './lib/sessionStore'
import type { AnyLap, Offset } from './lib/analysis'
import { cursorAt, BEST_COLOR, LAP_PALETTE, fractionAtTime, buildSessionTimeline, sampleTimelineAt } from './lib/analysis'
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

/** Absolutny czas [s] początku okrążenia (kotwica synchronizacji wideo). */
function lapStartAbs(lap: AnyLap): number {
  return 'samples' in lap ? lap.beaconStartS : lap.t[0]
}

function videoOffsetKey(laps: AnyLap[]): string {
  return `video-offset:${offsetKey(laps)}`
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [colorOverrides, setColorOverrides] = useState<Record<number, string>>({})
  const [playing, setPlaying] = useState(false)
  const [cursorT, setCursorT] = useState(0) // zegar [s] wyścigu na całym torze
  const [colorMode, setColorMode] = useState<ColorMode>('lap')
  const [offset, setOffset] = useState<Offset>({ dLat: 0, dLon: 0 })
  const [follow, setFollow] = useState(false)
  const [focusSeg, setFocusSeg] = useState<Segment | null>(null)
  const [tab, setTab] = useState<Tab>('speed')
  // --- wideo (lokalne) ---
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoRawT, setVideoRawT] = useState(0) // bieżący czas wideo [s]
  const [videoOffsetS, setVideoOffsetS] = useState(0) // dane = wideo + offset
  const [syncLap, setSyncLap] = useState(0) // indeks okrążenia, które pokazuje wideo (kotwica sync)
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

  // sprawdź uprawnienia admina po zalogowaniu
  useEffect(() => {
    if (!email) {
      setIsAdmin(false)
      return
    }
    checkIsAdmin().then(setIsAdmin)
  }, [email])

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

  // Okrążenie referencyjne + oś CZASU (wszystko parametryzowane czasem → spójne tempo).
  const refLap = shownLaps[0]
  const maxDurS = useMemo(
    () => Math.max(1, ...shownLaps.map((l) => (l.timeMs || 0) / 1000)),
    [shownLaps],
  )
  // czas [s] wejścia w sektor i długość sektora (wg okrążenia referencyjnego)
  const t0Sec = focusSeg && refLap ? elapsedMs(refLap, focusSeg.f0) / 1000 : 0
  const sectorDurS = focusSeg && refLap ? elapsedMs(refLap, focusSeg.f1) / 1000 - t0Sec : 0
  const clockMax = focusSeg ? Math.max(0.1, sectorDurS) : maxDurS

  // Ułamki dystansu PER okrążenie — liczone z CZASU (realne tempo: wolniej w zakrętach).
  //  - brak sektora → wyścig: każde okrążenie wg swojego czasu (szybsze wyprzedza),
  //  - sektor → analiza: obie kropki w tym samym punkcie toru (pozycja okr. referencyjnego).
  const cursorFs = useMemo(() => {
    if (!refLap) return []
    if (focusSeg) {
      const f = fractionAtTime(refLap, t0Sec + cursorT)
      return shownLaps.map(() => f)
    }
    return shownLaps.map((l) => fractionAtTime(l, cursorT))
  }, [focusSeg, shownLaps, cursorT, t0Sec, refLap])

  // pozycja kursora na wykresach (dystansowych) = pozycja okrążenia referencyjnego
  const chartF = refLap
    ? focusSeg
      ? fractionAtTime(refLap, t0Sec + cursorT)
      : fractionAtTime(refLap, cursorT)
    : 0

  // --- wideo: oś absolutnego czasu sesji + pozycja markera na mapie ---
  const sessionTimeline = useMemo(() => buildSessionTimeline(analysis?.laps ?? []), [analysis])
  const videoSessionT = videoRawT + videoOffsetS
  const videoSample = videoUrl ? sampleTimelineAt(sessionTimeline, videoSessionT) : null
  const videoPoint = videoSample ? { lon: videoSample.lon, lat: videoSample.lat } : null
  // czas w bieżącym okrążeniu (do wskaźnika + precyzyjnej synchronizacji: start okrążenia = 0:00)
  const videoLap = videoSample && analysis
    ? analysis.laps.find((l) => l.lapNumber === videoSample.lapNumber)
    : null
  const videoInLapMs = videoLap
    ? (videoSessionT - ('samples' in videoLap ? videoLap.beaconStartS : videoLap.t[0])) * 1000
    : 0
  const handleVideoTime = useCallback((sec: number) => setVideoRawT(sec), [])

  const focusSegment = useCallback((seg: Segment | null) => {
    setFocusSeg(seg)
    setPlaying(false) // pauza przy wejściu/wyjściu z analizy sektora
    setCursorT(0) // start od początku sektora / toru
    if (seg) setFollow(false)
    else setFitToken((t) => t + 1) // tylko powrót do całego toru dopasowuje kamerę
  }, [])

  const startAnalysis = useCallback((a: Analysis) => {
    setAnalysis(a)
    const best = a.bestLapIndex >= 0 ? a.bestLapIndex : 0
    const other = best + 1 < a.laps.length ? best + 1 : Math.max(0, best - 1)
    setSelected(other === best ? [best] : [best, other])
    setColorOverrides({})
    setFocusSeg(null)
    setCursorT(0)
    setError(null)
    try {
      const s = localStorage.getItem(offsetKey(a.laps))
      setOffset(s ? JSON.parse(s) : { dLat: 0, dLon: 0 })
    } catch {
      setOffset({ dLat: 0, dLon: 0 })
    }
    try {
      const vo = localStorage.getItem(videoOffsetKey(a.laps))
      setVideoOffsetS(vo ? parseFloat(vo) : 0)
    } catch {
      setVideoOffsetS(0)
    }
    setSyncLap(best) // domyślnie kotwica na najlepszym okrążeniu
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
    const max = clockMax
    const step = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      // jedna oś czasu (sektor: 0..czas sektora; cały tor: 0..najdłuższe okrążenie)
      setCursorT((t) => {
        const nt = t + dt / 1000
        return nt >= max ? 0 : nt
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = 0
    }
  }, [playing, shownLaps, clockMax])

  function toggleLap(i: number) {
    setSelected((sel) =>
      sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort((a, b) => a - b),
    )
  }

  // scrub z wykresów (f = ułamek dystansu 0..1) → przelicz na czas
  function scrubF(f: number) {
    if (!refLap) return
    const tSec = elapsedMs(refLap, f) / 1000
    if (focusSeg) setCursorT(Math.max(0, Math.min(sectorDurS, tSec - t0Sec)))
    else setCursorT(tSec)
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

  function loadVideo(file: File) {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    setVideoRawT(0)
    setPlaying(false)
  }

  function closeVideo() {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(null)
  }

  function updateVideoOffset(next: number) {
    setVideoOffsetS(next)
    if (analysis) {
      try {
        localStorage.setItem(videoOffsetKey(analysis.laps), String(next))
      } catch {
        /* ignore */
      }
    }
  }

  // Kotwica: „bieżąca klatka wideo = start wybranego okrążenia" → policz offset.
  function anchorVideoToLapStart() {
    const lap = analysis?.laps[syncLap]
    if (!lap) return
    updateVideoOffset(lapStartAbs(lap) - videoRawT)
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
        <Home
          onFile={handleFile}
          reloadToken={reloadToken}
          onOpen={openSession}
          email={email}
          isAdmin={isAdmin}
        />
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
            <div className="stage-top">
            <div className="map-wrap">
              <MapView
                laps={shownLaps}
                colors={shownColors}
                cursorFs={cursorFs}
                offset={offset}
                colorMode={colorMode}
                segments={track.segments}
                follow={follow}
                focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
                fitToken={fitToken}
                videoPoint={videoPoint}
                videoMode={!!videoUrl}
              />
              <div className="map-controls">
                <button
                  className={follow ? 'on' : ''}
                  onClick={() => setFollow((f) => !f)}
                  title="Kamera podąża za autem"
                >
                  🎥 Podążaj{follow ? ' ✓' : ''}
                </button>
                <button onClick={() => focusSegment(null)}>⤢ Cały tor</button>
                <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
                  <option value="lap">kolor: okrążenia</option>
                  <option value="speed">kolor: prędkość</option>
                  <option value="sector">kolor: sektory</option>
                </select>
                {!videoUrl && (
                  <label className="btn video-btn">
                    🎬 Wczytaj wideo
                    <input
                      type="file" accept="video/*" hidden
                      onChange={(e) => e.target.files?.[0] && loadVideo(e.target.files[0])}
                    />
                  </label>
                )}
              </div>
              {!videoUrl && (
              <div className="lap-timer">
                {shownLaps.map((lap, i) => {
                  const f = cursorFs[i] ?? 0
                  const finished = !focusSeg && f >= 1
                  const base = focusSeg ? elapsedMs(lap, focusSeg.f0) : 0
                  return (
                    <div key={i} className={'lt-row' + (finished ? ' finished' : '')}>
                      <span className="dot" style={{ background: shownColors[i] }} />
                      <span className="lt-time">{formatClock(elapsedMs(lap, f) - base)}</span>
                      <span className="muted lt-speed">
                        {finished ? 'META' : cursorAt(lap, f, offset).v.toFixed(0) + ' km/h'}
                      </span>
                    </div>
                  )
                })}
              </div>
              )}
            </div>

            {videoUrl && (
              <div className="video-col">
                <VideoPanel url={videoUrl} onTime={handleVideoTime} onClose={closeVideo} />
                <div className="video-sync">
                  {videoSample && (
                    <div className="v-readout">
                      <div className="v-lap">
                        Okrążenie L{videoSample.lapNumber} · {formatClock(videoInLapMs)}
                        {!videoSample.inRange && <span className="err small"> · poza danymi</span>}
                      </div>
                      <div className="muted small">
                        {videoSample.v.toFixed(0)} km/h · wzdł {videoSample.ax >= 0 ? '+' : ''}
                        {videoSample.ax.toFixed(2)}g · bok {videoSample.ay.toFixed(2)}g
                      </div>
                    </div>
                  )}
                  <div className="v-sync-row">
                    <span>Wideo pokazuje okrążenie:</span>
                    <select value={syncLap} onChange={(e) => setSyncLap(parseInt(e.target.value))}>
                      {analysis.laps.map((l, i) => (
                        <option key={i} value={i}>
                          L{l.lapNumber} ({formatLapTime(l.timeMs)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="v-anchor"
                    onClick={anchorVideoToLapStart}
                    title="Zapauzuj wideo dokładnie na przecięciu linii startu tego okrążenia, potem kliknij"
                  >
                    ⟳ To jest start okrążenia (ustaw sync)
                  </button>
                  <div className="v-nudge">
                    <button onClick={() => updateVideoOffset(videoOffsetS - 1)}>−1s</button>
                    <button onClick={() => updateVideoOffset(videoOffsetS - 0.1)}>−0.1s</button>
                    <button onClick={() => updateVideoOffset(videoOffsetS + 0.1)}>+0.1s</button>
                    <button onClick={() => updateVideoOffset(videoOffsetS + 1)}>+1s</button>
                  </div>
                  <p className="muted small">
                    Marker jedzie po CAŁEJ sesji (okrążenie po okrążeniu). Wybierz okrążenie, które akurat
                    pokazuje wideo, zapauzuj film <strong>na przecięciu linii startu</strong> i kliknij „ustaw sync".
                    Sprawdź wskaźnik: przy przecięciu linii ma pokazać <strong>0:00.000</strong>. Dostrój ±0.1 s.
                    Offset {videoOffsetS.toFixed(2)} s.
                  </p>
                </div>
              </div>
            )}
            </div>

            {!videoUrl && (
            <div className="scrub">
              <button className="play" onClick={() => setPlaying((p) => !p)}>
                {playing ? '⏸' : '▶'}
              </button>
              <span
                className={'mode-badge' + (focusSeg ? ' analyze' : '')}
                title={
                  focusSeg
                    ? 'Analiza sektora: obie kropki w tym samym punkcie toru; Play przejeżdża sektor od nowa'
                    : 'Wyścig w czasie: kropka tam, gdzie realnie było auto — szybsze wyprzedza'
                }
              >
                {focusSeg ? `📐 ${focusSeg.label}` : '🏁 wyścig'}
              </span>
              <input
                type="range" min={0} max={clockMax} step={0.01}
                value={Math.min(clockMax, cursorT)}
                onChange={(e) => setCursorT(parseFloat(e.target.value))}
              />
              <span className="muted scrub-pct">{formatClock(cursorT * 1000)}</span>
            </div>
            )}

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
                    cursorF={chartF}
                    focus={focusSeg ? [focusSeg.f0, focusSeg.f1] : null}
                    onScrub={scrubF}
                  />
                )}
                {tab === 'delta' &&
                  (lapA && lapB ? (
                    <DeltaChart lapA={lapA} lapB={lapB} cursorF={chartF} onScrub={scrubF} />
                  ) : (
                    <p className="muted pad">Zaznacz 2 okrążenia, aby zobaczyć deltę.</p>
                  ))}
                {tab === 'g' && <GMeter laps={shownLaps} colors={shownColors} cursorFs={cursorFs} />}
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
  isAdmin: boolean
}

function Home({ onFile, reloadToken, onOpen, email, isAdmin }: HomeProps) {
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
            Zaloguj się (e-mail + hasło u góry), aby zapisywać sesje i mieć do nich dostęp z każdego
            urządzenia. Bez logowania możesz analizować pliki lokalnie.
          </p>
        )}
      </div>
      {isAdmin && (
        <div className="home-col home-admin">
          <AdminPanel />
        </div>
      )}
    </div>
  )
}
