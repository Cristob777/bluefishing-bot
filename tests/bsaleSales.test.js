const test = require("node:test");
const assert = require("node:assert/strict");
const { syncBsaleSales, isCountableSale, salesSource, salesConfig } = require("../lib/bsaleSales");

const ENV = { BSALE_ACCESS_TOKEN: "tok_test" };
const day = (iso) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / 1000);
const boleta = (id, client = {}, over = {}) => ({
  id, number: 1000 + id, emissionDate: day("2026-11-21"), totalAmount: 114980, state: 0,
  document_type: { codeSii: 39, isCreditNote: 0, isSalesNote: 0 }, office: { id: 1 }, client, ...over,
});

function harness(docs, { lastEmission = null } = {}) {
  const inserts = [], stageUpdates = [], stateWrites = [], lookups = [];
  const query = async (sql, params = []) => {
    if (/select last_emission_at from bsale_sync_state/.test(sql)) return { rows: lastEmission ? [{ last_emission_at: lastEmission }] : [] };
    if (/select id, session_id from contacts/.test(sql)) {
      lookups.push(params);
      return { rows: params[0] === "912345678" ? [{ id: 7, session_id: "wa:56912345678" }] : [] };
    }
    if (/insert into bsale_sales/.test(sql)) { inserts.push(params); return { rows: [] }; }
    if (/update contacts set stage='compro'/.test(sql)) { stageUpdates.push(params[0]); return { rows: [{ id: params[0] }] }; }
    if (/insert into bsale_sync_state/.test(sql)) { stateWrites.push({ sql, params }); return { rows: [] }; }
    return { rows: [] };
  };
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => ({ count: docs.length, items: docs }) }; };
  return { query, fetchImpl, inserts, stageUpdates, stateWrites, lookups, urls };
}

test("sin token no sincroniza y el CRM sigue usando WooCommerce", async () => {
  const r = await syncBsaleSales(async () => { throw new Error("no debería consultar"); }, { env: {} });
  assert.deepEqual(r, { ok: true, skipped: true });
  assert.equal(salesSource({}), "woo");
  assert.equal(salesSource(ENV), "bsale");
  assert.equal(salesSource({ ...ENV, BSALE_SALES_SYNC: "false" }), "woo");
});

test("solo cuentan boletas/facturas activas: fuera notas de crédito, notas de venta y guías", () => {
  const codes = salesConfig(ENV).saleCodes;
  assert.equal(isCountableSale(boleta(1), codes), true);
  assert.equal(isCountableSale(boleta(2, {}, { document_type: { codeSii: 33 } }), codes), true);
  assert.equal(isCountableSale(boleta(3, {}, { document_type: { codeSii: 61, isCreditNote: 1 } }), codes), false);
  assert.equal(isCountableSale(boleta(4, {}, { document_type: { codeSii: 0, isSalesNote: 1 } }), codes), false);
  assert.equal(isCountableSale(boleta(5, {}, { document_type: { codeSii: 52 } }), codes), false);
  assert.equal(isCountableSale(boleta(6, {}, { state: 1 }), codes), false);
});

test("venta en tienda con teléfono del cliente se atribuye y el contacto pasa a Compró", async () => {
  const docs = [
    boleta(1, { phone: "+56 9 1234 5678", email: "" }),          // cliente que habló con Matías
    boleta(2, {}),                                                // boleta anónima: cuenta para el total, sin atribución
    boleta(3, { phone: "+56 9 1234 5678" }, { document_type: { codeSii: 61, isCreditNote: 1 } }), // devolución: se ignora
  ];
  const h = harness(docs);
  const r = await syncBsaleSales(h.query, { env: ENV, fetchImpl: h.fetchImpl, now: () => new Date("2026-11-22T12:00:00Z") });

  assert.deepEqual(r, { ok: true, documents: 3, sales: 2, attributed: 1 });
  assert.equal(h.inserts.length, 2);
  const [first, second] = h.inserts;
  assert.equal(first[0], 1);
  assert.equal(first[8], 7, "contact_id del contacto de WhatsApp");
  assert.equal(first[6], "912345678", "teléfono guardado solo si se atribuyó");
  assert.equal(second[8], null);
  assert.equal(second[6], null, "boleta no atribuida: sin datos personales");
  assert.deepEqual(h.stageUpdates, [7]);

  // Ventana de atribución: el contacto debe haber hablado antes del FIN del día de emisión.
  assert.equal(h.lookups[0][2], "2026-11-21T23:59:59.000Z");
  // Primera corrida: backfill 30 días; pide cliente y tipo de documento expandidos.
  assert.match(decodeURIComponent(h.urls[0]), /emissiondaterange=\[\d+,\d+\]&state=0&expand=\[client,document_type\]/);
  assert.equal(h.stateWrites.at(-1).params[0], new Date(day("2026-11-21") * 1000).toISOString());
});

test("corridas siguientes son incrementales (desde la última emisión menos 2 días)", async () => {
  const h = harness([], { lastEmission: "2026-11-20T00:00:00Z" });
  await syncBsaleSales(h.query, { env: ENV, fetchImpl: h.fetchImpl, now: () => new Date("2026-11-22T12:00:00Z") });
  const from = Number(decodeURIComponent(h.urls[0]).match(/emissiondaterange=\[(\d+),/)[1]);
  assert.equal(new Date(from * 1000).toISOString(), "2026-11-18T00:00:00.000Z");
});

test("si Bsale falla, se registra el error y no se rompe el ciclo", async () => {
  const errors = [];
  const query = async (sql, params) => { if (/last_error=\$1/.test(sql)) errors.push(params[0]); return { rows: [] }; };
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await syncBsaleSales(query, { env: ENV, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
    assert.equal(r.ok, false);
    assert.deepEqual(errors, ["bsale_http_401"]);
  } finally { console.warn = warn; }
});
