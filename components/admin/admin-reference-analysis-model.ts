import { z } from "zod";
import { imageSemanticResultSchema, type ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import { referenceFileFormat } from "@/lib/reference-analysis/input";
import { studioAnalysisResultSchema, type StudioAnalysisResult } from "@/lib/reference-analysis/studio-analysis-result-dto";

// 관리자 콘텐츠 분석·공개 화면 계약(브라우저 안전). 서버 경로·저장·권한 판정은 Master 점유 서버가 맡는다.
// - POST /api/admin/reference-analysis: {url, authorized:true, media} 또는 분류·이름 헤더를 가진 원본 파일.
// - GET  /api/admin/reference-publications → 200 {items: PublishedReferenceAnalysis[]}
// - POST 같은 경로 {id, title, summary, prompt, media, authorized:true} → 200 {item}  (명시 공개, 재시도는 같은 id)
// - DELETE 같은 경로 {id} → 200 {ok: true}  (철회, 이미 철회돼 있어도 ok)
// 401·403은 본문 없이 상태로 판정한다. 400·404·409·422 본문의 error 코드만 읽고, 서버 문장은 화면에 쓰지 않는다.

export const ANALYSIS_URI = "/api/admin/reference-analysis";
export const PUBLICATIONS_URI = "/api/admin/reference-publications";
export const LIMITS = { title: 80, summary: 600, prompt: 2000 } as const;

export type AnalysisMedia = "image" | "music" | "video";
export const MEDIA_LABEL: Record<AnalysisMedia, string> = { image: "이미지", music: "음악", video: "영상" };
export type AnalysisSource = { media: AnalysisMedia } & ({ kind: "url"; url: string } | { kind: "file"; file: File });

// 지원 안내(기존 local-media-url의 고정 원본·형식·한도와 같다).
export const SUPPORTED_ORIGINS = ["https://interactive-examples.mdn.mozilla.net", "https://mdn.github.io", "https://tonejs.github.io"] as const;
export const SUPPORTED_FORMATS = [
  { media: "image", extensions: ["png", "jpg", "jpeg", "webp"], limit: "" },
  { media: "music", extensions: ["mp3", "wav", "m4a"], limit: "24초까지" },
  { media: "video", extensions: ["mp4", "mov", "webm"], limit: "20초 · 240프레임까지" },
] as const;
export const URL_SIZE_LIMIT_LABEL = "64 MiB";
export const UPLOAD_SIZE_LIMIT_LABEL = "4 MiB";
const uploadByteLimit = 4 * 1024 * 1024;

export function analysisInputIssue(source: AnalysisSource): string | undefined {
  let name: string;
  if (source.kind === "file") {
    if (!source.file.size) return "내용이 있는 파일을 선택해 주세요.";
    if (source.file.size > uploadByteLimit) return `업로드는 ${UPLOAD_SIZE_LIMIT_LABEL}까지 가능해요.`;
    name = source.file.name;
  } else {
    let url: URL;
    try { url = new URL(source.url); }
    catch { return "https://로 시작하는 직접 파일 주소를 입력하세요."; }
    if (url.protocol === "blob:") return "이 주소는 원본 화면에서만 열려요. 원본 파일을 저장한 뒤 파일 업로드에서 선택하세요.";
    if (/(^|\.)threads\.(com|net)$/.test(url.hostname)) return "Threads 게시물 링크는 분석할 수 없어요. 미디어 파일의 직접 HTTPS 주소를 입력하세요.";
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
      return "쿼리나 로그인 정보가 없는 직접 HTTPS 파일 주소를 입력하세요.";
    }
    if (!SUPPORTED_ORIGINS.some((origin) => origin === url.origin)) return "지원하는 공개 원본의 주소만 분석할 수 있어요.";
    name = url.pathname;
  }
  const format = referenceFileFormat(name);
  if (!format) return "지원하는 파일 확장자를 확인해 주세요.";
  if (format.media !== source.media) return `파일 형식에 맞게 ‘${MEDIA_LABEL[format.media]}’ 옵션을 선택하세요.`;
}

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

export const ERROR_CODES = ["invalid_input", "analysis_busy", "invalid_url", "unsupported_origin", "unsupported_format", "too_large", "rights_required", "invalid_file", "file_type_mismatch",
  "analysis_failed", "invalid_publication", "publication_conflict", "not_found", "already_revoked"] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type Failure =
  | Readonly<{ kind: "login" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "rejected"; code: ErrorCode }>
  | Readonly<{ kind: "failed" }>;

