const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards every :id path param. Postgres rejects a malformed uuid with a driver error,
 * which would surface as a 500 — checking first lets us answer 400 instead.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Trims a name from a request body. Returns null when it is missing or unusable. */
export function parseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

/**
 * A latitude or longitude from a request body. Rejects NaN/Infinity (which survive
 * JSON.parse as numbers) and anything outside the valid range.
 */
export function parseCoordinate(value: unknown, limit: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < -limit || value > limit) return null;
  return value;
}

/** Optional free text (address, place id). Absent or unusable becomes null, not an error. */
export function parseOptionalText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}
