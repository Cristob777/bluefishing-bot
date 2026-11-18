// AES-256-GCM para credenciales por tenant. Formato: v1.<iv>.<tag>.<ciphertext> (base64url).
// El AAD ata cada valor a su tenant y campo: un valor copiado a otra fila no descifra.
const crypto = require("node:crypto");

function masterKey() {
  const raw = String(process.env.CREDENTIALS_MASTER_KEY || "").trim();
  if (!raw) throw new Error("CREDENTIALS_MASTER_KEY no configurada");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_MASTER_KEY debe tener 32 bytes (64 hex o base64)");
  return key;
}

function isConfigured() {
  try { masterKey(); return true; } catch { return false; }
}

function encrypt(plaintext, aad) {
  if (plaintext == null || plaintext === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

function decrypt(box, aad) {
  if (!box) return null;
  const [v, iv, tag, ct] = String(box).split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Formato de credencial inválido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// Derivaciones deterministas (no reversibles) a partir de la clave maestra.
function derive(label) {
  return crypto.createHmac("sha256", masterKey()).update(String(label)).digest("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

module.exports = { encrypt, decrypt, derive, sha256, isConfigured };
