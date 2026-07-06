const fs = require("fs");
const path = require("path");
const express = require("express");

const config = require("./config");
const { ANSWERS_SCHEMA } = require("./lib/systemPrompt");
const { askOllamaStructured } = require("./lib/ollama");
const { formatAnswer } = require("./lib/format");

const questionnaire = JSON.parse(fs.readFileSync(path.join(__dirname, "questionnaire.json"), "utf8"));

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

function renderIndex(res, { selectedTaxpayerId, checkedQuestionIds, freeformQuestion, result } = {}) {
  res.render("index", {
    taxpayers: config.taxpayers,
    questionnaire,
    selectedTaxpayerId: selectedTaxpayerId || config.taxpayers[0].id,
    checkedQuestionIds: checkedQuestionIds || [],
    freeformQuestion: freeformQuestion || "",
    result: result || null
  });
}

app.get("/", (req, res) => {
  renderIndex(res);
});

app.post("/ask", async (req, res) => {
  const { taxpayerId, freeformQuestion = "" } = req.body;
  const questionIds = [].concat(req.body.questionIds || []);

  const viewState = {
    selectedTaxpayerId: taxpayerId,
    checkedQuestionIds: questionIds,
    freeformQuestion
  };

  const taxpayer = config.taxpayers.find((t) => t.id === taxpayerId);
  if (!taxpayer) {
    return renderIndex(res, { ...viewState, result: { error: "Unknown taxpayer selected." } });
  }

  const items = questionIds
    .map((id) => questionnaire.find((q) => q.id === id))
    .filter(Boolean)
    .map((q) => ({ id: q.id, text: q.text, answerDataType: q.answerDataType }));

  freeformQuestion
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, idx) => {
      items.push({ id: `freeform-${idx + 1}`, text: line, answerDataType: "text" });
    });

  if (items.length === 0) {
    return renderIndex(res, { ...viewState, result: { error: "Select at least one question or type a free-form question." } });
  }

  let taxpayerData;
  try {
    taxpayerData = JSON.parse(fs.readFileSync(path.join(__dirname, taxpayer.file), "utf8"));
  } catch (err) {
    return renderIndex(res, { ...viewState, result: { error: `Could not load taxpayer file: ${err.message}` } });
  }

  const userContent = JSON.stringify({
    taxpayerData,
    questions: items.map(({ id, text, answerDataType }) => ({ questionId: id, text, answerDataType }))
  });

  try {
    const { answers } = await askOllamaStructured(userContent, ANSWERS_SCHEMA, config.ollama);
    const answersById = new Map((answers || []).map((a) => [a.questionId, a.answer]));

    const rows = items.map((item) => {
      const rawAnswer = answersById.has(item.id) ? answersById.get(item.id) : "Not available in provided data";
      const { html } = formatAnswer(item.answerDataType, rawAnswer);
      return { questionText: item.text, dataType: item.answerDataType, html };
    });

    renderIndex(res, { ...viewState, result: { rows } });
  } catch (err) {
    renderIndex(res, { ...viewState, result: { error: err.message } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Taxpayer Q&A POC listening on http://localhost:${PORT}`);
});
