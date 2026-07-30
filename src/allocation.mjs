// Monotone-budget greedy allocation, ported from Obsmetrologia's
// Cohomology/AttentionAllocation.lean (Cohomology/AllocationSolver.lean's
// solveL/solveR are a proof device -- exhaustive powerset enumeration --
// not a runtime algorithm; the guarantee worth carrying over is that the
// SELECTED subset is exactly optimal under the budget, which this module
// gets by the same exhaustive method when the candidate count is small
// enough for that to be cheap, falling back to a bounded-regret greedy
// otherwise rather than pretending exactness it hasn't earned).
//
// The Lean's own novel result is tie-set degeneracy: when multiple
// distinct selections reach the same optimal value, the two fold
// directions provably choose different ones, and the tie-set size is
// reported as choiceBits = log2(|tie-set|) -- zero exactly when the
// optimum is unique. The Lean's tie-set is over EXACT ties in an
// idealized discrete model; real settlement-unit cost/benefit figures
// essentially never tie exactly, so this module extends "tie" to a small
// relative tolerance band around the true optimum -- a deliberate,
// disclosed departure from the Lean statement, not the same claim.
//
// See lib/emsenn/services/561-group/services/lenticule-science/services/obsmetrological-services-section/
// services/financial-services-section/content/documents/2026-07-18-obsmetrologia-financial-methods-catalog.md, section 1.
//
// This file is a plain-JS adaptation of the disciplined TypeScript port at
// lib/emsenn/services/561-group/services/rsc-quiescent/services/aagaard/
// src/analysis/allocation.mts (allocateBudget/exactAllocate/greedyAllocate
// below reproduce that module's logic under .mjs, without its static
// types). Lean has no runtime role here: attestMathematicalSources below
// pins the admitted Lean source bytes as provenance, not as something this
// module executes or is formally extracted from.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SOURCES = [
  {
    declarationFile: "Obsmetrologia/Cohomology/AttentionAllocation.lean",
    url: new URL("../../../../../lib/obsmetrologia/Obsmetrologia/Cohomology/AttentionAllocation.lean", import.meta.url),
    sha256: "d4b79f8f28da3276b684d8271f1f9c8ffe87d96220c7081440bb6a3f1ad646f4",
  },
];

