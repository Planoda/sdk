/**
 * Webhook signature verification for `@planoda/sdk`.
 *
 * Planoda signs every outbound webhook with the header
 *   `X-Webhook-Signature: v1=<hex(hmac-sha256(secret, `${t}.${body}`))>,t=<unixSec>`
 * (see `src/lib/webhook-signer.ts` in the app). {@link verifyWebhook} recomputes
 * that HMAC over the *raw* request body and constant-time-compares it, rejecting
 * payloads whose timestamp is outside the tolerance window (replay protection).
 *
 * Implemented with Web Crypto (`crypto.subtle`) so it runs unmodified on Node
 * 20+, Bun, Deno, Cloudflare Workers, Vercel Edge, and the browser.
 */

export interface VerifyWebhookOptions {
  /** The `X-Webhook-Signature` header value. */
  header: string;
  /** Override "now" (unix seconds) — for deterministic tests. */
  now?: number;
  /** The raw request body string, exactly as received (do not re-serialize). */
  payload: string;
  /** The endpoint's signing secret. */
  secret: string;
  /** Max age of the signature in seconds before it's rejected. Default 300. */
  toleranceSec?: number;
}

/**
 * Verify a Planoda webhook signature. Returns `true` only when the signature
 * is valid AND the timestamp is within `toleranceSec` of now.
 */
export async function verifyWebhook(
  opts: VerifyWebhookOptions
): Promise<boolean> {
  const { payload, header, secret, toleranceSec = 300 } = opts;
  if (!(header && secret)) {
    return false;
  }

  const fields = parseSignatureHeader(header);
  const v1 = fields.get("v1");
  const tStr = fields.get("t");
  if (!(v1 && tStr)) {
    return false;
  }

  const t = Number.parseInt(tStr, 10);
  if (!Number.isFinite(t)) {
    return false;
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > toleranceSec) {
    return false;
  }

  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return timingSafeEqualHex(expected, v1);
}

/** Parse `v1=<hex>,t=<unix>` (order-independent) into a map. */
function parseSignatureHeader(header: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const piece of header.split(",")) {
    const idx = piece.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const k = piece.slice(0, idx).trim();
    const v = piece.slice(idx + 1).trim();
    if (k && v) {
      fields.set(k, v);
    }
  }
  return fields;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
