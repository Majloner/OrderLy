/**
 * Core of the scripted code-review agent: prompt assembly, model call via the
 * Claude Agent SDK, and zod-enforced response shape (the "review contract").
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(here, "..");

export const CRITERIA_IDS = [
  "tenant-isolation",
  "auth-and-secrets",
  "input-validation",
  "framework-conventions",
  "test-coverage",
];

const Finding = z.object({
  file: z.string().min(1),
  line_hint: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  issue: z.string().min(1),
  fix: z.string().min(1),
});

const Criterion = z.object({
  id: z.enum(CRITERIA_IDS),
  status: z.enum(["pass", "warn", "fail"]),
  notes: z.string().min(1),
  findings: z.array(Finding),
});

export const ReviewSchema = z
  .object({
    summary: z.string().min(1),
    verdict: z.enum(["approve", "request_changes"]),
    criteria: z.array(Criterion).length(CRITERIA_IDS.length),
  })
  .superRefine((review, ctx) => {
    const seen = review.criteria.map((c) => c.id);
    for (const id of CRITERIA_IDS) {
      if (!seen.includes(id)) {
        ctx.addIssue({ code: "custom", message: `missing criterion '${id}'` });
      }
    }
    if (new Set(seen).size !== seen.length) {
      ctx.addIssue({ code: "custom", message: "duplicate criterion id" });
    }
    for (const c of review.criteria) {
      if (c.status !== "pass" && c.findings.length === 0) {
        ctx.addIssue({ code: "custom", message: `criterion '${c.id}' is '${c.status}' but has no findings` });
      }
    }
  });

/** The gate derives the verdict mechanically — it never trusts the model's own verdict. */
export function deriveVerdict(review) {
  return review.criteria.some((c) => c.status === "fail") ? "request_changes" : "approve";
}

/**
 * Parse a raw model response into a contract-valid review object.
 * Tolerates an accidental markdown fence; throws (with `raw` attached) on
 * malformed JSON or a contract violation.
 */
export function parseReviewResponse(reviewText) {
  const jsonText = reviewText
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsedJson;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    const err = new Error("model responded, but not with valid JSON");
    err.raw = reviewText;
    throw err;
  }

  const parsed = ReviewSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const err = new Error(
      `response violates the review contract: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
    err.raw = reviewText;
    throw err;
  }

  return parsed.data;
}

const TOOL_MODES = {
  none: {
    allowedTools: [],
    disallowedTools: ["*"],
    maxTurns: 1,
    extraPrompt: "",
  },
  read: {
    allowedTools: ["Read", "Grep", "Glob"],
    disallowedTools: [],
    maxTurns: 12,
    extraPrompt:
      "\nBefore judging, you MAY read repository context with your tools (read-only): " +
      "AGENTS.md (hard rules), context/foundation/test-plan.md §6 (testing cookbook), and any " +
      "file the diff touches, to check surrounding conventions. Never modify anything. " +
      "Your final message must still be only the JSON object.",
  },
};

/**
 * Run one review. Returns { review, raw, meta } or throws.
 * @param {string} diff unified diff text
 * @param {{model?: string, tools?: "none"|"read", cwd?: string}} opts
 */
export async function runReview(diff, opts = {}) {
  const model = opts.model ?? process.env.REVIEW_MODEL ?? "claude-opus-5";
  const mode = TOOL_MODES[opts.tools ?? process.env.REVIEW_TOOLS ?? "none"];
  if (!mode) {
    throw new Error(`Unknown tools mode; use one of: ${Object.keys(TOOL_MODES).join(", ")}`);
  }

  const systemPrompt = readFileSync(join(packageRoot, "prompts", "review-system.md"), "utf8") + mode.extraPrompt;

  const prompt = [
    "Review the following unified diff and respond in the JSON format defined in your instructions.",
    "",
    "```diff",
    diff,
    "```",
  ].join("\n");

  const started = Date.now();
  let reviewText = "";
  let resultMessage = null;

  for await (const message of query({
    prompt,
    options: {
      model,
      systemPrompt,
      maxTurns: mode.maxTurns,
      allowedTools: mode.allowedTools,
      disallowedTools: mode.disallowedTools,
      permissionMode: "dontAsk",
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          reviewText = block.text; // keep the last text message (tool runs may precede it)
        }
      }
    } else if (message.type === "result") {
      resultMessage = message;
    }
  }

  if (!resultMessage || resultMessage.subtype !== "success") {
    throw new Error(`model call failed: ${JSON.stringify(resultMessage)}`);
  }

  const review = parseReviewResponse(reviewText);

  return {
    review,
    meta: {
      model,
      tools: opts.tools ?? process.env.REVIEW_TOOLS ?? "none",
      cost_usd: resultMessage.total_cost_usd ?? null,
      input_tokens: resultMessage.usage?.input_tokens ?? null,
      output_tokens: resultMessage.usage?.output_tokens ?? null,
      duration_ms: Date.now() - started,
      verdict_derived: deriveVerdict(review),
      verdict_consistent: deriveVerdict(review) === review.verdict,
    },
  };
}
