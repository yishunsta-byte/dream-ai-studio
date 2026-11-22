import { z } from "zod";

export const referenceMedia = z.enum(["video", "music", "image"]);
export type ReferenceMedia = z.infer<typeof referenceMedia>;
export const referencePermission = z.enum(["synthetic", "authorized", "unknown"]);
export const referenceFileName = z.string().min(1).max(255).refine(value =>
  value === value.trim() && value !== "." && value !== ".." && !/[\\/:]/.test(value) &&
  [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const bodyText = z.string().max(100_000).refine(value => value.trim().length > 0);
const maxUrlLength = 4_096;
const urlText = z.string().max(maxUrlLength);
const permission = referencePermission.default("unknown");
const bodyAttribution = z.enum(["provided", "creator_public"]);
const bodyInput = z.strictObject({
  kind: z.literal("body"), text: bodyText, permission, attribution: bodyAttribution.default("provided"),
  sourceUrl: urlText.optional(), mediaHint: referenceMedia.optional(),
});
const fileInput = z.strictObject({
  kind: z.literal("file"), name: referenceFileName, sizeBytes: z.number().int().positive(), permission, mime: z.string().max(120).optional(),
});
const urlInput = z.strictObject({
  kind: z.literal("url"), url: urlText, permission, access: z.enum(["unknown", "public", "restricted"]).default("unknown"),
  mediaHint: referenceMedia.optional(),
});
const inputSchema = z.discriminatedUnion("kind", [bodyInput, fileInput, urlInput]);

const knownPermission = z.enum(["synthetic", "authorized"]);
// Keep the shortlist aligned with the repository's local media inspector.
const fileFormats = [
  { media: "image", extensions: ["png"], mimes: ["image/png"] },
  { media: "image", extensions: ["jpg", "jpeg"], mimes: ["image/jpeg"] },
  { media: "image", extensions: ["webp"], mimes: ["image/webp"] },
  { media: "video", extensions: ["mp4"], mimes: ["video/mp4"] },
  { media: "video", extensions: ["mov"], mimes: ["video/quicktime"] },
  { media: "video", extensions: ["webm"], mimes: ["video/webm"] },
  { media: "music", extensions: ["mp3"], mimes: ["audio/mpeg"] },
  { media: "music", extensions: ["wav"], mimes: ["audio/wav", "audio/x-wav"] },
  { media: "music", extensions: ["m4a"], mimes: ["audio/mp4", "audio/x-m4a"] },
] as const;

export const referenceFileByteLimit = 64 * 1024 * 1024;
export const referenceUploadByteLimit = 4 * 1024 * 1024;

export function referenceFileFormat(name: string) {
  const suffix = /\.(\w+)$/.exec(name)?.[1]?.toLowerCase();
  return fileFormats.find(format => format.extensions.some(extension => extension === suffix));
}

function approvedLink(value: string): URL | undefined {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed) || /[\r\n\t]/.test(trimmed)) return;
  try {
    const link = new URL(trimmed);
    if ((link.protocol === "https:" || link.protocol === "http:") && !link.username && !link.password &&
      publicLocator(link).length <= maxUrlLength) return link;
  } catch { /* A malformed locator is handled as invalid input. */ }
}

function isSite(host: string, domain: string) {
  return host === domain || host.endsWith("." + domain);
}

function isProfile(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase().replace(/^%40/, "@");
  if (isSite(host, "youtube.com")) {
    return first.startsWith("@") || ["channel", "user", "c"].includes(first);
  }
  if (isSite(host, "tiktok.com")) return first.startsWith("@") && parts.length === 1;
  if (isSite(host, "instagram.com")) return parts.length === 1 && !["p", "reel", "reels", "tv", "explore"].includes(first);
  if (isSite(host, "soundcloud.com")) return parts.length === 1;
  return false;
}

function publicLocator(url: URL): string {
  const safe = new URL(url);
  const youtubeId = isSite(safe.hostname, "youtube.com") && safe.pathname === "/watch"
    ? safe.searchParams.get("v") : null;
  safe.search = "";
  safe.hash = "";
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) safe.searchParams.set("v", youtubeId);
  return safe.href;
}

