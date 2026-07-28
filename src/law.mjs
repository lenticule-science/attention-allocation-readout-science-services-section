import { readFileSync } from "node:fs";

import { compileRmlLaw } from "@red-cup-engineering/rmn-semantic-conformance/law";

export const ATTENTION_ALLOCATION_LAW = compileRmlLaw(
  readFileSync(new URL("../content/contracts/attention-allocation-readout.rml", import.meta.url), "utf8"),
);

export const ATTENTION_ALLOCATION_CONTRACT = ATTENTION_ALLOCATION_LAW.id;