export type AnalyzeOutcome = Readonly<{ kind: "ready"; result: ReadyResult; semantic?: ImageSemanticResult }> | Readonly<{ kind: "unavailable"; reason: string }> | Failure;
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
  if ([400, 404, 409, 413, 422, 429].includes(response.status)) {
    const parsed = errorBody.safeParse(body);
    if (parsed.success) return { kind: "rejected", code: parsed.data.error };
  }
  return { kind: "failed" };
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit =>
  ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

export function createAdminReferenceAnalysisClient(transport: AdminTransport = browserTransport) {
  return {
    analyze: (source: AnalysisSource, signal?: AbortSignal, options?: { imageSemantic?: boolean }): Promise<AnalyzeOutcome> => {
      const imageSemantic = source.media === "image" && options?.imageSemantic === true;
      return call(transport, ANALYSIS_URI,
        source.kind === "url" ? json("POST", {
          url: source.url, authorized: true, media: source.media, ...(imageSemantic && { semantic: "image" }),
        }, signal) : {
          method: "POST", signal, body: source.file,
          headers: {
            "content-type": "application/octet-stream", "x-dream-media": source.media, "x-dream-filename": encodeURIComponent(source.file.name),
            ...(imageSemantic && { "x-dream-semantic": "image" }),
          },
        }, (body) => {
          const parsed = z.object({ result: studioAnalysisResultSchema, semantic: z.unknown().optional() }).safeParse(body);
          if (!parsed.success) return undefined;
          const result = parsed.data.result;
          if (result.status === "unavailable") return { kind: "unavailable", reason: result.reason };
          if (result.media !== source.media) return undefined;
          if (!imageSemantic) return { kind: "ready", result };
          const semantic = imageSemanticResultSchema.safeParse(parsed.data.semantic);
          return { kind: "ready", result, semantic: semantic.data ?? { status: "unavailable", reason: "invalid_response" } };
        });
    },
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
  invalid_selection: "분석할 수 없는 자료예요. 주소나 파일을 다시 확인해 주세요.",
  source_unavailable: "원본 파일을 가져올 수 없어요.",
  analysis_unavailable: "이 파일은 지금 분석할 수 없어요.",
  cancelled: "분석이 취소됐어요.",
  timed_out: "분석 시간이 초과됐어요. 더 짧은 파일로 다시 시도해 주세요.",
};
export const unavailableMessage = (reason: string) => UNAVAILABLE[reason] ?? "이 파일은 지금 분석할 수 없어요.";

const REJECTED: Record<ErrorCode, string> = {
  invalid_input: "요청 형식이 올바르지 않아요. 화면을 새로 고친 뒤 다시 시도해 주세요.",
  analysis_busy: "다른 분석이 진행 중이에요. 잠시 뒤 다시 실행해 주세요.",
  invalid_url: "직접 파일 주소(https://…/파일.확장자)를 입력하세요.",
  unsupported_origin: "지원하는 공개 원본의 주소만 분석할 수 있어요.",
  unsupported_format: "지원하는 이미지·음악·영상 형식이 아니에요.",
  too_large: "파일 크기나 길이가 한도를 넘었어요. 지원 원본·형식 안내를 확인해 주세요.",
  rights_required: "자료를 분석할 권리 확인이 필요해요.",
  invalid_file: "파일을 읽을 수 없어요. 다른 파일을 선택해 주세요.",
  file_type_mismatch: "선택한 매체와 파일 내용이 달라요. 매체나 파일을 다시 선택해 주세요.",
  analysis_failed: "이 파일은 지금 분석할 수 없어요. 다른 파일이나 형식으로 시도해 주세요.",
  invalid_publication: "공개 내용을 확인해 주세요. 제목·요약·프롬프트가 한도 안에 있어야 해요.",
  publication_conflict: "같은 공개 요청이 다른 내용으로 이미 처리됐어요. 아래 공개 목록을 확인한 뒤 다시 동의하고 공개해 주세요.",
  not_found: "이미 없어진 공개 결과예요. 아래 공개 목록을 확인해 주세요.",
  already_revoked: "이미 철회된 결과예요. 아래 공개 목록을 확인해 주세요.",
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