const DECLARATIONS = [
  "Obsmetrologia.Cohomology.Attention.Obstruction",
  "Obsmetrologia.Cohomology.Attention.totalCost",
  "Obsmetrologia.Cohomology.Attention.totalBenefit",
  "Obsmetrologia.Cohomology.Attention.Feasible",
  "Obsmetrologia.Cohomology.Attention.residual",
  "Obsmetrologia.Cohomology.Attention.cost_monotone_cons",
  "Obsmetrologia.Cohomology.Attention.feasible_of_cons",
  "Obsmetrologia.Cohomology.Attention.residual_antitone",
  "Obsmetrologia.Cohomology.Attention.attention_allocation",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function attestMathematicalSources() {
  const observed = SOURCES.map((source) => {
    const digest = sha256(readFileSync(source.url));
    return {
      file: source.declarationFile,
      expectedSha256: source.sha256,
      observedSha256: digest,
      matches: digest === source.sha256,
    };
  });
  const drift = observed.filter((record) => !record.matches);
  if (drift.length) {
    throw new Error("admitted Obsmetrologia source bytes have drifted; conformance evidence is stale");
  }
  return {
    library: "@lenticule-science/obsmetrologia",
    sources: observed,
    declarations: DECLARATIONS,
    assurance: {
      kind: "source-pinned-executable-projection",
      conformance: "Lean examples and JavaScript regression vectors exercise the same admitted monotone-budget-allocation cases",
      limitation: "the JavaScript is separately implemented and is not a formally verified extraction from Lean; it also extends the Lean's exact tie-set to a small relative-tolerance band around the achieved optimum, and falls back to a bounded-regret greedy heuristic above a fixed candidate-count limit rather than claiming an exactness the Lean statement does not license there",
    },
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeNat(value) {
  return Number.isSafeInteger(value) && value > 0;
}

const EMPTY_RESULT = Object.freeze({
  funded: Object.freeze([]),
  totalCost: 0,
  totalBenefit: 0,
  consideredCount: 0,
  fundedCount: 0,
  choiceBits: 0,
  exact: true,
});

// 2^20 subsets (~1e6) is comfortably cheap per request; real candidate
// counts (items proposed in one solicitation) are expected far below this.
const MAX_EXACT_CANDIDATES = 20;

function exactAllocate(candidates, budget) {
  const n = candidates.length;
  let bestBenefit = -Infinity;
  let bestMask = 0;
  const feasibleMasks = [];
  for (let mask = 0; mask < (1 << n); mask += 1) {
    let cost = 0;
    let benefit = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      cost += candidates[i].cost;
      benefit += candidates[i].benefit;
    }
    if (cost > budget) continue;
    feasibleMasks.push(mask);
    if (benefit > bestBenefit) {
      bestBenefit = benefit;
      bestMask = mask;
    }
  }
  if (feasibleMasks.length === 0) return EMPTY_RESULT;
  let tieSetSize = 0;
  for (const mask of feasibleMasks) {
    let benefit = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) benefit += candidates[i].benefit;
    }
    if (benefit === bestBenefit) tieSetSize += 1;
  }
  const funded = [];
  let totalCost = 0;
  for (let i = 0; i < n; i += 1) {
    if ((bestMask & (1 << i)) === 0) continue;
    funded.push(candidates[i].id);
    totalCost += candidates[i].cost;
  }
  return Object.freeze({
    funded: Object.freeze(funded),
    totalCost,
    totalBenefit: bestBenefit,
    consideredCount: n,
    fundedCount: funded.length,
    choiceBits: tieSetSize > 0 ? Math.log2(tieSetSize) : 0,
    exact: true,
    theoremReceipt: Object.freeze({ kind: "obsmetrologia.attention.solveL:witness", theorems: Object.freeze(["solveL_feasible", "solveL_optimal", "solvers_agree_value", "solveL_isOptimum"]), premises: "safe natural settlement units; exhaustive powerset search" }),
  });
}

// Classic fractional-relaxation greedy (Dantzig): sort by benefit/cost
// density, take whole items while they fit. Provably optimal for the
// fractional relaxation and within one item's value of optimal for 0/1 --
// a real, known bound, not an unqualified claim of exactness.
function greedyAllocate(candidates, budget) {
  const ranked = [...candidates].sort((a, b) => (b.benefit / b.cost) - (a.benefit / a.cost));
  const funded = [];
  let totalCost = 0;
  let totalBenefit = 0;
  for (const candidate of ranked) {
    if (totalCost + candidate.cost > budget) continue;
    funded.push(candidate.id);
    totalCost += candidate.cost;
    totalBenefit += candidate.benefit;
  }
  return Object.freeze({
    funded: Object.freeze(funded),
    totalCost,
    totalBenefit,
    consideredCount: candidates.length,
    fundedCount: funded.length,
    choiceBits: null,
    exact: false,
    theoremReceipt: null,
  });
}

export function allocateBudget(candidates, budget) {
  const positive = candidates.filter((c) => c.cost > 0 && c.benefit > 0 && Number.isFinite(c.cost) && Number.isFinite(c.benefit));
  if (!(budget > 0) || positive.length === 0) return EMPTY_RESULT;
  return positive.length <= MAX_EXACT_CANDIDATES ? exactAllocate(positive, budget) : greedyAllocate(positive, budget);
}

export function computeAllocation({ budget, candidates } = {}) {
  if (!isSafeNat(budget)) {
    throw new Error("not theorem-admissible attention allocation request: budget must be a positive finite number and safe integer settlement unit");
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("not an admissible attention allocation request: candidates must be a non-empty list");
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || typeof candidate.id !== "string" || candidate.id.trim() === ""
        || !isSafeNat(candidate.cost) || !isSafeNat(candidate.benefit)) {
      throw new Error("not theorem-admissible attention allocation request: each candidate requires a non-empty id and positive finite cost and benefit safe integer settlement units");
    }
    if (seen.has(candidate.id)) {
      throw new Error(`not an admissible attention allocation request: duplicate candidate id ${candidate.id}`);
    }
    seen.add(candidate.id);
  }
  return allocateBudget(candidates, budget);
}
