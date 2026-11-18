// Gráficos SVG renderizados en servidor (sin JS ni CDNs; compatibles con CSP).
const { esc } = require("./ui");
const nf = (n) => new Intl.NumberFormat("es-CL").format(Number(n || 0));
const C = { a: "#0a6cbd", b: "#1aa0e6", ok: "#0f9d6b", err: "#d64545", grid: "#e4e9f0", muted: "#5b6b80" };

function noData(text = "Sin datos en este período") {
  return `<div class="empty" style="padding:28px 10px"><b>Sin datos</b><div class="small">${esc(text)}</div></div>`;
}

// series: [{name,color,values:[n]}], labels:[str]
function line(labels, series, { h = 220 } = {}) {
  const all = series.flatMap((s) => s.values);
  if (!labels.length || !all.some((v) => v > 0)) return noData();
  const W = 640, pl = 34, pr = 10, pt = 12, pb = 26, iw = W - pl - pr, ih = h - pt - pb;
  const max = Math.max(1, ...all), step = labels.length > 1 ? iw / (labels.length - 1) : 0;
  const x = (i) => pl + i * step, y = (v) => pt + ih - (v / max) * ih;
  const ticks = [0, Math.round(max / 2), max];
  const grid = ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="${C.muted}">${nf(t)}</text>`).join("");
  const every = Math.ceil(labels.length / 7);
  const xl = labels.map((l, i) => (i % every === 0 || i === labels.length - 1) ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="${C.muted}">${esc(l)}</text>` : "").join("");
  const paths = series.map((s, k) => {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = k === 0 ? `<polygon points="${pl},${pt + ih} ${pts} ${x(s.values.length - 1)},${pt + ih}" fill="${s.color}" opacity=".08"/>` : "";
    return `${area}<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  const legend = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px" class="small"><i style="width:10px;height:3px;background:${s.color};display:inline-block;border-radius:2px"></i>${esc(s.name)} · <b>${nf(s.values.reduce((a, b) => a + b, 0))}</b></span>`).join("");
  return `<div>${legend}</div><svg viewBox="0 0 ${W} ${h}" width="100%" role="img" aria-label="Gráfico de líneas" style="display:block;margin-top:8px;max-height:260px">${grid}${paths}${xl}</svg>`;
}

// steps: [{label,value}] — embudo con % de conversión entre pasos
function funnel(steps) {
  if (!steps.length || !(steps[0].value > 0)) return noData("Aún no hay contactos en el embudo.");
  const top = steps[0].value;
  return steps.map((s, i) => {
    const pct = Math.round((s.value / top) * 100), conv = i ? (steps[i - 1].value ? Math.round((s.value / steps[i - 1].value) * 100) : 0) : null;
    return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between" class="small"><b>${esc(s.label)}</b><span>${nf(s.value)} · ${pct}%${conv !== null ? ` <span class="muted">(${conv}% del paso anterior)</span>` : ""}</span></div>
<svg viewBox="0 0 100 8" width="100%" height="14" preserveAspectRatio="none" style="display:block;margin-top:4px"><rect width="100" height="8" rx="2" fill="#eef1f5"/><rect width="${Math.max(pct, s.value ? 1 : 0)}" height="8" rx="2" fill="${i === steps.length - 1 ? C.ok : C.a}" opacity="${1 - i * 0.12}"/></svg></div>`;
  }).join("");
}

// parts: [{label,value,color}]
function donut(parts, center = "") {
  const total = parts.reduce((a, p) => a + Number(p.value || 0), 0);
  if (!total) return noData();
  const r = 15.915, segs = []; let off = 25;
  for (const p of parts) { const pct = (p.value / total) * 100; segs.push(`<circle cx="21" cy="21" r="${r}" fill="none" stroke="${p.color}" stroke-width="5" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>`); off -= pct; }
  const legend = parts.map((p) => `<div class="it"><span style="display:flex;align-items:center;gap:8px"><i style="width:10px;height:10px;border-radius:3px;background:${p.color};display:inline-block"></i>${esc(p.label)}</span><b>${nf(p.value)} · ${Math.round((p.value / total) * 100)}%</b></div>`).join("");
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="Gráfico de dona"><circle cx="21" cy="21" r="${r}" fill="none" stroke="#eef1f5" stroke-width="5"/>${segs.join("")}<text x="21" y="22.5" text-anchor="middle" font-size="6" font-weight="700" fill="#0f1b2d">${esc(center)}</text></svg><div class="list" style="flex:1;min-width:160px">${legend}</div></div>`;
}

// rows: [{name,count}]
function hbars(rows, label = (x) => x) {
  if (!rows.length) return noData();
  const max = Math.max(1, ...rows.map((r) => Number(r.count)));
  return rows.map((r) => `<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;gap:10px" class="small"><span>${esc(label(r.name) || "Sin dato")}</span><b>${nf(r.count)}</b></div><svg viewBox="0 0 100 6" width="100%" height="8" preserveAspectRatio="none" style="display:block;margin-top:3px"><rect width="100" height="6" rx="3" fill="#eef1f5"/><rect width="${(Number(r.count) / max) * 100}" height="6" rx="3" fill="${C.b}"/></svg></div>`).join("");
}

module.exports = { line, funnel, donut, hbars, noData, C };
