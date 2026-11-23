// El cliente pide hablar con una persona. Regla compartida por el motor de ventas y Chatwoot.
// Bordes con \p{L} (no \b): "asesoría" o "vendedores" no deben confundirse con pedir un humano.
const HUMAN_REQUEST_RE = /(?<!\p{L})(humano|una persona|persona real|vendedor(a)?|ejecutiv[oa]|asesor(a)?|hablar con alguien)(?!\p{L})/iu;
module.exports = { HUMAN_REQUEST_RE };
