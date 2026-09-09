#!/usr/bin/env node
/**
 * promptfoo `exec:` provider wrapper.
 * argv[2] = rendered prompt (the diff), argv[3] = provider options JSON, argv[4] = context JSON.
 * Prints the full review JSON (review + meta with cost/duration) to stdout.
 */
import { runReview } from "../src/lib.mjs";

const diff = process.argv[2] ?? "";
let options = {};
try {
  options = JSON.parse(process.argv[3] ?? "{}");
} catch {
  // keep defaults
}

const model = options?.config?.model ?? options?.model ?? process.env.REVIEW_MODEL ?? "claude-opus-5";

try {
  const { review, meta } = await runReview(diff, { model });
  process.stdout.write(JSON.stringify({ ...review, _meta: meta }));
} catch (error) {
  console.error(error.message);
  if (error.raw) {
    console.error(error.raw);
  }
  process.exit(1);
}
