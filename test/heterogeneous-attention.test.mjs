import assert from "node:assert/strict";
import test from "node:test";

import { computeAttentionFrontier, frontierProblem, RESOURCE_DIMENSIONS } from "../src/heterogeneous-attention.mjs";

const cost = (humanReentries = 0, computeMillis = 0, cashCents = 0, wallMinutes = 0) =>
  ({ humanReentries, computeMillis, cashCents, wallMinutes });
const budgets = cost(1, 100, 0, 20);
const authority = { controller: "urn:office:leader-movement", basis: "observed source, inquiry only" };
const candidate = (id, benefits, changes = {}) => ({
  id, kind: "science-question", source: "urn:source:" + id,
  claim: "Original claim " + id, receiver: "urn:receiver:science",
  valuation: { source: "urn:estimate:" + id, cost: cost(1, 10, 0, 5), benefits },
  ...changes,
});
const request = (candidates, overrides = {}) => ({
  mode: "heterogeneous-frontier", budgets, candidates, authority, ...overrides,
});

test("unpriced heterogeneous ideas remain intact, while distinct receiver gains remain incomparable", () => {
  const a = candidate("a", { "urn:condition:science-proof": 1 });
  const b = candidate("b", { "urn:condition:public-handoff": 1 });
  const incoming = { id: "spark", kind: "hypothesis", source: "urn:leader:utterance:17",
    claim: "What if semiotic foam supported this?", receiver: null };
  const result = computeAttentionFrontier(request([incoming, b, a]));
  assert.equal(result.status, "exact");
  assert.equal(result.theoremReceipt, null);
  assert.deepEqual(result.held, [{
    id: "spark", kind: "hypothesis", source: "urn:leader:utterance:17",
    claim: incoming.claim, receiver: null, disposition: "unpriced:valuation-unknown",
  }]);
  assert.deepEqual(result.intake.map((x) => x.id), ["a", "b", "spark"]);
  assert.ok(result.alternatives.some((a) => a.selected.join(",") === "a"));
  assert.ok(result.alternatives.some((a) => a.selected.join(",") === "b"));
  assert.ok(result.alternatives.every((a) => a.selected.length <= 1));
  assert.deepEqual(result.benefitDimensions,
    ["urn:condition:public-handoff", "urn:condition:science-proof"]);
});

test("candidate order cannot set the outcome or change provenance", () => {
  const candidates = [
    candidate("c", { "urn:condition:c": 2 }),
    candidate("a", { "urn:condition:a": 1 }),
    candidate("b", { "urn:condition:b": 3 }),
  ];
  assert.deepEqual(
    computeAttentionFrontier(request(candidates)),
    computeAttentionFrontier(request([...candidates].reverse())),
  );
});

test("dependency closure and exclusions are honored without inventing authority", () => {
  const setup = candidate("setup", { "urn:condition:reusable-research-capability": 1 },
    { valuation: { source: "urn:estimate:setup", cost: cost(0, 20, 0, 2), benefits: { "urn:condition:reusable-research-capability": 1 } } });
  const science = candidate("science", { "urn:condition:proved-claim": 1 }, { requires: ["setup"] });
  const distraction = candidate("distraction", { "urn:condition:public-handoff": 1 },
    { excludes: ["science"] });
  const result = computeAttentionFrontier(request([science, setup, distraction], {
    budgets: cost(2, 100, 0, 30),
  }));
  assert.equal(result.status, "exact");
  for (const alt of result.alternatives) {
    if (alt.selected.includes("science")) {
      assert.ok(alt.selected.includes("setup"));
      assert.ok(!alt.selected.includes("distraction"));
    }
  }
  assert.ok(result.alternatives.some((alt) => alt.selected.includes("science")));
});

