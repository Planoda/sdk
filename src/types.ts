/**
 * Shared types used across resource modules and the transport.
 *
 * List endpoints return the cursor-paginated `{ items, nextCursor }` envelope.
 * The wire format from the REST API is `{ data, nextCursor }`; resource methods
 * normalize `data` → `items` so callers get the ergonomic shape the docs promise.
 */

/** Opaque cursor token returned by list endpoints. `undefined` means no further pages. */
export type PageCursor = string | undefined;

/** Standard cursor-paginated list envelope returned by every `list()` method. */
export interface ListEnvelope<T> {
  items: T[];
  nextCursor?: PageCursor;
}

/** Per-call options accepted by every resource method. */
export interface RequestOptions {
  /** Extra headers merged with the client defaults. */
  headers?: Record<string, string>;
  /**
   * Deduplicate a mutation: sent as the `Idempotency-Key` header so the server
   * collapses safe retries of the same `POST` into a single effect (24 h window).
   */
  idempotencyKey?: string;
  /** Disable retry policy for this call (still throws on terminal errors). */
  retry?: boolean;
  /** Abort the in-flight request. */
  signal?: AbortSignal;
  /** Abort the request after this many milliseconds (composed with `signal`). */
  timeoutMs?: number;
}
