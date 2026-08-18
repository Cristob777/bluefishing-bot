// El auto-entrenamiento real de este bot: cuando el equipo marca una
// corrección como "resuelta" en /admin (pestaña Correcciones), esa lección
// se inyecta sola en el prompt de ventas — sin tocar código ni el
// cuestionario del producto. Solo entran acá correcciones que un humano ya
// validó (status = 'resolved'); lo que está "flagged" sin resolver nunca
// llega al bot, así un error mal escrito no se propaga a clientes reales
// antes de que alguien lo revise.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_EXAMPLES = 20;
const MAX_CORRECTION_LENGTH = 400;

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

let cache = { examples: [], fetchedAt: 0 };

async function getLearnedExamples() {
  if (!client) return [];

  const now = Date.now();
  if (now - cache.fetchedAt < CACHE_TTL_MS) return cache.examples;

  try {
    const { data, error } = await client
      .from("chat_feedback")
      .select("user_message, correction, resolved_at")
      .eq("status", "resolved")
      .not("correction", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(MAX_EXAMPLES);
    if (error) throw error;

    const examples = (data || [])
      .filter((row) => (row.correction || "").trim())
      .map((row) => ({
        userMessage: row.user_message,
        correction: row.correction.trim().slice(0, MAX_CORRECTION_LENGTH),
      }));

    cache = { examples, fetchedAt: now };
    return examples;
  } catch (error) {
    console.warn("[LearnedExamples] No se pudo cargar:", error.message);
    return cache.examples;
  }
}

function formatLearnedExamples(examples) {
  if (!examples.length) return "";

  const lines = examples.map((ex, i) =>
    `${i + 1}. Cliente preguntó algo como: "${ex.userMessage}"\n   Respuesta correcta validada por el equipo: "${ex.correction}"`
  );

  return [
    "=== CORRECCIONES APRENDIDAS ===",
    "El equipo ya validó estas respuestas tras revisar errores previos del bot. Si la consulta actual se parece a alguna, sigue ese criterio en vez de improvisar:",
    lines.join("\n\n"),
  ].join("\n");
}

module.exports = { getLearnedExamples, formatLearnedExamples };
