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
import { join, resolve } from "node:path";

const SOURCES = [
  {
    declarationFile: "Obsmetrologia/Cohomology/AttentionAllocation.lean",
    sha256: "d4b79f8f28da3276b684d8271f1f9c8ffe87d96220c7081440bb6a3f1ad646f4",
  },
  { declarationFile: "Obsmetrologia/Cohomology/AllocationSolver.lean", sha256: "690143f5487ffda3527d9af80ea0c42cae09636219158f3f66fb43c390849393" },
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
  "Obsmetrologia.Cohomology.Attention.solveL_feasible",
  "Obsmetrologia.Cohomology.Attention.solveL_optimal",
  "Obsmetrologia.Cohomology.Attention.solvers_agree_value",
  "Obsmetrologia.Cohomology.Attention.solveL_isOptimum",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read the original PRIVATE mathematical owner through an explicitly selected,
 * trusted host source root. Never copy private Lean bytes into this public
 * package or fetch a mutable remote HEAD at invocation time.
 *
 * No mounted original source is a truthful 'unavailable', not a digest match,
 * a proof receipt, or a reason to suppress a separately labeled numeric
 * calculation. Any original-source drift remains visible and unqualified.
 */
export function attestMathematicalSources({ sourceRoot = process.env.OBSMETROLOGIA_SOURCE_ROOT } = {}) {
  const root = typeof sourceRoot === "string" && sourceRoot.trim() ? resolve(sourceRoot) : null;
  const sources = SOURCES.map(source => {
    const core = { file: source.declarationFile, expectedSha256: source.sha256 };
    if (root === null) return { ...core, observedSha256: null, matches: false, status: "source-unavailable" };
    let bytes;
    try { bytes = readFileSync(join(root, source.declarationFile)); }
    catch (error) {
      if (error?.code !== "ENOENT") throw new Error("original mathematical source unreadable: source access refused");
      return { ...core, observedSha256: null, matches: false, status: "source-unavailable" };
    }
    const digest = sha256(bytes);
    return { ...core, observedSha256: digest, matches: digest === source.sha256,
      status: digest === source.sha256 ? "matched" : "source-drift" };
  });
  const qualified = sources.every(source => source.status === "matched");
  return {
    library: "@lenticule-science/obsmetrologia",
    owner: "lenticule-science/obsmetrologia (private source; not bundled)",
    status: qualified ? "source-qualified" : sources.some(s => s.status === "source-drift")
      ? "source-drift" : "source-unavailable",
    qualified, sources, declarations: DECLARATIONS,
    assurance: {
      kind: qualified ? "source-pinned-executable-projection" : "unattested-numeric-projection",
      conformance: qualified
        ? "Exact pinned private Lean source digests matched on the executing owner-controlled host; source matching is not a kernel proof or extraction"
        : "No original mathematical theorem receipt: the current private source is not independently matched on this host",
      limitation: "JavaScript is separately implemented, not formally verified extraction; a theorem receipt additionally requires finite safe natural settlement units, exact exhaustive selection, current source digests and independent proof receiving",
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

function exactAllocate(candidates, budget, theoremEligible = false) {
  const n = candidates.length;
  let bestBenefit = -Infinity;
  let bestMask = 0;
  const feasibleMasks = [];
  const masks = (length) => length === 0 ? [0] : (() => { const tail = masks(length - 1).map((mask) => mask << 1); return [...tail, ...tail.map((mask) => mask | 1)]; })();
  // Lean `subs`: tail subsets, then those same subsets with current head consed.
  for (const mask of masks(n)) {
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
    theoremReceipt: theoremEligible && attestMathematicalSources().qualified ? Object.freeze({ kind: "obsmetrologia.attention.solveL:witness", theorems: Object.freeze([
      "Obsmetrologia.Cohomology.Attention.solveL_feasible", "Obsmetrologia.Cohomology.Attention.solveL_optimal",
      "Obsmetrologia.Cohomology.Attention.solvers_agree_value", "Obsmetrologia.Cohomology.Attention.solveL_isOptimum",
    ]), source: attestMathematicalSources().sources.find((source) => source.file === "Obsmetrologia/Cohomology/AllocationSolver.lean"), premises: "safe natural settlement units; exhaustive powerset search" }) : null,
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
  const theoremEligible = isSafeNat(budget) && positive.every((c) => isSafeNat(c.cost) && isSafeNat(c.benefit))
    && positive.reduce((sum, c) => sum + c.cost, 0) <= Number.MAX_SAFE_INTEGER
    && positive.reduce((sum, c) => sum + c.benefit, 0) <= Number.MAX_SAFE_INTEGER;
  return positive.length <= MAX_EXACT_CANDIDATES ? exactAllocate(positive, budget, theoremEligible) : greedyAllocate(positive, budget);
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
