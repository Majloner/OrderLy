import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WRITE_ROUTES } from "./route-matrix";

// Guards the matrix against drift: if someone adds a new mutating menu/room/staff
// route and forgets to register it here, this fails — so the authz matrix can
// never silently stop covering a route. Runs without a database (pure fs scan),
// so it executes even when the local Supabase is down.

const API_DIR = fileURLToPath(new URL("../../../src/pages/api", import.meta.url));
const ROOTS = ["menu", "room", "staff"];
const METHOD_RE = /export const (POST|PUT|PATCH|DELETE)\b/g;

function discoverMutatingRoutes(): string[] {
  const keys: string[] = [];
  for (const root of ROOTS) {
    const rootDir = join(API_DIR, root);
    for (const entry of readdirSync(rootDir, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".ts") || entry.includes("photo")) {
        continue;
      }
      const routePath = `/api/${root}/${entry.replaceAll("\\", "/")}`.replace(/\.ts$/, "").replace(/\/index$/, "");
      const content = readFileSync(join(rootDir, entry), "utf8");
      for (const match of content.matchAll(METHOD_RE)) {
        keys.push(`${match[1]} ${routePath}`);
      }
    }
  }
  return keys;
}

describe("Risk #3 — registry completeness", () => {
  it("covers every mutating menu/room/staff route (photo excluded)", () => {
    const registry = new Set(WRITE_ROUTES.map((route) => `${route.method} ${route.path}`));
    const discovered = discoverMutatingRoutes();

    expect(discovered.length).toBeGreaterThan(0);
    const missing = discovered.filter((key) => !registry.has(key));
    expect(missing).toEqual([]);
  });
});
