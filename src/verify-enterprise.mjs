#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attestMathematicalSources } from "./allocation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "AGENTS.md",
  "lib/ownership.json",
  "lib/management/roster.json",
  "content/offices/attention-allocation-broker.json",
  "content/services/attention-allocation-readout.json",
  "src/allocation.mjs",
  "src/contract-attention-allocation.mjs",
  "test/allocation.test.mjs",
  "test/contract-attention-allocation.test.mjs",
  "package.json",
];

const failures = required.filter((path) => !existsSync(join(ROOT, path))).map((path) => `missing ${path}`);
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const enterprise = manifest["x-agentic-metro-enterprise"];
if (enterprise?.["node-id"] !== "attention-allocation-readout") failures.push("package node identity is absent or wrong");
if (enterprise?.actor !== "urn:ame:attention-allocation-readout") failures.push("package actor identity is absent or wrong");
if (!enterprise?.["unimplemented-operations"]?.includes("formally-verified-Lean-extraction")) {
  failures.push("absence of formal extraction is not disclosed");
}
if (!enterprise?.["implemented-operations"]?.includes("serve-activitystreams-contract-over-stdio")) {
  failures.push("ActivityStreams contract operation is not advertised");
}
for (const operation of ["solicit-service", "invoke-service"]) {
  if (manifest.bin?.[operation] !== "./src/contract-attention-allocation.mjs") {
    failures.push(`bin.${operation} does not point at the contract CLI`);
  }
}
const sourceContractOnly = process.argv.includes("--public-source-contract");
let sourceAttestation;
try {
  sourceAttestation = attestMathematicalSources();
  if (!sourceContractOnly && sourceAttestation.qualified !== true)
    failures.push("private mathematical source is not digest-attested by an original host selection");
} catch (error) {
  failures.push(error.message);
}
const result = {
  enterprise: "attention-allocation-readout",
  qualification: sourceContractOnly
    ? "public-source-contract-only-no-provider-dependency-or-mathematical-proof"
    : "full-provider-source-and-mathematical-attestation",
  mathematicalSource: sourceAttestation?.status ?? "unavailable",
  mathematicalSourceQualified: sourceAttestation?.qualified === true,
  ok: failures.length === 0, failures,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
