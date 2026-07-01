import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AnyLap, Offset } from '../lib/analysis'
import { lapCoords, lapSpeeds, lapNd, cursorAt, speedRange } from '../lib/analysis'
import type { Segment } from '../lib/segments'
import { segmentColor } from '../lib/segments'
import { bounds } from '../lib/geo'

const SAT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export type ColorMode = 'lap' | 'speed' | 'sector'

interface Props {
  laps: AnyLap[]
  colors: string[]
  cursorF: number
  offset: Offset
  colorMode: ColorMode
  segments: Segment[]
  follow: boolean
  focus: [number, number] | null
  fitToken: number
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

function segIndexAt(segments: Segment[], f: number): number {
  for (let i = 0; i < segments.length; i++) {
    if (f >= segments[i].f0 && f < segments[i].f1) return i
  }
  return Math.max(0, segments.length - 1)
}

function segmentsFC(
  lap: AnyLap,
  offset: Offset,
  segments: Segment[],
  focus: [number, number] | null,
): GeoJSON.FeatureCollection {
  const coords = lapCoords(lap, offset)
  const speeds = lapSpeeds(lap)
  const nd = lapNd(lap)
  const features: GeoJSON.Feature[] = []
  for (let i = 1; i < coords.length; i++) {
    const midNd = (nd[i - 1] + nd[i]) / 2
    const inFocus = focus ? midNd >= focus[0] && midNd <= focus[1] : true
    features.push({
      type: 'Feature',
      properties: {
        v: (speeds[i - 1] + speeds[i]) / 2,
        seg: segments.length ? segIndexAt(segments, midNd) : 0,
        inFocus: inFocus ? 1 : 0,
      },
      geometry: { type: 'LineString', coordinates: [coords[i - 1], coords[i]] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export default function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const stateRef = useRef(props)
  stateRef.current = props

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

  function colorExpr(): maplibregl.ExpressionSpecification | string {
    const { laps: L, colorMode: cm, segments } = stateRef.current
    if (cm === 'speed') {
      const [vmin, vmax] = speedRange(L)
      return [
        'interpolate', ['linear'], ['get', 'v'],
        vmin, '#2b83ba', (vmin + vmax) / 2, '#ffffbf', vmax, '#d7191c',
      ] as unknown as maplibregl.ExpressionSpecification
    }
    if (cm === 'sector') {
      const match: unknown[] = ['match', ['get', 'seg']]
      segments.forEach((_s, i) => match.push(i, segmentColor(i)))
      match.push('#888')
      return match as unknown as maplibregl.ExpressionSpecification
    }
    return '#4aa3ff'
  }

  function renderLaps() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { laps: L, colors, offset: off, colorMode: cm, segments, focus } = stateRef.current
    const wantIds = new Set(L.map((_, i) => `lap-${i}`))

    const style = map.getStyle()
    for (const layer of style.layers ?? []) {
      if (layer.id.startsWith('lap-') && !wantIds.has(layer.id) && map.getLayer(layer.id)) {
        map.removeLayer(layer.id)
      }
    }
    for (const srcId of Object.keys(style.sources ?? {})) {
      if (srcId.startsWith('lap-') && !wantIds.has(srcId) && map.getSource(srcId)) {
        map.removeSource(srcId)
      }
    }

    L.forEach((lap, i) => {
      const id = `lap-${i}`
      const data = segmentsFC(lap, off, segments, focus)
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(data)
      else {
        map.addSource(id, { type: 'geojson', data })
        map.addLayer({
          id,
          type: 'line',
          source: id,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 3 },
        })
      }
      const color = cm === 'lap' ? colors[i] || '#4aa3ff' : colorExpr()
      map.setPaintProperty(id, 'line-color', color)
      // wyszarzenie fragmentów poza zaznaczonym sektorem/zakrętem
      map.setPaintProperty(
        id,
        'line-opacity',
        (focus
          ? ['case', ['==', ['get', 'inFocus'], 1], 1, 0.12]
          : 1) as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>,
      )
      map.setPaintProperty(
        id,
        'line-width',
        (focus
          ? ['case', ['==', ['get', 'inFocus'], 1], 5, 2]
          : 3) as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>,
      )
    })

    renderCursor()
  }

  function renderCursor() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { laps: L, colors, cursorF: cf, offset: off, follow: fol } = stateRef.current
    const features: GeoJSON.Feature[] = L.map((lap, i) => {
      const p = cursorAt(lap, cf, off)
      return {
        type: 'Feature',
        properties: { color: colors[i] || '#4aa3ff' },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }
    })
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    const src = map.getSource('cursor') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
    else {
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

    if (fol && L.length > 0) {
      const p = cursorAt(L[0], cf, off)
      map.setCenter([p.lon, p.lat])
    }
  }

  function fit() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { laps: L, offset: off, focus: foc } = stateRef.current
    if (L.length === 0) return
    let bb: [number, number, number, number]
    if (foc) bb = rangeBounds(L[0], off, foc)
    else {
      const [minLon, minLat, maxLon, maxLat] = bounds(L)
      bb = [minLon + off.dLon, minLat + off.dLat, maxLon + off.dLon, maxLat + off.dLat]
    }
    if (!Number.isFinite(bb[0])) return
    map.fitBounds(
      [
        [bb[0], bb[1]],
        [bb[2], bb[3]],
      ],
      { padding: foc ? 90 : 40, duration: 600 },
    )
  }

  useEffect(() => {
    renderLaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.laps, props.colors, props.colorMode, props.offset.dLat, props.offset.dLon, props.segments, props.focus])

  useEffect(() => {
    renderCursor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cursorF, props.follow])

  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitToken, props.focus])

  return <div ref={containerRef} className="map" />
}

function rangeBounds(
  lap: AnyLap,
  offset: Offset,
  range: [number, number],
): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  const steps = 60
  for (let k = 0; k <= steps; k++) {
    const f = range[0] + ((range[1] - range[0]) * k) / steps
    const p = cursorAt(lap, f, offset)
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return [minLon, minLat, maxLon, maxLat]
}
