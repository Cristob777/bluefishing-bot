// Acceso a datos multi-tenant. Toda consulta va filtrada por tenant_id.
const crypto = require("node:crypto");
const { query } = require("./postgres");
const box = require("./secretBox");

const aad = (tenantId, field) => `${tenantId}:${field}`;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored || "").split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64url");
    const got = crypto.scryptSync(String(password), Buffer.from(salt, "base64url"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}

// Hash fijo para igualar el tiempo de respuesta cuando el correo no existe.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

function createStore(db = { query }) {
  return {
    async signup({ company, email, password }) {
      const r = await db.query(
        `with t as (insert into tenants(name) values ($1) returning id)
         insert into tenant_users(tenant_id,email,password_hash)
         select id,$2,$3 from t
         on conflict (email) do nothing
         returning id, tenant_id, email, session_version`,
        [company, email, hashPassword(password)]
      );
      return r.rows[0] || null;
    },

    async login(email, password) {
      const r = await db.query("select id, tenant_id, email, password_hash, session_version from tenant_users where email=$1", [email]);
      const u = r.rows[0];
      if (!verifyPassword(password, u ? u.password_hash : DUMMY_HASH) || !u) return null;
      await db.query("update tenant_users set last_login_at=now() where id=$1", [u.id]);
      return { id: u.id, tenant_id: u.tenant_id, email: u.email, session_version: u.session_version };
    },

    async getUser(userId) {
      const r = await db.query(
        "select u.id,u.tenant_id,u.email,u.session_version,t.name tenant_name from tenant_users u join tenants t on t.id=u.tenant_id where u.id=$1",
        [userId]
      );
      return r.rows[0] || null;
    },

    async bumpSession(userId) {
      await db.query("update tenant_users set session_version=session_version+1 where id=$1", [userId]);
    },

    async status(tenantId) {
      const r = await db.query(
        "select woo_store_url,woo_key_permissions,woo_connected_at,wa_mode,wa_phone_number_id,wa_waba_id,wa_display_phone,wa_connected_at from tenant_credentials where tenant_id=$1",
        [tenantId]
      );
      return r.rows[0] || {};
    },


    // ---- Datos de actividad por empresa (sesiones WhatsApp con prefijo wa:<tenant>:) ----
    async metrics(tenantId, days = 30) {
      const pre = `wa:${tenantId}:%`;
      const r = await db.query(
        `select (select count(*)::int from bot_events where session_id like $1 and created_at>=now()-($2::int*interval '1 day')) messages,
                (select count(distinct session_id)::int from bot_events where session_id like $1 and created_at>=now()-($2::int*interval '1 day')) contacts,
                (select count(*)::int from handoff_requests where session_id like $1 and status='open') handoffs,
                (select count(*)::int from bot_events where session_id like $1 and created_at>=now()-interval '1 day') today`,
        [pre, days]
      );
      return r.rows[0] || {};
    },

    async results(tenantId, days) {
      return require("./results").results((t, v) => db.query(t, v), { days, prefix: `wa:${tenantId}:%` });
    },

    async conversations(tenantId, limit = 50) {
      const r = await db.query(
        `select e.session_id, max(e.created_at) last_at, count(*)::int turns,
                (array_agg(e.user_message order by e.created_at desc))[1] last_message,
                (array_agg(coalesce(e.intent,'') order by e.created_at desc))[1] last_intent,
                bool_or(e.handoff) handoff,
                max(s.known_context->>'purchase_intent_level') intent_level
           from bot_events e left join bot_sessions s on s.session_id=e.session_id
          where e.session_id like $1 group by e.session_id order by max(e.created_at) desc limit $2`,
        [`wa:${tenantId}:%`, limit]
      );
      return r.rows;
    },

    async conversation(tenantId, sessionId) {
      if (!String(sessionId).startsWith(`wa:${tenantId}:`)) return null;
      const [s, e, h] = await Promise.all([
        db.query("select known_context, updated_at from bot_sessions where session_id=$1", [sessionId]),
        db.query("select user_message, bot_response, intent, products, created_at from bot_events where session_id=$1 order by created_at asc limit 200", [sessionId]),
        db.query("select status, intent, created_at from handoff_requests where session_id=$1 order by created_at desc limit 5", [sessionId]),
      ]);
      return { context: s.rows[0]?.known_context || {}, events: e.rows, handoffs: h.rows };
    },

    async createState({ tenantId, kind, storeUrl = null, ttlSeconds = 900 }) {
      const state = crypto.randomBytes(32).toString("base64url");
      await db.query(
        "insert into onboarding_states(state_hash,tenant_id,kind,store_url,expires_at) values ($1,$2,$3,$4,now()+($5::int*interval '1 second'))",
        [box.sha256(state), tenantId, kind, storeUrl, ttlSeconds]
      );
      return state;
    },

    // Consume el state una sola vez; devuelve null si no existe, expiró o ya se usó.
    async consumeState(state, kind) {
      if (!state || String(state).length > 200) return null;
      const r = await db.query(
        "update onboarding_states set used_at=now() where state_hash=$1 and kind=$2 and used_at is null and expires_at>now() returning tenant_id, store_url",
        [box.sha256(state), kind]
      );
      return r.rows[0] || null;
    },

    async saveWoo(tenantId, { storeUrl, keyId, consumerKey, consumerSecret, permissions }) {
      await db.query(
        `insert into tenant_credentials(tenant_id,woo_store_url,woo_key_id,woo_consumer_key_enc,woo_consumer_secret_enc,woo_key_permissions,woo_connected_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,now(),now())
         on conflict (tenant_id) do update set woo_store_url=excluded.woo_store_url,woo_key_id=excluded.woo_key_id,
           woo_consumer_key_enc=excluded.woo_consumer_key_enc,woo_consumer_secret_enc=excluded.woo_consumer_secret_enc,
           woo_key_permissions=excluded.woo_key_permissions,woo_connected_at=now(),updated_at=now()`,
        [tenantId, storeUrl, keyId || null, box.encrypt(consumerKey, aad(tenantId, "woo_key")), box.encrypt(consumerSecret, aad(tenantId, "woo_secret")), permissions || null]
      );
    },

    async saveWhatsApp(tenantId, { mode, phoneNumberId, wabaId, displayPhone, accessToken, appSecret, pin }) {
      await db.query(
        `insert into tenant_credentials(tenant_id,wa_mode,wa_phone_number_id,wa_waba_id,wa_display_phone,wa_access_token_enc,wa_app_secret_enc,wa_registration_pin_enc,wa_connected_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
         on conflict (tenant_id) do update set wa_mode=excluded.wa_mode,wa_phone_number_id=excluded.wa_phone_number_id,
           wa_waba_id=excluded.wa_waba_id,wa_display_phone=excluded.wa_display_phone,wa_access_token_enc=excluded.wa_access_token_enc,
           wa_app_secret_enc=excluded.wa_app_secret_enc,wa_registration_pin_enc=excluded.wa_registration_pin_enc,
           wa_connected_at=now(),updated_at=now()`,
        [tenantId, mode, phoneNumberId, wabaId, displayPhone || null,
          box.encrypt(accessToken, aad(tenantId, "wa_token")),
          box.encrypt(appSecret, aad(tenantId, "wa_app_secret")),
          box.encrypt(pin, aad(tenantId, "wa_pin"))]
      );
    },

    async findWhatsAppByPhoneNumberId(phoneNumberId) {
      if (!phoneNumberId) return null;
      const r = await db.query(
        "select tenant_id,wa_phone_number_id,wa_access_token_enc,wa_app_secret_enc from tenant_credentials where wa_phone_number_id=$1",
        [String(phoneNumberId)]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        tenantId: row.tenant_id,
        phoneNumberId: row.wa_phone_number_id,
        accessToken: box.decrypt(row.wa_access_token_enc, aad(row.tenant_id, "wa_token")),
        appSecret: box.decrypt(row.wa_app_secret_enc, aad(row.tenant_id, "wa_app_secret")),
      };
    },

    async ensureVerifyTokenHash(tenantId, hash) {
      await db.query(
        `insert into tenant_credentials(tenant_id,wa_verify_token_hash,updated_at) values ($1,$2,now())
         on conflict (tenant_id) do update set wa_verify_token_hash=excluded.wa_verify_token_hash`,
        [tenantId, hash]
      );
    },

    async hasVerifyTokenHash(hash) {
      const r = await db.query("select 1 from tenant_credentials where wa_verify_token_hash=$1", [hash]);
      return r.rows.length > 0;
    },

    async getWooCredentials(tenantId) {
      const r = await db.query("select woo_store_url,woo_consumer_key_enc,woo_consumer_secret_enc from tenant_credentials where tenant_id=$1", [tenantId]);
      const row = r.rows[0];
      if (!row?.woo_consumer_key_enc) return null;
      return {
        storeUrl: row.woo_store_url,
        consumerKey: box.decrypt(row.woo_consumer_key_enc, aad(tenantId, "woo_key")),
        consumerSecret: box.decrypt(row.woo_consumer_secret_enc, aad(tenantId, "woo_secret")),
      };
    },
  };
}

module.exports = { createStore, normalizeEmail, validEmail, hashPassword, verifyPassword };
