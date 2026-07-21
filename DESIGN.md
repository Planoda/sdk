# @planoda/sdk — Design

This document captures the architectural decisions behind `@planoda/sdk`. It is the
companion to `README.md` (which is the consumer-facing surface). Anything that
looks ambiguous in the README should resolve against this doc.

## Code generation pipeline

The SDK is **not** hand-written per-resource. Instead, a `codegen` script
(landing in a follow-up wave) consumes the exported `AppRouter` type from the
main app and emits thin per-resource wrappers.

Pipeline stages:

1. **Type import.** `import type { AppRouter } from '@/server/router'` — the
   SDK builds against the same type the server publishes. No JSON Schema, no
   OpenAPI intermediate — the TypeScript type **is** the contract.
2. **Router walk.** A build-time script (`scripts/sdk-codegen.ts`) reflects on
   the runtime router object (imported lazily, never bundled) to enumerate
   procedures: `workspaces.boards.list`, `issues.create`, etc.
3. **Wrapper emission.** For each procedure, emit a method on the appropriate
   namespace class that:
   - Forwards typed input via `inferRouterInputs<AppRouter>[path]`.
   - Returns typed output via `inferRouterOutputs<AppRouter>[path]`.
   - Threads through the shared transport (auth, retry, telemetry).
4. **Subpath entry generation.** Each top-level namespace becomes a subpath
   export (`@planoda/sdk/issues`) so consumers can import a slice.
5. **Coverage assertion.** After codegen, `scripts/sdk-coverage.sh` diff-checks
   the generated method list against the live router and fails CI on drift.

This pipeline runs in CI on every change to `src/server/router/**` so the SDK
is always in lockstep with the API.

## Tree-shaking strategy

The default `@planoda/sdk` entry is a convenience facade — it imports every
namespace, so bundling a CLI that uses 8 namespaces is fine. For browser-bound
or size-sensitive consumers, the per-resource subpath imports avoid pulling
unrelated namespaces:

```ts
import { IssuesClient } from '@planoda/sdk/issues';   // ~6 KB gzipped
import { TaskManager } from '@planoda/sdk';            // ~28 KB gzipped (full)
```

Each subpath has its own `package.json` shim (`packages/sdk/issues/package.json`
with `"main"`/`"module"`/`"types"` pointing into `dist/issues/`) so bundlers
without `exports` map support still work.

`sideEffects: false` is set on the root `package.json` (in the follow-up build
wave) so bundlers can prune aggressively.

## Why no GraphQL gateway

**Decision: locked. Do not revisit without a written RFC.**

We considered exposing a GraphQL gateway as an alternative client surface.
Rejected because:

- The server is tRPC-native; the type information already flows end-to-end via
  TypeScript. A GraphQL layer would re-encode that contract in SDL, doubling
  the source of truth.
- GraphQL's caching benefits don't apply — our reads are workspace-scoped and
  already cursor-paginated; a normalized cache adds complexity without payoff
  for typical SDK consumers (servers, CI jobs).
- Federation / schema-stitching is not a use case we have. The whole API is
  one monolith.
- Field-level selection isn't needed — payloads are small and tRPC procedures
  are already shaped for their callsite.

The SDK + tRPC + Zod stack gives us full type safety, validation, and a
single source of truth without the operational overhead of a second API
surface.

## Streaming endpoints

Procedures marked as `subscription` in the router (and any `query` that opts
into Server-Sent Events) are exposed as `AsyncIterable` on the SDK:

```ts
for await (const event of sdk.activity.watch({ workspaceId })) {
  // event is typed from the subscription's emit type
}
```

Implementation:

- Transport uses `EventSource` in browsers and a Node-compatible polyfill
  (`eventsource`) on the server.
- The SDK adapter exposes an `AsyncIterableIterator` whose `.return()` cleanly
  closes the underlying connection (caller can `break` out of the loop and the
  connection drops within one tick).
- Reconnection on transient drop is automatic with the same backoff policy as
  HTTP retries, capped at 5 attempts, then the iterator throws.
- Heartbeat: server emits `: ping\n\n` every 15s; SDK treats >45s of silence as
  a disconnect and triggers reconnect.

Backpressure is handled by the AsyncIterable contract — consumers naturally
pace the stream by how fast they iterate.

## Open questions (follow-up waves)

- React Query / SWR adapters (`@planoda/sdk/react`) — likely a separate package to
  keep the core dependency-free.
- Webhook signature verification helpers (`sdk.webhooks.verify(payload, sig)`)
  — needs the server-side signing scheme finalized first.
- Browser usage: CORS policy on the API must whitelist customer origins before
  the SDK is safe to ship to first-party browser apps. Until then, the SDK is
  Node-only in practice.
