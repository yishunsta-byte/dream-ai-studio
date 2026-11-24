// The Node instrumentation hook and the Pages API may be emitted as separate bundles.
export const playbackRuntimeKey = Symbol.for("dream-ai-studio.publication-playback-handler");
export type PlaybackRuntimeScope = typeof globalThis & {
  [playbackRuntimeKey]?: (request: Request) => Promise<Response>;
};
