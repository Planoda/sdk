/**
 * `issues` resource — list / get / create / update / delete / listAll.
 *
 * Input and output shapes mirror the live REST contract at `/api/v1/issues`
 * (see docs/api.md). Response payloads are unwrapped from the `{ data }`
 * envelope so callers get the resource directly.
 */

import type { PlanodaClient } from "../client.js";
import { toQueryString, unwrapData, unwrapList } from "../internal.js";
import type { ListEnvelope, RequestOptions } from "../types.js";

/** Priority scale: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low. */
export type IssuePriority = 0 | 1 | 2 | 3 | 4;

export interface Issue {
  assigneeId: string | null;
  createdAt: string;
  descriptionMd: string | null;
  id: string;
  number: number;
  priority: IssuePriority;
  projectId: string | null;
  teamId: string;
  title: string;
  updatedAt: string;
  workflowStateId: string;
}

export interface IssuesListInput {
  /** Opaque cursor from a previous `nextCursor`. */
  cursor?: string;
  /** Page size, 1–100 (default 25). */
  limit?: number;
  /** Scope to a single team (UUID). */
  teamId?: string;
  /** Forward-compatible filters without forcing a type bump. */
  [key: string]: unknown;
}

export interface IssueCreateInput {
  descriptionMd?: string;
  priority?: IssuePriority;
  projectId?: string | null;
  teamId: string;
  title: string;
  workflowStateId?: string;
  [key: string]: unknown;
}

export interface IssueUpdateInput {
  descriptionMd?: string | null;
  priority?: IssuePriority;
  title?: string;
  workflowStateId?: string;
  [key: string]: unknown;
}

export function issues(client: PlanodaClient) {
  return {
    /**
     * List issues. Cursor-paginated; pass the returned `nextCursor` back in to
     * fetch subsequent pages, or use {@link listAll} to walk every page.
     */
    async list<T = Issue>(
      input: IssuesListInput = {},
      opts?: RequestOptions
    ): Promise<ListEnvelope<T>> {
      const body = await client.request(
        "GET",
        `/v1/issues${toQueryString(input)}`,
        undefined,
        opts
      );
      return unwrapList<T>(body);
    },

    /** Async-iterate every issue across all pages, fetching lazily. */
    async *listAll<T = Issue>(
      input: IssuesListInput = {},
      opts?: RequestOptions
    ): AsyncGenerator<T, void, unknown> {
      let cursor = input.cursor;
      do {
        const page = await this.list<T>({ ...input, cursor }, opts);
        for (const item of page.items) {
          yield item;
        }
        cursor = page.nextCursor;
      } while (cursor);
    },

    async get<T = Issue>(id: string, opts?: RequestOptions): Promise<T> {
      const body = await client.request(
        "GET",
        `/v1/issues/${encodeURIComponent(id)}`,
        undefined,
        opts
      );
      return unwrapData<T>(body);
    },

    async create<T = Issue>(
      input: IssueCreateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request("POST", "/v1/issues", input, opts);
      return unwrapData<T>(body);
    },

    async update<T = Issue>(
      id: string,
      input: IssueUpdateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request(
        "PATCH",
        `/v1/issues/${encodeURIComponent(id)}`,
        input,
        opts
      );
      return unwrapData<T>(body);
    },

    delete(id: string, opts?: RequestOptions): Promise<void> {
      return client.request<void>(
        "DELETE",
        `/v1/issues/${encodeURIComponent(id)}`,
        undefined,
        opts
      );
    },
  };
}
