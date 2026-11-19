import { isPublicationItem, isPublicationOutcome, type PublicationAction, type PublicationItem, type PublicationList, type PublicationOutcome } from "./publication-model";
import type { PublicationProvider } from "./publication-provider";

// T297 동일 출처 HTTP 공급자. 화면은 actor·owner를 보내지 않고, 서버(/api/admin/publications)가 세션으로 정한다.
// - 목록: 200 + 형식이 맞는 목록만 받는다. 그 밖(인증 만료·리다이렉트·형식 오류·네트워크)은 failed.
// - 쓰기: 200 + 형식이 맞는 결과만 그대로. 401·403 → denied, 400·413·415 → invalid,
//   그 밖(503 미연결·5xx·네트워크·형식 오류)은 커밋 여부를 모르므로 unavailable(같은 UUID 재시도 허용).
export const PUBLICATION_ENDPOINT = "/api/admin/publications";
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const ITEM_KEYS = ["activeGeneration", "approvedMs", "kind", "pendingGeneration", "rights", "slug", "source", "title", "version"].join();
// 목록 한 줄은 계약 필드만 받는다(서버가 실수로 소유자·경로 같은 값을 더 보내도 화면에 들이지 않음).
function exactItem(item: unknown) {
  if (!isPublicationItem(item)) return false;
  return Object.keys(item).sort().join() === ITEM_KEYS && Object.keys(item.source).sort().join() === "finished,revision";
}

export function isPublicationList(value: unknown): value is PublicationList {
  if (!value || typeof value !== "object") return false;
  const list = value as { kind?: unknown; items?: unknown };
  if (list.kind === "closed" || list.kind === "failed") return Object.keys(value).length === 1;
  if (list.kind !== "ok" || !Array.isArray(list.items) || Object.keys(value).length !== 2) return false;
  const slugs = new Set<string>();
  for (const item of list.items as unknown[]) {
    if (!exactItem(item)) return false;
    const slug = (item as PublicationItem).slug;
    if (slugs.has(slug)) return false;
    slugs.add(slug);
  }
  return true;
}

// 서버로 보낼 본문은 계약 필드만 골라 만든다(화면 상태가 섞이지 않게).
export function actionBody(action: PublicationAction) {
  const { requestId, command, slug, expectedVersion, generation, rightsConfirmed } = action;
  return JSON.stringify({ requestId, command, slug, expectedVersion, generation, rightsConfirmed });
}

export function outcomeForStatus(status: number): PublicationOutcome {
  if (status === 401 || status === 403) return { status: "denied" };
  if (status === 400 || status === 413 || status === 415) return { status: "invalid" };
  return { status: "unavailable" };
}

export function createHttpPublicationProvider(fetcher: Fetcher = (input, init) => fetch(input, init)): PublicationProvider {
  const common = { cache: "no-store", credentials: "same-origin", redirect: "error" } satisfies RequestInit;
  return Object.freeze({
    async list(): Promise<PublicationList> {
      try {
        const response = await fetcher(PUBLICATION_ENDPOINT, { ...common, method: "GET", headers: { accept: "application/json" } });
        if (response.status !== 200) return { kind: "failed" };
        const body: unknown = await response.json();
        return isPublicationList(body) ? body : { kind: "failed" };
      } catch { return { kind: "failed" }; }
    },
    async apply(action: PublicationAction): Promise<PublicationOutcome> {
      let response: Response;
      try {
        response = await fetcher(PUBLICATION_ENDPOINT, { ...common, method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: actionBody(action) });
      } catch { return { status: "unavailable" }; }
      if (response.status !== 200) return outcomeForStatus(response.status);
      try {
        const body: unknown = await response.json();
        return isPublicationOutcome(body) ? body : { status: "unavailable" };
      } catch { return { status: "unavailable" }; }
    },
  });
}
