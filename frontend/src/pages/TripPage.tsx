import { APIProvider } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  addStop,
  deleteStop,
  getTrip,
  renameStop,
  reorderStop,
  type Stop,
  type TripDetail,
} from '../api'
import PlaceAutocomplete, { type SelectedPlace } from '../components/PlaceAutocomplete'
import TripMap from '../components/TripMap'

// Used in the browser by design — a Maps JS key is public and is secured with HTTP
// referrer + API restrictions in the Cloud console, not by hiding it behind the backend.
const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export default function TripPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<TripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapsError, setMapsError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    setData(await getTrip(id))
  }, [id])

  useEffect(() => {
    setLoading(true)
    refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [refresh])

  /** Every mutation: run it, re-fetch so the order is the server's, surface failures. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        await refresh()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  // Handed straight to the add-stop endpoint: the Places fields were already mapped to
  // name/address/placeId/lat/lng by the autocomplete wrapper.
  const handleSelectPlace = useCallback(
    (place: SelectedPlace) => {
      if (!id) return
      void run(() => addStop(id, place))
    },
    [id, run],
  )

  function handleRename(stopId: string, current: string) {
    const next = window.prompt('Rename stop', current)
    if (next === null) return // cancelled
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    void run(() => renameStop(stopId, trimmed))
  }

  // Moving up means landing between the stop two above and the stop directly above.
  // A missing neighbour is null, which the API reads as "the end of the list".
  function handleMoveUp(list: Stop[], index: number) {
    void run(() => reorderStop(list[index].id, list[index - 2]?.id ?? null, list[index - 1].id))
  }

  function handleMoveDown(list: Stop[], index: number) {
    void run(() => reorderStop(list[index].id, list[index + 1].id, list[index + 2]?.id ?? null))
  }

  if (loading) {
    return (
      <main>
        <p>Loading trip…</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main>
        <p role="alert">Could not load this trip — {error ?? 'unknown error'}</p>
        <Link to="/">← Start a new trip</Link>
      </main>
    )
  }

  const { trip, stops } = data

  return (
    <main>
      <h1>{trip.name}</h1>
      <p>
        Shareable URL: <code>{window.location.href}</code>
      </p>

      {error && <p role="alert">Something went wrong — {error}</p>}

      {/* One APIProvider for the whole page: the map and the place search share this
          single script load and single API key. A second loader would trigger Google's
          "included multiple times" warning. */}
      {MAPS_API_KEY ? (
        <APIProvider
          apiKey={MAPS_API_KEY}
          onError={() =>
            setMapsError('Google Maps failed to load. Check the API key and its restrictions.')
          }
        >
          {mapsError ? <p role="alert">{mapsError}</p> : <TripMap stops={stops} />}

          <h2>Add a stop</h2>
          <PlaceAutocomplete onSelect={handleSelectPlace} disabled={busy} />
        </APIProvider>
      ) : (
        <p role="alert">
          VITE_GOOGLE_MAPS_API_KEY is not set, so the map and place search are unavailable.
          See the README for Cloud console setup.
        </p>
      )}

      <h2>Stops</h2>
      {stops.length === 0 ? (
        <p>No stops yet. Search for a place above.</p>
      ) : (
        <ol>
          {stops.map((stop, index) => (
            <li key={stop.id}>
              {stop.name}
              {stop.address && <span> — {stop.address}</span>}{' '}
              <button onClick={() => handleMoveUp(stops, index)} disabled={busy || index === 0}>
                ↑
              </button>
              <button
                onClick={() => handleMoveDown(stops, index)}
                disabled={busy || index === stops.length - 1}
              >
                ↓
              </button>
              <button onClick={() => handleRename(stop.id, stop.name)} disabled={busy}>
                Rename
              </button>
              <button onClick={() => void run(() => deleteStop(stop.id))} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
        </ol>
      )}

      <p>
        <Link to="/">← Start a new trip</Link>
      </p>
    </main>
  )
}