const sourceUrl = urlText.refine(value => {
  const link = approvedLink(value);
  return !!link && publicLocator(link) === value;
});
const bodySource = bodyInput.extend({ permission: knownPermission, attribution: bodyAttribution, sourceUrl: sourceUrl.optional() });
const fileSource = fileInput.extend({ permission: knownPermission, media: referenceMedia }).superRefine((source, context) => {
  const format = referenceFileFormat(source.name);
  if (!format || source.sizeBytes > referenceFileByteLimit || source.media !== format.media ||
    (source.mime !== undefined && !format.mimes.some(mime => mime === source.mime))) {
    context.addIssue({ code: "custom", message: "File type declaration is inconsistent" });
  }
});
const replacementReason = z.enum(["profile_url", "access_restricted", "permission_required", "url_not_accessed"]);
const invalidReason = z.enum(["invalid_input", "invalid_url", "unsupported_file_type", "file_type_mismatch", "invalid_file", "file_too_large"]);
const replacementOptions = ["body", "capture", "file"] as const;

export const referenceInputDecisionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), source: z.discriminatedUnion("kind", [bodySource, fileSource]) }),
  z.strictObject({
    status: z.literal("replacement_required"), reason: replacementReason, sourceUrl: sourceUrl.optional(), mediaHint: referenceMedia.optional(),
    alternatives: z.tuple([z.literal("body"), z.literal("capture"), z.literal("file")]),
  }),
  z.strictObject({ status: z.literal("invalid"), reason: invalidReason }),
]);

export type ReferenceInputDecision = z.infer<typeof referenceInputDecisionSchema>;
export type ReferenceFileSource = z.infer<typeof fileSource>;

function replace(reason: z.infer<typeof replacementReason>, link?: URL, mediaHint?: z.infer<typeof referenceMedia>): ReferenceInputDecision {
  return {
    status: "replacement_required", reason, alternatives: [...replacementOptions],
    ...(link ? { sourceUrl: publicLocator(link) } : {}),
    ...(mediaHint ? { mediaHint } : {}),
  };
}

/** Classifies a local submission without reading a file or contacting its origin. */
export function classifyReferenceInput(input: unknown): ReferenceInputDecision {
  const value = typeof input === "string"
    ? /^(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|file|data|javascript|blob):|\/\/|www\.)/i.test(input.trim())
      ? { kind: "url", url: input } : { kind: "body", text: input }
    : input;
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { status: "invalid", reason: "invalid_input" };
  const source = parsed.data;

  if (source.kind === "url") {
    const link = approvedLink(source.url);
    if (!link) return { status: "invalid", reason: "invalid_url" };
    if (isProfile(link)) return replace("profile_url", link, source.mediaHint);
    if (source.access === "restricted") return replace("access_restricted", link, source.mediaHint);
    return replace(source.permission === "unknown" ? "permission_required" : "url_not_accessed", link, source.mediaHint);
  }

  if (source.kind === "body") {
    const link = source.sourceUrl === undefined ? undefined : approvedLink(source.sourceUrl);
    if (source.sourceUrl !== undefined && !link) return { status: "invalid", reason: "invalid_url" };
    if (source.permission === "unknown") return replace("permission_required", link, source.mediaHint);
    return { status: "ready", source: {
      kind: "body", text: source.text, permission: source.permission, attribution: source.attribution,
      ...(link ? { sourceUrl: publicLocator(link) } : {}),
      ...(source.mediaHint ? { mediaHint: source.mediaHint } : {}),
    } };
  }

  if (source.sizeBytes > referenceFileByteLimit) return { status: "invalid", reason: "file_too_large" };
  if (source.permission === "unknown") return replace("permission_required");
  const format = referenceFileFormat(source.name);
  if (!format) return { status: "invalid", reason: "unsupported_file_type" };
  const mime = source.mime?.trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && !format.mimes.some(candidate => candidate === mime)) {
    return { status: "invalid", reason: "file_type_mismatch" };
  }
  return { status: "ready", source: {
    kind: "file", name: source.name, sizeBytes: source.sizeBytes, permission: source.permission, media: format.media,
    ...(mime && mime !== "application/octet-stream" ? { mime } : {}),
  } };
}
