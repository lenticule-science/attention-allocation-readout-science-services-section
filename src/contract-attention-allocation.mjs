#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { semanticId } from "@red-cup-engineering/rmn-semantic-conformance";
import { encodeRelationalValue } from "@red-cup-engineering/rmn-semantic-conformance/relational-value";
import { createSettlementStore } from "@lenticule-science/witness-journal-rdf-projection-service/client";

import { ATTENTION_ALLOCATION_CONTRACT } from "./law.mjs";
import { attestMathematicalSources, computeAllocation } from "./allocation.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const ACTOR = "urn:ame:attention-allocation-readout";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EFFECTS = ["provider-local-rwil-evidence"];

// Resource-price declaration: which of the leader-movement-team's six
// canonical resource dimensions (asset/compute/erasure/gas/time/wit, per
// inference-procurement.mjs's own measures()) this die charges, and how.
// Compute and time are priced by measurement method only -- the request
// alone does not fix how much CPU, RAM, or wall time an allocation will
// cost, so the quoted quantity is null and the actual measured vector on
// the completion receipt is the audit trail against this quote. Unlike
// the sibling mathematical-readout-exchange die, this die's own math
// (choiceBits: tie-set degeneracy, log2 of the optimal-tie-set size) is
// NOT a Landauer/erasure carrier -- it measures selection ambiguity, not
// bits erased. Per root law (AGENTS.md, accounting-for-interactive-
// execution: "Landauer or coordination measure enters the ledger only
// through the contracted Obsmetrologia carrier with recomputable
// incidence evidence"), no such carrier is defined for this die, so
// erasure is declared not-priced rather than inventing one out of
// choiceBits. This is a resource-vector price declaration only -- no
// cash figure, no x402 wiring; see AGENTS.md's "Cost is a local
// measured resource readout, not a settled denomination."
function resourcePrice() {
  return {
    type: "ResourceVectorPriceDeclaration",
    dimensions: [
      { dimension: "asset", unit: "none", priced: false,
        method: "no cash or asset settlement is claimed for this readout" },
      { dimension: "compute", unit: "cpu-microsecond+peak-rss-byte", priced: true, quantity: null,
        method: "cpu-microseconds measured as process.cpuUsage() user+system delta across the invoke call, "
          + "plus peak-rss bytes measured as process.resourceUsage().maxRSS (KiB, reported as bytes) at completion; "
          + "the quantity is not fixed by the request and is reported as the actual measured vector on the completion receipt" },
      { dimension: "erasure", unit: "none", priced: false,
        method: "no Landauer or coordination-measure carrier is defined for the monotone-budget allocation die; "
          + "this die's own choiceBits measures tie-set selection ambiguity, not bits erased, and per root law "
          + "(AGENTS.md) erasure enters the ledger only through a contracted Obsmetrologia carrier with recomputable "
          + "incidence evidence, which does not exist here -- so this dimension is declared not-priced rather than invented" },
      { dimension: "gas", unit: "gas", priced: false,
        method: "no gas carrier is defined for this die" },
      { dimension: "time", unit: "millisecond", priced: true, quantity: null,
        method: "wall-clock milliseconds measured as a process.hrtime.bigint() delta across the invoke call; "
          + "the quantity is not fixed by the request and is reported as the actual measured vector on the completion receipt" },
      { dimension: "wit", unit: "typed-four-cover", priced: false,
        method: "no wit interchangeability is claimed for this die" },
    ],
  };
}

