const fs = require("node:fs");
const path = require("node:path");

// Archivos de catálogo generados en runtime (sync/enrich). En el stack Docker, CATALOG_RUNTIME_DIR
// apunta a un volumen (/app/data/catalogo) para no modificar los archivos trackeados de catalogo/.
// Sin la variable (dev/CI) se escribe en catalogo/ como antes.
const TRACKED_DIR = path.join(__dirname, "..", "catalogo");

function runtimeDir() {
  return process.env.CATALOG_RUNTIME_DIR ? path.resolve(process.env.CATALOG_RUNTIME_DIR) : TRACKED_DIR;
}

function trackedPath(name) {
  return path.join(TRACKED_DIR, name);
}

// Ruta de escritura (crea el directorio si falta).
function writePath(name) {
  const dir = runtimeDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// Ruta de lectura: generado en runtime si existe y no está vacío; si no, el trackeado.
function readPath(name) {
  const runtime = path.join(runtimeDir(), name);
  try {
    if (fs.statSync(runtime).size > 0) return runtime;
  } catch {}
  return trackedPath(name);
}

module.exports = { runtimeDir, trackedPath, writePath, readPath };
