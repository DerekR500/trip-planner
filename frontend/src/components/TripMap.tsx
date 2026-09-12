import { AdvancedMarker, Map, Pin, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo } from 'react'

import type { Stop } from '../api'

const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined

// Shown before any stop has coordinates: a wide world view rather than a random city.
const DEFAULT_CENTER = { lat: 20, lng: 0 }
const DEFAULT_ZOOM = 2
const SINGLE_STOP_ZOOM = 13

/** A stop we can actually place on the map. */
type LocatedStop = Stop & { latitude: number; longitude: number }

function hasCoordinates(stop: Stop): stop is LocatedStop {
  return stop.latitude !== null && stop.longitude !== null
}

/**
 * Pans/zooms the map to show every stop. Lives inside <Map> because useMap() reads the
 * map instance from that context.
 */
function FitBounds({ stops }: { stops: LocatedStop[] }) {
  const map = useMap()

  // The array identity changes on every parent render, so the effect keys off a string
  // of the actual coordinates instead — otherwise the map would re-fit constantly and
  // fight the user's own panning.
  const signature = stops.map((s) => `${s.id}:${s.latitude},${s.longitude}`).join('|')

  useEffect(() => {
    if (!map || stops.length === 0) return

    if (stops.length === 1) {
      map.setCenter({ lat: stops[0].latitude, lng: stops[0].longitude })
      map.setZoom(SINGLE_STOP_ZOOM)
      return
    }

    const bounds = new google.maps.LatLngBounds()
    for (const stop of stops) {
      bounds.extend({ lat: stop.latitude, lng: stop.longitude })
    }
    map.fitBounds(bounds, 64)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature covers `stops`
  }, [map, signature])

  return null
}

export default function TripMap({ stops }: { stops: Stop[] }) {
  const located = useMemo(() => stops.filter(hasCoordinates), [stops])

  if (!MAP_ID) {
    return (
      <p role="alert">
        VITE_GOOGLE_MAPS_MAP_ID is not set, so markers cannot render. See the README.
      </p>
    )
  }

  return (
    <div style={{ width: '100%', height: 400 }}>
      <Map
        mapId={MAP_ID}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        {located.map((stop, index) => (
          <AdvancedMarker
            key={stop.id}
            position={{ lat: stop.latitude, lng: stop.longitude }}
            title={stop.name}
          >
            {/* The number is the stop's position in the list, so a reorder is visible
                on the map and not just in the list below it. */}
            <Pin glyph={String(index + 1)} />
          </AdvancedMarker>
        ))}
        <FitBounds stops={located} />
      </Map>
    </div>
  )
}
