// Cliente mínimo de la Graph API para el onboarding de WhatsApp.
// Nunca registra tokens: los errores se devuelven sin el token.
const crypto = require("node:crypto");
const GRAPH = "https://graph.facebook.com";
const version = () => process.env.GRAPH_API_VERSION || "v24.0";
const ID_RE = /^\d{5,25}$/;

async function graph(path, { method = "GET", token, params, body, fetchImpl = fetch } = {}) {
  const url = new URL(`${GRAPH}/${version()}/${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetchImpl(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(`graph_error:${res.status}:${data?.error?.code || ""}`);
    err.graphCode = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Fase 1: valida token + phone_number_id + WABA del propio cliente y suscribe la app al WABA.
// Si se entrega appSecret, se envía appsecret_proof: Graph lo rechaza si el secreto
// no corresponde a la app que emitió el token, así validamos también el App secret.
async function validateAndSubscribe({ accessToken, phoneNumberId, wabaId, appSecret }, { fetchImpl } = {}) {
  if (!ID_RE.test(String(phoneNumberId)) || !ID_RE.test(String(wabaId))) throw new Error("invalid_ids");
  if (!accessToken || String(accessToken).length < 20) throw new Error("invalid_token");
  const proof = appSecret ? crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex") : undefined;
  const phone = await graph(phoneNumberId, { token: accessToken, params: { fields: "id,display_phone_number,verified_name", appsecret_proof: proof }, fetchImpl });
  const list = await graph(`${wabaId}/phone_numbers`, { token: accessToken, params: { fields: "id" }, fetchImpl });
  if (!(list.data || []).some((p) => String(p.id) === String(phoneNumberId))) throw new Error("phone_not_in_waba");
  const sub = await graph(`${wabaId}/subscribed_apps`, { method: "POST", token: accessToken, fetchImpl });
  if (sub.success === false) throw new Error("subscribe_failed");
  return { displayPhone: phone.display_phone_number || null, verifiedName: phone.verified_name || null };
}

// Fase 2 (Embedded Signup): intercambia el code por un business token.
async function exchangeCode(code, { fetchImpl } = {}) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("meta_app_not_configured");
  const data = await graph("oauth/access_token", { params: { client_id: appId, client_secret: appSecret, code }, fetchImpl });
  if (!data.access_token) throw new Error("no_access_token");
  return data.access_token;
}

async function registerPhone({ accessToken, phoneNumberId, pin }, { fetchImpl } = {}) {
  return graph(`${phoneNumberId}/register`, { method: "POST", token: accessToken, body: { messaging_product: "whatsapp", pin }, fetchImpl });
}

async function sendText({ accessToken, phoneNumberId, to, body }, { fetchImpl } = {}) {
  return graph(`${phoneNumberId}/messages`, {
    method: "POST", token: accessToken, fetchImpl,
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: String(to), type: "text", text: { body, preview_url: false } },
  });
}

module.exports = { graph, validateAndSubscribe, exchangeCode, registerPhone, sendText, ID_RE };
