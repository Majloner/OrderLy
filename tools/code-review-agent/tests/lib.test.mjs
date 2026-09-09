import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CRITERIA_IDS, ReviewSchema, deriveVerdict, parseReviewResponse } from "../src/lib.mjs";

function makeReview(overrides = {}) {
  return {
    summary: "ok",
    verdict: "approve",
    criteria: CRITERIA_IDS.map((id) => ({ id, status: "pass", notes: "not exercised", findings: [] })),
    ...overrides,
  };
}

function makeFinding() {
  return { file: "src/x.ts", line_hint: "foo()", severity: "high", issue: "bad", fix: "good" };
}

describe("deriveVerdict", () => {
  it("approves when every criterion passes", () => {
    assert.equal(deriveVerdict(makeReview()), "approve");
  });

  it("approves when criteria only warn", () => {
    const review = makeReview();
    review.criteria[2] = { ...review.criteria[2], status: "warn", findings: [makeFinding()] };
    assert.equal(deriveVerdict(review), "approve");
  });

  it("requests changes on any single fail", () => {
    for (const id of CRITERIA_IDS) {
      const review = makeReview();
      const i = review.criteria.findIndex((c) => c.id === id);
      review.criteria[i] = { ...review.criteria[i], status: "fail", findings: [makeFinding()] };
      assert.equal(deriveVerdict(review), "request_changes", `fail on ${id}`);
    }
  });
});

describe("ReviewSchema invariants", () => {
  it("accepts a well-formed review", () => {
    assert.equal(ReviewSchema.safeParse(makeReview()).success, true);
  });

  it("rejects a missing criterion", () => {
    const review = makeReview();
    review.criteria = review.criteria.slice(1);
    assert.equal(ReviewSchema.safeParse(review).success, false);
  });

  it("rejects a duplicate criterion id", () => {
    const review = makeReview();
    review.criteria[1] = { ...review.criteria[0] };
    const result = ReviewSchema.safeParse(review);
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error.issues), /duplicate criterion id/);
  });

  it("rejects warn/fail without findings", () => {
    for (const status of ["warn", "fail"]) {
      const review = makeReview();
      review.criteria[0] = { ...review.criteria[0], status, findings: [] };
      const result = ReviewSchema.safeParse(review);
      assert.equal(result.success, false, `${status} without findings must be rejected`);
      assert.match(JSON.stringify(result.error.issues), /has no findings/);
    }
  });

  it("rejects an unknown status or verdict", () => {
    const badStatus = makeReview();
    badStatus.criteria[0] = { ...badStatus.criteria[0], status: "maybe" };
    assert.equal(ReviewSchema.safeParse(badStatus).success, false);
    assert.equal(ReviewSchema.safeParse(makeReview({ verdict: "lgtm" })).success, false);
  });
});

describe("parseReviewResponse", () => {
  it("parses bare JSON", () => {
    const review = parseReviewResponse(JSON.stringify(makeReview()));
    assert.equal(review.verdict, "approve");
  });

  it("strips an accidental markdown fence", () => {
    const fenced = "```json\n" + JSON.stringify(makeReview()) + "\n```";
    assert.equal(parseReviewResponse(fenced).verdict, "approve");
  });

  it("throws the JSON error (with raw attached) on garbled output", () => {
    assert.throws(
      () => parseReviewResponse("Sure! Here is my review: it looks fine."),
      (err) => err.message.includes("not with valid JSON") && err.raw.includes("Sure!"),
    );
  });

  it("throws the contract error on valid JSON that violates the schema", () => {
    const review = makeReview();
    review.criteria = review.criteria.slice(1);
    assert.throws(
      () => parseReviewResponse(JSON.stringify(review)),
      (err) => err.message.includes("violates the review contract"),
    );
  });
});
