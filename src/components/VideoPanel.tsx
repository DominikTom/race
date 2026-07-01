import { useEffect, useRef } from 'react'

interface Props {
  url: string
  /** Zgłasza bieżący czas wideo [s] — źródło zegara nadrzędnego. */
  onTime: (currentSec: number) => void
  onClose: () => void
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (h: number) => void
}

/** Odtwarzacz lokalnego wideo (bez uploadu). Emituje currentTime klatka-po-klatce. */
export default function VideoPanel({ url, onTime, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  const onTimeRef = useRef(onTime)
  onTimeRef.current = onTime

  useEffect(() => {
    const video = ref.current as RVFCVideo | null
    if (!video) return
    let rvfc = 0
    let raf = 0
    const emit = () => onTimeRef.current(video.currentTime)
    const hasRVFC = typeof video.requestVideoFrameCallback === 'function'
    const rvfcLoop = () => {
      emit()
      rvfc = video.requestVideoFrameCallback!(rvfcLoop)
    }
    const rafLoop = () => {
      emit()
      raf = requestAnimationFrame(rafLoop)
    }
    if (hasRVFC) rvfc = video.requestVideoFrameCallback!(rvfcLoop)
    else raf = requestAnimationFrame(rafLoop)
    // rVFC nie odpala w pauzie — łap też seek/timeupdate (scrub, klatka po pauzie)
    const onSeek = () => emit()
    video.addEventListener('seeked', onSeek)
    video.addEventListener('timeupdate', onSeek)
    return () => {
      video.removeEventListener('seeked', onSeek)
      video.removeEventListener('timeupdate', onSeek)
      if (hasRVFC && rvfc) video.cancelVideoFrameCallback?.(rvfc)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [url])

  return (
    <div className="video-panel">
      <div className="video-head">
        <span className="muted small">Wideo (lokalne, w przeglądarce)</span>
        <button onClick={onClose}>✕ zamknij</button>
      </div>
      <video ref={ref} src={url} controls playsInline className="video-el" />
    </div>
  )
}
