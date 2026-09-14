import { APIProvider } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import type { ServerMessage, Stop, Trip } from '../../../shared/protocol'
import { asRoute, getRoute, getTrip, sortByRank, type Route } from '../api'
import PlaceAutocomplete, { type SelectedPlace } from '../components/PlaceAutocomplete'
import TripMap from '../components/TripMap'
import { useTripSocket } from '../hooks/useTripSocket'

const ROUTE_DEBOUNCE_MS = 500
const METERS_PER_MILE = 1609.344

/** 48280 -> "30.0 mi" */
function formatDistance(meters: number): string {
  return `${(meters / METERS_PER_MILE).toFixed(1)} mi`
}

/** 5400 -> "1 h 30 min" */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`
}

/** Display name per trip. Not auth — just a label so collaborators can tell each other apart. */
const nameKey = (tripId: string) => `tripDisplayName:${tripId}`

// Used in the browser by design — a Maps JS key is public and is secured with HTTP
// referrer + API restrictions in the Cloud console, not by hiding it behind the backend.
const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export default function TripPage() {
  const { id } = useParams<{ id: string }>()

  const [displayName, setDisplayName] = useState(() =>
    id ? (localStorage.getItem(nameKey(id)) ?? '') : '',
  )
  const [nameDraft, setNameDraft] = useState('')

  const [trip, setTrip] = useState<Trip | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapsError, setMapsError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)

  // First paint over plain HTTP, so the page has content before the socket is up.
  useEffect(() => {
    if (!id) return
    setLoading(true)
    getTrip(id)
      .then((detail) => {
        setTrip(detail.trip)
        setStops(sortByRank(detail.stops))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [id])

  /**
   * The server is authoritative: nothing here is applied optimistically. A click sends an
   * intent, and state only changes when the broadcast comes back — which is also why other
   * people's edits arrive through this exact same path.
   */
  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'trip:state':
        setTrip(message.trip)
        setStops(sortByRank(message.stops))
        setUsers(message.users)
        setError(null)
        break
      case 'stop:added':
        setStops((prev) => sortByRank([...prev, message.stop]))
        break
      case 'stop:removed':
        setStops((prev) => prev.filter((s) => s.id !== message.stopId))
        break
      case 'stop:renamed':
        setStops((prev) => prev.map((s) => (s.id === message.stop.id ? message.stop : s)))
        break
      case 'stop:reordered':
        // Only the moved stop's rank changed; re-sorting is what reveals the new order.
        setStops((prev) =>
          sortByRank(prev.map((s) => (s.id === message.stop.id ? message.stop : s))),
        )
        break
      case 'presence:update':
        setUsers(message.users)
        break
      case 'error':
        setError(message.message)
        break
    }
  }, [])

  const { status, send } = useTripSocket(id, displayName, handleMessage)

  // The route depends only on which stops exist and in what order. Renaming leaves this
  // string untouched, so it costs nothing; add/remove/reorder all change it.
  const stopSignature = stops.map((s) => s.id).join(',')
  const stopCount = stops.length

  useEffect(() => {
    if (!id) return
    if (stopCount < 2) {
      setRoute(null)
      setRouteError(null)
      return
    }
    const timer = setTimeout(() => {
      getRoute(id)
        .then((response) => {
          setRoute(asRoute(response))
          setRouteError(null)
        })
        .catch((err: unknown) => {
          setRoute(null)
          setRouteError(err instanceof Error ? err.message : String(err))
        })
    }, ROUTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [id, stopSignature, stopCount])

  /* -------------------------------------------------- intents sent over the websocket */

  const handleSelectPlace = useCallback(
    (place: SelectedPlace) => {
      if (!id) return
      send({
        type: 'stop:add',
        tripId: id,
        name: place.name,
        address: place.address,
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
      })
    },
    [id, send],
  )

  function handleRename(stopId: string, current: string) {
    const next = window.prompt('Rename stop', current)
    if (next === null || !id) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    send({ type: 'stop:rename', tripId: id, stopId, name: trimmed })
  }

  // Moving up means landing between the stop two above and the stop directly above.
  // A missing neighbour is null, which the server reads as "the end of the list".
  function handleMoveUp(list: Stop[], index: number) {
    if (!id) return
    send({
      type: 'stop:reorder',
      tripId: id,
      stopId: list[index].id,
      beforeId: list[index - 2]?.id ?? null,
      afterId: list[index - 1].id,
    })
  }

  function handleMoveDown(list: Stop[], index: number) {
    if (!id) return
    send({
      type: 'stop:reorder',
      tripId: id,
      stopId: list[index].id,
      beforeId: list[index + 1].id,
      afterId: list[index + 2]?.id ?? null,
    })
  }

  /* ------------------------------------------------------------------------ rendering */

  function handleJoin(event: FormEvent) {
    event.preventDefault()
    const trimmed = nameDraft.trim()
    if (!trimmed || !id) return
    localStorage.setItem(nameKey(id), trimmed)
    setDisplayName(trimmed)
  }

  if (loading) {
    return (
      <main>
        <p>Loading trip…</p>
      </main>
    )
  }

  if (!trip) {
    return (
      <main>
        <p role="alert">Could not load this trip — {error ?? 'unknown error'}</p>
        <Link to="/">← Start a new trip</Link>
      </main>
    )
  }

  // Ask who you are before joining the room, so presence has something to show.
  if (!displayName) {
    return (
      <main>
        <h1>{trip.name}</h1>
        <p>Pick a display name so others can see who is editing.</p>
        <form onSubmit={handleJoin}>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Your name"
            autoFocus
          />
          <button type="submit" disabled={nameDraft.trim() === ''}>
            Join trip
          </button>
        </form>
      </main>
    )
  }

  return (
    <main>
      <h1>{trip.name}</h1>
      <p>
        Shareable URL: <code>{window.location.href}</code>
      </p>

      <p>
        {status === 'open' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        {' · '}
        <strong>{users.length}</strong> here: {users.join(', ') || '—'}
        {' · '}you are <strong>{displayName}</strong>
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
          {mapsError ? (
            <p role="alert">{mapsError}</p>
          ) : (
            <TripMap stops={stops} encodedPolyline={route?.encodedPolyline ?? null} />
          )}

          {route && (
            <p>
              Driving route: <strong>{formatDistance(route.distanceMeters)}</strong> ·{' '}
              <strong>{formatDuration(route.durationSeconds)}</strong>
            </p>
          )}
          {routeError && <p role="alert">Could not compute the route — {routeError}</p>}

          <h2>Add a stop</h2>
          <PlaceAutocomplete onSelect={handleSelectPlace} disabled={status !== 'open'} />
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
              <button onClick={() => handleMoveUp(stops, index)} disabled={index === 0}>
                ↑
              </button>
              <button
                onClick={() => handleMoveDown(stops, index)}
                disabled={index === stops.length - 1}
              >
                ↓
              </button>
              <button onClick={() => handleRename(stop.id, stop.name)}>Rename</button>
              <button
                onClick={() => id && send({ type: 'stop:remove', tripId: id, stopId: stop.id })}
              >
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
