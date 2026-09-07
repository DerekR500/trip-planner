import { useEffect, useState } from 'react'

// Vite inlines VITE_* vars at build time; the fallback keeps `npm run dev` working
// with no .env file present.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type Health = { server: string; db: string }

type State =
  | { status: 'loading' }
  | { status: 'loaded'; health: Health }
  | { status: 'failed'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    fetch(`${API_URL}/health`)
      // The backend answers 503 with a real body when the DB is down, so read the
      // JSON either way and let the values speak for themselves.
      .then((res) => res.json() as Promise<Health>)
      .then((health) => setState({ status: 'loaded', health }))
      .catch((err: unknown) =>
        setState({ status: 'failed', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  return (
    <main>
      <h1>Trip Planner — connectivity check</h1>
      <p>API: {API_URL}</p>

      {state.status === 'loading' && <p>Checking…</p>}

      {state.status === 'loaded' && (
        <p>
          Backend: {state.health.server} / Database: {state.health.db}
        </p>
      )}

      {state.status === 'failed' && (
        <p>Could not reach the backend at {API_URL} — {state.message}</p>
      )}
    </main>
  )
}
