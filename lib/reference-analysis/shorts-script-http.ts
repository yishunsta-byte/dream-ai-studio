import "server-only";

import { createShortsCreativePost, type ShortsCreativeOverrides } from "./shorts-creative-http";
import { shortsScriptBodyByteLimit, shortsScriptRequest, type ShortsScriptResult } from "./shorts-script-contract";
import { generateShortsScript } from "./shorts-script";

export function createShortsScriptPost(overrides: ShortsCreativeOverrides = {}) {
  return createShortsCreativePost({
    schema: shortsScriptRequest,
    progressCode: "script_in_progress",
    largeBody: { limit: shortsScriptBodyByteLimit, allows: input => input.revision !== undefined },
    generate: generateShortsScript,
    format: ({ source, config, geminiCredentialVersion }, { scenes }): ShortsScriptResult => ({
      schemaVersion: 1, geminiCredentialVersion, source,
      generation: { kind: "creative_script_draft", durationSec: config.durationSec, scenes },
    }),
  }, overrides);
}
