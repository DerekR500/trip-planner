const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type Trip = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Stop = {
  id: string;
  tripId: string;
  name: string;
  address: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  rank: string;
  createdAt: string;
  updatedAt: string;
};

export type TripDetail = { trip: Trip; stops: Stop[] };

/**
 * One place where every request is shaped and every failure is turned into an Error.
 * The <T> is a promise from us to the caller, not a runtime check — the server could
 * return anything and TypeScript would never know.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    // Only declare a JSON content type when there actually is a body. On a bodyless GET or
    // DELETE it is not a CORS-safelisted header, so sending it anyway forces the browser
    // into an extra OPTIONS preflight round trip before every read.
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }

  // DELETE answers 204 with no body, so there is nothing to parse.
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const createTrip = (name: string) =>
  request<Trip>("/api/trips", { method: "POST", body: JSON.stringify({ name }) });

export const getTrip = (tripId: string) => request<TripDetail>(`/api/trips/${tripId}`);

/** What the Places selection gives us, and exactly what the add-stop endpoint wants. */
export type NewStopInput = {
  name: string;
  address: string | null;
  placeId: string;
  lat: number;
  lng: number;
};

export const addStop = (tripId: string, stop: NewStopInput) =>
  request<Stop>(`/api/trips/${tripId}/stops`, {
    method: "POST",
    body: JSON.stringify(stop),
  });

export const renameStop = (stopId: string, name: string) =>
  request<Stop>(`/api/stops/${stopId}`, { method: "PATCH", body: JSON.stringify({ name }) });

export const deleteStop = (stopId: string) =>
  request<void>(`/api/stops/${stopId}`, { method: "DELETE" });

/** beforeId ends up directly above the moved stop, afterId directly below. */
export const reorderStop = (stopId: string, beforeId: string | null, afterId: string | null) =>
  request<Stop>(`/api/stops/${stopId}/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ beforeId, afterId }),
  });

/** Either there is nothing to draw, or a full route. */
export type RouteResponse =
  | { route: null }
  | { encodedPolyline: string; distanceMeters: number; durationSeconds: number };

export type Route = Exclude<RouteResponse, { route: null }>;

export const getRoute = (tripId: string) =>
  request<RouteResponse>(`/api/trips/${tripId}/route`);

/** Narrows the two-shaped response to "a route I can draw", or null. */
export function asRoute(response: RouteResponse): Route | null {
  return "encodedPolyline" in response ? response : null;
}
