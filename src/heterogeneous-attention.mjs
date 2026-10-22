// Source-qualified heterogeneous attention, not a second Work queue.
// All incoming claim surfaces survive an unpriced or combinatorially bounded readout.
// A projected benefit is a caller assertion, never a WIT/ACK, settled receipt,
// independent permission, Landauer bit, clinical attention measurement, or payment.
// The model assumes additive sequential costs and outcomes only for the bounded
// comparison. Source-linked complementarity is represented through requires.
// Non-additive outcomes still need explicit evidence and further research.

export const RESOURCE_DIMENSIONS = Object.freeze([
  "humanReentries", "computeMillis", "cashCents", "wallMinutes",
]);
const MAX_EXACT = 12;
const MAX_ALTERNATIVES = 128;
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;
const natural = (v) => Number.isSafeInteger(v) && v >= 0;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v, allowed) => record(v) && Object.keys(v).every((key) => allowed.includes(key));
const allDimensions = (v) => record(v) &&
  Object.keys(v).length === RESOURCE_DIMENSIONS.length &&
  RESOURCE_DIMENSIONS.every((key) => natural(v[key]));

function vectorZero() {
  return Object.fromEntries(RESOURCE_DIMENSIONS.map((key) => [key, 0]));
}

export function frontierProblem(request) {
  if (!exactKeys(request, ["mode", "budgets", "candidates", "authority", "sensitivity"]) ||
      request.mode !== "heterogeneous-frontier") {
    return "frontier request must carry only mode=heterogeneous-frontier, budgets, candidates, and authority";
  }
  if (!allDimensions(request.budgets)) {
    return "budgets require four explicit, non-negative, safe integer dimensions: " +
      RESOURCE_DIMENSIONS.join(", ");
  }
  if (request.sensitivity !== undefined) {
    const gauge = request.sensitivity;
    if (!exactKeys(gauge, ["resource", "increment"]) ||
        !RESOURCE_DIMENSIONS.includes(gauge.resource) ||
        !Number.isSafeInteger(gauge.increment) || gauge.increment <= 0 ||
        !Number.isSafeInteger(request.budgets[gauge.resource] + gauge.increment)) {
      return "sensitivity requires one resource dimension and an exact, bounded positive integer increment";
    }
  }
  if (!Array.isArray(request.candidates) || request.candidates.length === 0) {
    return "frontier candidates must be a non-empty list";
  }
  const authority = request.authority;
  if (!exactKeys(authority, ["controller", "basis"]) ||
      !nonempty(authority.controller) || !nonempty(authority.basis)) {
    return "authority must carry only non-empty controller and basis";
  }
  const ids = new Set();
  for (const c of request.candidates) {
    if (!exactKeys(c, ["id", "kind", "source", "claim", "receiver", "requires", "excludes", "valuation"]) ||
        !nonempty(c.id) || !nonempty(c.kind) || !nonempty(c.source) || !nonempty(c.claim) ||
        !(c.receiver == null || nonempty(c.receiver))) {
      return "candidate requires source, original claim, kind and id; receiver may be null";
    }
    if (ids.has(c.id)) return "duplicate candidate id " + c.id;
    ids.add(c.id);
    for (const field of ["requires", "excludes"]) {
      if (c[field] !== undefined && (!Array.isArray(c[field]) ||
          c[field].some((value) => !nonempty(value) || value === c.id) ||
          new Set(c[field]).size !== c[field].length)) {
        return c.id + ": " + field + " must be distinct other candidate ids";
      }
    }
    if (c.valuation == null) continue; // The input stays held without a fabricated number.
    if (!exactKeys(c.valuation, ["source", "cost", "benefits"]) ||
        !nonempty(c.valuation.source) || !allDimensions(c.valuation.cost) ||
        !record(c.valuation.benefits) || Object.keys(c.valuation.benefits).length === 0 ||
        Object.entries(c.valuation.benefits).some(([key, value]) => !nonempty(key) || !natural(value))) {
      return c.id + ": valuation requires its source, four resource costs and non-negative source-qualified condition gains";
    }
    if (!Object.values(c.valuation.benefits).some((value) => value > 0)) {
      return c.id + ": a zero-gain valuation cannot justify purchasing attention";
    }
  }
  for (const c of request.candidates) {
    for (const field of ["requires", "excludes"]) {
      for (const ref of c[field] ?? []) {
        if (!ids.has(ref)) return c.id + ": unknown " + field + " reference " + ref;
      }
    }
  }
  // A directed prerequisite cycle is not an executable sequential plan, even
  // if its members could be selected together as an algebraic closed set.
  const indegree = new Map(request.candidates.map((c) => [c.id, (c.requires ?? []).length]));
  const dependents = new Map(request.candidates.map((c) => [c.id, []]));
  for (const c of request.candidates) {
    for (const dependency of c.requires ?? []) dependents.get(dependency).push(c.id);
  }
  const ready = request.candidates.filter((c) => indegree.get(c.id) === 0).map((c) => c.id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    visited += 1;
    for (const dependent of dependents.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
  }
  if (visited !== request.candidates.length) return "cyclic requires: sequential prerequisites cannot all precede each other";
  return null;
}

function dominance(a, b, gainDimensions) {
  let strict = false;
  for (const key of RESOURCE_DIMENSIONS) {
    if (a.cost[key] > b.cost[key]) return false;
    if (a.cost[key] < b.cost[key]) strict = true;
  }
  for (const key of gainDimensions) {
    const lhs = a.projected[key] ?? 0, rhs = b.projected[key] ?? 0;
    if (lhs < rhs) return false;
    if (lhs > rhs) strict = true;
  }
  return strict;
}

function computeAttentionFrontierCore(request) {
  const problem = frontierProblem(request);
  if (problem) throw new Error(problem);
  const original = [...request.candidates].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const dispositions = new Map();
  for (const c of original) {
    if (!c.valuation) dispositions.set(c.id, "unpriced:valuation-unknown");
    else if (!c.receiver) dispositions.set(c.id, "unpriced:receiver-unknown");
  }
  // Do not silently rank an action whose prerequisites were not qualified.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of original) {
      if (dispositions.has(c.id)) continue;
      if ((c.requires ?? []).some((ref) => dispositions.has(ref))) {
        dispositions.set(c.id, "held:unpriced-prerequisite");
        changed = true;
      }
    }
  }
  const eligible = original.filter((c) => !dispositions.has(c.id));
  const intake = original.map((c) => ({
    id: c.id, kind: c.kind, source: c.source, claim: c.claim,
    receiver: c.receiver ?? null,
    disposition: dispositions.get(c.id) ?? "qualified:conditional-valuation",
  }));
  const held = intake.filter((item) => !item.disposition.startsWith("qualified"));
  const common = {
    mode: "heterogeneous-frontier", model: "conditional-pareto-v1",
    status: "exact", candidateCount: original.length,
    qualifiedCount: eligible.length, held, intake,
    budgets: { ...request.budgets },
    assumptions: [
      "All projected benefits and costs are customer-supplied estimates, not verified acceptance.",
      "Costs and condition-specific gains add only within this bounded, sequential model.",
      "The readout confers no Work authority and cannot spend, interrupt or settle a claim.",
      "Distinct benefit condition IDs are never converted into a universal utility scalar.",
    ],
    theoremReceipt: null,
  };
  if (eligible.length > MAX_EXACT) {
    return { ...common, status: "needs-decomposition", alternatives: [],
      reason: "more than " + MAX_EXACT + " qualified candidates; preserve all inputs and use an independently justified scope/receiver partition" };
  }
  const benefitDimensions = [...new Set(eligible.flatMap((c) => Object.keys(c.valuation.benefits)))].sort();
  const allIds = eligible.map((c) => c.id);
  const frontier = [];
  for (let mask = 0; mask < 2 ** eligible.length; mask += 1) {
    const selected = eligible.filter((_, i) => (mask & (1 << i)) !== 0);
    const ids = new Set(selected.map((c) => c.id));
    if (selected.some((c) => (c.requires ?? []).some((id) => !ids.has(id)) ||
        (c.excludes ?? []).some((id) => ids.has(id)))) continue;
    const cost = vectorZero(), projected = {};
    let overBudget = false;
    for (const c of selected) {
      for (const key of RESOURCE_DIMENSIONS) {
        const sum = cost[key] + c.valuation.cost[key];
        if (!Number.isSafeInteger(sum) || sum > request.budgets[key]) {
          overBudget = true;
          break;
        }
        cost[key] = sum;
      }
      if (overBudget) break;
      for (const [key, value] of Object.entries(c.valuation.benefits)) {
        const sum = (projected[key] ?? 0) + value;
        if (!Number.isSafeInteger(sum)) {
          throw new Error("unsafe aggregate for projected condition " + key);
        }
        projected[key] = sum;
      }
    }
    if (overBudget) continue;
    const option = {
      selected: [...ids].sort(),
      deferred: allIds.filter((id) => !ids.has(id)),
      cost, projected,
    };
    if (frontier.some((x) => dominance(x, option, benefitDimensions))) continue;
    for (let i = frontier.length - 1; i >= 0; i -= 1) {
      if (dominance(option, frontier[i], benefitDimensions)) frontier.splice(i, 1);
    }
    frontier.push(option);
  }
  frontier.sort((a, b) => a.selected.length - b.selected.length ||
    a.selected.join("\u0000").localeCompare(b.selected.join("\u0000"), "en"));
  if (frontier.length > MAX_ALTERNATIVES) {
    return { ...common, status: "frontier-too-wide", alternatives: [],
      reason: "more than " + MAX_ALTERNATIVES + " nondominated alternatives; no alternatives were silently discarded" };
  }
  return { ...common, benefitDimensions, alternatives: frontier, exact: true };
}


