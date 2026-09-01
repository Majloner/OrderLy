import * as Sentry from "@sentry/astro";

// Server-side Sentry (m3l5). Note: SSR here runs on Cloudflare workerd, which
// the Node-oriented server SDK only partially supports — if this init misbehaves
// on the worker runtime, drop this file and keep client-side monitoring only.
Sentry.init({
  dsn: "https://c8041486d2e6d7157c4b27a11759bdf5@o4512013338476544.ingest.de.sentry.io/4512013345816656",
});
