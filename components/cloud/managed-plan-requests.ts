import { z } from "zod";
import { planningInputSchema, sceneDraftSchema } from "@/lib/domain/planning-draft";

// P1-08 클라우드 기획 화면 규칙(Backend 4fba696 GET/POST /api/projects/:id/plan, Master msg_daf0eaf6b86c).
// - 읽기: GET → {revision, version, planId, draft, writable, canApprove, approved, produceOpen, lengthSec, steps, materials?, ...}
// - 초안 저장: POST {revision, version, draft} → 201 {revision, version(+1), planId, draft}. 요청 키가 없어 응답을 잃으면 GET으로 판정한다.
// - 명시 승인: POST {action:"approve-plan", acknowledged:true, revision, version, planId} → 200 {approved:true, produceOpen, hostedProductionAvailable?}.
//   같은 기획·버전·리비전의 승인 재요청은 같은 결과라서, 결과를 모르는 승인은 같은 본문으로 다시 보낸다.
// 저장·승인 완료는 서버 응답(201·200)과 다시 읽은 상태로만 말한다.

export type SceneDraft = z.infer<typeof sceneDraftSchema>;
export type PlanDraft = z.infer<typeof planningInputSchema>;

const step = z.object({ id: z.string().min(1), label: z.string() });
export const planStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  planId: z.uuidv7().nullable(),
  draft: z.object({ script: z.string(), scenes: z.array(sceneDraftSchema) }).nullable(),
  writable: z.boolean(), canApprove: z.boolean(), approved: z.boolean(), produceOpen: z.boolean(),
  lengthSec: z.number().int().positive(),
  steps: z.array(step).min(1),
  capabilities: z.object({ saveDraft: z.boolean(), importShortsDraft: z.boolean(), approvePlan: z.boolean() }).optional(),
  hostedProductionAvailable: z.boolean().optional(),
  materials: z.unknown().optional(),
});
export type PlanState = z.infer<typeof planStateSchema>;

const codeOf = (body: unknown) => (body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "");
const errorOf = (body: unknown) => (body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "");

export type PlanRead = { kind: "ok"; plan: PlanState } | { kind: "brief-first" } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unavailable" } | { kind: "failed" };
export function classifyPlanRead(status: number, body: unknown): PlanRead {
  if (status === 200) { const parsed = planStateSchema.safeParse(body); return parsed.success ? { kind: "ok", plan: parsed.data } : { kind: "failed" }; }
  if (status === 409) return { kind: "brief-first" };
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 503) return { kind: "unavailable" };
  return { kind: "failed" };
}

const savedSchema = z.object({ revision: z.number().int().nonnegative(), version: z.number().int().positive(), planId: z.uuidv7() });
export type SaveOutcome =
  | { kind: "saved"; version: number; planId: string }
  | { kind: "conflict" }              // 409(바뀜·부가 자료 필요·길이 다름): 최신 상태를 다시 읽는다
  | { kind: "invalid"; message: string } | { kind: "too-large" } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unknown" };              // 503·5xx·연결 끊김·형식 틀린 201: GET으로 저장 여부를 판정한다
export function classifySave(status: number, body: unknown, sent: { version: number }): SaveOutcome {
  if (status === 201) {
    const parsed = savedSchema.safeParse(body);
    return parsed.success && parsed.data.version === sent.version + 1 ? { kind: "saved", version: parsed.data.version, planId: parsed.data.planId } : { kind: "unknown" };
  }
  if (status === 409) return { kind: "conflict" };
  if (status === 400) return { kind: "invalid", message: errorOf(body) || "초안의 내용을 다시 확인해 주세요." };
  if (status === 413) return { kind: "too-large" };
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  return { kind: "unknown" };
}

export type ApprovePlanOutcome =
  | { kind: "approved"; produceOpen: boolean; hostedProduction: boolean }
  | { kind: "conflict" } | { kind: "materials-stale" } | { kind: "not-here" }
  | { kind: "invalid"; message: string } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unknown" };
export function classifyApprovePlan(status: number, body: unknown, sent: { planId: string; version: number }): ApprovePlanOutcome {
  if (status === 200) {
    const ok = body && typeof body === "object" && "approved" in body && body.approved === true
      && "planId" in body && body.planId === sent.planId && "version" in body && body.version === sent.version;
    if (!ok) return { kind: "unknown" };
    const record = body as { produceOpen?: unknown; hostedProductionAvailable?: unknown };
    return { kind: "approved", produceOpen: record.produceOpen === true, hostedProduction: record.hostedProductionAvailable !== false };
  }
  if (status === 409) {
    const code = codeOf(body);
    return code === "PLAN_MATERIALS_STALE" ? { kind: "materials-stale" } : code === "PLAN_APPROVAL_UNAVAILABLE" ? { kind: "not-here" } : { kind: "conflict" };
  }
  if (status === 400) return { kind: "invalid", message: errorOf(body) || "승인 확인을 다시 해 주세요." };
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  return { kind: "unknown" };
}

/** 응답을 잃은 저장이 실제로 들어갔는지: 다시 읽은 최신 버전이 보낸 버전+1이고 내용이 같으면 저장된 것. */
export function savedByRead(plan: PlanState, sent: { version: number; draft: PlanDraft }) {
  return plan.version === sent.version + 1 && !!plan.draft && sameDraft(plan.draft, sent.draft);
}
export function sameDraft(a: { script: string; scenes: SceneDraft[] }, b: { script: string; scenes: SceneDraft[] }) {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}
const normal = (draft: { script: string; scenes: SceneDraft[] }) => ({ script: draft.script.trim(), scenes: draft.scenes.map(scene => ({
  stepId: scene.stepId, title: scene.title.trim(), description: scene.description.trim(), dialogue: scene.dialogue.trim(),
  durationSec: scene.durationSec, characterIds: scene.characterIds, assetIds: scene.assetIds })) });

/** 저장된 초안이 없을 때 메뉴 단계마다 장면 하나, 목표 길이를 나눠 시작한다. */
export function initialScenes(steps: { id: string; label: string }[], lengthSec: number): SceneDraft[] {
  const base = Math.max(1, Math.floor(lengthSec / steps.length));
  return steps.map((step, index) => ({ stepId: step.id, title: step.label, description: "", dialogue: "",
    durationSec: index === 0 ? Math.max(1, lengthSec - base * (steps.length - 1)) : base, characterIds: [], assetIds: [] }));
}

export const totalSec = (scenes: { durationSec: number }[]) => scenes.reduce((sum, scene) => sum + (Number.isFinite(scene.durationSec) ? scene.durationSec : 0), 0);
export const planApiPath = (id: string) => `/api/projects/${id}/plan`;
export const cloudPlanPath = (id: string) => `/cloud/projects/${id}/plan`;
