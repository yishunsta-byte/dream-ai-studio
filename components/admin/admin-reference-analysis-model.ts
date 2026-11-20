import { z } from "zod";
import { studioAnalysisResultSchema, type StudioAnalysisResult } from "@/lib/reference-analysis/studio-analysis-result-dto";

// 관리자 콘텐츠 분석·공개 화면 계약(브라우저 안전). 서버 경로·저장·권한 판정은 Master 점유 서버가 맡는다.
// - POST /api/admin/reference-analysis {url, authorized:true} → 200 {result: StudioAnalysisResult}
// - GET  /api/admin/reference-analysis/publications → 200 {items: PublishedReferenceAnalysis[]}
// - POST 같은 경로 {id, title, summary, prompt, media, authorized:true} → 200 {item}  (명시 공개, 재시도는 같은 id)
// - DELETE 같은 경로 {id} → 200 {ok: true}  (철회, 이미 철회돼 있어도 ok)
// 401·403은 본문 없이 상태로 판정한다. 400·404·409·422 본문의 error 코드만 읽고, 서버 문장은 화면에 쓰지 않는다.

export const ANALYSIS_URI = "/api/admin/reference-analysis";
export const PUBLICATIONS_URI = "/api/admin/reference-analysis/publications";
export const LIMITS = { title: 80, summary: 600, prompt: 2000 } as const;

export type AnalysisMedia = "image" | "music" | "video";
export const MEDIA_LABEL: Record<AnalysisMedia, string> = { image: "이미지", music: "음악", video: "영상" };

// 지원 안내(기존 local-media-url의 고정 원본·형식·한도와 같다).
export const SUPPORTED_ORIGINS = ["https://interactive-examples.mdn.mozilla.net", "https://mdn.github.io", "https://tonejs.github.io"] as const;
export const SUPPORTED_FORMATS = [
  { media: "image", label: "이미지", extensions: "PNG · JPG · WEBP", limit: "" },
  { media: "music", label: "음악", extensions: "MP3 · WAV · M4A", limit: "24초까지" },
  { media: "video", label: "영상", extensions: "MP4 · MOV · WEBM", limit: "20초 · 240프레임까지" },
] as const;
export const SIZE_LIMIT_LABEL = "64MB";

const media = z.enum(["image", "music", "video"]);
const publicationSchema = z.strictObject({
  id: z.guid(),
  title: z.string().min(1).max(LIMITS.title),
  summary: z.string().min(1).max(LIMITS.summary),
  prompt: z.string().min(1).max(LIMITS.prompt),
  media,
  status: z.enum(["published", "revoked"]),
  publishedAt: z.iso.datetime({ offset: true }),
});
export type PublishedReferenceAnalysis = Readonly<z.infer<typeof publicationSchema>>;
export const isPublishedReferenceAnalysis = (value: unknown): value is PublishedReferenceAnalysis => publicationSchema.safeParse(value).success;

export type PublicationDraft = Readonly<{ title: string; summary: string; prompt: string; media: AnalysisMedia }>;
export type ReadyResult = Extract<StudioAnalysisResult, { status: "ready" }>;

export const ERROR_CODES = ["invalid_url", "unsupported_origin", "unsupported_format", "too_large", "rights_required",
  "analysis_failed", "invalid_publication", "not_found", "already_revoked"] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type Failure =
  | Readonly<{ kind: "login" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "rejected"; code: ErrorCode }>
  | Readonly<{ kind: "failed" }>;

export type AnalyzeOutcome = Readonly<{ kind: "ready"; result: ReadyResult }> | Readonly<{ kind: "unavailable"; reason: string }> | Failure;
export type ListOutcome = Readonly<{ kind: "ok"; items: readonly PublishedReferenceAnalysis[] }> | Failure;
export type PublishOutcome = Readonly<{ kind: "ok"; item: PublishedReferenceAnalysis }> | Failure;
export type RevokeOutcome = Readonly<{ kind: "ok" }> | Failure;

export type AdminTransportResponse = Readonly<{ status: number; json: () => Promise<unknown> }>;
export type AdminTransport = (uri: string, init: RequestInit) => Promise<AdminTransportResponse>;
export const browserTransport: AdminTransport = (uri, init) => fetch(uri, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });

const errorBody = z.object({ error: z.enum(ERROR_CODES) });

