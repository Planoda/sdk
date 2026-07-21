/**
 * `projects` resource — list / listAll / get / create / update / delete.
 *
 * Mirrors the REST contract at `/api/v1/projects`. Responses are unwrapped from
 * the `{ data }` envelope; `list` is cursor-paginated.
 */

import type { PlanodaClient } from "../client.js";
import { toQueryString, unwrapData, unwrapList } from "../internal.js";
import type { ListEnvelope, RequestOptions } from "../types.js";
import type { IssuePriority } from "./issues.js";

export type ProjectStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export interface Project {
  color: string;
  createdAt: string;
  descriptionMd: string | null;
  icon: string | null;
  id: string;
  initiativeId: string | null;
  leadUserId: string | null;
  name: string;
  priority: IssuePriority;
  startDate: string | null;
  status: ProjectStatus;
  targetDate: string | null;
  teamId: string | null;
  updatedAt: string;
  workspaceId: string;
}

export interface ProjectsListInput {
  cursor?: string;
  includeArchived?: boolean;
  limit?: number;
  status?: ProjectStatus;
  teamId?: string;
  [key: string]: unknown;
}

export interface ProjectCreateInput {
  color?: string;
  descriptionMd?: string | null;
  icon?: string | null;
  initiativeId?: string | null;
  leadUserId?: string | null;
  name: string;
  priority?: IssuePriority;
  startDate?: string | null;
  status?: ProjectStatus;
  targetDate?: string | null;
  teamId?: string | null;
  [key: string]: unknown;
}

export type ProjectUpdateInput = Partial<ProjectCreateInput>;

export function projects(client: PlanodaClient) {
  return {
    async list<T = Project>(
      input: ProjectsListInput = {},
      opts?: RequestOptions
    ): Promise<ListEnvelope<T>> {
      const body = await client.request(
        "GET",
        `/v1/projects${toQueryString(input)}`,
        undefined,
        opts
      );
      return unwrapList<T>(body);
    },

    async *listAll<T = Project>(
      input: ProjectsListInput = {},
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

    async get<T = Project>(id: string, opts?: RequestOptions): Promise<T> {
      const body = await client.request(
        "GET",
        `/v1/projects/${encodeURIComponent(id)}`,
        undefined,
        opts
      );
      return unwrapData<T>(body);
    },

    async create<T = Project>(
      input: ProjectCreateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request("POST", "/v1/projects", input, opts);
      return unwrapData<T>(body);
    },

    async update<T = Project>(
      id: string,
      input: ProjectUpdateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request(
        "PATCH",
        `/v1/projects/${encodeURIComponent(id)}`,
        input,
        opts
      );
      return unwrapData<T>(body);
    },

    delete(id: string, opts?: RequestOptions): Promise<void> {
      return client.request<void>(
        "DELETE",
        `/v1/projects/${encodeURIComponent(id)}`,
        undefined,
        opts
      );
    },
  };
}
