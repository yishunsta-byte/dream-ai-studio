import type { PublicationAction, PublicationItem, PublicationKind, PublicationList, PublicationOutcome, RightsStatus } from "./publication-model";

// T289 게시 큐 공급자 계약.
// - 운영 기본값은 닫힌 공급자다. 서버 권한·쓰기 계약(T290)이 연결되기 전에는 목록을 "미연결"로만 돌려주고 어떤 요청도 실행하지 않는다.
// - 메모리 공급자는 격리 시험·사본 확인 전용이다. T253 apply_command의 규칙(게시자 허용, 소유자 범위, 요청 UUID 원장·지문,
//   기대 버전·세대, 원본 완결)을 같은 결과 분류로 흉내 낸다. 운영 화면은 이 공급자를 쓰지 않는다.
export type PublicationProvider = Readonly<{
  list(): Promise<PublicationList>;
  apply(action: PublicationAction): Promise<PublicationOutcome>;
}>;

export const CLOSED_PUBLICATION_PROVIDER: PublicationProvider = Object.freeze({
  list: async () => Object.freeze({ kind: "closed" as const }),
  apply: async () => Object.freeze({ status: "unavailable" as const }),
});

type Slot = {
  slug: string; owner: string; title: string; kind: PublicationKind; rights: RightsStatus;
  version: bigint; pending: bigint | null; pendingSource: string | null; active: bigint | null; approvedMs: number | null;
};
type Source = { revision: bigint; finished: boolean };
export type MemorySeed = Readonly<{
  slug: string; owner: string; title: string; kind: PublicationKind; rights: RightsStatus;
  source: Readonly<{ revision: number; finished: boolean }>;
}>;

export function createMemoryPublicationProvider(options: Readonly<{
  actor: string; publishers: readonly string[]; seeds: readonly MemorySeed[]; now?: () => number;
}>) {
  const slots = new Map<string, Slot>();
  const sources = new Map<string, Source>();
  const ledger = new Map<string, { fingerprint: string; outcome: PublicationOutcome }>();
  const now = options.now ?? (() => 1_800_000_000_000);
  let calls = 0;
  for (const seed of options.seeds) {
    slots.set(seed.slug, { slug: seed.slug, owner: seed.owner, title: seed.title, kind: seed.kind, rights: seed.rights, version: 0n, pending: null, pendingSource: null, active: null, approvedMs: null });
    sources.set(seed.slug, { revision: BigInt(seed.source.revision), finished: seed.source.finished });
  }
  const view = (slot: Slot): PublicationItem => {
    const source = sources.get(slot.slug)!;
    return Object.freeze({
      slug: slot.slug, title: slot.title, kind: slot.kind, version: String(slot.version),
      pendingGeneration: slot.pending === null ? null : String(slot.pending),
      activeGeneration: slot.active === null ? null : String(slot.active),
      approvedMs: slot.approvedMs === null ? null : String(slot.approvedMs),
      source: Object.freeze({ revision: String(source.revision), finished: source.finished }), rights: slot.rights,
    });
  };
  const sourceKey = (slug: string) => { const s = sources.get(slug)!; return `${s.revision}:${s.finished}`; };
  function run(action: PublicationAction, actor: string): PublicationOutcome {
    if (!options.publishers.includes(actor)) return { status: "denied" };
    const slot = slots.get(action.slug);
    if (!slot) return { status: "conflict" };
    if (slot.owner !== actor) return { status: "denied" }; // RLS: 다른 소유자의 행은 보이지도 바뀌지도 않는다
    const expected = BigInt(action.expectedVersion);
    const generation = action.generation === null ? null : BigInt(action.generation);
    if (action.command !== "revoke" && !action.rightsConfirmed) return { status: "invalid" };
    if (action.command === "prepare" ? generation !== null : generation === null || generation < 1n || generation > expected) return { status: "invalid" };
    if (expected > slot.version) return { status: "conflict" };
    const source = sources.get(slot.slug)!;
    if (action.command === "prepare") {
      if (slot.version !== expected || slot.pending !== null) return { status: "conflict" };
      if (!source.finished || slot.rights !== "confirmed") return { status: "source-unavailable" };
      slot.version += 1n; slot.pending = slot.version; slot.pendingSource = sourceKey(slot.slug);
      return { status: "prepared", version: String(slot.version), generation: String(slot.version) };
    }
    if (action.command === "complete") {
      if (expected !== generation || slot.pending !== generation) return { status: "conflict" };
      if (!source.finished || slot.pendingSource !== sourceKey(slot.slug)) return { status: "source-unavailable" };
      slot.version += 1n; slot.active = generation; slot.pending = null; slot.pendingSource = null; slot.approvedMs = now();
      return { status: "published", version: String(slot.version), generation: String(generation) };
    }
    if (slot.pending !== generation && slot.active !== generation) return { status: "conflict" };
    slot.version += 1n;
    if (slot.pending === generation) { slot.pending = null; slot.pendingSource = null; }
    if (slot.active === generation) { slot.active = null; slot.approvedMs = null; }
    return { status: "revoked", version: String(slot.version), generation: String(generation) };
  }
  const provider: PublicationProvider = Object.freeze({
    list: async () => Object.freeze({ kind: "ok" as const, items: Object.freeze([...slots.values()].filter((slot) => slot.owner === options.actor).map(view)) }),
    apply: async (action: PublicationAction) => {
      calls++;
      const key = `${options.actor}:${action.requestId}`;
      const fingerprint = JSON.stringify([action.command, action.slug, action.expectedVersion, action.generation, action.rightsConfirmed]);
      const prior = ledger.get(key);
      if (prior) return prior.fingerprint === fingerprint ? prior.outcome : { status: "invalid" as const };
      const outcome = Object.freeze(run(action, options.actor));
      // 권한 거부·잘못된 요청은 원장에 남기지 않는다(T253은 예외로 트랜잭션이 되돌려진다).
      if (outcome.status !== "denied" && outcome.status !== "invalid") ledger.set(key, { fingerprint, outcome });
      return outcome;
    },
  });
  return Object.freeze({
    provider,
    // 시험 조작: 다른 곳에서 일어난 변경을 흉내 낸다.
    changeSource(slug: string, next: Readonly<{ revision: number; finished: boolean }>) { sources.set(slug, { revision: BigInt(next.revision), finished: next.finished }); },
    bumpElsewhere(slug: string) { const slot = slots.get(slug)!; slot.version += 1n; },
    callCount: () => calls,
  });
}
