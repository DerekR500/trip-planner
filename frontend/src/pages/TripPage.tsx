import { useCallback, useEffect, useState, type FormEvent } from 'react'
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

export default function TripPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<TripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newStopName, setNewStopName] = useState('')

  // useCallback keeps this the same function between renders, so the effect below
  // doesn't re-run on every render.
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
  async function run(action: () => Promise<unknown>) {
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
  }

  function handleAddStop(event: FormEvent) {
    event.preventDefault()
    const trimmed = newStopName.trim()
    if (!trimmed || !id) return
    void run(async () => {
      await addStop(id, trimmed)
      setNewStopName('')
    })
  }

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

      {stops.length === 0 ? (
        <p>No stops yet.</p>
      ) : (
        <ol>
          {stops.map((stop, index) => (
            <li key={stop.id}>
              {stop.name}{' '}
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

      <form onSubmit={handleAddStop}>
        <input
          value={newStopName}
          onChange={(e) => setNewStopName(e.target.value)}
          placeholder="Add a stop"
          disabled={busy}
        />
        <button type="submit" disabled={busy || newStopName.trim() === ''}>
          Add stop
        </button>
      </form>

      <p>
        <Link to="/">← Start a new trip</Link>
      </p>
    </main>
  )
}
