const test = require("node:test");
const assert = require("node:assert/strict");
const { contracts, getContractPrompt } = require("../lib/agentContract");

test("all BlueFishing contracts load with stable ids", () => {
  assert.equal(contracts.sales.id, "bluefishing.sales.v1");
  assert.equal(contracts.recommendation.id, "bluefishing.recommendation.v1");
  assert.equal(contracts.tools.id, "bluefishing.tools.v1");
  assert.equal(contracts.security.id, "bluefishing.security.v1");
  assert.equal(contracts.response.id, "bluefishing.response.v1");
  assert.match(getContractPrompt(), /authoritative/i);
});

test("high-risk tools are not automatic", () => {
  assert.equal(contracts.tools.policy.modify_price.permission, "forbidden");
  assert.equal(contracts.tools.policy.modify_stock.permission, "forbidden");
  assert.equal(contracts.tools.policy.refund_order.permission, "human_approval_required");
  assert.equal(contracts.tools.policy.execute_shell.permission, "forbidden");
});
