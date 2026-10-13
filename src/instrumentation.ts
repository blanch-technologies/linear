import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry";

export async function register() {
  // Importing the server env validates it, so a bad config fails at boot (D-40).
  const { serverEnv } = await import("@/lib/env/server");
  if (!serverEnv.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init({
    dsn: serverEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: serverEnv.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    dataCollection: sentryDataCollection,
  });
}

export const onRequestError = Sentry.captureRequestError;
