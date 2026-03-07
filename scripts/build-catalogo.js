const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const CSV_PATH = path.join(__dirname, "..", "catalogo", "wc-product-export.csv");
const OUT_PATH = path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt");

function slugify(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function main() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const lines = [];
  const baseUrl = "https://bluefishing.cl/producto/";

  for (const row of rows) {
    const nombre = (row.Nombre || "").trim();
    const precio = (row["Precio normal"] || "").trim();
    const categorias = (row.Categorías || "").trim();

    if (!nombre || !precio) continue;

    const slug = slugify(nombre);
    const precioStr = `$${Number(precio).toLocaleString("es-CL")}`;
    const catShort = categorias.split(",")[0].trim().replace(/^Todos los Productos\s*>\s*/i, "");

    // Filtrar solo las categorías principales o marcas importantes para no saturar a la IA
    const allowedCats = ["Cañas", "Carretes", "Líneas", "Combos", "Señuelos"];
    const isAllowed = allowedCats.some(c => catShort.includes(c)) || catShort.includes("Marcas");
    
    if (isAllowed) {
      const url = slug ? `${baseUrl}${slug}/` : "";
      lines.push(`${nombre} | ${precioStr} | ${catShort} | ${url}`);
    }
  }

  const header = `# Catálogo Bluefishing.cl\n# Formato: Nombre | Precio | Categoría | URL\n\n`;
  fs.writeFileSync(OUT_PATH, header + lines.join("\n"), "utf8");
  console.log(`Listo: ${lines.length} productos → ${OUT_PATH}`);
}

main();
