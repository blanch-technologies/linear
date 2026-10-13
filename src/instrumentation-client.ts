import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry";
import { clientEnv } from "@/lib/env/client";

if (clientEnv.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    dataCollection: sentryDataCollection,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
