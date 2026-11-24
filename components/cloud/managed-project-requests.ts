import { z } from "zod";

// P1-02 관리형 프로젝트 생성·브리프 화면 규칙(Backend e91a89c 계약, Master msg_ff678d34d472, Tester UI-PREFLIGHT).
// - POST /api/projects: 같은 출처 JSON {menuId, inputs} + UUIDv7 Idempotency-Key → 201 {id}.
// - GET/POST /api/projects/:id/brief: 승인은 {acknowledged:true, revision} + UUIDv7 Idempotency-Key → 200 {stage:"plan", revision}.
// 결과를 모르는 요청(연결 끊김·503·5xx)은 같은 내용이면 같은 요청 키로 다시 보내 중복 생성·승인을 막는다.
// 내용을 바꾸면(또는 서버가 같은 키에 다른 내용이라고 409로 알리면) 새 요청 키를 쓴다. 저장 완료는 201·200 응답에서만 말한다.

export type Attempt = Readonly<{ key: string; body: string }>;

/** 보낼 요청의 키: 결과를 모르는 직전 요청과 본문이 같으면 그 키를, 아니면 새 키를 쓴다. */
export function nextAttempt(pending: Attempt | undefined, body: string, newKey: () => string): Attempt {
  return pending && pending.body === body ? pending : { key: newKey(), body };
}

/** 같은 필드 순서와 상관없이 같은 입력이면 같은 본문 문자열(요청 키 재사용 판정용). */
export function createBody(menuId: string, inputs: Record<string, unknown>) {
  return JSON.stringify({ menuId, inputs: Object.fromEntries(Object.keys(inputs).sort().map(key => [key, inputs[key]])) });
}

const codeOf = (body: unknown) => (body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "");
const errorsOf = (body: unknown): Record<string, string> | undefined => {
  if (!body || typeof body !== "object" || !("errors" in body) || !body.errors || typeof body.errors !== "object") return undefined;
  const entries = Object.entries(body.errors).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
};
const uuidv7 = z.uuidv7();

export type CreateOutcome =
  | { kind: "created"; id: string }
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "key-conflict" } | { kind: "locked" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unknown" };   // 결과를 모름: 같은 내용이면 같은 키로 다시 보낸다(503·5xx·형식이 틀린 응답·연결 끊김)

/** 생성 응답 분류. 201이어도 id가 UUIDv7이 아니면 저장됐다고 말하지 않는다. */
export function classifyCreate(status: number, body: unknown): CreateOutcome {
  if (status === 201) {
    const id = body && typeof body === "object" && "id" in body ? uuidv7.safeParse(body.id) : undefined;
    return id?.success ? { kind: "created", id: id.data.toLowerCase() } : { kind: "unknown" };
  }
  if (status === 400) return { kind: "invalid", errors: errorsOf(body) ?? { _form: "입력 항목을 확인해 주세요." } };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 409) return codeOf(body) === "IDEMPOTENCY_CONFLICT" ? { kind: "key-conflict" } : { kind: "locked" };
  if (status === 413) return { kind: "invalid", errors: { _form: "저장 요청이 너무 커요. 입력을 줄여 주세요." } };
  return { kind: "unknown" };
}

// lib/domain/stages StageStatus와 같은 값(서버는 stage_states.status를 그대로 준다).
const stage = z.enum(["locked", "todo", "in_progress", "needs_approval", "approved", "failed"]);
export const briefSchema = z.object({
  title: z.string(), goal: z.string(), target: z.string(), aspect: z.string(), lengthSec: z.number().int().positive(),
  revision: z.number().int().positive(),
  facts: z.string().nullable(), product: z.string().nullable(), rights: z.string().nullable(), sources: z.string().nullable(),
  stages: z.object({ intake: stage, brief: stage, plan: stage }),
});
export type Brief = z.infer<typeof briefSchema>;

export type BriefRead = { kind: "ok"; brief: Brief } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" } | { kind: "unavailable" } | { kind: "failed" };
export function classifyBriefRead(status: number, body: unknown): BriefRead {
  if (status === 200) { const parsed = briefSchema.safeParse(body); return parsed.success ? { kind: "ok", brief: parsed.data } : { kind: "failed" }; }
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 503) return { kind: "unavailable" };
  return { kind: "failed" };
}

export type ApproveOutcome =
  | { kind: "approved"; revision: number }
  | { kind: "stale" }          // BRIEF_CONFLICT: 최신 상태를 다시 읽는다
  | { kind: "key-conflict" } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "invalid"; message: string }
  | { kind: "unknown" };
export function classifyApprove(status: number, body: unknown, expected: number): ApproveOutcome {
  if (status === 200) {
    const ok = body && typeof body === "object" && "stage" in body && body.stage === "plan" && "revision" in body && body.revision === expected;
    return ok ? { kind: "approved", revision: expected } : { kind: "unknown" };
  }
  if (status === 409) return codeOf(body) === "IDEMPOTENCY_CONFLICT" ? { kind: "key-conflict" } : { kind: "stale" };
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 400) return { kind: "invalid", message: errorsOf(body)?._form ?? "요구 사항을 검토한 뒤 승인해 주세요." };
  return { kind: "unknown" };
}

export const cloudBriefPath = (id: string) => `/cloud/projects/${id}/brief`;

// Backend msg_1741d19f7010: GET /api/projects/asset-choices → 200 {assets:[{id:UUIDv7,title,kind:image|video}], nextCursor?:UUIDv7}
// (최신순 최대 100개, 남은 쪽이 있으면 ?cursor=). 401·403·503·400은 기존 규칙. 이 경로가 아직 없는 빌드(404)는 '연결 전'으로 본다.
export const assetChoicesPath = (cursor?: string) => `/api/projects/asset-choices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
const choicesSchema = z.object({
  assets: z.array(z.object({ id: z.uuidv7(), title: z.string().max(500), kind: z.enum(["image", "video"]) })).max(100),
  nextCursor: z.uuidv7().optional(),
});
export type AssetChoice = z.infer<typeof choicesSchema>["assets"][number];
export type ChoicesPage = { kind: "ok"; assets: AssetChoice[]; nextCursor?: string } | { kind: "unlinked" } | { kind: "login" } | { kind: "forbidden" } | { kind: "failed" };
export function classifyChoices(status: number, body: unknown): ChoicesPage {
  if (status === 200) { const parsed = choicesSchema.safeParse(body); return parsed.success ? { kind: "ok", ...parsed.data } : { kind: "failed" }; }
  if (status === 404 || status === 503) return { kind: "unlinked" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  return { kind: "failed" };
}
/** 다음 쪽을 이어 붙인다(같은 ID는 한 번만). */
export function mergeChoices(current: AssetChoice[], next: AssetChoice[]) {
  const seen = new Set(current.map(item => item.id));
  return [...current, ...next.filter(item => !seen.has(item.id))];
}