test("a dependency with unpriced prerequisites is held, not optimized as a phantom benefit", () => {
  const setup = candidate("setup", { "urn:condition:setup": 1 }, { valuation: null });
  const followup = candidate("followup", { "urn:condition:followup": 1 }, { requires: ["setup"] });
  const result = computeAttentionFrontier(request([followup, setup]));
  assert.deepEqual(result.held.map((x) => [x.id, x.disposition]), [
    ["followup", "held:unpriced-prerequisite"],
    ["setup", "unpriced:valuation-unknown"],
  ]);
  assert.equal(result.qualifiedCount, 0);
  assert.deepEqual(result.alternatives[0].selected, []);
});

test("different resource dimensions are kept separate, never summed as energy or WIT", () => {
  const human = candidate("human", { "urn:condition:decision": 1 });
  const compute = candidate("compute", { "urn:condition:simulation": 1 }, {
    valuation: { source: "urn:estimate:compute", cost: cost(0, 90, 0, 15),
      benefits: { "urn:condition:simulation": 1 } },
  });
  const result = computeAttentionFrontier(request([compute, human]));
  assert.ok(result.alternatives.some((alt) => alt.selected.join(",") === "compute,human"));
  const restricted = computeAttentionFrontier(request([human, compute], { budgets: cost(0, 100, 0, 20) }));
  assert.ok(restricted.alternatives.every((alt) => !alt.selected.includes("human")));
  assert.deepEqual(RESOURCE_DIMENSIONS,
    ["humanReentries", "computeMillis", "cashCents", "wallMinutes"]);
});

test("duplicate ids, missing exact sources, unsourced gains and bad cost units are refused", () => {
  const good = candidate("a", { "urn:condition:outcome": 1 });
  assert.match(frontierProblem(request([good, good])), /duplicate/);
  assert.match(frontierProblem(request([{ ...good, source: "" }])), /source, original claim/);
  assert.match(frontierProblem(request([{ ...good,
    valuation: { ...good.valuation, benefits: { "urn:condition:outcome": 1.2 } },
  }])), /valuation requires/);
  assert.match(frontierProblem(request([{ ...good,
    valuation: { ...good.valuation, cost: cost(0, 1.1, 0, 0) },
  }])), /valuation requires/);
  assert.match(frontierProblem(request([{ ...good, requires: ["nonexistent"] }])), /unknown requires/);
  assert.match(frontierProblem(request([good], { budgets: { humanReentries: 1 } })),
    /four explicit/);
});

test("large qualified sets refuse an implicit greedy priority while retaining the full intake", () => {
  const candidates = Array.from({ length: 13 }, (_, i) =>
    candidate("c" + i, { "urn:condition:useful": 1 }));
  const result = computeAttentionFrontier(request(candidates));
  assert.equal(result.status, "needs-decomposition");
  assert.equal(result.qualifiedCount, 13);
  assert.equal(result.intake.length, 13);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.theoremReceipt, null);
});

test("an excessively wide exact Pareto set is disclosed rather than truncated", () => {
  const candidates = Array.from({ length: 9 }, (_, i) =>
    candidate("c" + i, { ["urn:condition:" + i]: 1 }));
  const result = computeAttentionFrontier(request(candidates, { budgets: cost(9, 100, 0, 50) }));
  assert.equal(result.status, "frontier-too-wide");
  assert.equal(result.intake.length, 9);
  assert.deepEqual(result.alternatives, []);
});

test("cyclic prerequisites refuse an impossible sequential attention plan", () => {
  const a = candidate("a", { "urn:condition:one": 1 }, { requires: ["b"] });
  const b = candidate("b", { "urn:condition:two": 1 }, { requires: ["a"] });
  assert.match(frontierProblem(request([a, b])), /cyclic requires/);
  assert.throws(() => computeAttentionFrontier(request([a, b])), /cyclic requires/);
});


