// Esquema de "entrenamiento" del catálogo: los campos que cada producto necesita
// tener cargados para que el bot pueda recomendar con criterio técnico real en
// vez de adivinar a partir del nombre. Espeja los CONTEXT_FIELDS que el bot ya
// extrae del cliente en lib/classifier.js, para que el match cliente↔producto
// se pueda hacer campo contra campo.

// Campos presentes en TODOS los productos, sin importar categoría.
const COMMON_FIELDS = [
  {
    key: "target_species",
    label: "Especies objetivo",
    type: "multiselect_tags",
    help: "Para qué peces sirve. Vacío = no verificado, no listar como \"sirve para todo\".",
    options: [
      "róbalo", "corvina", "lenguado", "congrio", "reineta", "pejerrey",
      "atún", "dorado", "albacora", "hiramasa", "trucha", "salmón",
      "bacalao", "merluza", "tiburón", "general/no específico",
    ],
  },
  {
    key: "water_type",
    label: "Tipo de agua",
    type: "multiselect",
    options: ["mar", "río", "lago"],
  },
  {
    key: "fishing_position",
    label: "Posición de pesca",
    type: "multiselect",
    options: ["orilla", "roca", "playa", "bote", "embarcación", "muelle"],
  },
  {
    key: "technique",
    label: "Técnica",
    type: "multiselect",
    options: [
      "spinning", "baitcasting", "jigging", "popping", "trolling",
      "surfcasting", "ajing/light game", "fondeo", "fly fishing",
    ],
  },
  {
    key: "experience_level",
    label: "Nivel de experiencia recomendado",
    type: "select",
    options: ["beginner", "intermediate", "advanced", "cualquiera"],
  },
  {
    key: "verified_notes",
    label: "Notas técnicas verificadas",
    type: "textarea",
    help: "Solo datos confirmados por el equipo. El bot puede citar esto tal cual; no debe inventar specs que no estén acá.",
  },
];

// Campos adicionales según product_type (mismos valores que product_type en
// prompts/intent-slot-extractor.xml).
const FIELDS_BY_PRODUCT_TYPE = {
  "caña": [
    {
      key: "rod_setup",
      label: "Tipo de armado",
      type: "select",
      options: ["spinning", "baitcasting", "jigging", "popping", "surf", "embarcado", "ajing", "trolling"],
    },
    { key: "length", label: "Largo", type: "text", help: "Ej: 6'6\" / 1,98m" },
    {
      key: "power",
      label: "Potencia (power)",
      type: "select",
      options: ["UL", "L", "ML", "M", "MH", "H", "XH"],
    },
    {
      key: "rod_action",
      label: "Acción de la caña",
      type: "select",
      help: "No confundir con action_type de señuelos (floating/sinking).",
      options: ["rápida (fast)", "media (medium)", "lenta (slow)"],
    },
    { key: "weight_range", label: "Rango de peso de señuelo compatible", type: "text", help: "Ej: 10-50g" },
    { key: "pieces", label: "Piezas", type: "select", options: ["1", "2", "3+"] },
    { key: "material", label: "Material", type: "select", options: ["grafito", "carbono", "fibra de vidrio", "composite"] },
  ],

  "carrete": [
    { key: "reel_type", label: "Tipo de carrete", type: "select", options: ["spinning", "baitcasting", "conventional"] },
    { key: "size", label: "Tamaño", type: "text", help: "Ej: 1000, 2000, 4000, 8000" },
    { key: "gear_ratio", label: "Relación de recuperación", type: "text", help: "Ej: 5.2:1" },
    { key: "line_capacity", label: "Capacidad de línea", type: "text" },
    { key: "max_drag_kg", label: "Freno máximo (kg)", type: "text" },
    { key: "bearings", label: "Rodamientos", type: "text" },
    { key: "saltwater_sealed", label: "Sellado para agua salada", type: "boolean" },
  ],

  "señuelo": [
    {
      key: "lure_type",
      label: "Tipo de señuelo",
      type: "select",
      options: ["floating", "sinking", "jig", "minnow", "popper", "soft_bait", "stickbait", "carnada artificial"],
    },
    {
      key: "action_type",
      label: "Comportamiento en el agua",
      type: "select",
      options: ["floating", "suspending", "sinking"],
    },
    { key: "weight_grams", label: "Peso", type: "text", help: "Ej: 30g" },
    { key: "length_cm", label: "Largo (cm)", type: "text" },
    { key: "working_depth", label: "Profundidad de trabajo", type: "text" },
  ],

  "línea": [
    { key: "line_type", label: "Tipo de línea", type: "select", options: ["monofilamento", "fluorocarbono", "multifilamento/trenzada"] },
    { key: "diameter_or_pe", label: "Diámetro / rating PE", type: "text", help: "Ej: 0.30mm ó PE 0.8" },
    { key: "breaking_strength_kg", label: "Resistencia (kg)", type: "text" },
    { key: "spool_length_m", label: "Metraje", type: "text" },
  ],

  "ropa": [
    { key: "accessory_type", label: "Tipo de prenda", type: "select", options: ["jockey", "guante", "chaqueta", "otro"] },
    { key: "use_case", label: "Uso", type: "select", options: ["protección solar", "abrigo", "impermeable"] },
    { key: "size", label: "Talla", type: "text" },
  ],

  "accesorio": [
    { key: "accessory_type", label: "Tipo de accesorio", type: "select", options: ["caja", "linterna", "cocina/camping", "otro"] },
    { key: "use_case", label: "Uso", type: "text" },
  ],

  "otro": [],
};

// Para combos: se referencian los productos incluidos, no se repiten specs.
const COMBO_FIELDS = [
  { key: "included_products", label: "Productos incluidos", type: "multiselect_tags", help: "Nombres o URLs de los productos que trae el combo." },
  { key: "target_use", label: "Uso objetivo del combo", type: "text", help: "Ej: iniciación corvina/lenguado desde orilla" },
];

module.exports = {
  COMMON_FIELDS,
  FIELDS_BY_PRODUCT_TYPE,
  COMBO_FIELDS,
};
