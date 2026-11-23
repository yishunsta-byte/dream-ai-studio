import "server-only";

import { shortsBgmPromptRequest, type ShortsBgmPromptResult } from "./shorts-bgm-prompt-contract";
import { generateShortsBgmPrompt } from "./shorts-bgm-prompt";
import { createShortsCreativePost, type ShortsCreativeOverrides } from "./shorts-creative-http";

export function createShortsBgmPromptPost(overrides: ShortsCreativeOverrides = {}) {
  return createShortsCreativePost({
    schema: shortsBgmPromptRequest,
    progressCode: "bgm_prompt_in_progress",
    generate: generateShortsBgmPrompt,
    format: ({ source, durationSec, geminiCredentialVersion }, generated): ShortsBgmPromptResult => ({
      schemaVersion: 1, geminiCredentialVersion, source,
      generation: { ...generated, kind: "creative_bgm_prompt_draft", durationSec },
    }),
  }, overrides);
}
