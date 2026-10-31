// Sincroniza pedidos de WooCommerce (solo lectura) y los atribuye a conversaciones del bot.
// Atribución: el teléfono (últimos 9 dígitos) o el correo del pedido coincide con un contacto de la
// misma empresa cuya primera conversación fue ANTES del pedido y como máximo N días antes (ventana).
const { safeError } = require("./logSanitizer");

const digits = (v) => String(v || "").replace(/\D/g, "");
const last9 = (v) => { const d = digits(v); return d.length >= 8 ? d.slice(-9) : null; };
const email = (v) => { const e = String(v || "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null; };
const windowDays = () => { const n = Number(process.env.ATTRIBUTION_WINDOW_DAYS || 30); return n >= 1 && n <= 180 ? n : 30; };

async function fetchOrders({ storeUrl, consumerKey, consumerSecret }, { since, fetchImpl = fetch, maxPages = 10 } = {}) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(`${storeUrl}/wp-json/wc/v3/orders`);
    u.searchParams.set("per_page", "100"); u.searchParams.set("page", String(page));
    u.searchParams.set("after", since.toISOString());
    u.searchParams.set("_fields", "id,status,total,currency,date_created_gmt,billing");
    const res = await fetchImpl(u.toString(), { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, redirect: "error" });
    if (!res.ok) throw new Error(`woo_orders_http_${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("woo_orders_bad_payload");
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

// tenantId null = cuenta del operador (WC_* del .env).
async function syncOrders(query, { tenantId = null, creds, fetchImpl = fetch, days = 90 } = {}) {
  const key = tenantId || "operator";
  try {
    const since = new Date(Date.now() - days * 86400000);
    const orders = await fetchOrders(creds, { since, fetchImpl });
    let attributed = 0;
    for (const o of orders) {
      const phone = last9(o.billing?.phone), mail = email(o.billing?.email);
      const created = new Date(String(o.date_created_gmt || "") + (String(o.date_created_gmt || "").endsWith("Z") ? "" : "Z"));
      if (!Number.isInteger(Number(o.id)) || isNaN(created)) continue;
      let contact = null;
      if (phone || mail) {
        const r = await query(
          `select id, session_id from contacts
            where ${tenantId ? "tenant_id = $1" : "tenant_id is null"}
              and ((${"$2"}::text is not null and right(regexp_replace(coalesce(phone, external_id), '\\D', '', 'g'), 9) = $2)
                or ($3::text is not null and lower(email) = $3))
              and first_seen_at <= $4 and first_seen_at >= $4::timestamptz - ($5::int * interval '1 day')
            order by last_seen_at desc limit 1`,
          [tenantId || null, phone, mail, created.toISOString(), windowDays()]
        );
        contact = r.rows[0] || null;
      }
      await query(
        `insert into woo_orders (tenant_id, order_id, status, total, currency, phone, email, order_created_at, contact_id, attributed_session)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict ((coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), order_id) do update set
           status=excluded.status, total=excluded.total, currency=excluded.currency, contact_id=excluded.contact_id,
           attributed_session=excluded.attributed_session, synced_at=now()`,
        [tenantId, Number(o.id), String(o.status || "").slice(0, 30), Number(o.total) || 0, String(o.currency || "").slice(0, 8) || null, phone, mail, created.toISOString(), contact?.id || null, contact?.session_id || null]
      );
      if (contact && ["completed", "processing"].includes(o.status)) {
        attributed++;
        const u = await query("update contacts set stage='compro', updated_at=now() where id=$1 and stage<>'compro' returning id", [contact.id]);
        if (u.rows.length) await query("insert into contact_stage_events (contact_id, tenant_id, from_stage, to_stage, actor) values ($1,$2,null,'compro','woo_order')", [contact.id, tenantId]);
      }
    }
    await query("insert into woo_sync_state (tenant_key, last_sync_at, last_error) values ($1, now(), null) on conflict (tenant_key) do update set last_sync_at=now(), last_error=null", [key]);
    return { ok: true, orders: orders.length, attributed };
  } catch (error) {
    console.warn("[Woo] order sync failed:", safeError(error));
    await query("insert into woo_sync_state (tenant_key, last_error) values ($1, $2) on conflict (tenant_key) do update set last_error=$2", [key, String(error.message || "error").slice(0, 120)]).catch(() => {});
    return { ok: false, error: String(error.message || "error") };
  }
}

function operatorCreds() {
  const { WC_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET } = process.env;
  return WC_URL && WC_CONSUMER_KEY && WC_CONSUMER_SECRET ? { storeUrl: WC_URL.replace(/\/+$/, ""), consumerKey: WC_CONSUMER_KEY, consumerSecret: WC_CONSUMER_SECRET } : null;
}

module.exports = { fetchOrders, syncOrders, operatorCreds, last9, email, windowDays };
