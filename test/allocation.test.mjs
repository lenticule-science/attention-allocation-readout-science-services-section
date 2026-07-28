import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateBudget, attestMathematicalSources, computeAllocation } from "../src/allocation.mjs";

test("admitted mathematical source bytes still match", () => {
  const attestation = attestMathematicalSources();
  assert.equal(attestation.sources.every((source) => source.matches), true);
  assert.match(attestation.assurance.limitation, /not a formally verified extraction/);
  assert.match(attestation.assurance.limitation, /relative-tolerance band/);
});

test("the exact optimum is chosen within budget", () => {
  const result = computeAllocation({
    budget: 5,
    candidates: [
      { id: "a", cost: 2, benefit: 5 },
      { id: "b", cost: 3, benefit: 6 },
      { id: "c", cost: 5, benefit: 9 },
    ],
  });
  assert.deepEqual(result.funded, ["a", "b"]);
  assert.equal(result.totalCost, 5);
  assert.equal(result.totalBenefit, 11);
  assert.equal(result.consideredCount, 3);
  assert.equal(result.fundedCount, 2);
  assert.equal(result.choiceBits, 0);
  assert.equal(result.exact, true);
});

test("a tighter budget funds only the single affordable candidate", () => {
  const result = computeAllocation({
    budget: 4,
    candidates: [
      { id: "a", cost: 2, benefit: 5 },
      { id: "b", cost: 3, benefit: 6 },
    ],
  });
  assert.deepEqual(result.funded, ["b"]);
  assert.equal(result.totalBenefit, 6);
  assert.equal(result.exact, true);
});

test("budget below every cost funds nothing", () => {
  const result = computeAllocation({
    budget: 1,
    candidates: [{ id: "a", cost: 2, benefit: 5 }],
  });
  assert.deepEqual(result.funded, []);
  assert.equal(result.totalCost, 0);
  assert.equal(result.choiceBits, 0);
});

test("an exact tie is disclosed as a positive choiceBits", () => {
  const result = computeAllocation({
    budget: 3,
    candidates: [
      { id: "a", cost: 3, benefit: 9 },
      { id: "b", cost: 3, benefit: 9 },
    ],
  });
  assert.equal(result.totalBenefit, 9);
  assert.equal(result.fundedCount, 1);
  assert.equal(result.choiceBits, 1);
});

test("above the exact-enumeration limit the greedy fallback runs and does not claim exactness", () => {
  const candidates = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, cost: i + 1, benefit: (i + 1) * 2 }));
  const result = computeAllocation({ budget: 1000, candidates });
  assert.equal(result.exact, false);
  assert.equal(result.choiceBits, null);
});

test("inadmissible requests are refused", () => {
  assert.throws(() => computeAllocation({ budget: 0, candidates: [{ id: "a", cost: 1, benefit: 1 }] }), /positive finite number/);
  assert.throws(() => computeAllocation({ budget: 5, candidates: [] }), /non-empty list/);
  assert.throws(() => computeAllocation({ budget: 5, candidates: [{ id: "a", cost: -1, benefit: 1 }] }), /positive finite cost/);
  assert.throws(() => computeAllocation({ budget: 5, candidates: [{ id: "a", cost: 1, benefit: 1 }, { id: "a", cost: 2, benefit: 2 }] }), /duplicate candidate id/);
});

test("allocateBudget filters non-positive or non-finite candidates before allocating", () => {
  const result = allocateBudget([
    { id: "a", cost: 1, benefit: 2 },
    { id: "bad-cost", cost: 0, benefit: 5 },
    { id: "bad-benefit", cost: 1, benefit: -1 },
    { id: "bad-finite", cost: Infinity, benefit: 3 },
  ], 10);
  assert.deepEqual(result.funded, ["a"]);
});
