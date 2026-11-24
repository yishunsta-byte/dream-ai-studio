import { z } from "zod";
import { adminAudioResponseSchema, type AdminAudioMode } from "@/lib/reference-analysis/admin-audio-contract";
import {
  ADMIN_AUDIO_REPORT_PROFILE_HEADER, detailedAudioResponseSchema, EXPANDED_AUDIO_REPORT_PROFILE, type AudioAnalysisResponse,
} from "@/lib/reference-analysis/admin-audio-details-contract";
import {
  adminAudioChunkBytes, adminAudioUploadLimit, adminAudioUploadsPath, audioFormatFromFilename,
} from "@/lib/reference-analysis/admin-audio-upload-contract";
import { readCredentialSettings } from "./gemini-credentials-client";

// P1-07 원본 v1.15 100 MiB 오디오 업로드의 화면 쪽 통신(Backend 298cc8f 계약, d35eea5 기준).
// 접수 POST → 2 MiB 분할 PUT(x-dream-upload-offset) → 상태 GET → 분석·취소·정리 POST. 상세 v2 보고서는 사용자가 고른 경우에만
// 분석 본문에 reportVersion: 2를 붙인다(생략 = v1, d35eea5 계약).
// 응답이 끊기거나 형식이 맞지 않으면 'lost'로 돌려주고, 화면은 같은 요청 ID로 다시 확인하거나 상태를 읽는다.
// A-3(B-2 7e7a264): expanded면 x-dream-audio-report-profile: expanded를 붙인다. 서버는 저장 보고서를 응답에 담을 때 요청의 이 머리글을 따른다
// (없으면 기본 v2, 같은 접수의 분석 재전송에서 프로필이 바뀌면 409). 화면은 그 접수의 분석을 보낸 프로필을 조회·취소·정리·조각에도 그대로 쓴다.
export const largeAudioLimit = adminAudioUploadLimit;
export const directAudioLimit = 4 * 1024 * 1024;
// P1-07 A-2: 관리자 오디오 형식은 서버와 같은 audioFormatFromFilename으로만 판정한다(대소문자 무관).
// 오디오 호환 3차: 원본 키트 v1.01 파일 고르기와 같은 MP3·WAV·M4A·FLAC·AAC·OGG·WMA. 실제 형식은 서버가 내용을 측정해 확인한다.
// 공용 참조 분석 형식(referenceFileFormat)은 넓히지 않는다. 바로 분석·보호 업로드·파일 선택 세 곳이 같은 판정을 쓴다.
export const AUDIO_FORMATS_LABEL = "MP3 · WAV · M4A · FLAC · AAC · OGG · WMA";
export const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.flac,.aac,.ogg,.wma";
/** 바로 분석(4 MiB 이하) 입력 확인. 맞지 않으면 안내 문구. */
export function directAudioIssue(file: File): string | undefined {
  if (!file.size) return "내용이 있는 파일을 선택해 주세요.";
  if (file.size > directAudioLimit) return "바로 분석은 4 MiB까지 가능해요.";
  if (!audioFormatFromFilename(file.name)) return `${AUDIO_FORMATS_LABEL} 확장자의 오디오 파일만 분석할 수 있어요.`;
  return undefined;
}
const statuses = ["uploading", "uploaded", "analyzing", "completed", "failed", "cancelled", "expired"] as const;
export type UploadStatus = typeof statuses[number];
export type CleanupStatus = "none" | "pending" | "done" | "unconfirmed";

const uploadSchema = z.object({
  id: z.uuid(), status: z.enum(statuses), sizeBytes: z.int().min(1).max(adminAudioUploadLimit),
  receivedBytes: z.int().min(0).max(adminAudioUploadLimit), chunkBytes: z.int().min(1).max(adminAudioChunkBytes),
  expiresAt: z.iso.datetime({ offset: true }), cleanup: z.enum(["none", "pending", "done", "unconfirmed"]),
  report: z.unknown().optional(), code: z.string().max(80).optional(),
}).refine(upload => upload.receivedBytes <= upload.sizeBytes);
export type AudioUploadView = Omit<z.infer<typeof uploadSchema>, "report"> & { report?: AudioAnalysisResponse };

export type UploadReply =
  | { kind: "ok"; status: number; upload: AudioUploadView }
  | { kind: "problem"; status: number; code: string; upload?: AudioUploadView }
  | { kind: "lost" } | { kind: "aborted" };

// 보고서가 있으면 schemaVersion에 따라 v1 또는 상세 v2 계약으로 읽는다. 어느 쪽도 아니면 응답 전체를 확인 실패로 본다.
function readUpload(value: unknown): AudioUploadView | null {
  const parsed = uploadSchema.safeParse(value);
  if (!parsed.success) return null;
  const { report, ...rest } = parsed.data;
  if (report === undefined) return rest;
  const read = (report && typeof report === "object" && "schemaVersion" in report && report.schemaVersion === 2
    ? detailedAudioResponseSchema : adminAudioResponseSchema).safeParse(report);
  return read.success ? { ...rest, report: read.data } : null;
}

