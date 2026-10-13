import { ConvexError } from "convex/values";

/** Codes thrown by Convex functions (convex/lib/errors.ts). */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NO_WORKSPACE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID"
  | "CONFLICT"
  | "LAST_OWNER"
  | "UPSTREAM";

/** The typed code of a Convex error, if it has one. */
export function errorCode(error: unknown): ErrorCode | undefined {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data) {
    return error.data.code as ErrorCode;
  }
  return undefined;
}

/** A message safe to show the user. Unexpected errors get a generic sentence. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data && "message" in error.data) {
    return String(error.data.message);
  }
  return fallback;
}
