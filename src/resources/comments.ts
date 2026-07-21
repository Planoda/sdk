/**
 * `comments` resource — list / create / update / delete.
 *
 * Mirrors the REST contract at `/api/v1/comments`. `list` returns every comment
 * for a parent (issue/project/initiative) in creation order — it is not
 * paginated — so it resolves to a plain array. Responses are unwrapped from the
 * `{ data }` envelope.
 */

import type { PlanodaClient } from "../client.js";
import { toQueryString, unwrapData, unwrapList } from "../internal.js";
import type { RequestOptions } from "../types.js";

export type CommentParentKind = "issue" | "project" | "initiative";

export interface Comment {
  authorId: string;
  bodyHtml: string;
  bodyMd: string;
  createdAt: string;
  editedAt: string | null;
  id: string;
  parentCommentId: string | null;
  parentId: string;
  parentKind: string;
  updatedAt: string;
  workspaceId: string;
}

export interface CommentsListInput {
  includeDeleted?: boolean;
  issueId?: string;
  parentId?: string;
  parentKind?: CommentParentKind;
  [key: string]: unknown;
}

export interface CommentCreateInput {
  bodyMd: string;
  issueId?: string;
  parentCommentId?: string | null;
  parentId?: string;
  parentKind?: CommentParentKind;
  [key: string]: unknown;
}

export function comments(client: PlanodaClient) {
  return {
    /** List every comment for a parent (pass `issueId` or `parentKind`+`parentId`). */
    async list<T = Comment>(
      input: CommentsListInput,
      opts?: RequestOptions
    ): Promise<T[]> {
      const body = await client.request(
        "GET",
        `/v1/comments${toQueryString(input)}`,
        undefined,
        opts
      );
      return unwrapList<T>(body).items;
    },

    async create<T = Comment>(
      input: CommentCreateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request("POST", "/v1/comments", input, opts);
      return unwrapData<T>(body);
    },

    async update<T = Comment>(
      id: string,
      input: { bodyMd: string },
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request(
        "PATCH",
        `/v1/comments/${encodeURIComponent(id)}`,
        input,
        opts
      );
      return unwrapData<T>(body);
    },

    delete(id: string, opts?: RequestOptions): Promise<void> {
      return client.request<void>(
        "DELETE",
        `/v1/comments/${encodeURIComponent(id)}`,
        undefined,
        opts
      );
    },
  };
}
