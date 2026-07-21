# @planoda/sdk

[![npm version](https://img.shields.io/npm/v/@planoda/sdk.svg)](https://www.npmjs.com/package/@planoda/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@planoda/sdk.svg)](https://www.npmjs.com/package/@planoda/sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@planoda/sdk.svg)](https://www.npmjs.com/package/@planoda/sdk)

> Type-safe TypeScript SDK for the [Planoda](https://planoda.com) API — the
> AI-native work platform that replaces Linear, ClickUp, Monday & Trello.

`@planoda/sdk` is the first-party client for programmatic access to a Planoda
workspace over the REST API at `/api/v1`. It's isomorphic (Node 20+, Bun, Deno,
edge runtimes, browsers), has **zero runtime dependencies** (just the platform
`fetch` + Web Crypto), and ships a typed error hierarchy, cursor pagination,
automatic retries, and webhook-signature verification.

## Try it in one command first (no account needed)

Before you write any code, feel the AI part of Planoda with zero setup — this
hits a public, unauthenticated backlog-triage endpoint via our companion CLI:

```bash
npx @planoda/cli triage "Fix the flaky login test" "Add dark mode" "Typo in footer"
```

```
urgent   Bug       3pt Fix the flaky login test
medium   Feature   5pt Add dark mode
low      Chore     1pt Typo in footer
```

That's the same AI triage available through this SDK once you're
authenticated — no signup, no API key, just `npx`.

## Install

```bash
npm i @planoda/sdk
```

## Quickstart

```ts
import { createPlanodaClient } from "@planoda/sdk";

const planoda = createPlanodaClient({
  // baseUrl defaults to https://planoda.com/api
  auth: { kind: "apiKey", key: process.env.PLANODA_API_KEY! },
});

const issue = await planoda.issues.create({
  teamId: "team_8f3a…",
  title: "Ship the SDK",
  priority: 2, // 0 none · 1 urgent · 2 high · 3 medium · 4 low
});
console.log(issue.number);

for await (const i of planoda.issues.listAll({ teamId: "team_8f3a…" })) {
  process(i);
}
```

Get an API key in Planoda under **Settings → API keys**. Auth is either
`{ kind: "apiKey", key }` (service account, per-workspace scope) or
`{ kind: "bearer", token }` (user-scoped, short-lived).

## What's implemented

| Area | Surface |
| --- | --- |
| `client.issues` | `list` · `listAll` · `get` · `create` · `update` · `delete` |
| `client.projects` | `list` · `listAll` · `get` · `create` · `update` · `delete` |
| `client.comments` | `list` · `create` · `update` · `delete` |
| `client.customerRequests` | `list` · `listAll` · `create` |
| Pagination | `{ items, nextCursor }` envelope + `listAll()` async iterator |
| Errors | `PlanodaError` + `Unauthorized/PaymentRequired/Forbidden/NotFound/Conflict/Validation/RateLimit/Server` |
| Resilience | retry on `429` (any verb) + `502/503/504` (idempotent verbs); `idempotencyKey`, `timeoutMs`, `signal` per call |
| Webhooks | `verifyWebhook(...)` (also `@planoda/sdk/webhooks`) — HMAC-SHA-256, constant-time, replay window |

The SDK ships dual **ESM + CJS** builds with full `.d.ts` types.

## Authentication

```ts
// API key (service account, per-workspace scope)
createPlanodaClient({ auth: { kind: "apiKey", key } });

// Bearer (user-scoped, short-lived)
createPlanodaClient({ auth: { kind: "bearer", token } });
```

Never embed an API key in a client-side bundle.

## Errors

```ts
import { RateLimitError, ValidationError } from "@planoda/sdk";

try {
  await planoda.issues.create({ teamId, title: "" });
} catch (err) {
  if (err instanceof ValidationError) console.error(err.issues);
  else if (err instanceof RateLimitError) await sleep((err.retryAfterSeconds ?? 1) * 1000);
  else throw err;
}
```

Every error carries `status`, the parsed `body`, and `requestId`.

## Webhook verification

```ts
import { verifyWebhook } from "@planoda/sdk/webhooks";

const ok = await verifyWebhook({
  payload: rawBody,
  header: req.headers.get("x-webhook-signature") ?? "",
  secret: process.env.PLANODA_WEBHOOK_SECRET!,
});
```

Constant-time, with a configurable replay tolerance (default 300s).

## CLI

Prefer the terminal? [`@planoda/cli`](https://www.npmjs.com/package/@planoda/cli)
wraps this SDK for scripting issues from your shell or CI:

```bash
npx @planoda/cli issue create --team ENG --title "Fix flaky test"
```

## What is Planoda?

[Planoda](https://planoda.com/gh?utm_source=github&utm_medium=readme&utm_campaign=oss)
is an AI-native work platform — issues, projects, cycles, docs, dashboards, and
automations on one schema, with AI agents as first-class operators (not a
chatbot bolted onto the side). Every destructive agent action goes through a
propose/approve broker and lands in an immutable audit trail; AI usage spends
from a transparent per-workspace credit ledger instead of a per-action credit
roulette. This SDK and [`@planoda/cli`](https://www.npmjs.com/package/@planoda/cli)
are the open-source developer surface of the product; the hosted app itself is
**pre-launch** — there's a free tier (10 members, 1,000 issues, 3 projects, AI
triage included, no credit card) and no fabricated user counts here, just an
honest invite to try it:
[**planoda.com/gh**](https://planoda.com/gh?utm_source=github&utm_medium=readme&utm_campaign=oss).

## Development

```bash
npm run build       # tsup (ESM+CJS) + tsc (.d.ts)
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

## Contributing

Issues and PRs are welcome — see [`DESIGN.md`](./DESIGN.md) for the SDK's
internal architecture before proposing a structural change.

## License

MIT © [Planoda](https://planoda.com)
