# @planoda/sdk — Design

This document captures the architectural decisions behind `@planoda/sdk`. It is the
companion to `README.md` (which is the consumer-facing surface). Anything that
looks ambiguous in the README should resolve against this doc.

## Resource layout (today) & the codegen direction (roadmap)

**Today the SDK is hand-written per-resource.** Each namespace lives in its own
module under `src/resources/` (`issues.ts`, `projects.ts`, `comments.ts`,
`customer-requests.ts`) as a thin factory over the shared `PlanodaClient`
transport (`src/client.ts`) — it mirrors the **curated, versioned REST contract**
the server exposes at `/api/v1/**` (see `src/server/api/rest/registry.ts` in the
app), not the full internal tRPC router. Adding a resource = one small module
plus a getter on `PlanodaClient`. This keeps the public surface deliberately
small and stable, decoupled from internal router churn.

### Roadmap — optional codegen (not yet implemented)

A future wave *may* generate the per-resource wrappers from the server's exported
types so the SDK tracks the API automatically. Sketch, if we pursue it:

1. **Type import.** `import type { AppRouter } from '@/server/router'` — build
   against the same type the server publishes; the TypeScript type is the contract.
2. **Router walk.** A build-time script reflects over the (lazily imported, never
   bundled) router to enumerate the REST-exposed procedures.
3. **Wrapper emission.** Emit a typed method per procedure, forwarding
   `inferRouterInputs`/returning `inferRouterOutputs` through the shared transport.
4. **Coverage assertion.** Diff the generated method list against the live
   registry and fail CI on drift.

Until that lands, treat the hand-written modules as the source of truth. The
tradeoff is explicit: a curated surface costs a little manual upkeep but avoids
leaking every internal procedure and keeps the contract intentional.

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
