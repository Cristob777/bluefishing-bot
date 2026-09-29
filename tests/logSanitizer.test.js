const test = require("node:test");
const assert = require("node:assert/strict");
const { redactSecrets, safeError, pseudonymize } = require("../lib/logSanitizer");

test("runtime secrets are redacted from logs", () => {
  const old = process.env.WHATSAPP_TOKEN;
  process.env.WHATSAPP_TOKEN = "whatsapp-super-secret-token";
  try {
    const output = redactSecrets("failure token=whatsapp-super-secret-token whatsapp-super-secret-token");
    assert.doesNotMatch(output, /whatsapp-super-secret-token/);
    assert.match(output, /REDACTED/);
  } finally {
    if (old === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = old;
  }
});

test("database URLs are removed from error logs", () => {
  const result = safeError(new Error("connect postgresql://user:secret@db:5432/bluefishing failed"));
  assert.doesNotMatch(result, /user:secret|postgresql:\/\//);
});

test("customer identifiers are pseudonymized when log key exists", () => {
  const old = process.env.LOG_HASH_KEY;
  process.env.LOG_HASH_KEY = "test-log-hash-key";
  try {
    const a = pseudonymize("56912345678");
    const b = pseudonymize("56912345678");
    assert.equal(a, b);
    assert.notEqual(a, "56912345678");
  } finally {
    if (old === undefined) delete process.env.LOG_HASH_KEY;
    else process.env.LOG_HASH_KEY = old;
  }
});
