import assert from "node:assert/strict";
import { PROVIDER_CONTRACTS, getProviderContracts } from "../dom_resilience/provider-dom-contracts.js";

for (const provider of ["chatgpt","grok","claude","gemini","copilot"]) {
  const contracts = getProviderContracts(provider);
  assert.ok(contracts);
  for (const probe of ["composer","send","stop","response"]) {
    assert.ok(Array.isArray(contracts[probe]));
    assert.ok(contracts[probe].length > 0);
    for (const contract of contracts[probe]) {
      assert.equal(typeof contract.id, "string");
      assert.equal(typeof contract.selector, "string");
      assert.equal(typeof contract.rank, "number");
    }
  }
}
assert.equal(PROVIDER_CONTRACTS.grok.response.at(-1).rank, 3);
console.log("provider-dom-contracts: PASS");