export function semanticDigest(value) {
  const relational = encodeRelationalValue(value);
  return semanticId(["ascribe", relational.type, relational.term]);
}
function identify(body) { return { id: semanticDigest(body), ...body }; }
function contentValid(value) { const { id: _id, ...body } = value ?? {}; return value?.id === semanticDigest(body); }
function operation() {
  const index = process.argv.indexOf("--operation");
  if (index >= 0) return process.argv[index + 1];
  const invoked = basename(process.argv[1] ?? "");
  return invoked === "solicit-service" || invoked === "invoke-service" ? invoked : "invoke-service";
}
function instant() { const index = process.argv.indexOf("--now"); return index >= 0 ? process.argv[index + 1] : new Date().toISOString(); }
function response(type, source, object, at) {
  return identify({ "@context": CONTEXT, type, actor: ACTOR, target: source?.actor ?? null,
    inReplyTo: source?.id ?? null, law: ATTENTION_ALLOCATION_CONTRACT, object, published: at });
}
async function append(store, category, record) {
  await store.record({ category: `attention-allocation-readout-${category}`, recordedAt: record.published ?? record.recordedAt, record });
}
async function reject(store, source, reason, at) {
  const value = response("Reject", source, { type: "AttentionAllocationReadoutRefusal", law: ATTENTION_ALLOCATION_CONTRACT,
    reason, prohibitedEffectsPerformed: false, customerMutation: false, foreignMutation: false }, at);
  await append(store, "refusals", value); return value;
}
function isFiniteNumber(value) { return typeof value === "number" && Number.isFinite(value); }

