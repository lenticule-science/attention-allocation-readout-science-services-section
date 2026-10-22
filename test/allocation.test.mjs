import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateBudget, attestMathematicalSources, computeAllocation } from "../src/allocation.mjs";

test("private original mathematical sources are independently qualified or explicitly unavailable", () => {
  const attestation = attestMathematicalSources();
  assert.equal(attestation.qualified, attestation.sources.every(source => source.matches));
  assert.match(attestation.assurance.limitation, /not formally verified extraction/);
  assert.match(attestation.assurance.limitation, /safe natural settlement units/);
  assert.equal(attestation.sources.length, 2);
  assert.ok(attestation.sources.every(source => source.expectedSha256.length === 64));
  if (!process.env.OBSMETROLOGIA_SOURCE_ROOT) {
    assert.equal(attestation.status, "source-unavailable");
    assert.equal(attestation.qualified, false);
    assert.equal(attestation.sources.every(source => source.observedSha256 === null), true);
  }
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
  if (attestMathematicalSources().qualified) {
    assert.equal(result.theoremReceipt.theorems[0], "Obsmetrologia.Cohomology.Attention.solveL_feasible");
  } else {
    assert.equal(result.theoremReceipt, null,
      "public scalar arithmetic without verified private Lean bytes cannot claim a theorem receipt");
  }
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
  assert.equal(result.theoremReceipt, null);
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

test("public numeric exact computation never leaks a theorem receipt outside Nat premises", () => {
  const result = allocateBudget([{ id: "fraction", cost: 1.5, benefit: 2.5 }], 2.5);
  assert.equal(result.exact, true);
  assert.equal(result.theoremReceipt, null);
});

test("unsafe aggregate suppresses theorem receipt", () => {
  const result = allocateBudget([{ id: "a", cost: Number.MAX_SAFE_INTEGER, benefit: 1 }, { id: "b", cost: 1, benefit: 1 }], Number.MAX_SAFE_INTEGER);
  assert.equal(result.theoremReceipt, null);
});

test("Lean solveL chirality keeps the second equal-benefit bead", () => {
  const result = computeAllocation({ budget: 2, candidates: [{ id: "bead1", cost: 1, benefit: 5 }, { id: "bead2", cost: 2, benefit: 5 }] });
  assert.deepEqual(result.funded, ["bead2"]);
});

test("a declared-but-unmounted private source and a substituted fake source cannot mint a theorem receipt", async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "private-math-attestation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const absent = attestMathematicalSources({ sourceRoot: root });
  assert.equal(absent.status, "source-unavailable");
  assert.equal(absent.qualified, false);
  mkdirSync(join(root, "Obsmetrologia", "Cohomology"), { recursive: true });
  writeFileSync(join(root, "Obsmetrologia", "Cohomology", "AttentionAllocation.lean"),
    "-- deliberately NOT the original private mathematical source");
  const forged = attestMathematicalSources({ sourceRoot: root });
  assert.equal(forged.status, "source-drift");
  assert.equal(forged.qualified, false);
  assert.ok(forged.sources.some(source => source.status === "source-drift"));
  assert.ok(forged.sources.some(source => source.status === "source-unavailable"));
  assert.equal(forged.sources.every(source => !Object.hasOwn(source, "content")), true);
});
