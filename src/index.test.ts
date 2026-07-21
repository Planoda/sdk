/**
 * Vitest spec for `@planoda/sdk` transport + resources.
 *
 * These tests inject a `fetch` mock + a no-op `sleep` so we can drive the
 * retry loop deterministically without real timers or network.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  createPlanodaClient,
  ForbiddenError,
  type Issue,
  PaymentRequiredError,
  PlanodaClient,
  RateLimitError,
  UnauthorizedError,
  verifyWebhook,
} from "./index.js";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makeClient(fetchMock: FetchMock) {
  return createPlanodaClient({
    baseUrl: "https://api.test",
    auth: { kind: "bearer", token: "tok_abc" },
    fetch: fetchMock as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
    initialBackoffMs: 1,
    maxRetries: 3,
  });
}

describe("@planoda/sdk client", () => {
  it("constructs with bearer + apiKey auth modes", () => {
    const bearer = createPlanodaClient({
      auth: { kind: "bearer", token: "t" },
    });
    const apiKey = createPlanodaClient({
      auth: { kind: "apiKey", key: "k" },
    });
    expect(bearer).toBeInstanceOf(PlanodaClient);
    expect(apiKey).toBeInstanceOf(PlanodaClient);
    // Default baseUrl is applied + trailing-slash stripped.
    expect(bearer.baseUrl).toBe("https://planoda.com/api");
  });

  it("sends Authorization: Bearer for bearer auth, content-type for body", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    await client.request("POST", "/v1/issues", { title: "hi" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/issues");
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe("Bearer tok_abc");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(init!.body).toBe('{"title":"hi"}');
  });

  it("sends Authorization: Bearer for apiKey auth (the API reads the key as a bearer token, not x-api-key)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true })
    ) as FetchMock;
    const client = createPlanodaClient({
      baseUrl: "https://api.test",
      auth: { kind: "apiKey", key: "key_xyz" },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.request("GET", "/v1/issues");
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe("Bearer key_xyz");
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("sets the Idempotency-Key header when provided", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: "iss_1" } }, { status: 201 })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    await client.issues.create(
      { teamId: "team_1", title: "hi" },
      { idempotencyKey: "key-123" }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers);
    expect(headers.get("idempotency-key")).toBe("key-123");
  });

  it("throws UnauthorizedError on 401", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_1",
          },
        })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    await expect(client.request("GET", "/v1/issues")).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("maps 402/403/409 to typed errors", async () => {
    for (const [status, ctor] of [
      [402, PaymentRequiredError],
      [403, ForbiddenError],
      [409, ConflictError],
    ] as const) {
      const fetchMock = vi.fn(
        async () => new Response("{}", { status })
      ) as FetchMock;
      const client = makeClient(fetchMock);
      await expect(client.request("GET", "/v1/issues")).rejects.toBeInstanceOf(
        ctor
      );
    }
  });

  it("retries on 429 honouring Retry-After, then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as FetchMock;
    const client = makeClient(fetchMock);
    const result = await client.request<{ ok: boolean }>("GET", "/v1/issues");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries idempotent GET on transient 503, then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as FetchMock;
    const client = makeClient(fetchMock);
    const result = await client.request<{ ok: boolean }>("GET", "/v1/issues");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a POST on 503 (avoids duplicate writes)", async () => {
    const fetchMock = vi.fn(
      async () => new Response("", { status: 503 })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    await expect(
      client.request("POST", "/v1/issues", { title: "x" })
    ).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws RateLimitError after exhausting retries on 429", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "0" } })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    await expect(client.request("GET", "/v1/issues")).rejects.toBeInstanceOf(
      RateLimitError
    );
    // 1 initial + maxRetries(3) = 4 calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns parsed JSON on 200 and undefined on 204", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [1, 2, 3] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as FetchMock;
    const client = makeClient(fetchMock);
    const list = await client.request<{ items: number[] }>("GET", "/v1/issues");
    expect(list).toEqual({ items: [1, 2, 3] });
    const empty = await client.request<undefined>("DELETE", "/v1/issues/iss_1");
    expect(empty).toBeUndefined();
  });
});

describe("@planoda/sdk resources", () => {
  it("exposes fluent namespaces on the client", () => {
    const client = makeClient(vi.fn() as FetchMock);
    expect(typeof client.issues.list).toBe("function");
    expect(typeof client.issues.listAll).toBe("function");
    expect(typeof client.issues.create).toBe("function");
    expect(typeof client.customerRequests.list).toBe("function");
    expect(typeof client.projects.list).toBe("function");
    expect(typeof client.projects.listAll).toBe("function");
    expect(typeof client.comments.list).toBe("function");
    expect(typeof client.comments.create).toBe("function");
    // Memoized: same object across accesses.
    expect(client.issues).toBe(client.issues);
    expect(client.projects).toBe(client.projects);
  });

  it("projects.list normalizes the envelope; projects.get unwraps data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "prj_1" }], nextCursor: "c2" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: "prj_1", name: "Q3" } })
      ) as FetchMock;
    const client = makeClient(fetchMock);
    const page = await client.projects.list({ teamId: "team_1" });
    expect(page.items).toEqual([{ id: "prj_1" }]);
    expect(page.nextCursor).toBe("c2");
    const project = await client.projects.get<{ id: string; name: string }>(
      "prj_1"
    );
    expect(project.name).toBe("Q3");
    expect(new URL(fetchMock.mock.calls[0]![0] as string).pathname).toBe(
      "/v1/projects"
    );
  });

  it("comments.list resolves to a plain array (unpaginated)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: "cmt_1" }, { id: "cmt_2" }] })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    const list = await client.comments.list<{ id: string }>({
      issueId: "iss_1",
    });
    expect(list).toEqual([{ id: "cmt_1" }, { id: "cmt_2" }]);
  });

  it("issues.list normalizes { data, nextCursor } → { items, nextCursor }", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: "iss_1" }], nextCursor: "c2" })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    const page = await client.issues.list({ teamId: "team_1", limit: 50 });
    expect(page.items).toEqual([{ id: "iss_1" }]);
    expect(page.nextCursor).toBe("c2");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/issues?teamId=team_1&limit=50");
  });

  it("issues.get unwraps the { data } envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: "iss_9", title: "hello" } })
    ) as FetchMock;
    const client = makeClient(fetchMock);
    const issue = await client.issues.get<Issue>("iss_9");
    expect(issue.id).toBe("iss_9");
    expect(issue.title).toBe("hello");
  });

  it("issues.listAll walks every page via nextCursor", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "a" }], nextCursor: "c2" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "b" }], nextCursor: null })
      ) as FetchMock;
    const client = makeClient(fetchMock);
    const seen: string[] = [];
    for await (const issue of client.issues.listAll<{ id: string }>()) {
      seen.push(issue.id);
    }
    expect(seen).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("@planoda/sdk webhooks", () => {
  const secret = "whsec_test";
  const body = '{"event":"issue.created","data":{"id":"iss_1"}}';
  const t = 1_700_000_000;

  // Mirror the server scheme: v1=hex(hmac-sha256(secret, `${t}.${body}`)),t=<unix>
  function sign(at: number, payload: string): string {
    const v1 = createHmac("sha256", secret)
      .update(`${at}.${payload}`)
      .digest("hex");
    return `v1=${v1},t=${at}`;
  }

  it("accepts a valid signature within tolerance", async () => {
    const header = sign(t, body);
    expect(await verifyWebhook({ payload: body, header, secret, now: t })).toBe(
      true
    );
  });

  it("rejects a tampered body", async () => {
    const header = sign(t, body);
    expect(
      await verifyWebhook({
        payload: `${body} `,
        header,
        secret,
        now: t,
      })
    ).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", async () => {
    const header = sign(t, body);
    expect(
      await verifyWebhook({
        payload: body,
        header,
        secret,
        now: t + 10_000,
        toleranceSec: 300,
      })
    ).toBe(false);
  });

  it("rejects a malformed or empty header", async () => {
    expect(await verifyWebhook({ payload: body, header: "", secret })).toBe(
      false
    );
    expect(
      await verifyWebhook({ payload: body, header: "garbage", secret, now: t })
    ).toBe(false);
  });
});
