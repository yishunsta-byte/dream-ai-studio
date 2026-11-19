import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import type { AdminPublicationStore, AdminPublicationTransaction, AdminPublicationWork } from "../../lib/public-showcase/admin-publication-service";

// T297 집중 시험용 합성 저장소(운영 저장소 아님). T290 서비스 시험과 같은 규칙: 트랜잭션 직렬화·실패 시 전체 롤백,
// 게시자 집합, 소유자 범위, 요청 UUID 원장, 권리·원본 증빙, 검증된 WebP 표지.
export const ACTOR_A = "10000000-0000-4000-8000-0000000002a1";
export const ACTOR_B = "10000000-0000-4000-8000-0000000002b2";
export const SITE = "http://127.0.0.1:43297";
export const verified = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "synthetic@example.invalid" });
export const requestId = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type Change = Parameters<AdminPublicationTransaction["save"]>[0];
type Ledger = NonNullable<Awaited<ReturnType<AdminPublicationTransaction["findRequest"]>>>;

export async function syntheticCover() {
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#2050e0" } }).webp().toBuffer();
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}

export function work(ownerId: string, slug: string, index: number): AdminPublicationWork {
  return { id: requestId(300 + index), ownerId, slug, revision: "0", media: "image",
    artifact: { id: requestId(400 + index), revision: "11", sha: "a".repeat(64), status: "complete" },
    display: { kind: "광고", title: `합성 완성본 ${slug}`, subtitle: "한 장면", creator: "합성 작업실", genre: "디자인",
      format: "이미지", description: "격리 시험용 합성 이미지예요.", width: 8, height: 6 }, review: null, active: null };
}

export function evidence(item: AdminPublicationWork, generation: string, cover: { bytes: Buffer; sha: string }) {
  const proof = { ownerId: item.ownerId, workId: item.id, artifactId: item.artifact.id, artifactRevision: item.artifact.revision, sourceSha: item.artifact.sha };
  return {
    source: { ...proof, status: "complete" },
    rights: { ...proof, status: "confirmed", scope: "public_showcase", reference: "synthetic-rights-reference", expiresAtMs: null },
    cover: { ...proof, status: "verified", sha: cover.sha, sizeBytes: cover.bytes.length, mime: "image/webp", width: 8, height: 6,
      objectKey: `${item.slug}/${generation}/${cover.sha}.webp` },
  };
}

export function syntheticStore(cover: { bytes: Buffer; sha: string }, works: AdminPublicationWork[]) {
  let snapshot = { works, ledger: new Map<string, Ledger>(), audit: [] as Change["audit"][] };
  const publishers = new Set([ACTOR_A]);
  const proof = new Map<string, unknown>(works.map((item) => [item.slug, evidence(item, "1", cover)]));
  const counts = { transactions: 0, saves: 0 };
  const hooks = { failCommit: 0 };
  let tail: Promise<unknown> = Promise.resolve();
  const store: AdminPublicationStore = {
    transaction: (operation) => {
      const pending = tail.then(async () => {
        counts.transactions++;
        const draft = structuredClone(snapshot);
        const result = await operation({
          isPublisher: async (actor) => publishers.has(actor.id),
          findOwnedWork: async (actor, slug) => draft.works.find((item) => item.slug === slug && item.ownerId === actor.id) ?? null,
          listOwnedWorks: async (actor) => draft.works.filter((item) => item.ownerId === actor.id),
          findRequest: async (actor, id) => draft.ledger.get(`${actor.id}/${id}`) ?? null,
          readEvidence: async (_actor, item) => proof.get(item.slug),
          readCover: async () => cover.bytes,
          saveFailure: async (actor, id, entry) => { draft.ledger.set(`${actor.id}/${id}`, entry); },
          save: async (change) => {
            draft.works = draft.works.map((item) => item.id === change.work.id ? change.work : item);
            draft.ledger.set(`${change.audit.actorId}/${change.audit.requestId}`, change.request);
            draft.audit.push(change.audit);
            counts.saves++;
          },
        });
        // 커밋 전 실패 주입: 바뀐 내용을 버리고 예외(서비스는 unavailable로 돌려준다).
        if (hooks.failCommit > 0) { hooks.failCommit--; throw new Error("synthetic rollback"); }
        snapshot = draft;
        return result;
      });
      tail = pending.catch(() => undefined);
      return pending;
    },
  };
  return {
    store, publishers, counts, hooks,
    snapshot: () => structuredClone(snapshot),
    setEvidence(slug: string, value: unknown) { proof.set(slug, value); },
  };
}

/** 같은 사이트에서 보낸 POST 요청. */
export function post(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/admin/publications`, {
    method: "POST", body, duplex: "half",
    headers: { host: "127.0.0.1:43297", origin: SITE, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
  } as RequestInit);
}
