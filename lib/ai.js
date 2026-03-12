const { Anthropic } = require("@anthropic-ai/sdk");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

async function generateWithClaude({ systemPrompt, userMessage, history = [], maxTokens = 700 }) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY o CLAUDE_API_KEY");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const messages = [
    ...history.map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  return response.content?.find((block) => block.type === "text")?.text || "";
}

async function generateAIText(options) {
  return generateWithClaude(options);
}

module.exports = {
  generateAIText,
  CLAUDE_MODEL,
};
