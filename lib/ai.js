const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "none";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("").trim();
}

async function generateAIText({ systemPrompt, userMessage, history = [], maxTokens = 700 }) {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY");
  }

  const input = [
    ...history.map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: String(entry.content || ""),
    })),
    { role: "user", content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemPrompt,
        input,
        reasoning: { effort: OPENAI_REASONING_EFFORT },
        max_output_tokens: maxTokens,
        store: false,
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenAI Responses API: ${detail}`);
    }

    const text = extractOutputText(data);
    if (!text) {
      throw new Error("OpenAI devolvió una respuesta vacía");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateAIText,
  OPENAI_MODEL,
};
