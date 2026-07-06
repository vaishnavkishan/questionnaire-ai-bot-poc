# Taxpayer Q&A POC (Node + Ollama/gemma3:12b)

## Context

This is a greenfield POC in an otherwise-empty repo. The goal is a very simple, low-design, server-rendered Node web app that lets a user pick a taxpayer (backed by a full-info JSON file), ask questions about them (from a predefined list and/or free-form), and see the AI's answer rendered alongside the questions asked. The AI backend is a locally running Ollama instance serving `gemma3:12b`.

Confirmed decisions from clarification:
- **Rendering**: server-rendered HTML (Express + EJS), minimal CSS, no SPA/client framework.
- **Taxpayer data**: use the existing `Ben 1040.taxpayer-info.json` (a 1040 tax return extract: taxpayer info, income/deduction/tax lines, schedules). Taxpayer list is **hardcoded** in a config file (id → label → filename), not auto-scanned.
- **Question bank**: `questionnaire.json`, currently empty, will be populated as an array of `{ id, text, answerDataType }` objects, where `answerDataType` is one of `text | number | money | date | boolean`. I'll seed it with a reasonable default set of ~8 questions derived from the 1040 schema (filing status, total income, AGI, taxable income, total tax, refund/owe, dependents, itemized vs. standard) — easy to edit later.
- **Context/memory**: no conversation history — every request is independent. A single request can bundle multiple questions (checked predefined ones + free-form lines), all sent together in one prompt.
- **Structured JSON in/out (key design point)**: the app sends Ollama a JSON payload (taxpayer data + the list of questions, each with its `id`/`text`/`answerDataType`) and constrains the model's response to a JSON schema via Ollama's structured-output `format` field: `{ answers: [{ questionId, answer }] }`. The app then renders each answer using the **question's own known `answerDataType`** (not something the model has to decide) — this is more reliable than trusting the model to self-report a type.
  - `answerDataType` is used both ways, as requested: (1) it's included in the prompt as a hint so the model tries to phrase/compute the answer appropriately (e.g. a plain number for `money`, ISO-ish date for `date`), and (2) the app independently formats the displayed value based on that same type (currency formatting, date formatting, Yes/No for booleans, etc.), with a safe fallback to the raw string if parsing fails.
  - Free-form input: the textarea may contain multiple questions (one per line). Each non-empty line becomes its own item with a generated id (`freeform-1`, `freeform-2`, ...) and `answerDataType: "text"` (free-form has no predefined type).
- **Ollama call**: plain `fetch` (Node 25 has global fetch) to the local REST API, no client library. Use `/api/chat` (not `/api/generate`) with separate `system`/`user` messages, `stream: false`, and `format: <json-schema>` for structured output — cleaner separation of fixed instructions vs. per-request data than one combined prompt string.
- **System prompt**: fixed instructions live in `lib/systemPrompt.js`, grounding the model strictly in the provided `taxpayerData`, requiring it to answer every question with exactly one entry each, requiring a concrete "locate the field, confirm it matches" self-check per answer (not just a vague "double-check yourself"), and requiring **raw, unformatted values** per `answerDataType` (e.g. `"36000"` not `"$36,000"`, `"true"`/`"false"` for booleans, `YYYY-MM-DD` for dates) — display formatting is the app's job (`format.js`), not the model's. Single-pass (no separate verification call) — good enough for this POC; a real two-call draft-then-verify pass would double latency and isn't warranted here.
- **Dependencies**: allowed to add minimal npm packages — `express`, `ejs`, `marked` (for rendering any markdown inside a `text`-type answer as formatted HTML).
- **Persistence**: none — each submission just shows its own result, nothing is saved to disk/DB.

Note: `ollama serve` is not currently running on this machine (checked via `ollama list`). The user will need to start it and ensure `gemma3:12b` is pulled before running the app.

## File structure

```
questionnaire-ai-bot-poc/
  package.json
  server.js                        # Express app + routes
  config.js                        # taxpayer list + ollama settings
  questionnaire.json                # seeded predefined questions
  "Ben 1040.taxpayer-info.json"     # existing, unchanged
  lib/
    ollama.js                       # fetch wrapper for Ollama /api/chat (structured output)
    systemPrompt.js                  # fixed system-prompt text + JSON schema for the response
    format.js                       # formatAnswer(dataType, rawValue) -> display string/html
  views/
    index.ejs                       # single page: form + result
  public/
    style.css                       # minimal styling
  PLAN.md                           # this plan, copied into the repo for reference
```

## Implementation details

**config.js**
```js
module.exports = {
  taxpayers: [
    { id: "ben-1040", label: "Ben 1040", file: "Ben 1040.taxpayer-info.json" }
  ],
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "gemma3:12b",
    numCtx: 8192 // headroom for the ~22KB taxpayer JSON + prompt + instructions
  }
};
```

**questionnaire.json** — array of `{ id, text, answerDataType }`, e.g.:
```json
[
  { "id": "filing-status", "text": "What is the taxpayer's filing status?", "answerDataType": "text" },
  { "id": "total-income", "text": "What is the total income reported?", "answerDataType": "money" },
  { "id": "agi", "text": "What is the adjusted gross income (AGI)?", "answerDataType": "money" },
  { "id": "taxable-income", "text": "What is the taxable income?", "answerDataType": "money" },
  { "id": "total-tax", "text": "What is the total tax owed?", "answerDataType": "money" },
  { "id": "refund-or-owe", "text": "Does the taxpayer get a refund, or do they owe money?", "answerDataType": "text" },
  { "id": "has-dependents", "text": "Does the taxpayer have any dependents?", "answerDataType": "boolean" },
  { "id": "itemized-vs-standard", "text": "Did the taxpayer itemize deductions or take the standard deduction?", "answerDataType": "text" }
]
```