/**
 * Finite-difference attention gauge over the SAME source-qualified Work and
 * condition claims. The increment is hypothetical resource headroom, not a
 * budget grant, purchased compute, a price quote or an execution permission.
 * Marginal gains by named receiver condition are separate upper envelopes;
 * their separate maxima need not occur in the same feasible selection.
 * There is no universal utility, shadow-price theorem or ATT/WIT receipt.
 */
export function computeAttentionFrontier(request) {
  const base = computeAttentionFrontierCore(request);
  if (request.sensitivity === undefined) return base;
  const {resource, increment} = request.sensitivity;
  const gauge = {
    kind: "attention-economics.resource-sensitivity-gauge/v1",
    status: "indeterminate", resource, increment,
    baselineBudget: request.budgets[resource],
    expandedBudget: request.budgets[resource] + increment,
    sourceStatus: base.status,
    theoremReceipt: null,
    authority: "conditional-readout-only",
  };
  if (base.status !== "exact") {
    return { ...base, sensitivityGauge: {
      ...gauge, reason: "baseline-frontier-not-exact; no finite difference justified",
    } };
  }
  const expanded = computeAttentionFrontierCore({
    ...request,
    budgets: {...request.budgets, [resource]: gauge.expandedBudget},
    sensitivity: undefined,
  });
  if (expanded.status !== "exact") {
    return { ...base, sensitivityGauge: {
      ...gauge, expandedStatus: expanded.status,
      reason: "expanded-frontier-not-exact; no finite difference justified",
    } };
  }
  const dimensions = [...new Set([...base.benefitDimensions, ...expanded.benefitDimensions])].sort();
  const maximumAt = (frontier, condition) =>
    frontier.alternatives.reduce((best, option) =>
      Math.max(best, option.projected[condition] ?? 0), 0);
  const conditionalDifferences = Object.fromEntries(dimensions.map(condition => {
    const baselineMax = maximumAt(base, condition);
    const expandedMax = maximumAt(expanded, condition);
    return [condition, {
      baselineMax, expandedMax,
      finiteDifferencePerResourceUnit: {
        numerator: String(expandedMax - baselineMax),
        denominator: String(increment),
      },
    }];
  }));
  return { ...base, sensitivityGauge: {
    ...gauge, status:"exact-conditional-comparison",
    expandedStatus: expanded.status,
    newlyBudgetFeasibleFrontierAlternatives: expanded.alternatives
      .filter(option => option.cost[resource] > request.budgets[resource])
      .map(option => ({selected:option.selected,cost:option.cost,projected:option.projected})),
    conditionalDifferences,
    caution:"Per-condition maxima may require incompatible alternatives. These are projected finite differences from source-supplied valuations, NOT an observed shadow price, independent Work ACK, spend authorization or actual new compute capacity.",
  } };
}
