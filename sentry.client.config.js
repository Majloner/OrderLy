import * as Sentry from "@sentry/astro";

// Browser-side Sentry (m3l5). The DSN is not a secret — it ships to every
// visitor's browser by design; access control happens on the Sentry side.
Sentry.init({
  dsn: "https://c8041486d2e6d7157c4b27a11759bdf5@o4512013338476544.ingest.de.sentry.io/4512013345816656",
  integrations: [Sentry.replayIntegration()],
  // 10% of sessions record a replay; every session with an error records one.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