async function call<T>(transport: AdminTransport, uri: string, init: RequestInit, accept: (body: unknown) => T | undefined): Promise<T | Failure> {
  let response: AdminTransportResponse;
  try { response = await transport(uri, init); } catch { return { kind: "failed" }; }
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  let body: unknown;
  try { body = await response.json(); } catch { return { kind: "failed" }; }
  if (init.signal?.aborted) return { kind: "failed" };
  if (response.status === 200) return accept(body) ?? { kind: "failed" };
  if ([400, 404, 409, 422].includes(response.status)) {
    const parsed = errorBody.safeParse(body);
    if (parsed.success) return { kind: "rejected", code: parsed.data.error };
  }
  return { kind: "failed" };
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit =>
  ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

export function createAdminReferenceAnalysisClient(transport: AdminTransport = browserTransport) {
  return {
    analyze: (url: string, signal?: AbortSignal): Promise<AnalyzeOutcome> => call(transport, ANALYSIS_URI, json("POST", { url, authorized: true }, signal), (body) => {
      const parsed = z.object({ result: studioAnalysisResultSchema }).safeParse(body);
      if (!parsed.success) return undefined;
      const result = parsed.data.result as StudioAnalysisResult;
      return result.status === "ready" ? (result.proposals.length ? { kind: "ready", result } : undefined) : { kind: "unavailable", reason: result.reason };
    }),
    list: (signal?: AbortSignal): Promise<ListOutcome> => call(transport, PUBLICATIONS_URI, { method: "GET", signal }, (body) => {
      const parsed = z.object({ items: z.array(publicationSchema) }).safeParse(body);
      return parsed.success ? { kind: "ok", items: parsed.data.items } : undefined;
    }),
    // requestId는 화면이 만든 UUID다. 같은 공개 의도의 재시도에는 같은 값을 다시 보낸다(중복 공개 방지).
    publish: (requestId: string, draft: PublicationDraft): Promise<PublishOutcome> => call(transport, PUBLICATIONS_URI,
      json("POST", { id: requestId, ...trimmedDraft(draft), authorized: true }), (body) => {
      const parsed = z.object({ item: publicationSchema }).safeParse(body);
      return parsed.success && parsed.data.item.status === "published" && parsed.data.item.id === requestId ? { kind: "ok", item: parsed.data.item } : undefined;
    }),
    revoke: (id: string): Promise<RevokeOutcome> => call(transport, PUBLICATIONS_URI, json("DELETE", { id }), (body) =>
      z.object({ ok: z.literal(true) }).safeParse(body).success ? { kind: "ok" } : undefined),
  };
}
export type AdminReferenceAnalysisClient = ReturnType<typeof createAdminReferenceAnalysisClient>;

// 분석 결과 한 개에서 공개 초안을 만든다. 측정 원값은 넣지 않고, 관리자가 읽고 고칠 평문만 채운다.
export function draftFromResult(result: ReadyResult, index: number): PublicationDraft {
  const proposal = result.proposals[index] ?? result.proposals[0];
  const inference = proposal.inference;
  const label = MEDIA_LABEL[result.media];
  const found = inference?.measure === "estimated_bpm" ? `추정 템포 ${inference.bpm} BPM`
    : inference?.measure === "candidate_cut" ? "장면 전환 후보"
      : `관찰 근거 ${proposal.observations.length}개`;
  return {
    title: `${label} 분석 결과`.slice(0, LIMITS.title),
    summary: `${label} 소스에서 ${found}를 측정했어요.`.slice(0, LIMITS.summary),
    prompt: proposal.draft.prompt.slice(0, LIMITS.prompt),
    media: result.media,
  };
}

export type DraftErrors = Partial<Record<"title" | "summary" | "prompt", string>>;
export function validateDraft(draft: PublicationDraft): DraftErrors {
  const errors: DraftErrors = {};
  for (const field of ["title", "summary", "prompt"] as const) {
    const length = draft[field].trim().length;
    const name = field === "title" ? "제목" : field === "summary" ? "요약" : "생성 프롬프트";
    if (!length) errors[field] = `${name}을 입력하세요.`;
    else if (draft[field].length > LIMITS[field]) errors[field] = `${name}은 ${LIMITS[field]}자 이하로 줄여 주세요.`;
  }
  return errors;
}
export const trimmedDraft = (draft: PublicationDraft): PublicationDraft =>
  ({ title: draft.title.trim(), summary: draft.summary.trim(), prompt: draft.prompt.trim(), media: draft.media });

const UNAVAILABLE: Record<string, string> = {
  invalid_selection: "분석할 수 없는 자료예요. URL을 다시 확인해 주세요.",
  source_unavailable: "원본 파일을 가져올 수 없어요.",
  analysis_unavailable: "이 파일은 지금 분석할 수 없어요.",
  cancelled: "분석이 취소됐어요.",
  timed_out: "분석 시간이 초과됐어요. 더 짧은 파일로 다시 시도해 주세요.",
};
export const unavailableMessage = (reason: string) => UNAVAILABLE[reason] ?? "이 파일은 지금 분석할 수 없어요.";

const REJECTED: Record<ErrorCode, string> = {
  invalid_url: "직접 파일 주소(https://…/파일.확장자)를 입력하세요.",
  unsupported_origin: "지원하는 공개 원본의 주소만 분석할 수 있어요.",
  unsupported_format: "지원하는 이미지·음악·영상 형식이 아니에요.",
  too_large: `파일이 ${SIZE_LIMIT_LABEL} 한도를 넘거나 길이 한도를 넘었어요.`,
  rights_required: "자료를 분석할 권리 확인이 필요해요.",
  analysis_failed: "이 파일은 지금 분석할 수 없어요. 다른 파일이나 형식으로 시도해 주세요.",
  invalid_publication: "공개 내용을 확인해 주세요. 제목·요약·프롬프트가 한도 안에 있어야 해요.",
  not_found: "이미 없어진 공개 결과예요. 목록을 새로 불러왔어요.",
  already_revoked: "이미 철회된 결과예요. 목록을 새로 불러왔어요.",
};
export function failureMessage(failure: Failure): string {
  switch (failure.kind) {
    case "login": return "로그인이 끝났어요. 다시 로그인한 뒤 시도해 주세요.";
    case "forbidden": return "이 계정에는 관리 권한이 없어요.";
    case "rejected": return REJECTED[failure.code];
    case "failed": return "서버 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.";
  }
}
// 권한이 끝난 응답이면 이 화면의 조작을 멈추고 로그인·권한 안내만 남긴다.
export const isAuthFailure = (failure: Failure) => failure.kind === "login" || failure.kind === "forbidden";

export function formatPublishedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}
