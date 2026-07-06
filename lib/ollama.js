const { SYSTEM_PROMPT } = require("./systemPrompt");

async function askOllamaStructured(userContent, schema, { baseUrl, model, numCtx }) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        stream: false,
        format: schema,
        options: { num_ctx: numCtx }
      })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${baseUrl} — is 'ollama serve' running? (${err.message})`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const content = data && data.message && data.message.content;
  if (!content) {
    throw new Error("Ollama response did not contain message content");
  }

  const NS_PER_MS = 1e6;
  const evalCount = data.eval_count || 0;
  const evalDurationMs = (data.eval_duration || 0) / NS_PER_MS;
  const stats = {
    model,
    // Wall-clock round trip measured by us, including network overhead.
    elapsedMs: Date.now() - startedAt,
    // Metrics reported by Ollama (durations converted from ns to ms).
    totalDurationMs: (data.total_duration || 0) / NS_PER_MS,
    loadDurationMs: (data.load_duration || 0) / NS_PER_MS,
    promptTokens: data.prompt_eval_count || 0,
    responseTokens: evalCount,
    tokensPerSecond: evalDurationMs > 0 ? (evalCount / evalDurationMs) * 1000 : 0
  };

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Ollama did not return valid JSON: ${err.message}`);
  }

  return { ...parsed, stats };
}

module.exports = { askOllamaStructured };
