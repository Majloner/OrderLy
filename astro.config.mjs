// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Force a single React copy — avoids the dev-server "more than one copy of
    // React / invalid hook call" from duplicated optimized deps.
    resolve: { dedupe: ["react", "react-dom"] },
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
