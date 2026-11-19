// Ventas Bsale -> atribución conversación -> venta (web Y tienda física).
// Una venta se atribuye a Matías cuando el teléfono (últimos 9 dígitos) o el correo del cliente
// del documento coincide con un contacto del operador que habló con el bot ANTES de la venta y
// como máximo ATTRIBUTION_WINDOW_DAYS antes (misma regla que los pedidos WooCommerce).
//
// Requisito operativo: en la tienda física el vendedor debe registrar al cliente (teléfono o
// correo) en la boleta. Una boleta anónima no se puede atribuir.
const { bsaleGet, config } = require("./bsale");
const { last9, email: cleanEmail, windowDays } = require("./wooOrders");
const { safeError } = require("./logSanitizer");

// Boleta (39), boleta exenta (41), factura (33), factura exenta (34). Notas de crédito,
// guías de despacho y notas de venta no son ventas finales (evita doble conteo y devoluciones).
const DEFAULT_SALE_CODES = [33, 34, 39, 41];
const PAGE = 50;

function salesConfig(env = process.env) {
  const codes = String(env.BSALE_SALE_CODES_SII || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
  return {
    enabled: config(env).enabled && String(env.BSALE_SALES_SYNC || "true").toLowerCase() !== "false",
    saleCodes: new Set(codes.length ? codes : DEFAULT_SALE_CODES),
    backfillDays: num(env.BSALE_SALES_BACKFILL_DAYS, 30, 1, 365),
    maxPages: num(env.BSALE_SALES_MAX_PAGES, 400, 1, 5000),
  };
}

// ¿Es una venta final que cuenta? (expand=document_type)
function isCountableSale(doc, saleCodes) {
  if (Number(doc?.state) === 1) return false; // anulado / inactivo
  const dt = doc?.document_type || {};
  if (Number(dt.isCreditNote) === 1 || Number(dt.isSalesNote) === 1) return false;
  const code = Number(dt.codeSii);
  if (Number.isFinite(code) && code > 0) return saleCodes.has(code);
  return true; // sin tipo expandido: se cuenta (Bsale ya filtra state=0)
}

async function fetchDocuments({ since, until }, { cfg = config(), fetchImpl = fetch, maxPages = 400 } = {}) {
  const a = Math.floor(since.getTime() / 1000), b = Math.floor(until.getTime() / 1000);
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const q = `/documents.json?emissiondaterange=[${a},${b}]&state=0&expand=[client,document_type]&limit=${PAGE}&offset=${page * PAGE}`;
    const data = await bsaleGet(q, { cfg, fetchImpl });
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items) throw new Error("bsale_documents_bad_payload");
    out.push(...items);
    if (items.length < PAGE || (Number(data?.count) && out.length >= Number(data.count))) break;
  }
  return out;
}

async function syncBsaleSales(query, { fetchImpl = fetch, env = process.env, now = () => new Date() } = {}) {
  const sc = salesConfig(env);
  if (!sc.enabled) return { ok: true, skipped: true };
  const cfg = config(env);
  try {
    const st = await query("select last_emission_at from bsale_sync_state where scope='operator'");
    const last = st.rows[0]?.last_emission_at ? new Date(st.rows[0].last_emission_at) : null;
    // Ventana incremental con 2 días de solape (la fecha de emisión de Bsale no trae hora).
    const since = last ? new Date(last.getTime() - 2 * 86400000) : new Date(now().getTime() - sc.backfillDays * 86400000);
    const until = new Date(now().getTime() + 86400000);
    const docs = await fetchDocuments({ since, until }, { cfg, fetchImpl, maxPages: sc.maxPages });

    let counted = 0, attributed = 0, maxEmission = last;
    for (const doc of docs) {
      const id = Number(doc?.id);
      const emission = Number(doc?.emissionDate);
      if (!Number.isInteger(id) || !Number.isFinite(emission) || emission <= 0) continue;
      if (!isCountableSale(doc, sc.saleCodes)) continue;
      counted++;
      const emittedAt = new Date(emission * 1000);
      if (!maxEmission || emittedAt > maxEmission) maxEmission = emittedAt;
      const endOfDay = new Date((emission + 86399) * 1000);

      const phone = last9(doc.client?.phone), mail = cleanEmail(doc.client?.email);
      let contact = null;
      if (phone || mail) {
        const r = await query(
          `select id, session_id from contacts
            where tenant_id is null
              and (($1::text is not null and right(regexp_replace(coalesce(phone, external_id), '\\D', '', 'g'), 9) = $1)
                or ($2::text is not null and lower(email) = $2))
              and first_seen_at <= $3 and first_seen_at >= $3::timestamptz - ($4::int * interval '1 day')
            order by last_seen_at desc limit 1`,
          [phone, mail, endOfDay.toISOString(), windowDays()]
        );
        contact = r.rows[0] || null;
      }

      await query(
        `insert into bsale_sales (document_id, number, code_sii, total, emitted_at, office_id, phone, email, contact_id, attributed_session)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (document_id) do update set total=excluded.total, contact_id=excluded.contact_id,
           attributed_session=excluded.attributed_session, phone=excluded.phone, email=excluded.email, synced_at=now()`,
        [id, doc.number != null ? String(doc.number).slice(0, 30) : null, Number(doc.document_type?.codeSii) || null,
          Number(doc.totalAmount) || 0, emittedAt.toISOString(), Number(doc.office?.id) || null,
          contact ? phone : null, contact ? mail : null, contact?.id || null, contact?.session_id || null]
      );

      if (contact) {
        attributed++;
        const u = await query("update contacts set stage='compro', updated_at=now() where id=$1 and stage<>'compro' returning id", [contact.id]);
        if (u.rows.length) await query("insert into contact_stage_events (contact_id, tenant_id, from_stage, to_stage, actor) values ($1,null,null,'compro','bsale_sale')", [contact.id]);
      }
    }

    await query(
      `insert into bsale_sync_state (scope, last_sync_at, last_emission_at, last_error) values ('operator', now(), $1, null)
       on conflict (scope) do update set last_sync_at=now(), last_emission_at=coalesce($1, bsale_sync_state.last_emission_at), last_error=null`,
      [maxEmission ? maxEmission.toISOString() : null]
    );
    return { ok: true, documents: docs.length, sales: counted, attributed };
  } catch (error) {
    console.warn("[Bsale] sync de ventas falló:", safeError(error));
    await query(
      "insert into bsale_sync_state (scope, last_error) values ('operator', $1) on conflict (scope) do update set last_error=$1",
      [String(error.message || "error").slice(0, 120)]
    ).catch(() => {});
    return { ok: false, error: String(error.message || "error") };
  }
}

// Con Bsale activo, las ventas del CRM salen de Bsale (incluye web + tienda) y no de WooCommerce,
// para no contar dos veces un pedido web que también se boletea en Bsale.
const salesSource = (env = process.env) => (salesConfig(env).enabled ? "bsale" : "woo");

module.exports = { salesConfig, isCountableSale, fetchDocuments, syncBsaleSales, salesSource, DEFAULT_SALE_CODES };
