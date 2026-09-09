#!/usr/bin/env node
/**
 * Scripted code-review agent (10xDevs M5L2/M5L3) built on the Claude Agent SDK.
 *
 * Usage:
 *   node src/review.mjs <path-to-diff>        review a diff file
 *   git diff main | node src/review.mjs -     review a diff from stdin
 *
 * Env:
 *   REVIEW_MODEL  model id (default claude-opus-5)
 *   REVIEW_TOOLS  "none" (default, pure LLM) | "read" (Read/Grep/Glob on the repo)
 *
 * Exit codes: 0 approve · 3 request_changes (CI gate) · 1 contract/model error · 2 usage.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReview, packageRoot } from "./lib.mjs";

function readDiff(arg) {
  if (!arg) {
    console.error("Usage: node src/review.mjs <path-to-diff | ->");
    process.exit(2);
  }
  return readFileSync(arg === "-" ? 0 : arg, "utf8");
}

const diff = readDiff(process.argv[2]).trim();
if (!diff) {
  console.error("The diff is empty — nothing to review.");
  process.exit(2);
}

let review, meta;
try {
  ({ review, meta } = await runReview(diff, { cwd: join(packageRoot, "..", "..") }));
} catch (error) {
  console.error(`Review failed: ${error.message}`);
  if (error.raw) {
    console.error("\nRaw model response:\n" + error.raw);
  }
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = join(packageRoot, "reports");
mkdirSync(reportDir, { recursive: true });
const reportPath = join(reportDir, `review-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify({ meta, review }, null, 2));

const icon = { pass: "✅", warn: "⚠️", fail: "❌" };
console.log(`\n# Code review (${meta.model}, tools=${meta.tools})\n`);
console.log(`**Summary:** ${review.summary}\n`);
for (const c of review.criteria) {
  console.log(`${icon[c.status]} ${c.id} — ${c.status}`);
  console.log(`   ${c.notes}`);
  for (const f of c.findings) {
    console.log(`   - [${f.severity}] ${f.file} :: ${f.issue}`);
    console.log(`     fix: ${f.fix}`);
  }
}

if (!meta.verdict_consistent) {
  console.log(
    `\n⚠️ Model verdict '${review.verdict}' is inconsistent with criteria — the gate uses the derived verdict.`,
  );
}
console.log(`\nVerdict:  ${meta.verdict_derived.toUpperCase()}`);
console.log(`Report:   ${reportPath}`);
console.log(
  `Usage:    in=${meta.input_tokens} out=${meta.output_tokens} ` +
    `cost=$${meta.cost_usd?.toFixed(4) ?? "n/a"} duration=${meta.duration_ms}ms`,
);

process.exit(meta.verdict_derived === "request_changes" ? 3 : 0);
