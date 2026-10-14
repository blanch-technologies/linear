import { ConvexError } from "convex/values";

/** Typed error codes the client can branch on (src/lib/errors.ts reads them). */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NO_WORKSPACE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID"
  | "CONFLICT"
  | "LAST_OWNER"
  | "UPSTREAM";

export type ErrorData = { code: ErrorCode; message: string };

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError<ErrorData>({ code, message });
}

export function ensure(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) fail(code, message);
}

/** Permission denials. Callers hide existence with NOT_FOUND where that matters. */
export function forbid(message = "You don't have permission to do that."): never {
  fail("FORBIDDEN", message);
}
