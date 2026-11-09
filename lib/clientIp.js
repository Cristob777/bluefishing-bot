// IP real del cliente detrás del proxy.
//
// En PROXY_MODE=tunnel el tráfico llega por cloudflared, que agrega CF-Connecting-IP con la IP
// que vio Cloudflare. En ese modo solo cloudflared puede alcanzar la app (los puertos se publican
// únicamente en 127.0.0.1), así que el header es confiable. En los demás modos se devuelve null
// y cada endpoint mantiene su lógica previa con X-Forwarded-For.
function cloudflareClientIp(req, env = process.env) {
  if (String(env.PROXY_MODE || "").trim().toLowerCase() !== "tunnel") return null;
  const ip = String(req.headers?.["cf-connecting-ip"] || "").trim();
  return ip || null;
}

module.exports = { cloudflareClientIp };
