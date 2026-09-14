// The wire types come from shared/ so client and server cannot drift apart.
import type { Stop, Trip } from '../../shared/protocol'

export type { Stop, Trip }

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type TripDetail = { trip: Trip; stops: Stop[] }

/**
 * One place where every request is shaped and every failure is turned into an Error.
 * The <T> is a promise from us to the caller, not a runtime check — the server could
 * return anything and TypeScript would never know.
 *
 * Stop mutations are NOT here any more: since milestone 5 they travel over the
 * websocket. What remains is trip creation, first paint, and routing.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    // Only declare a JSON content type when there actually is a body. On a bodyless GET or
    // DELETE it is not a CORS-safelisted header, so sending it anyway forces the browser
    // into an extra OPTIONS preflight round trip before every read.
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const createTrip = (name: string) =>
  request<Trip>('/api/trips', { method: 'POST', body: JSON.stringify({ name }) })

export const getTrip = (tripId: string) => request<TripDetail>(`/api/trips/${tripId}`)

/** Either there is nothing to draw, or a full route. */
export type RouteResponse =
  | { route: null }
  | { encodedPolyline: string; distanceMeters: number; durationSeconds: number }

export type Route = Exclude<RouteResponse, { route: null }>

export const getRoute = (tripId: string) => request<RouteResponse>(`/api/trips/${tripId}/route`)

/** Narrows the two-shaped response to "a route I can draw", or null. */
export function asRoute(response: RouteResponse): Route | null {
  return 'encodedPolyline' in response ? response : null
}

/** Stops must always be displayed in rank order, never arrival order. */
export function sortByRank(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
}
