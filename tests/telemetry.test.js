const test = require("node:test");
const assert = require("node:assert/strict");

test("handoff does not claim persistence when Supabase is unavailable", async () => {
  const { createHandoffRequest } = require("../lib/telemetry");
  const persisted = await createHandoffRequest({
    sessionId: "wa:test",
    phone: "56900000000",
    intent: "postventa",
    message: "Necesito ayuda"
  });
  assert.equal(persisted, false);
});
