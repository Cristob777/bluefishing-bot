const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_DASHBOARD_USER = "owner";
process.env.ADMIN_DASHBOARD_PASSWORD = "secret";
process.env.ADMIN_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
process.env.OPENAI_INPUT_COST_PER_1M = "1";
process.env.OPENAI_CACHED_INPUT_COST_PER_1M = "0.5";
process.env.OPENAI_OUTPUT_COST_PER_1M = "2";

const admin = require("../api/admin")._test;

test("admin session signs and verifies", () => {
  const token = admin.sign("owner");
  assert.equal(admin.verify(token), true);
  assert.equal(admin.verify(token + "x"), false);
});

test("admin HTML escaping blocks markup", () => {
  assert.equal(admin.esc('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
});

test("admin day filter only accepts supported windows", () => {
  assert.equal(admin.days("30"), 30);
  assert.equal(admin.days("365"), 7);
});

test("customer identifiers are masked in dashboard lists", () => {
  assert.equal(admin.masked("wa:56912345678"), "569 •••• 5678");
});

test("AI cost uses measured token buckets and configured rates", () => {
  const value = admin.cost({ input_tokens: 1000000, cached_input_tokens: 200000, output_tokens: 500000 });
  assert.equal(value, 1.9);
});

test("la vista Entrenar escapa el contenido y protege los formularios con CSRF", () => {
  const html = admin.trainingHtml({
    fb: { pending: [{ id: "f1", session_id: "wa:56911112222", user_message: "<b>hola</b>", bot_response: "resp", created_at: new Date() }], learned: [] },
    docs: [{ url: "https://bluefishing.cl/producto/x/", name: "Caña <X>", price: "$1", category: "Cañas", waterType: [], needsReview: true, verification: "parcial", fishingPosition: [], technique: [], targetSpecies: [], verifiedNotes: "" }],
    q: { p: "https://bluefishing.cl/producto/x/" },
  }, "tok123");
  assert.ok(!html.includes("<b>hola</b>"));
  assert.ok(html.includes("Caña &lt;X&gt;"));
  assert.equal((html.match(/name='csrf' value='tok123'/g) || []).length, 3, "resolver, descartar y guardar ficha");
  assert.ok(html.includes("Guardar ficha verificada"));
});

test("cada respuesta del bot ofrece corregirse una sola vez", () => {
  const x = { csrf: "t", flagged: new Map([["2", "flagged"], ["3", "resolved"]]) };
  assert.match(admin.fixControl(x, { id: 1 }), /Corregir esta respuesta/);
  assert.match(admin.fixControl(x, { id: 2 }), /Corrección pendiente/);
  assert.match(admin.fixControl(x, { id: 3 }), /Corrección aprobada/);
});