export function requestProblem(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
      || Object.keys(request).some((key) => !["budget", "candidates", "authority"].includes(key))) {
    return "request must carry only budget, candidates, and authority";
  }
  if (!isFiniteNumber(request.budget) || request.budget <= 0) return "budget must be a positive finite number";
  if (!Array.isArray(request.candidates) || request.candidates.length === 0) return "candidates must be a non-empty list";
  const seen = new Set();
  for (const candidate of request.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || Object.keys(candidate).some((key) => !["id", "cost", "benefit"].includes(key))) {
      return "each candidate must carry only id, cost, and benefit";
    }
    if (typeof candidate.id !== "string" || candidate.id.trim() === "") return "each candidate id must be a non-empty string";
    if (!isFiniteNumber(candidate.cost) || candidate.cost <= 0) return "each candidate cost must be a positive finite number";
    if (!isFiniteNumber(candidate.benefit) || candidate.benefit <= 0) return "each candidate benefit must be a positive finite number";
    if (seen.has(candidate.id)) return `duplicate candidate id ${candidate.id}`;
    seen.add(candidate.id);
  }
  if (!request.authority || typeof request.authority.controller !== "string" || request.authority.controller.trim() === ""
      || typeof request.authority.basis !== "string" || request.authority.basis.trim() === ""
      || Object.keys(request.authority).some((key) => !["controller", "basis"].includes(key))) {
    return "authority must carry only non-empty controller and basis";
  }
  return null;
}
function solicitationProblem(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR
      || activity.object?.type !== "ServiceSolicitation") return "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to Attention Allocation Readout";
  if (activity.object.contract !== ATTENTION_ALLOCATION_CONTRACT) return "solicitation must name the exact normalized RMN law";
  return requestProblem(activity.object.request);
}
async function solicit(store, activity, at) {
  const invalid = solicitationProblem(activity); if (invalid) return reject(store, activity, invalid, at);
  const request = structuredClone(activity.object.request);
  const terms = { type: "UnpricedServiceTerms", law: ATTENTION_ALLOCATION_CONTRACT, assetPaymentRequired: false,
    resourceMeasures: ["compute-seconds", "wall-time-seconds"], witInterchangeabilityClaimed: false,
    erasureInterchangeabilityClaimed: false, gasInterchangeabilityClaimed: false, resourcePrice: resourcePrice() };
  const object = { type: "ExecutableServiceOffer", law: ATTENTION_ALLOCATION_CONTRACT, sourceActivity: activity.id,
    request, requestDigest: semanticDigest(request), terms, termsDigest: semanticDigest(terms), operation: "invoke-service",
    effects: EFFECTS, evidence: ["source-attestation", "provider-local-rwil-evidence", "typed-resource-measures", "completion-or-typed-refusal"] };
  const offer = response("Offer", activity, object, at); await append(store, "offers", offer); return offer;
}
function invocationProblem(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to Attention Allocation Readout";
  const contract = activity.object; const offer = contract?.offer; const terms = offer?.object?.terms;
  if (contract?.type !== "ServiceContract" || contract.law !== ATTENTION_ALLOCATION_CONTRACT) return "invocation must accept the exact normalized RMN law";
  if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.law !== ATTENTION_ALLOCATION_CONTRACT || !contentValid(offer)
      || offer.object?.type !== "ExecutableServiceOffer" || offer.object.law !== ATTENTION_ALLOCATION_CONTRACT) return "ServiceContract must carry this provider's exact authored offer";
  if (offer.object.requestDigest !== semanticDigest(offer.object.request)) return "accepted request differs from provider-authored term";
  if (offer.object.termsDigest !== semanticDigest(terms) || contract.termsAcceptance?.termDigest !== offer.object.termsDigest) return "customer did not accept the provider-authored terms";
  const capability = contract.capability;
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "invocation requires a capability held by this provider";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer";
  if (capability.capTP?.target !== ACTOR || capability.capTP.method !== "invoke-service" || !(capability.allowedActions ?? []).includes("invoke-service")) return "capability does not authorize the exact invoke-service method";
  if (!EFFECTS.every((effect) => (capability.allowedActions ?? []).includes(effect)) || (capability.allowedActions ?? []).includes("customer-write")) return "capability must permit only provider-local RWIL evidence";
  return null;
}
async function invoke(store, activity, at) {
  const invalid = invocationProblem(activity); if (invalid) return reject(store, activity, invalid, at);
  const offer = activity.object.offer; const request = offer.object.request;
  const wallStart = process.hrtime.bigint(); const cpuStart = process.cpuUsage();
  let result;
  try { result = { ...computeAllocation(request), certificate: attestMathematicalSources() }; }
  catch (error) { return reject(store, activity, `readout-could-not-settle:${error.message}`, at); }
  const cpu = process.cpuUsage(cpuStart);
  const wallNanoseconds = process.hrtime.bigint() - wallStart;
  const resources = { type: "TypedResourceVector", computeSeconds: (cpu.user + cpu.system) / 1e6,
    wallTimeSeconds: Number(wallNanoseconds) / 1e9, assetAmount: null, wit: null, erasure: null, gas: null,
    // Actual measured vector for THIS execution, in the same units the quoted
    // terms named (cpu-microseconds, peak-rss bytes, milliseconds), so the
    // quote in offer.object.terms.resourcePrice and the actual measurement
    // here are directly comparable per-dimension. erasure stays null: this
    // die never quoted an erasure price, so there is nothing to audit here.
    cpuMicroseconds: cpu.user + cpu.system, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    timeMilliseconds: Number(wallNanoseconds) / 1e6 };
  const exchange = identify({ type: "AttentionAllocationReadout", law: ATTENTION_ALLOCATION_CONTRACT, outcome: "completion",
    request, requestDigest: offer.object.requestDigest, result, quotedResourcePrice: offer.object.terms.resourcePrice,
    resources, recordedAt: at, customerMutation: false, foreignMutation: false });
  const receipt = identify({ type: "ServicePerformanceReceipt", law: ATTENTION_ALLOCATION_CONTRACT, provider: ACTOR,
    customer: activity.actor, offer: offer.id, invocation: activity.id, fulfillment: exchange.id,
    outcome: exchange.outcome, recordedAt: at, assetSettlementClaimed: false });
  const reply = response("Accept", activity, { type: "AttentionAllocationReadoutResult", law: ATTENTION_ALLOCATION_CONTRACT,
    exchange, receipt, customerMutation: false, foreignMutation: false }, at);
  await append(store, "readouts", exchange); await append(store, "receipts", receipt); await append(store, "results", reply);
  return reply;
}

export async function run(activity, op = "invoke-service", at = new Date().toISOString(), options = {}) {
  const dataRoot = resolve(options.dataRoot ?? process.env.ATTENTION_ALLOCATION_READOUT_DATA_ROOT ?? join(NODE_ROOT, "data"));
  const store = createSettlementStore({ settlementRoot: NODE_ROOT, agentUrl: options.agentUrl ?? process.env.RWIL_RDF_AGENT });
  if (op === "solicit-service") return solicit(store, activity, at);
  if (op === "invoke-service") return invoke(store, activity, at);
  return reject(store, activity, `unknown-provider-operation:${op}`, at);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = await run(JSON.parse(readFileSync(0, "utf8")), operation(), instant());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); if (output.type === "Reject") process.exitCode = 2;
  } catch (error) { process.stderr.write(`attention-allocation-readout: ${error.message}\n`); process.exitCode = 1; }
}
