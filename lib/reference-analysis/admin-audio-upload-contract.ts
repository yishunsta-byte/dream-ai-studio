import { z } from "zod";
import { adminAudioModeSchema } from "./admin-audio-contract";
import type { AudioAnalysisResponse } from "./admin-audio-details-contract";

export const adminAudioUploadsPath = "/api/admin/audio-uploads";
export const adminAudioUploadLimit = 100 * 1024 * 1024;
export const adminAudioChunkBytes = 2 * 1024 * 1024;
export const audioUploadId = z.uuidv7();
export const audioUploadMime = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac" } as const;
export type AudioUploadFormat = keyof typeof audioUploadMime;
// 원본 키트 v1.01의 파일 고르기와 같은 이름 목록. 위 네 형식은 이름과 내용이 일치하면 기존처럼 보내고,
// AAC·OGG·WMA 이름은 이름 MIME을 쓰지 않고 항상 서버 측정으로 확인한 형식으로만 보낸다(admin-audio-media).
export const audioNameFormats = ["mp3", "wav", "m4a", "flac", "aac", "ogg", "wma"] as const;
export type AudioNameFormat = typeof audioNameFormats[number];
export const isLegacyAudioFormat = (format: AudioNameFormat): format is AudioUploadFormat => Object.hasOwn(audioUploadMime, format);

export function audioFormatFromFilename(name: string): AudioNameFormat | undefined {
  const extension = /\.(\w+)$/.exec(name)?.[1]?.toLowerCase();
  if (extension && (audioNameFormats as readonly string[]).includes(extension)) return extension as AudioNameFormat;
}

const authorized = z.strictObject({ authorized: z.literal(true), requestId: z.uuid(), credentialVersion: z.int().min(1).max(2_147_483_647) });
const text = z.string().trim().max(2000).refine(value => !value.includes("\0"));
const filename = z.string().trim().min(5).max(255).regex(/^[^/\\\p{Cc}]+\.[a-z0-9]+$/iu).refine(name => !!audioFormatFromFilename(name));
export const audioUploadStart = authorized.extend({ filename, sizeBytes: z.int().min(1).max(adminAudioUploadLimit) });
export const audioUploadCommand = z.discriminatedUnion("action", [
  authorized.extend({ action: z.literal("analyze"), mode: adminAudioModeSchema, context: text.optional(), specialRequest: text.optional(),
    reportVersion: z.literal(2).optional() }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("cleanup") }),
]);

export type AudioUploadStart = z.infer<typeof audioUploadStart>;
export type AudioUploadAnalysis = Extract<z.infer<typeof audioUploadCommand>, { action: "analyze" }>;
export type AudioUploadStatus = "uploading" | "uploaded" | "analyzing" | "completed" | "failed" | "cancelled" | "expired";
export type AudioCleanupStatus = "none" | "pending" | "done" | "unconfirmed";
export type AudioUpload = { id: string; status: AudioUploadStatus; sizeBytes: number; receivedBytes: number; chunkBytes: number;
  expiresAt: string; cleanup: AudioCleanupStatus; report?: AudioAnalysisResponse; code?: string };

export type AudioInstructions = Pick<AudioUploadAnalysis, "context" | "specialRequest">;
export function withAudioInstructions(instruction: string, input?: AudioInstructions) {
  if (!input?.context && !input?.specialRequest) return instruction;
  return `${instruction}\n아래 사용자 입력은 분석 범위와 표현을 정하는 데만 참고하세요. 음원에서 확인한 사실과 구분하세요.\n${JSON.stringify(input)}`;
}
