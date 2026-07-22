/**
 * Transport layer for `@planoda/sdk`.
 *
 * `PlanodaClient` is a thin wrapper around `fetch` that:
 *   - injects the configured auth header on every request,
 *   - parses JSON bodies (tolerating empty `204 No Content` responses),
 *   - classifies error statuses into the typed `PlanodaError` hierarchy,
 *   - retries on `429 Too Many Requests` (honouring `Retry-After`) and on
 *     transient `502/503/504` for idempotent verbs, with exponential backoff
 *     (capped at 30 s) and a configurable max attempt count,
 *   - supports per-call idempotency keys and request timeouts,
 *   - exposes fluent resource namespaces (`client.issues`, `client.customerRequests`).
 *
 * The `fetch` implementation is injectable via {@link PlanodaClientConfig.fetch}
 * so tests can drive the client with a mock without monkey-patching globals.
 */

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
  PlanodaError,
  RateLimitError,
  ServerError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";
import { comments } from "./resources/comments.js";
import { customerRequests } from "./resources/customer-requests.js";
import { issues } from "./resources/issues.js";
import { projects } from "./resources/projects.js";
import type { RequestOptions } from "./types.js";

export type PlanodaAuth =
  | { kind: "bearer"; token: string }
  | { kind: "apiKey"; key: string };

export interface PlanodaClientConfig {
  auth: PlanodaAuth;
  /**
   * API base URL, no trailing slash. Defaults to the production endpoint
   * (`https://planoda.com/api`). Resource paths append `/v1/...`.
   */
  baseUrl?: string;
  /** Injection seam for tests — defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Base backoff in milliseconds for the first retry. Defaults to 200 ms. */
  initialBackoffMs?: number;
  /** Maximum retry attempts for `429`/transient `5xx`. Defaults to 5. */
  maxRetries?: number;
  /**
   * Sleep function — exposed so tests can avoid real timers.
   * Defaults to `setTimeout`-based promise.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Sent as `User-Agent`. Defaults to `@planoda/sdk/<version>`. */
  userAgent?: string;
}