const json = { "content-type": "application/json" };
const profiled = (headers: Record<string, string>, expanded?: boolean) =>
  expanded ? { ...headers, [ADMIN_AUDIO_REPORT_PROFILE_HEADER]: EXPANDED_AUDIO_REPORT_PROFILE } : headers;
export function createAudioUploadClient(send: typeof fetch = (...args) => fetch(...args)) {
  async function call(uri: string, init: RequestInit): Promise<UploadReply> {
    let response: Response;
    try { response = await send(uri, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" }); }
    catch { return init.signal?.aborted ? { kind: "aborted" } : { kind: "lost" }; }
    let body: unknown;
    try { body = await response.json(); }
    catch { return init.signal?.aborted ? { kind: "aborted" } : response.ok ? { kind: "lost" } : { kind: "problem", status: response.status, code: "" }; }
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const upload = "upload" in record ? readUpload(record.upload) : undefined;
    if (upload === null) return { kind: "lost" };
    if (response.ok) return upload ? { kind: "ok", status: response.status, upload } : { kind: "lost" };
    // 명시 code가 먼저다. code가 없을 때는 관리자 감싸개의 일시 장애 응답({ error: "unavailable" })만 코드로 읽고, 다른 error 원문은 버린다.
    const code = typeof record.code === "string" ? record.code.slice(0, 80) : record.error === "unavailable" ? "unavailable" : "";
    return { kind: "problem", status: response.status, code, ...(upload && { upload }) };
  }
  const at = (id: string) => `${adminAudioUploadsPath}/${encodeURIComponent(id)}`;
  return {
    /** 음악 분석 키 그룹 버전과 저장된 음악 모델 여부(접수·분석 요청의 credentialVersion). */
    async settings(signal: AbortSignal): Promise<{ kind: "ok"; configured: boolean; version: number } | { kind: "failed"; login: boolean }> {
      const outcome = await readCredentialSettings(signal);
      if (outcome.kind !== "ok") return { kind: "failed", login: outcome.kind === "login" };
      const music = outcome.value.programs.music;
      const version = outcome.value.groups.music.version;
      return { kind: "ok", configured: music.configured && music.source === "stored" && version >= 1, version };
    },
    start: (input: { requestId: string; credentialVersion: number; filename: string; sizeBytes: number }, signal: AbortSignal) =>
      call(adminAudioUploadsPath, { method: "POST", signal, headers: json, body: JSON.stringify({ ...input, authorized: true }) }),
    chunk: (id: string, offset: number, bytes: Blob, signal: AbortSignal, expanded?: boolean) => call(`${at(id)}/chunks`, { method: "PUT", signal, body: bytes,
      headers: profiled({ "content-type": "application/octet-stream", "x-dream-upload-offset": String(offset) }, expanded) }),
    read: (id: string, signal: AbortSignal, expanded?: boolean) => call(at(id), { method: "GET", signal, headers: profiled({}, expanded) }),
    analyze: (id: string, input: { requestId: string; credentialVersion: number; mode: AdminAudioMode; context?: string; specialRequest?: string; reportVersion?: 2 },
      signal: AbortSignal, expanded?: boolean) => call(at(id), { method: "POST", signal, headers: profiled(json, expanded),
      body: JSON.stringify({ action: "analyze", authorized: true, ...input }) }),
    cancel: (id: string, signal: AbortSignal, expanded?: boolean) => call(at(id), { method: "POST", signal, headers: profiled(json, expanded), body: JSON.stringify({ action: "cancel" }) }),
    cleanup: (id: string, signal: AbortSignal, expanded?: boolean) => call(at(id), { method: "POST", signal, headers: profiled(json, expanded), body: JSON.stringify({ action: "cleanup" }) }),
  };
}
export type AudioUploadClient = ReturnType<typeof createAudioUploadClient>;

/** 서버 파일 이름 규칙(5~255자, 경로·제어 문자 없음, MP3·WAV·M4A·FLAC)과 크기(1바이트~100 MiB). 맞지 않으면 안내 문구. */
export function largeAudioIssue(file: File): string | undefined {
  if (!file.size) return "내용이 있는 파일을 선택해 주세요.";
  if (file.size > adminAudioUploadLimit) return "업로드는 100 MiB까지 가능해요.";
  if (!audioFormatFromFilename(file.name)) return `${AUDIO_FORMATS_LABEL} 확장자의 오디오 파일만 올릴 수 있어요.`;
  const name = file.name.trim();
  if (name.length < 5 || name.length > 255 || /[/\\\p{Cc}]/u.test(name)) return "파일 이름은 5~255자이고 경로나 제어 문자가 없어야 해요. 이름을 바꾼 뒤 다시 선택해 주세요.";
  return undefined;
}

/** 입력 2,000자는 서버처럼 앞뒤 공백을 뺀 길이로 센다. 빈 값은 보내지 않는다. */
export const guidanceLimit = 2000;
export function guidance(text: string) {
  const value = text.trim();
  return value && !value.includes("\0") ? value : undefined;
}
