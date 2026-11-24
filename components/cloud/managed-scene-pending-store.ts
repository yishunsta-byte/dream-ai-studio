import { z } from "zod";
import type { PendingWrite, PendingWrites } from "./managed-scene-requests";
import { pendingKey } from "./managed-scene-requests";

// P2-MANAGED-SOURCE-SCENE-PANEL-RETRY-RECOVERY: 결과 모름 쓰기를 새로고침 뒤에도 같은 요청 번호로 다시 확인하게 하는 최소 보관.
// - 저장소: 이 탭의 sessionStorage만 쓴다(같은 탭 새로고침에서 유지, 탭을 닫으면 사라짐, 다른 탭과 공유하지 않음).
// - 범위: 키는 서버 페이지가 확인된 계정 번호(verified.userId, 서버 소유자 판정과 같은 값)와 프로젝트 번호로 만든 해시(scope)다.
//   다른 계정·다른 프로젝트는 키가 달라 읽히지 않는다. 계정 번호·이메일 원문은 저장하지 않는다.
// - 내용: 장면 번호, 요청 번호, 처음 보낸 내용(개정·장면·자료 또는 버전), 보관 시각뿐이다. 자료 이름 같은 표시용 글은 저장하지 않는다.
// - 읽을 때 형식·범위·프로젝트·내용 일치·보관 기한(7일)·개수(20)를 확인하고, 하나라도 어긋나면 그 기록 전체를 쓰지 않는다(dropped).
//   읽기는 저장소를 바꾸지 않는다. 화면이 dropped를 받으면 clearPending으로 지운다.
// - 저장소를 쓸 수 없으면(사생활 보호 모드·용량·차단) 기록 없이 화면 메모리로만 동작하고 false를 돌려준다.

export type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const PENDING_PREFIX = "dream.scene-pending.v1:";
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_MAX = 20;
const scopeSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const pendingStorageKey = (scope: string) => `${PENDING_PREFIX}${scope}`;

const uuid = z.uuid();
const stored = z.object({
  kind: z.enum(["register", "select"]), sceneId: uuid, requestId: uuid, content: z.string().max(400), target: uuid, savedAt: z.number().int().nonnegative(),
}).strict();
const record = z.object({ v: z.literal(1), projectId: uuid, writes: z.array(stored).max(PENDING_MAX) }).strict();
const registerBody = z.object({ revision: z.number().int().positive(), sceneId: uuid, assetId: uuid }).strict();
const selectBody = z.object({ revision: z.number().int().positive(), sceneId: uuid, versionId: uuid, expectedVersionId: uuid.nullable() }).strict();

export const restoredLabel: Record<PendingWrite["kind"], string> = { register: "새로고침 전에 보낸 자료", select: "새로고침 전에 고른 결과" };

/** 저장된 작업 하나가 스스로 맞는지(내용의 장면·대상이 기록과 같은지). */
function consistent(write: z.infer<typeof stored>): boolean {
  let body: unknown;
  try { body = JSON.parse(write.content); } catch { return false; }
  const lower = (value: string) => value.toLowerCase();
  if (write.kind === "register") {
    const parsed = registerBody.safeParse(body);
    return parsed.success && lower(parsed.data.sceneId) === lower(write.sceneId) && lower(parsed.data.assetId) === lower(write.target);
  }
  const parsed = selectBody.safeParse(body);
  return parsed.success && lower(parsed.data.sceneId) === lower(write.sceneId) && lower(parsed.data.versionId) === lower(write.target);
}

export type Restored = { pendings: PendingWrites; dropped: boolean };
/** 이 범위·프로젝트의 결과 모름 작업을 읽는다(저장소는 바꾸지 않음). 어긋난 기록이면 빈 목록과 dropped=true. */
export function loadPending(storage: PendingStorage | null, scope: string | undefined, projectId: string, now: number = Date.now()): Restored {
  if (!storage || !scope || !scopeSchema.safeParse(scope).success) return { pendings: {}, dropped: false };
  const key = pendingStorageKey(scope);
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return { pendings: {}, dropped: false }; }
  if (raw === null) return { pendings: {}, dropped: false };
  const drop = (): Restored => ({ pendings: {}, dropped: true });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return drop(); }
  const parsed = record.safeParse(json);
  if (!parsed.success || parsed.data.projectId.toLowerCase() !== projectId.toLowerCase()) return drop();
  const pendings: Record<string, PendingWrite> = {};
  for (const write of parsed.data.writes) {
    if (!consistent(write) || write.savedAt > now || now - write.savedAt > PENDING_MAX_AGE_MS) return drop();
    const item: PendingWrite = { kind: write.kind, sceneId: write.sceneId.toLowerCase(), requestId: write.requestId.toLowerCase(), content: write.content,
      target: write.target.toLowerCase(), label: restoredLabel[write.kind] };
    const slot = pendingKey(item.kind, item.sceneId);
    if (pendings[slot]) return drop();
    pendings[slot] = item;
  }
  return { pendings, dropped: false };
}

/** 결과 모름 작업을 저장한다(없으면 지움). 이미 있던 작업은 처음 보관 시각을 유지한다. 저장소를 쓸 수 없으면 false. */
export function savePending(storage: PendingStorage | null, scope: string | undefined, projectId: string, pendings: PendingWrites, now: number = Date.now()): boolean {
  if (!storage || !scope || !scopeSchema.safeParse(scope).success) return false;
  const key = pendingStorageKey(scope);
  try {
    const writes = Object.values(pendings);
    if (!writes.length) { storage.removeItem(key); return true; }
    if (writes.length > PENDING_MAX) return false;
    const before = new Map<string, number>();
    try {
      const previous = record.safeParse(JSON.parse(storage.getItem(key) ?? "null"));
      if (previous.success) for (const write of previous.data.writes) before.set(write.requestId.toLowerCase(), write.savedAt);
    } catch { /* 이전 기록이 깨졌으면 새로 쓴다 */ }
    storage.setItem(key, JSON.stringify({ v: 1, projectId: projectId.toLowerCase(), writes: writes.map(write => ({
      kind: write.kind, sceneId: write.sceneId, requestId: write.requestId, content: write.content, target: write.target,
      savedAt: before.get(write.requestId.toLowerCase()) ?? now })) }));
    return true;
  } catch { return false; }
}

/** 이 범위의 기록을 지운다(잘못된 기록 정리). */
export function clearPending(storage: PendingStorage | null, scope: string | undefined): void {
  if (!storage || !scope || !scopeSchema.safeParse(scope).success) return;
  try { storage.removeItem(pendingStorageKey(scope)); } catch { /* 지우지 못해도 읽을 때마다 다시 버린다 */ }
}

/** 이 탭의 sessionStorage. 쓸 수 없으면 null(서버 그리기·차단·사생활 보호 모드). */
export function browserPendingStorage(): PendingStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
