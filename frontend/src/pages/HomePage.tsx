import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { createTrip } from '../api'

export default function HomePage() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    // Without this the browser reloads the page on submit and loses everything.
    event.preventDefault()

    const trimmed = name.trim()
    if (!trimmed) return

    setBusy(true)
    setError(null)
    try {
      const trip = await createTrip(trimmed)
      navigate(`/trip/${trip.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>Trip Planner</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trip name"
          disabled={busy}
        />
        <button type="submit" disabled={busy || name.trim() === ''}>
          {busy ? 'Creating…' : 'Create trip'}
        </button>
      </form>

      {error && <p role="alert">Could not create the trip — {error}</p>}
    </main>
  )
}
