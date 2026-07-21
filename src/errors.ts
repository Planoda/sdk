/**
 * Typed error hierarchy for `@planoda/sdk`.
 *
 * Every SDK error extends {@link PlanodaError} so callers can `catch (err) { if (err instanceof PlanodaError) … }`
 * and switch on the concrete subclass for fine-grained handling. The base class
 * carries the HTTP status, the parsed response body (if any), and the
 * `x-request-id` header when the server sets one — matching the contract
 * described in `packages/sdk/README.md`.
 */

export interface PlanodaErrorOptions {
  /** Parsed response body, if JSON. May be `unknown`/`undefined` for empty or non-JSON bodies. */
  body?: unknown;
  /** Underlying cause (network error, abort, etc.). */
  cause?: unknown;
  /** `x-request-id` header from the server, used for support correlation. */
  requestId?: string;
  status: number;
}

export class PlanodaError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId?: string;

  constructor(message: string, opts: PlanodaErrorOptions) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "PlanodaError";
    this.status = opts.status;
    this.body = opts.body;
    this.requestId = opts.requestId;
  }
}

export class UnauthorizedError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super("Unauthorized — missing or invalid credentials", opts);
    this.name = "UnauthorizedError";
  }
}

export class PaymentRequiredError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super("Payment required — plan limit reached or out of AI credits", opts);
    this.name = "PaymentRequiredError";
  }
}

export class ForbiddenError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super("Forbidden — authenticated but not allowed on this resource", opts);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super("Resource not found", opts);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super(
      "Conflict — idempotency-key reuse or unique-constraint violation",
      opts
    );
    this.name = "ConflictError";
  }
}

export class ValidationError extends PlanodaError {
  /** Server-reported field-level issues, when available. */
  readonly issues: unknown;
  constructor(opts: PlanodaErrorOptions & { issues?: unknown }) {
    super("Request failed validation", opts);
    this.name = "ValidationError";
    this.issues =
      opts.issues ?? (isRecord(opts.body) ? opts.body.issues : undefined);
  }
}

export class RateLimitError extends PlanodaError {
  /** Seconds to wait before retrying, parsed from the `Retry-After` response header. */
  readonly retryAfterSeconds?: number;
  constructor(opts: PlanodaErrorOptions & { retryAfterSeconds?: number }) {
    super("Rate limit exceeded", opts);
    this.name = "RateLimitError";
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export class ServerError extends PlanodaError {
  constructor(opts: PlanodaErrorOptions) {
    super(`Server error (${opts.status})`, opts);
    this.name = "ServerError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
