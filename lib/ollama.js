const { SYSTEM_PROMPT } = require("./systemPrompt");

async function askOllamaStructured(userContent, schema, { baseUrl, model, numCtx }) {
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

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Ollama did not return valid JSON: ${err.message}`);
  }
}

module.exports = { askOllamaStructured };
