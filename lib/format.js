const { marked } = require("marked");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const TRUTHY = new Set(["true", "yes", "y"]);
const FALSY = new Set(["false", "no", "n"]);

function formatAnswer(dataType, rawValue) {
  const raw = rawValue == null ? "" : String(rawValue).trim();

  if (dataType === "money") {
    const num = parseFloat(raw.replace(/[$,]/g, ""));
    if (!Number.isNaN(num)) {
      const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
      return { html: escapeHtml(formatted), ok: true };
    }
    return { html: escapeHtml(raw), ok: false };
  }

  if (dataType === "number") {
    const num = parseFloat(raw.replace(/,/g, ""));
    if (!Number.isNaN(num)) {
      return { html: escapeHtml(new Intl.NumberFormat("en-US").format(num)), ok: true };
    }
    return { html: escapeHtml(raw), ok: false };
  }

  if (dataType === "date") {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const formatted = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      return { html: escapeHtml(formatted), ok: true };
    }
    return { html: escapeHtml(raw), ok: false };
  }

  if (dataType === "boolean") {
    const lower = raw.toLowerCase();
    if (TRUTHY.has(lower)) return { html: '<span class="badge badge-yes">Yes</span>', ok: true };
    if (FALSY.has(lower)) return { html: '<span class="badge badge-no">No</span>', ok: true };
    return { html: escapeHtml(raw), ok: false };
  }

  // text (default)
  return { html: marked.parse(raw), ok: true };
}

module.exports = { formatAnswer };
