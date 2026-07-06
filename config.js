module.exports = {
  taxpayers: [
    { id: "ben-1040", label: "Ben", file: "Ben.taxpayer-info.json" },
    { id: "maria-chen-1040", label: "Maria Chen", file: "Maria Chen.taxpayer-info.json" },
    { id: "david-okafor-1040", label: "David Okafor", file: "David Okafor.taxpayer-info.json" }
  ],
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "gemma3:12b",
    numCtx: 8192
  }
};
