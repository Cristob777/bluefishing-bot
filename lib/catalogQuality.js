// Compuerta de calidad del conocimiento de catálogo.
// Si el enriquecimiento vuelve a contaminarse (ej.: vuelve a leer el menú del sitio),
// el refresh falla en voz alta en vez de publicar datos malos que el agente usaría para vender.

// Versión de la lógica de extracción. Súbela cuando cambie: fuerza re-enriquecer todo y el
// runtime ignora registros de versiones anteriores (v1 = contaminados por el menú del sitio).
const KNOWLEDGE_VERSION = 2;

const LIMITS = {
  // Productos marcados mar Y río a la vez. Algunos son legítimos (multipropósito), pero
  // el 100% que había antes era la firma del menú del sitio colado en la ficha.
  dual_water_max_ratio: 0.3,
  // Productos con 4+ técnicas distintas. Casi ningún producto real es para 4 técnicas.
  many_techniques_max_ratio: 0.15,
  many_techniques_threshold: 4,
  // Con muy pocos productos un solo caso legítimo mueve el porcentaje: no se aplica la compuerta.
  min_sample: 20,
};

function qualityReport(knowledge, { urls } = {}) {
  const entries = Object.entries(knowledge || {})
    .filter(([url]) => !urls || urls.has(url))
    .map(([, record]) => record);
  const total = entries.length;
  const count = (fn) => entries.filter(fn).length;

  const dualWater = count((r) => (r.water_type || []).includes("mar") && (r.water_type || []).includes("río"));
  const manyTechniques = count((r) => (r.technique || []).length >= LIMITS.many_techniques_threshold);
  const needsReview = count((r) => r.needs_review);
  const ai = count((r) => r.extraction_method === "openai_structured");

  const ratio = (n) => (total ? n / total : 0);
  const failures = [];
  if (total < LIMITS.min_sample) {
    return { total, dual_water: dualWater, many_techniques: manyTechniques, needs_review: needsReview, ai_extracted: ai, ok: true, failures, skipped: "muestra_pequeña" };
  }
  if (ratio(dualWater) > LIMITS.dual_water_max_ratio) {
    failures.push(`${dualWater}/${total} productos marcados mar+río (máx ${LIMITS.dual_water_max_ratio * 100}%)`);
  }
  if (ratio(manyTechniques) > LIMITS.many_techniques_max_ratio) {
    failures.push(`${manyTechniques}/${total} productos con ${LIMITS.many_techniques_threshold}+ técnicas (máx ${LIMITS.many_techniques_max_ratio * 100}%)`);
  }

  return {
    total,
    dual_water: dualWater,
    many_techniques: manyTechniques,
    needs_review: needsReview,
    ai_extracted: ai,
    ok: failures.length === 0,
    failures,
  };
}

module.exports = { KNOWLEDGE_VERSION, LIMITS, qualityReport };
