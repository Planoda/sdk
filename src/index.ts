/**
 * @planoda/sdk — TypeScript SDK for Planoda.
 * See packages/sdk/README.md.
 */

// Client
export type { PlanodaAuth, PlanodaClientConfig } from "./client.js";
export { createPlanodaClient, PlanodaClient } from "./client.js";

// Errors
export {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
  PlanodaError,
  RateLimitError,
  ServerError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";
// Resource models + input types
export type {
  Comment,
  CommentCreateInput,
  CommentParentKind,
  CommentsListInput,
} from "./resources/comments.js";
export { comments } from "./resources/comments.js";
export type {
  CustomerRequest,
  CustomerRequestCreateInput,
  CustomerRequestSource,
  CustomerRequestStatus,
  CustomerRequestsListInput,
} from "./resources/customer-requests.js";
// Resources (standalone factories — also reachable fluently via the client)
export { customerRequests } from "./resources/customer-requests.js";
export type {
  Issue,
  IssueCreateInput,
  IssuePriority,
  IssuesListInput,
  IssueUpdateInput,
} from "./resources/issues.js";
export { issues } from "./resources/issues.js";
export type {
  Project,
  ProjectCreateInput,
  ProjectStatus,
  ProjectsListInput,
  ProjectUpdateInput,
} from "./resources/projects.js";
export { projects } from "./resources/projects.js";

// Shared types
export type { ListEnvelope, PageCursor, RequestOptions } from "./types.js";
export type { VerifyWebhookOptions } from "./webhooks.js";
// Webhooks
export { verifyWebhook } from "./webhooks.js";
