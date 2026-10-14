/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as crons from "../crons.js";
import type * as invitations from "../invitations.js";
import type * as issues from "../issues.js";
import type * as labels from "../labels.js";
import type * as lib_auditActions from "../lib/auditActions.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_issues from "../lib/issues.js";
import type * as lib_members from "../lib/members.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_teams from "../lib/teams.js";
import type * as lib_viewer from "../lib/viewer.js";
import type * as lib_workos from "../lib/workos.js";
import type * as members from "../members.js";
import type * as migrations from "../migrations.js";
import type * as seed from "../seed.js";
import type * as session from "../session.js";
import type * as teams from "../teams.js";
import type * as views from "../views.js";
import type * as workflowStates from "../workflowStates.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  crons: typeof crons;
  invitations: typeof invitations;
  issues: typeof issues;
  labels: typeof labels;
  "lib/auditActions": typeof lib_auditActions;
  "lib/env": typeof lib_env;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/issues": typeof lib_issues;
  "lib/members": typeof lib_members;
  "lib/notify": typeof lib_notify;
  "lib/teams": typeof lib_teams;
  "lib/viewer": typeof lib_viewer;
  "lib/workos": typeof lib_workos;
  members: typeof members;
  migrations: typeof migrations;
  seed: typeof seed;
  session: typeof session;
  teams: typeof teams;
  views: typeof views;
  workflowStates: typeof workflowStates;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
