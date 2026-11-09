const test = require("node:test");
const assert = require("node:assert/strict");
const charts = require("../lib/charts");
const ui = require("../lib/ui");
const { resultsBody } = require("../lib/results");

test("charts show 'Sin datos' instead of inventing numbers", () => {
  assert.match(charts.line(["01/10"], [{ name: "x", color: "#000", values: [0] }]), /Sin datos/);
  assert.match(charts.donut([{ label: "a", value: 0, color: "#000" }]), /Sin datos/);
  assert.match(charts.funnel([{ label: "Nuevo", value: 0 }]), /Sin datos/);
  assert.match(charts.hbars([]), /Sin datos/);
});

test("charts render inline SVG with real values and conversion %", () => {
  assert.match(charts.line(["a", "b"], [{ name: "Mensajes", color: "#000", values: [2, 3] }]), /<svg[\s\S]*polyline/);
  const f = charts.funnel([{ label: "Nuevo", value: 10 }, { label: "Interesado", value: 4 }]);
  assert.match(f, /40% del paso anterior/);
  assert.match(charts.donut([{ label: "a", value: 3, color: "#000" }, { label: "b", value: 1, color: "#111" }], "75%"), /75%/);
});

test("results body never fakes sales and escapes labels", () => {
  const html = resultsBody(ui, charts, { days: 30, daily: [], split: {}, first: {}, products: [{ name: "<x>", count: 1 }], intents: [], funnel: { steps: [], partial: true }, sales: null }, "/panel/resultados");
  assert.match(html, /Ventas atribuidas al bot[\s\S]*Sin datos/);
  assert.ok(!html.includes("<x>"));
});
