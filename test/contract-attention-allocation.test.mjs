import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-rdf-projection-service/test-provider";

import { run, semanticDigest } from "../src/contract-attention-allocation.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER = "urn:ame:attention-allocation-readout";
const BUYER = "urn:ame:test-union-customer";
const AT = "2026-07-23T16:00:00.000Z";
let witnessJournal;

before(async () => { witnessJournal = await startWitnessJournalProviderProcess(); });
after(async () => { await witnessJournal?.close(); });

function solicitation(request = {
  budget: 5,
  candidates: [
    { id: "a", cost: 2, benefit: 5 },
    { id: "b", cost: 3, benefit: 6 },
    { id: "c", cost: 5, benefit: 9 },
  ],
  authority: { controller: BUYER, basis: "test fixture" },
}) {
  return { "@context": CONTEXT, id: "urn:test:allocation-solicitation", type: "Offer", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceSolicitation", request } };
}
function acceptance(offer, overrides = {}) {
  return { "@context": CONTEXT, id: "urn:test:allocation-acceptance", type: "Accept", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceContract", offer,
      termsAcceptance: { termDigest: offer.object.termsDigest },
      capability: { type: "Capability", holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id,
        attenuation: { requestDigest: offer.object.requestDigest }, capTP: { target: PROVIDER, method: "invoke-service" },
        allowedActions: ["invoke-service", "provider-local-witness-journal-evidence"] }, ...overrides } };
}
async function execute(activity, operation, root) {
  return run(activity, operation, AT, { dataRoot: root, agentUrl: witnessJournal.agentCardUrl });
}

test("the exact RMN law settles a source-attested allocation readout through WitnessJournal", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "attention-allocation-contract-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const offer = await execute(solicitation(), "solicit-service", root);
  assert.equal(offer.type, "Offer"); assert.equal(offer.object.requestDigest, semanticDigest(offer.object.request));
  assert.equal(offer.object.terms.assetPaymentRequired, false);
  // The offer's terms carry an explicit resource-price declaration. Unlike
  // the sibling mathematical-readout-exchange die, this die has no defined
  // Landauer/erasure carrier, so erasure is declared not-priced rather than
  // inventing one out of tie-set choiceBits.
  const priceByDimension = Object.fromEntries(offer.object.terms.resourcePrice.dimensions.map((d) => [d.dimension, d]));
  assert.deepEqual(Object.keys(priceByDimension).sort(), ["asset", "compute", "erasure", "gas", "time", "wit"].sort());
  assert.equal(priceByDimension.asset.priced, false);
  assert.equal(priceByDimension.gas.priced, false);
  assert.equal(priceByDimension.wit.priced, false);
  assert.equal(priceByDimension.erasure.priced, false);
  assert.match(priceByDimension.erasure.method, /no Landauer or coordination-measure carrier/);
  assert.equal(priceByDimension.compute.priced, true); assert.equal(priceByDimension.compute.quantity, null);
  assert.equal(priceByDimension.time.priced, true); assert.equal(priceByDimension.time.quantity, null);
  const result = await execute(acceptance(offer), "invoke-service", root);
  assert.equal(result.type, "Accept");
  assert.deepEqual(result.object.exchange.result.funded, ["a", "b"]);
  assert.equal(result.object.exchange.result.totalBenefit, 11);
  assert.equal(result.object.exchange.result.certificate.assurance.kind, "source-pinned-executable-projection");
  assert.equal(result.object.receipt.provider, PROVIDER); assert.equal(result.object.customerMutation, false);
  assert.equal(result.object.receipt.assetSettlementClaimed, false);
  assert.deepEqual(Object.keys(result.object.exchange.resources).sort(),
    ["assetAmount", "computeSeconds", "cpuMicroseconds", "erasure", "gas", "peakRssBytes",
      "timeMilliseconds", "type", "wallTimeSeconds", "wit"].sort());
  // No erasure price was quoted, so nothing is audited there either.
  assert.equal(result.object.exchange.resources.erasure, null);
  assert.deepEqual(result.object.exchange.quotedResourcePrice, offer.object.terms.resourcePrice);
  assert.equal(typeof result.object.exchange.resources.cpuMicroseconds, "number");
  assert.ok(result.object.exchange.resources.cpuMicroseconds >= 0);
  assert.equal(typeof result.object.exchange.resources.peakRssBytes, "number");
  assert.ok(result.object.exchange.resources.peakRssBytes > 0);
  assert.equal(typeof result.object.exchange.resources.timeMilliseconds, "number");
  assert.ok(result.object.exchange.resources.timeMilliseconds >= 0);
  const graphDirectory = join(root, "witnessJournal", "2026", "07", "23");
  assert.equal(readdirSync(graphDirectory).length >= 3, true);
  assert.equal(readFileSync(join(graphDirectory, readdirSync(graphDirectory)[0]), "utf8").includes("urn:emsenn:witness-journal:category"), true);
});

test("an inadmissible budget is refused during solicitation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "attention-allocation-refusal-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await execute(solicitation({ budget: 0, candidates: [{ id: "a", cost: 1, benefit: 1 }], authority: { controller: BUYER, basis: "test" } }), "solicit-service", root);
  assert.equal(result.type, "Reject"); assert.match(result.object.reason, /budget must be a positive finite number/);
  assert.equal(result.object.prohibitedEffectsPerformed, false);
});

test("a duplicate candidate id is refused during solicitation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "attention-allocation-duplicate-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await execute(solicitation({
    budget: 5,
    candidates: [{ id: "a", cost: 1, benefit: 1 }, { id: "a", cost: 2, benefit: 2 }],
    authority: { controller: BUYER, basis: "test" },
  }), "solicit-service", root);
  assert.equal(result.type, "Reject"); assert.match(result.object.reason, /duplicate candidate id/);
});

test("altered terms and wrong laws are refused without a readout", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "attention-allocation-altered-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const offer = await execute(solicitation(), "solicit-service", root);
  const altered = await execute(acceptance(offer, { termsAcceptance: { termDigest: "ni:///sha-256;changed" } }), "invoke-service", root);
  assert.equal(altered.type, "Reject");
  const wrong = solicitation(); wrong.object.contract = "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const refused = await execute(wrong, "solicit-service", root);
  assert.equal(refused.type, "Reject");
});

test("absence of the hired WitnessJournal provider fails closed", async () => {
  await assert.rejects(run(solicitation(), "solicit-service", AT, { dataRoot: mkdtempSync(join(tmpdir(), "attention-allocation-no-witness-journal-")) }), /WITNESS_JOURNAL_RDF_AGENT/u);
});
