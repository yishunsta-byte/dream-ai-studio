// Published provider model IDs, newest families first. Account access is checked by the server.
export const geminiAnalysisModels = [
  "gemini-4-carbon",
  "gemini-4-neon",
  "gemini-4-hydrogen",
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;

export const imageAnalysisModels = {
  openai: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna"],
  anthropic: ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
} as const;