**lib/format.js**
- `formatAnswer(dataType, rawValue)` — takes the model's raw string answer for a question and formats it for display per `dataType`:
  - `money` — strip `$`/commas, `parseFloat`, format via `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`; fall back to raw string if not parseable.
  - `number` — `parseFloat` + `Intl.NumberFormat('en-US')`; fall back to raw string.
  - `date` — `new Date(rawValue)`; if valid, format as `Month D, YYYY`; fall back to raw string.
  - `boolean` — normalize common truthy/falsy words (`yes/true/no/false`) to a `Yes`/`No` badge; fall back to raw string.
  - `text` — run through `marked()` so any markdown in the answer renders as HTML.
  - Always returns `{ html, ok }` (`ok: false` when it had to fall back), so the template can render either the formatted value or the raw text.

**lib/systemPrompt.js**
- Exports the fixed system-prompt string and the JSON schema for the response, e.g.:
  ```js
  const SYSTEM_PROMPT = `You are a tax-return data assistant. Answer questions about a taxpayer's Form 1040 return using ONLY the JSON provided in "taxpayerData" in the user message — no outside tax knowledge, no assumptions, no inference beyond what's explicitly present.

  Rules:
  1. If a fact is not present in taxpayerData, answer exactly "Not available in provided data" — never guess.
  2. Before finalizing each answer, locate the specific field(s) in taxpayerData you used and confirm the value matches exactly; correct it if it doesn't.
  3. Return the RAW value only, matching each question's answerDataType — the caller formats it for display:
     - "money" / "number": digits only, no $, commas, or units (e.g. "36000")
     - "date": YYYY-MM-DD
     - "boolean": exactly "true" or "false"
     - "text": concise plain text
  4. Answer every item in "questions" — exactly one entry per questionId, no extras, no omissions.
  5. Output ONLY JSON matching the given schema — no prose, no markdown fences, nothing before or after.`;

  const ANSWERS_SCHEMA = {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionId: { type: "string" },
            answer: { type: "string" }
          },
          required: ["questionId", "answer"]
        }
      }
    },
    required: ["answers"]
  };

  module.exports = { SYSTEM_PROMPT, ANSWERS_SCHEMA };
  ```

**lib/ollama.js**
- `async function askOllamaStructured(userContent, schema)` — POSTs `{ model, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }], stream: false, format: schema, options: { num_ctx } }` to `${baseUrl}/api/chat` via `fetch`. Parses `data.message.content` as JSON (constrained to match `schema`) and returns the parsed object. Throws a clear error if the fetch fails (e.g. Ollama not running), the HTTP response isn't OK, or the content isn't valid JSON, so the route can show a friendly error instead of crashing.
- The model always returns plain-string raw answers (per the system prompt's rules); the app owns type-aware display formatting via `format.js` using the `answerDataType` it already knows per question.

**server.js**
- Express app, `view engine = ejs`, static `public/`.
- `GET /` — loads `config.taxpayers` and `questionnaire.json`, renders `index.ejs` with no result yet (default-selects first taxpayer).
- `POST /ask` — body-parsed form fields: `taxpayerId`, `questionIds` (array, from checkboxes), `freeformQuestion` (multi-line text).
  - Look up taxpayer by id in config, `fs.readFileSync` + `JSON.parse` its file.
  - Build an `items` array: selected predefined questions (`{ id, text, answerDataType }` from `questionnaire.json`) plus one item per non-empty line of `freeformQuestion` (`{ id: "freeform-N", text: line, answerDataType: "text" }`).
  - Build the user message as `JSON.stringify({ taxpayerData, questions: items })`.
  - Call `askOllamaStructured(userContent, ANSWERS_SCHEMA)`; map the returned `answers` back to `items` by `questionId`; run each raw answer through `formatAnswer(item.answerDataType, rawAnswer)`.
  - Re-render `index.ejs` with the form re-populated (selected taxpayer, checked questions, free-form text) plus a `result` object: `{ rows: [{ questionText, dataType, html }], error? }`.

**views/index.ejs**
- Title, taxpayer `<select>` (from config), predefined questions as checkboxes with their text, free-form `<textarea>` (placeholder mentions one question per line), submit button.
- If `result` is present: a simple table/list of rows — question text, then its formatted answer (`<%- row.html %>` unescaped) — plus an error banner if `result.error` is set.

**public/style.css**
- Minimal: readable font, spacing, simple borders around sections — intentionally plain, no design system.

**package.json**
- `dependencies`: `express`, `ejs`, `marked`.
- `scripts.start`: `node server.js`.

## Verification

1. `npm install`
2. Ensure Ollama is running locally with the model pulled: `ollama serve` (separate terminal) and `ollama pull gemma3:12b` if not already present.
3. `npm start`, open `http://localhost:3000`.
4. Select the "Ben 1040" taxpayer, check a mix of predefined questions covering different `answerDataType`s (e.g. filing status → text, total tax → money, has dependents → boolean) and add a free-form question (e.g. "How much did they pay in mortgage interest?"), submit, confirm: each row's answer matches the underlying JSON data (filing status "Single", total tax $36,000, dependents "No", etc.) and is rendered per its type (currency formatting, Yes/No badge, markdown-rendered text).
5. Submit with no questions selected/entered to confirm it handles the empty case gracefully (either a validation message or a no-op).
6. Stop `ollama serve` and submit again to confirm the app shows a friendly error instead of crashing.
