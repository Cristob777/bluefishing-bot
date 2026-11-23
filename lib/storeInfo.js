// Información de la tienda (dirección, horario, despacho, pagos, retiro, cambios).
// La escribe Blue Fishing en .env.production (STORE_*), sin tocar código. Matías solo la usa tal cual:
// si un dato no está configurado, no lo inventa (regla 9 del prompt de ventas).
const { normalizeText } = require("./product-taxonomy");

const FIELDS = [
  { key: "address", env: "STORE_ADDRESS", label: "Dirección", re: /\b(direccion|donde (estan|queda|quedan|se ubican|esta la tienda)|ubicacion|ubicados|local fisico|tienda fisica)\b/ },
  { key: "hours", env: "STORE_HOURS", label: "Horario", re: /\b(horario|horarios|a que hora|abren|cierran|atienden (el|los|hoy|manana|sabado|domingo))\b/ },
  { key: "shipping", env: "STORE_SHIPPING", label: "Despacho", re: /\b(despacho|despachos|despachan|envio|envios|envian|mandan a|llega a|llegan a|courier|bluexpress)\b/ },
  { key: "payments", env: "STORE_PAYMENTS", label: "Medios de pago", re: /\b(medios? de pago|formas? de pago|como (pago|puedo pagar)|transferencia|webpay|tarjeta|cuotas)\b/ },
  { key: "pickup", env: "STORE_PICKUP", label: "Retiro en tienda", re: /\b(retiro en tienda|retirar|retiro|pasar a buscar|ir a buscar)\b/ },
  // Solo la política; "quiero devolver mi pedido" sigue yendo a postventa (traspaso).
  { key: "returns", env: "STORE_RETURNS", label: "Cambios y devoluciones", re: /\b(politica|plazo|como funciona[n]?)\b.*\b(cambio|cambios|devolucion|devoluciones|garantia)\b/ },
];

const clean = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 400);

function getStoreInfo(env = process.env) {
  return FIELDS.map((f) => ({ ...f, value: clean(env[f.env]) })).filter((f) => f.value && !/^CHANGE_ME/.test(f.value));
}

// Bloque para el prompt de ventas (vacío si no hay nada configurado).
function storeInfoPrompt(env = process.env) {
  const info = getStoreInfo(env);
  if (!info.length) return "";
  return [
    "=== INFORMACIÓN DE LA TIENDA (verificada por BlueFishing; úsala tal cual, no agregues datos) ===",
    ...info.map((f) => `${f.label}: ${f.value}`),
    "=== FIN INFORMACIÓN DE LA TIENDA ===",
  ].join("\n");
}

// Respuesta directa (sin LLM) a preguntas de la tienda. null = no es una pregunta de tienda,
// menciona productos (la responde el flujo de ventas) o pide un dato que no está configurado.
function storeInfoReply(message, { env = process.env, mentionsProduct = false } = {}) {
  if (mentionsProduct) return null;
  const text = normalizeText(message || "");
  const asked = FIELDS.filter((f) => f.re.test(text));
  if (!asked.length) return null;
  const known = new Map(getStoreInfo(env).map((f) => [f.key, f]));
  if (!asked.every((f) => known.has(f.key))) return null;
  const lines = asked.map((f) => `${f.label}: ${known.get(f.key).value}`);
  return `${lines.join("\n")}\n¿Te ayudo a elegir el equipo?`;
}

module.exports = { FIELDS, getStoreInfo, storeInfoPrompt, storeInfoReply };
