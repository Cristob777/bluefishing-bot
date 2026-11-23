const test = require("node:test");
const assert = require("node:assert/strict");
const { storeInfoReply, storeInfoPrompt } = require("../lib/storeInfo");

const ENV = {
  STORE_ADDRESS: "Av. Ejemplo 123, Santiago",
  STORE_HOURS: "Lunes a sábado de 10:00 a 19:00",
  STORE_SHIPPING: "Bluexpress a todo Chile, 2 a 5 días hábiles",
  STORE_PAYMENTS: "Webpay, transferencia y efectivo en tienda",
  STORE_PICKUP: "Retiro gratis en tienda, listo en 24 h",
};

test("responde dirección, horario, despacho y pagos con lo configurado, sin LLM", () => {
  assert.match(storeInfoReply("¿Dónde están ubicados?", { env: ENV }), /Dirección: Av\. Ejemplo 123/);
  assert.match(storeInfoReply("a qué hora abren el sábado?", { env: ENV }), /Horario: Lunes a sábado/);
  assert.match(storeInfoReply("hacen envíos a Concepción?", { env: ENV }), /Despacho: Bluexpress/);
  assert.match(storeInfoReply("puedo pagar con transferencia?", { env: ENV }), /Medios de pago: Webpay/);
  const both = storeInfoReply("cuál es el horario y la dirección?", { env: ENV });
  assert.match(both, /Dirección/); assert.match(both, /Horario/);
});

test("no inventa: si el dato no está configurado, no responde (lo toma el flujo normal)", () => {
  assert.equal(storeInfoReply("¿cuál es la política de cambios?", { env: ENV }), null);
  assert.equal(storeInfoReply("¿dónde están?", { env: {} }), null);
  assert.equal(storeInfoReply("¿dónde están?", { env: { STORE_ADDRESS: "CHANGE_ME" } }), null);
});

test("si pregunta por un producto, responde el flujo de ventas", () => {
  assert.equal(storeInfoReply("tienen caña de popping y hacen envíos?", { env: ENV, mentionsProduct: true }), null);
});

test("'quiero devolver mi pedido' no es una consulta de política (sigue a postventa)", () => {
  assert.equal(storeInfoReply("quiero devolver mi pedido", { env: { ...ENV, STORE_RETURNS: "30 días" } }), null);
  assert.match(storeInfoReply("cuál es la política de devoluciones?", { env: { ...ENV, STORE_RETURNS: "30 días con boleta" } }), /30 días/);
});

test("el prompt de ventas recibe la información de la tienda", () => {
  assert.equal(storeInfoPrompt({}), "");
  const p = storeInfoPrompt(ENV);
  assert.match(p, /INFORMACIÓN DE LA TIENDA/);
  assert.match(p, /Despacho: Bluexpress a todo Chile/);
});
