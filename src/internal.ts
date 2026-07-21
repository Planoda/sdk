/**
 * Internal helpers shared by resource modules. Not part of the public API.
 */

import type { ListEnvelope } from "./types.js";

/** Build a `?a=1&b=2` query string, skipping `null`/`undefined` values. */
export function toQueryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** The REST API wraps single resources in `{ data: … }`; unwrap to the payload. */
export function unwrapData<T>(body: unknown): T {
  if (isRecord(body) && "data" in body) {
    return body.data as T;
  }
  return body as T;
}

/**
 * The REST API returns lists as `{ data: T[], nextCursor }`; normalize to the
 * ergonomic `{ items, nextCursor }` envelope the SDK exposes.
 */
export function unwrapList<T>(body: unknown): ListEnvelope<T> {
  if (isRecord(body)) {
    const data = body.data;
    const next = body.nextCursor;
    return {
      items: Array.isArray(data) ? (data as T[]) : [],
      nextCursor: typeof next === "string" ? next : undefined,
    };
  }
  return { items: [], nextCursor: undefined };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
