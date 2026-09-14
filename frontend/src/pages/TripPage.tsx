import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { APIProvider } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import type { ServerMessage, Stop, Trip } from '../../../shared/protocol'
import { asRoute, getRoute, getTrip, sortStops, type Route } from '../api'
import PlaceAutocomplete, { type SelectedPlace } from '../components/PlaceAutocomplete'
import SortableStop from '../components/SortableStop'
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

/**
 * The local user's in-flight drags.
 *
 * `order` is the id sequence they should SEE right now; `pending` is the set of opIds we
 * are still waiting on. The overlay is dropped only once every pending op has been
 * answered — confirmed or rejected — at which point the authoritative list governs again.
 */
type LocalMoves = { order: string[] | null; pending: string[] }

const NO_MOVES: LocalMoves = { order: null, pending: [] }

/**
 * Lays the local user's predicted order over the server's list.
 *
 * Stops the overlay does not mention (added by someone else mid-drag) keep their
 * authoritative place at the end; stops that vanished (deleted by someone else mid-drag)
 * simply drop out. That is what stops a remote edit from breaking a local drag.
 */
function applyOverlay(authoritative: Stop[], order: string[]): Stop[] {
  const remaining = new Map(authoritative.map((s) => [s.id, s]))
  const result: Stop[] = []
  for (const id of order) {
    const stop = remaining.get(id)
    if (stop) {
      result.push(stop)
      remaining.delete(id)
    }
  }
  for (const stop of authoritative) if (remaining.has(stop.id)) result.push(stop)
  return result
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>()

  const [displayName, setDisplayName] = useState(() =>
    id ? (localStorage.getItem(nameKey(id)) ?? '') : '',
  )
  const [nameDraft, setNameDraft] = useState('')

  const [trip, setTrip] = useState<Trip | null>(null)
  /** The server's truth. Updated by every broadcast, including other people's, always. */
  const [authoritative, setAuthoritative] = useState<Stop[]>([])
  const [local, setLocal] = useState<LocalMoves>(NO_MOVES)
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
        setAuthoritative(sortStops(detail.stops))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [id])

  /**
   * Server messages only ever touch the authoritative layer. The optimistic overlay is
   * cleared by opId correlation, never by guessing from the content of a broadcast.
   */
  const handleMessage = useCallback((message: ServerMessage) => {
    /** Drop one answered op; when none are left the overlay goes with it. */
    const settle = (opId?: string) => {
      if (!opId) return
      setLocal((prev) => {
        if (!prev.pending.includes(opId)) return prev
        const pending = prev.pending.filter((x) => x !== opId)
        return pending.length > 0 ? { order: prev.order, pending } : NO_MOVES
      })
    }

    switch (message.type) {
      case 'trip:state':
        setTrip(message.trip)
        setAuthoritative(sortStops(message.stops))
        setUsers(message.users)
        // A fresh snapshot (first join or a reconnect) supersedes any local guess.
        setLocal(NO_MOVES)
        setError(null)
        break
      case 'stop:added':
        setAuthoritative((prev) => sortStops([...prev, message.stop]))
        break
      case 'stop:removed':
        setAuthoritative((prev) => prev.filter((s) => s.id !== message.stopId))
        break
      case 'stop:renamed':
        setAuthoritative((prev) => prev.map((s) => (s.id === message.stop.id ? message.stop : s)))
        break
      case 'stop:reordered':
        setAuthoritative((prev) =>
          sortStops(prev.map((s) => (s.id === message.stop.id ? message.stop : s))),
        )
        // Ours: stop predicting. Someone else's: no opId match, overlay untouched.
        settle(message.opId)
        break
      case 'presence:update':
        setUsers(message.users)
        break
      case 'error':
        setError(message.message)
        // A rejected drag rolls back: the overlay is dropped and the list snaps to truth.
        settle(message.opId)
        break
    }
  }, [])

  const { status, send } = useTripSocket(id, displayName, handleMessage)

  /** What the user actually sees: truth, with their own in-flight prediction on top. */
  const displayed = useMemo(
    () =>
      local.order && local.pending.length > 0
        ? applyOverlay(authoritative, local.order)
        : authoritative,
    [authoritative, local],
  )

  // Deliberately keyed on AUTHORITATIVE order, not the displayed one: an optimistic frame
  // must not trigger a billable Routes API call. The route settles once the server agrees.
  const authoritativeSignature = authoritative.map((s) => s.id).join(',')
  const stopCount = authoritative.length

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
  }, [id, authoritativeSignature, stopCount])

  /* -------------------------------------------------- intents sent over the websocket */

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !id) return

    const from = displayed.findIndex((s) => s.id === active.id)
    const to = displayed.findIndex((s) => s.id === over.id)
    if (from === -1 || to === -1) return

    // 1. Predict: redraw immediately so the drag feels instant.
    const next = arrayMove(displayed, from, to)
    const opId = crypto.randomUUID()
    setLocal((prev) => ({ order: next.map((s) => s.id), pending: [...prev.pending, opId] }))

    // 2. Send the intent, described by neighbours rather than an index, so the server can
    //    still place it sensibly if the list moved under us in the meantime.
    send({
      type: 'stop:reorder',
      tripId: id,
      stopId: String(active.id),
      beforeId: next[to - 1]?.id ?? null,
      afterId: next[to + 1]?.id ?? null,
      opId,
    })
    // 3. Reconcile happens in handleMessage, keyed on that opId.
  }

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

  function handleDelete(stopId: string) {
    if (!id) return
    send({ type: 'stop:remove', tripId: id, stopId })
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
        {local.pending.length > 0 && ' · saving…'}
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
            <TripMap stops={displayed} encodedPolyline={route?.encodedPolyline ?? null} />
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
      {displayed.length === 0 ? (
        <p>No stops yet. Search for a place above.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayed.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol style={{ paddingLeft: 0 }}>
              {displayed.map((stop, index) => (
                <SortableStop
                  key={stop.id}
                  stop={stop}
                  position={index + 1}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <p>
        <Link to="/">← Start a new trip</Link>
      </p>
    </main>
  )
}
