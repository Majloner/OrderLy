#!/usr/bin/env node
/** Render the promptfoo results.json as a model-comparison matrix (pass/fail, cost, time). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, process.argv[2] ?? "results.json"), "utf8"));
const rows = raw.results?.results ?? raw.results ?? [];

const byModel = new Map();
for (const r of rows) {
  const model = r.provider?.label ?? r.provider?.id ?? "?";
  const test = r.testCase?.description ?? r.description ?? "?";
  let meta = null;
  try {
    meta = JSON.parse(r.response?.output ?? "{}")._meta ?? null;
  } catch {
    /* non-JSON output */
  }
  const entry = byModel.get(model) ?? { tests: [], cost: 0, timeMs: 0, passed: 0 };
  entry.tests.push({ test, pass: !!r.success, latencyMs: r.latencyMs ?? meta?.duration_ms ?? null });
  entry.cost += meta?.cost_usd ?? 0;
  entry.timeMs += r.latencyMs ?? meta?.duration_ms ?? 0;
  entry.passed += r.success ? 1 : 0;
  byModel.set(model, entry);
}

console.log("| Model | Wynik | Koszt (3 diffy) | Łączny czas |");
console.log("|---|---|---|---|");
for (const [model, e] of byModel) {
  console.log(
    `| ${model} | ${e.passed}/${e.tests.length} | $${e.cost.toFixed(4)} | ${(e.timeMs / 1000).toFixed(1)}s |`
  );
}
console.log("");
for (const [model, e] of byModel) {
  for (const t of e.tests) {
    console.log(`${t.pass ? "PASS" : "FAIL"}  ${model}  ${t.test}  (${((t.latencyMs ?? 0) / 1000).toFixed(1)}s)`);
  }
}