test("one additional compute headroom gauge identifies newly affordable source Work without human reentry", () => {
  const cheap = candidate("cheap", {"urn:condition:public-accept":1},
    {valuation:{source:"urn:measured:budget:cheap",cost:cost(0,10,0,1),
      benefits:{"urn:condition:public-accept":1}}});
  const compute = candidate("compute",{"urn:condition:science-accept":2},
    {valuation:{source:"urn:measured:budget:compute",cost:cost(0,60,0,3),
      benefits:{"urn:condition:science-accept":2}}});
  const r = computeAttentionFrontier(request([compute,cheap], {
    budgets:cost(0,10,0,20),
    sensitivity:{resource:"computeMillis",increment:50},
  }));
  assert.equal(r.status,"exact");
  assert.equal(r.theoremReceipt,null);
  assert.equal(r.sensitivityGauge.kind,"attention-economics.resource-sensitivity-gauge/v1");
  assert.equal(r.sensitivityGauge.status,"exact-conditional-comparison");
  assert.deepEqual(r.sensitivityGauge.newlyBudgetFeasibleFrontierAlternatives.map(x=>x.selected),[["compute"]]);
  assert.deepEqual(r.sensitivityGauge.conditionalDifferences["urn:condition:science-accept"],{
    baselineMax:0,expandedMax:2,
    finiteDifferencePerResourceUnit:{numerator:"2",denominator:"50"},
  });
  assert.deepEqual(r.sensitivityGauge.conditionalDifferences["urn:condition:public-accept"],{
    baselineMax:1,expandedMax:1,
    finiteDifferencePerResourceUnit:{numerator:"0",denominator:"50"},
  });
  assert.equal(r.sensitivityGauge.authority,"conditional-readout-only");
});

test("sensitivity preserves base comparison, outside option, source claims and zero-cash boundary", () => {
  const a = candidate("a",{"urn:condition:a":1},
    {valuation:{source:"urn:valuation:a",cost:cost(0,5,0,1),benefits:{"urn:condition:a":1}}});
  const spark = {id:"spark",kind:"hypothesis",source:"urn:leader:utterance",claim:"unpriced idea",receiver:null};
  const plain = computeAttentionFrontier(request([a,spark],{budgets:cost(0,5,0,3)}));
  const gauged = computeAttentionFrontier(request([a,spark],{
    budgets:cost(0,5,0,3),sensitivity:{resource:"computeMillis",increment:5},
  }));
  assert.deepEqual(gauged.alternatives,plain.alternatives);
  assert.deepEqual(gauged.held,plain.held);
  assert.equal(gauged.intake.find(x=>x.id==="spark").claim,"unpriced idea");
  assert.equal(gauged.budgets.cashCents,0);
  assert.equal(gauged.sensitivityGauge.newlyBudgetFeasibleFrontierAlternatives.length,0);
  const cashHypothetical = computeAttentionFrontier(request([a],{
    budgets:cost(0,5,0,3),sensitivity:{resource:"cashCents",increment:1},
  }));
  assert.equal(cashHypothetical.sensitivityGauge.authority,"conditional-readout-only");
  assert.equal(cashHypothetical.budgets.cashCents,0);
});

test("invalid, overflowing and indeterminate sensitivity readings refuse false prices", () => {
  const a=candidate("a",{"urn:condition:accept":1});
  for(const sensitivity of [
    {resource:"tokens",increment:1},
    {resource:"computeMillis",increment:0},
    {resource:"computeMillis",increment:0.5},
    {resource:"computeMillis",increment:-1},
    {resource:"computeMillis",increment:1,granted:true},
  ]) assert.match(frontierProblem(request([a],{sensitivity})),/sensitivity requires/);
  assert.match(frontierProblem(request([a],{
    budgets:cost(0,Number.MAX_SAFE_INTEGER,0,0),
    sensitivity:{resource:"computeMillis",increment:1},
  })),/sensitivity requires/);
  const candidates=Array.from({length:13},(_,i)=>candidate("c"+i,{"urn:condition:useful":1}));
  const indeterminate=computeAttentionFrontier(request(candidates,{
    sensitivity:{resource:"computeMillis",increment:25},
  }));
  assert.equal(indeterminate.sensitivityGauge.status,"indeterminate");
  assert.equal(indeterminate.sensitivityGauge.conditionalDifferences,undefined);
  assert.equal(indeterminate.sensitivityGauge.theoremReceipt,null);
});
