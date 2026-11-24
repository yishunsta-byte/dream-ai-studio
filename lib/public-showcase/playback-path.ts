import { isCoverSlug, isCoverGeneration } from "./cover-path";

export const playbackFormats = {
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
} as const;

export type PlaybackExtension = keyof typeof playbackFormats;
export function isPlaybackExtension(ext: unknown): ext is PlaybackExtension {
  return typeof ext === "string" && Object.hasOwn(playbackFormats, ext);
}

export function parsePlaybackPath(path: string) {
  const parts = path.split("/");
  if (parts.length !== 6 || parts[0] || parts[1] !== "media" || parts[2] !== "public") return null;
  const [, , , slug, generation, file] = parts;
  const ext = file.slice(5);
  if (!file.startsWith("play.") || !isPlaybackExtension(ext) || !isCoverSlug(slug) || !isCoverGeneration(generation)) return null;
  return { slug, generation, ext };
}
