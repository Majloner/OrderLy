// @ts-check
import process from "node:process";
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import sentry from "@sentry/astro";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [
    react(),
    sitemap(),
    // Error monitoring (m3l5). Runtime config lives in sentry.client.config.js /
    // sentry.server.config.js. authToken is only needed to upload source maps at
    // build time — without it the integration just skips the upload.
    sentry({
      project: "orderly",
      org: "majloner",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Force a single React copy — avoids the dev-server "more than one copy of
    // React / invalid hook call" from duplicated optimized deps.
    resolve: { dedupe: ["react", "react-dom"] },
    // `astro check` spins up its own Vite and re-optimizes the dep cache it
    // shares with the dev server, leaving the server's SSR deps inconsistent
    // (null-React useMemo crash inside islands). Run checks against a separate
    // cache: the pre-commit gate invokes them with ASTRO_CHECK=1.
    ...(process.env.ASTRO_CHECK ? { cacheDir: "node_modules/.vite-check" } : {}),
  },
  // No astro:assets usage in the app, so skip the Cloudflare Images binding the
  // adapter otherwise auto-enables (and tries to provision on deploy).
  adapter: cloudflare({ imageService: "passthrough" }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Service-role key: used ONLY server-side to mint menu-photo signed upload
      // URLs / remove objects (Storage doesn't honor the user JWT for RLS here).
      // The endpoint authorizes the request (owner guard + server-built path).
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
