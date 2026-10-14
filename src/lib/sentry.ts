import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<Parameters<typeof init>[0]>["dataCollection"];

/** D-14: errors and traces only; no request bodies, cookies, headers, or PII. */
export const sentryDataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
};
