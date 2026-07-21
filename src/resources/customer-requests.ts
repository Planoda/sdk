/**
 * `customerRequests` resource — list / create / listAll.
 *
 * Append-only from the SDK perspective: a request is created, then triaged into
 * the issue lifecycle. Mirrors the live REST contract at
 * `/api/v1/customer-requests`. Responses are unwrapped from the `{ data }` envelope.
 */

import type { PlanodaClient } from "../client.js";
import { toQueryString, unwrapData, unwrapList } from "../internal.js";
import type { ListEnvelope, RequestOptions } from "../types.js";

export type CustomerRequestStatus =
  | "open"
  | "triaged"
  | "linked"
  | "resolved"
  | "spam";

export type CustomerRequestSource =
  | "manual"
  | "asks"
  | "intercom"
  | "zendesk"
  | "salesforce"
  | "email"
  | "slack"
  | "web-form";

export interface CustomerRequest {
  bodyMd: string;
  createdAt: string;
  customerId: string;
  id: string;
  linkedIssueId: string | null;
  receivedAt: string;
  source: CustomerRequestSource;
  sourceRef: string | null;
  status: CustomerRequestStatus;
  subject: string;
  updatedAt: string;
  workspaceId: string;
}

export interface CustomerRequestsListInput {
  cursor?: string;
  limit?: number;
  status?: CustomerRequestStatus;
  [key: string]: unknown;
}

export interface CustomerRequestCreateInput {
  bodyMd?: string;
  customerId: string;
  source?: CustomerRequestSource;
  sourceRef?: string;
  subject: string;
  [key: string]: unknown;
}

export function customerRequests(client: PlanodaClient) {
  return {
    async list<T = CustomerRequest>(
      input: CustomerRequestsListInput = {},
      opts?: RequestOptions
    ): Promise<ListEnvelope<T>> {
      const body = await client.request(
        "GET",
        `/v1/customer-requests${toQueryString(input)}`,
        undefined,
        opts
      );
      return unwrapList<T>(body);
    },

    /** Async-iterate every customer request across all pages. */
    async *listAll<T = CustomerRequest>(
      input: CustomerRequestsListInput = {},
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

    async create<T = CustomerRequest>(
      input: CustomerRequestCreateInput,
      opts?: RequestOptions
    ): Promise<T> {
      const body = await client.request(
        "POST",
        "/v1/customer-requests",
        input,
        opts
      );
      return unwrapData<T>(body);
    },
  };
}
