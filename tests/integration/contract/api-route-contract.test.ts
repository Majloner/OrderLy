import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md hard rule: "Every API route under src/pages/api/ must export
// `const prerender = false`." Without it Astro can prerender the route at build
// time, which for an SSR endpoint means it stops seeing the request — the guard
// never runs and locals are empty.
//
// This was a real drift, not a hypothetical: src/pages/api/auth/signout.ts was
// missing the export while all 23 siblings had it, and nothing caught it. A rule
// that is only written down is a rule that erodes; this file executes it.
//
// DB-free (pure fs scan), so it runs even with no local Supabase.

const API_DIR = fileURLToPath(new URL("../../../src/pages/api", import.meta.url));

function allRouteFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => entry.replaceAll("\\", "/"));
}

describe("API route contract", () => {
  it("finds the route tree", () => {
    expect(allRouteFiles().length).toBeGreaterThan(0);
  });

  it.each(allRouteFiles())("%s exports `const prerender = false`", (route) => {
    const source = readFileSync(join(API_DIR, route), "utf8");
    expect(source).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });
});
