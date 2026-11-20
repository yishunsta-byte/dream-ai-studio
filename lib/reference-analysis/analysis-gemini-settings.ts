import "server-only";

import { credentialGroup, geminiPrograms, type GeminiProgram } from "./analysis-credential-contract";
import { openRuntimeGeminiCredentialStore, type GeminiCredentialStore } from "./analysis-credential-store";

type Environment = Readonly<Record<string, string | undefined>>;
export type GeminiSettings = { key: string; model: string };

const modelEnv = {
  image: "DREAM_REFERENCE_GEMINI_MODEL",
  shorts: "DREAM_REFERENCE_SHORTS_GEMINI_MODEL",
  music: "DREAM_MUSIC_SEMANTIC_GEMINI_MODEL",
} as const;

// Preserve the existing platform configuration for each deployed analyzer.
const legacyModel = { image: /^gemini-[a-z0-9][a-z0-9.-]{0,99}$/, shorts: /^gemini-[a-z0-9.-]+$/i,
  music: /^gemini-[a-z0-9][a-z0-9.-]{0,79}$/ };

export function environmentGemini(program: GeminiProgram, env: Environment): GeminiSettings | undefined {
  const keyName = program === "music" ? "DREAM_MUSIC_SEMANTIC_GEMINI_API_KEY" : "DREAM_REFERENCE_GEMINI_API_KEY";
  const key = env[keyName]?.trim();
  const model = env[modelEnv[program]]?.trim();
  return key && model && legacyModel[program].test(model) ? { key, model } : undefined;
}

export async function currentGeminiSettings(owner: string, program: GeminiProgram,
  store = openRuntimeGeminiCredentialStore(), env: Environment = process.env): Promise<GeminiSettings | undefined> {
  const saved = await store?.open(owner, credentialGroup(program));
  const model = saved?.models[program];
  if (saved && model) return { key: saved.apiKey, model };
  return environmentGemini(program, env);
}

export async function geminiCredentialMetadata(owner: string, store: GeminiCredentialStore | null, env: Environment) {
  const values = await store?.metadata(owner) ?? [];
  const reference = values.find(row => row.group === "reference");
  const music = values.find(row => row.group === "music");
  const group = (row: typeof reference) => ({ version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null });
  const programs = Object.fromEntries(geminiPrograms.map(program => {
    const row = program === "music" ? music : reference;
    const stored = row?.models[program];
    const tested = row?.lastTest[program];
    const fallback = stored ? undefined : environmentGemini(program, env);
    return [program, { configured: !!(stored || fallback), source: stored ? "stored" : fallback ? "environment" : "none",
      modelId: stored ?? fallback?.model ?? null, lastTest: tested?.version === row?.version ? tested ?? null : null }];
  }));
  return { storage: store ? "ready" : "unavailable", groups: { reference: group(reference), music: group(music) }, programs };
}
