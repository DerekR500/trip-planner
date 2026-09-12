/**
 * Minimal client for the Google Routes API (Compute Routes).
 *
 * This runs server-side ONLY. GOOGLE_ROUTES_API_KEY must never reach the browser —
 * it has no VITE_ prefix and is never included in any response body.
 *
 * google.maps.DirectionsService / DirectionsRenderer / DistanceMatrixService are
 * deliberately not used: they were deprecated on 25 February 2026 and this is a new
 * project, so the Routes API is the supported path.
 */

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Only these three fields are requested — the field mask is what you are billed on. */
const FIELD_MASK = "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration";

/** Routes API allows at most 25 intermediate waypoints per request. */
export const MAX_INTERMEDIATES = 25;

export type RoutePoint = { latitude: number; longitude: number };

export type ComputedRoute = {
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
};

/** Thrown for anything the caller should surface as a 502 rather than a crash. */
export class RoutesApiError extends Error {}

const waypoint = (p: RoutePoint) => ({ location: { latLng: p } });

/** "1234s" -> 1234. The Routes API returns duration as a protobuf duration string. */
function parseDurationSeconds(duration: unknown): number {
  if (typeof duration !== "string") return 0;
  const parsed = Number.parseInt(duration.replace(/s$/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Computes a driving route through `points` in the order given: first is the origin,
 * last is the destination, everything between is an intermediate waypoint.
 */
export async function computeRoute(points: RoutePoint[]): Promise<ComputedRoute> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    throw new RoutesApiError(
      "GOOGLE_ROUTES_API_KEY is not set. Add it to backend/.env — see the README.",
    );
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediates = points.slice(1, -1);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: waypoint(origin),
        destination: waypoint(destination),
        intermediates: intermediates.map(waypoint),
        travelMode: "DRIVE",
        polylineEncoding: "ENCODED_POLYLINE",
      }),
    });
  } catch (err: unknown) {
    // Network-level failure (DNS, offline, timeout) — never reaches Google.
    throw new RoutesApiError(
      `Could not reach the Routes API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    // Google's error body carries the useful detail, but it can echo the request —
    // take only the message so the key can never be reflected back to a client.
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new RoutesApiError(
      `Routes API returned ${response.status}: ${body?.error?.message ?? "unknown error"}`,
    );
  }

  const data = (await response.json()) as {
    routes?: {
      polyline?: { encodedPolyline?: string };
      distanceMeters?: number;
      duration?: string;
    }[];
  };

  const route = data.routes?.[0];
  if (!route?.polyline?.encodedPolyline) {
    // A 200 with no routes means Google found no drivable path (e.g. across an ocean).
    throw new RoutesApiError("No drivable route exists between these stops.");
  }

  return {
    encodedPolyline: route.polyline.encodedPolyline,
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(route.duration),
  };
}
