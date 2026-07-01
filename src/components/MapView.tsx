import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AnyLap, Offset } from '../lib/analysis'
import { lapColor, lapCoords, lapSpeeds, cursorAt, speedRange } from '../lib/analysis'
import { bounds } from '../lib/geo'

const SAT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export type ColorMode = 'lap' | 'speed'

interface Props {
  laps: AnyLap[]
  cursorF: number
  offset: Offset
  colorMode: ColorMode
  fitToken: number // zmiana => wywołaj fitBounds
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: [SAT_TILES],
      tileSize: 256,
      attribution: 'Tiles © Esri — World Imagery',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
}

/** Buduje FeatureCollection segmentów (2-pkt) z property v (prędkość). */
function segmentsFC(lap: AnyLap, offset: Offset): GeoJSON.FeatureCollection {
  const coords = lapCoords(lap, offset)
  const speeds = lapSpeeds(lap)
  const features: GeoJSON.Feature[] = []
  for (let i = 1; i < coords.length; i++) {
    features.push({
      type: 'Feature',
      properties: { v: (speeds[i - 1] + speeds[i]) / 2 },
      geometry: { type: 'LineString', coordinates: [coords[i - 1], coords[i]] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export default function MapView({ laps, cursorF, offset, colorMode, fitToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)

  // init
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [16.8213, 52.4237],
      zoom: 14,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('load', () => {
      readyRef.current = true
      renderLaps()
      fit()
    })
    mapRef.current = map

    // Kluczowe dla responsywności: gdy kontener zmienia rozmiar (dodanie okrążeń,
    // zmiana układu, rotacja) — przelicz rozmiar canvasu, inaczej mapa "znika".
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // przerysuj linie okrążeń
  function renderLaps() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const [vmin, vmax] = speedRange(laps)
    const wantIds = new Set(laps.map((_, i) => `lap-${i}`))

    // usuń nieużywane
    const style = map.getStyle()
    for (const layer of style.layers ?? []) {
      if (layer.id.startsWith('lap-') && !wantIds.has(layer.id)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      }
    }
    for (const srcId of Object.keys(style.sources ?? {})) {
      if (srcId.startsWith('lap-') && !wantIds.has(srcId)) {
        if (map.getSource(srcId)) map.removeSource(srcId)
      }
    }

    laps.forEach((lap, i) => {
      const id = `lap-${i}`
      const data = segmentsFC(lap, offset)
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (src) {
        src.setData(data)
      } else {
        map.addSource(id, { type: 'geojson', data })
        map.addLayer({
          id,
          type: 'line',
          source: id,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 3 },
        })
      }
      const color =
        colorMode === 'speed'
          ? ([
              'interpolate',
              ['linear'],
              ['get', 'v'],
              vmin, '#2b83ba',
              (vmin + vmax) / 2, '#ffffbf',
              vmax, '#d7191c',
            ] as unknown as maplibregl.ExpressionSpecification)
          : lapColor(lap, i)
      map.setPaintProperty(id, 'line-color', color)
    })

    renderCursor()
  }

  // kursor: punkt per okrążenie
  function renderCursor() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const features: GeoJSON.Feature[] = laps.map((lap, i) => {
      const p = cursorAt(lap, cursorF, offset)
      return {
        type: 'Feature',
        properties: { color: lapColor(lap, i) },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }
    })
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    const src = map.getSource('cursor') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(data)
    } else {
      map.addSource('cursor', { type: 'geojson', data })
      map.addLayer({
        id: 'cursor',
        type: 'circle',
        source: 'cursor',
        paint: {
          'circle-radius': 7,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000',
        },
      })
    }
  }

  function fit() {
    const map = mapRef.current
    if (!map || !readyRef.current || laps.length === 0) return
    const [minLon, minLat, maxLon, maxLat] = bounds(laps)
    if (!Number.isFinite(minLon)) return
    map.fitBounds(
      [
        [minLon + offset.dLon, minLat + offset.dLat],
        [maxLon + offset.dLon, maxLat + offset.dLat],
      ],
      { padding: 40, duration: 600 },
    )
  }

  useEffect(() => {
    renderLaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps, colorMode, offset.dLat, offset.dLon])

  useEffect(() => {
    renderCursor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorF])

  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken])

  return <div ref={containerRef} className="map" />
}