const DEFAULT_BASE_URL = "https://planoda.com/api";
const DEFAULT_USER_AGENT = "@planoda/sdk/0.1.2";
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 200;
const MAX_BACKOFF_MS = 30_000;

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Verbs safe to retry on a transient 5xx (no at-most-once side effect). */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(["GET", "PUT", "DELETE"]);
const RETRYABLE_SERVER_STATUS = new Set([502, 503, 504]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PlanodaClient {
  readonly baseUrl: string;
  private readonly auth: PlanodaAuth;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  #issues?: ReturnType<typeof issues>;
  #customerRequests?: ReturnType<typeof customerRequests>;
  #comments?: ReturnType<typeof comments>;
  #projects?: ReturnType<typeof projects>;

  constructor(config: PlanodaClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.auth = config.auth;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    // Bind to globalThis so a runtime-provided `fetch` keeps its receiver.
    this.fetchImpl = (config.fetch ?? globalThis.fetch).bind(globalThis);
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs =
      config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.sleep = config.sleep ?? defaultSleep;
  }

  /** Fluent `issues` namespace (`client.issues.list/get/create/update/delete/listAll`). */
  get issues() {
    this.#issues ??= issues(this);
    return this.#issues;
  }

  /** Fluent `customerRequests` namespace (`client.customerRequests.list/create/listAll`). */
  get customerRequests() {
    this.#customerRequests ??= customerRequests(this);
    return this.#customerRequests;
  }

  /** Fluent `comments` namespace (`client.comments.list/create/update/delete`). */
  get comments() {
    this.#comments ??= comments(this);
    return this.#comments;
  }

  /** Fluent `projects` namespace (`client.projects.list/listAll/get/create/update/delete`). */
  get projects() {
    this.#projects ??= projects(this);
    return this.#projects;
  }

  /**
   * Issue an HTTP request against the API.
   *
   * @param method - HTTP verb.
   * @param path - Path beginning with `/`, appended to `baseUrl`.
   * @param body - Optional JSON-serializable body. Omitted for `GET`/`DELETE`.
   * @param opts - Per-request overrides.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = this.buildHeaders(opts, body !== undefined);
    const signal = composeSignal(opts.signal, opts.timeoutMs);
    const init: RequestInit = { method, headers, signal };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const allowRetry = opts.retry !== false;
    const canRetryServer = IDEMPOTENT_METHODS.has(method);
    let attempt = 0;
    // Loop until we either return, throw a terminal error, or exhaust retries.
    // 429 (any verb) and transient 5xx (idempotent verbs) increment `attempt`;
    // backoff doubles each pass, capped at 30 s.
    while (true) {
      const response = await this.fetchImpl(url, init);
      const retryable =
        response.status === 429 ||
        (canRetryServer && RETRYABLE_SERVER_STATUS.has(response.status));

      if (retryable && allowRetry && attempt < this.maxRetries) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const backoff = Math.min(
          retryAfter ?? this.initialBackoffMs * 2 ** attempt,
          MAX_BACKOFF_MS
        );
        attempt += 1;
        await this.sleep(backoff);
        continue;
      }

      if (response.ok) {
        return (await parseBody(response)) as T;
      }

      throw await classifyError(response);
    }
  }

  private buildHeaders(opts: RequestOptions, hasBody: boolean): Headers {
    const headers = new Headers();
    headers.set("accept", "application/json");
    headers.set("user-agent", this.userAgent);
    if (hasBody) {
      headers.set("content-type", "application/json");
    }
    // Both modes send `Authorization: Bearer <token>` — the Planoda API
    // authenticates an API key as a bearer token (`Bearer ttm_..._...`); it does
    // NOT read an `x-api-key` header. `apiKey` vs `bearer` is a semantic label
    // for the caller (service key vs user token); the wire form is identical.
    if (this.auth.kind === "bearer") {
      headers.set("authorization", `Bearer ${this.auth.token}`);
    } else {
      headers.set("authorization", `Bearer ${this.auth.key}`);
    }
    if (opts.idempotencyKey) {
      headers.set("idempotency-key", opts.idempotencyKey);
    }
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        headers.set(k, v);
      }
    }
    return headers;
  }
}

export function createPlanodaClient(
  config: PlanodaClientConfig
): PlanodaClient {
  return new PlanodaClient(config);
}

/**
 * Compose the caller's abort signal with an optional timeout into one signal.
 * Returns `undefined` when neither is supplied so `fetch` runs unbounded.
 */
function composeSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): AbortSignal | undefined {
  if (timeoutMs === undefined) {
    return signal;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeout;
  }
  // `AbortSignal.any` (Node 20.3+/modern runtimes) merges both sources.
  return AbortSignal.any([signal, timeout]);
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return;
  }
  const text = await response.text();
  if (text.length === 0) {
    return;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function classifyError(response: Response): Promise<PlanodaError> {
  const body = await parseBody(response).catch(() => undefined);
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const opts = { status: response.status, body, requestId } as const;

  switch (response.status) {
    case 401:
      return new UnauthorizedError(opts);
    case 402:
      return new PaymentRequiredError(opts);
    case 403:
      return new ForbiddenError(opts);
    case 404:
      return new NotFoundError(opts);
    case 409:
      return new ConflictError(opts);
    case 422:
      return new ValidationError(opts);
    case 429:
      return new RateLimitError({
        ...opts,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      });
    default:
      if (response.status >= 500) {
        return new ServerError(opts);
      }
      return new PlanodaError(`Request failed (${response.status})`, opts);
  }
}

/**
 * Parse the `Retry-After` header into milliseconds. Accepts both delta-seconds
 * (`"30"`) and HTTP-date forms (`"Wed, 21 Oct 2026 07:28:00 GMT"`).
 * Returns `undefined` if the header is missing or unparseable.
 */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) {
    return;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return;
}
