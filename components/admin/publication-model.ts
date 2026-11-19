// T289 관리자 완성본 검수·게시·철회 큐의 화면 계약과 순수 판정.
// 서버 쓰기 계약은 T253 apply_command(prepare·complete·revoke, expected_version, generation, 요청 UUID 원장)를 그대로 따른다.
// - 화면은 판정을 대신하지 않는다: 권한·소유자·원본 완결·충돌은 서버(공급자)가 결과로 알려 준다.
// - 화면이 하는 일: 명시적 권리 확인 없이 준비·게시 요청을 만들지 않기, 대상 리비전(version)과 세대를 요청에 고정하기,
//   같은 의도의 재시도에 같은 요청 UUID를 쓰기(중복 방지), 결과에 따라 항목을 갱신하거나 다시 불러오기를 요구하기.
// - 버전·세대는 64비트 정수 문자열이다(서버 jsonb text 그대로). 화면은 비교·표시만 하고 계산하지 않는다.

export type PublicationKind = "image" | "video" | "music";
export type RightsStatus = "confirmed" | "unconfirmed";

// 서버 → 화면 목록 한 줄. 원본 경로·소유자 이메일·object key·서명 URL은 담지 않는다.
export type PublicationItem = Readonly<{
  slug: string;
  title: string;
  kind: PublicationKind;
  version: string;
  pendingGeneration: string | null;
  activeGeneration: string | null;
  approvedMs: string | null;
  source: Readonly<{ revision: string; finished: boolean }>;
  rights: RightsStatus;
}>;

export type PublicationCommand = "prepare" | "complete" | "revoke";

// 화면 → 서버 요청. actor는 넣지 않는다(서버가 인증으로 정한다).
export type PublicationAction = Readonly<{
  requestId: string;
  command: PublicationCommand;
  slug: string;
  expectedVersion: string;
  generation: string | null;
  rightsConfirmed: boolean;
}>;

// 서버 → 화면 결과. T253 결과 status와 SQLSTATE를 화면 분류로 옮긴 것이다.
export type PublicationOutcome =
  | Readonly<{ status: "prepared" | "published" | "revoked"; version: string; generation: string }>
  | Readonly<{ status: "conflict" }>            // 기대 버전·세대가 현재와 다름
  | Readonly<{ status: "source-unavailable" }>  // 원본 완성본이 없거나 바뀜
  | Readonly<{ status: "denied" }>              // 42501 게시 권한 없음·다른 소유자
  | Readonly<{ status: "invalid" }>             // 22023 잘못된 요청·지문 불일치
  | Readonly<{ status: "unavailable" }>;        // 서버 게시 기능 미연결·일시 실패

export type PublicationList =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "ok"; items: readonly PublicationItem[] }>;

// 철회 여부는 version만으로 알 수 없다(후보 원본·표시가 바뀌어도 version이 오른다, T290). 게시·준비가 모두 없으면 검수 대기다.
export type PublicationStage = "candidate" | "prepared" | "published" | "republishing";

const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED = new Set(["sign", "authenticated", "private", "signed"]);
const big = (value: string) => BigInt(value);

export function isPublicationItem(value: unknown): value is PublicationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const source = item.source as Record<string, unknown> | null;
  const gen = (g: unknown) => g === null || (typeof g === "string" && DECIMAL.test(g) && g !== "0");
  if (typeof item.slug !== "string" || !SLUG.test(item.slug) || RESERVED.has(item.slug)) return false;
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 120) return false;
  if (!["image", "video", "music"].includes(item.kind as string)) return false;
  if (typeof item.version !== "string" || !DECIMAL.test(item.version)) return false;
  if (!gen(item.pendingGeneration) || !gen(item.activeGeneration)) return false;
  for (const g of [item.pendingGeneration, item.activeGeneration]) if (g !== null && big(g as string) > big(item.version)) return false;
  if ((item.activeGeneration === null) !== (item.approvedMs === null)) return false;
  if (item.approvedMs !== null && (typeof item.approvedMs !== "string" || !DECIMAL.test(item.approvedMs))) return false;
  if (!source || typeof source.revision !== "string" || !DECIMAL.test(source.revision) || source.revision === "0" || typeof source.finished !== "boolean") return false;
  return item.rights === "confirmed" || item.rights === "unconfirmed";
}

export function stageOf(item: PublicationItem): PublicationStage {
  if (item.activeGeneration && item.pendingGeneration) return "republishing";
  if (item.activeGeneration) return "published";
  if (item.pendingGeneration) return "prepared";
  return "candidate";
}

export const STAGE_LABEL: Record<PublicationStage, string> = {
  candidate: "검수 대기", prepared: "게시 준비됨", published: "게시 중", republishing: "게시 중 · 새 세대 준비됨",
};

// 지금 누를 수 있는 명령. 권리 확인은 준비·게시에만 필요하고, 철회는 언제나 권리 확인 없이 가능하다(내리는 쪽은 막지 않음).
export function allowedCommands(item: PublicationItem, rightsChecked: boolean): readonly PublicationCommand[] {
  const out: PublicationCommand[] = [];
  const canPublish = rightsChecked && item.rights === "confirmed" && item.source.finished;
  if (!item.pendingGeneration && canPublish) out.push("prepare");
  if (item.pendingGeneration && canPublish) out.push("complete");
  if (item.pendingGeneration || item.activeGeneration) out.push("revoke");
  return out;
}

// 철회 대상 세대: 준비 중인 세대가 있으면 그것을 먼저 거둔다(T253은 관찰한 세대 하나만 내린다).
export function revokeTarget(item: PublicationItem): string | null {
  return item.pendingGeneration ?? item.activeGeneration;
}

export function buildAction(item: PublicationItem, command: PublicationCommand, requestId: string, rightsChecked: boolean): PublicationAction | null {
  if (!allowedCommands(item, rightsChecked).includes(command)) return null;
  const generation = command === "prepare" ? null : command === "complete" ? item.pendingGeneration : revokeTarget(item);
  // complete는 T253 규칙상 expected_version = generation(준비한 세대)이다. 준비 세대가 바뀌었으면 서버가 conflict로 돌려준다.
  const expectedVersion = command === "complete" ? item.pendingGeneration! : item.version;
  return Object.freeze({ requestId, command, slug: item.slug, expectedVersion, generation, rightsConfirmed: command === "revoke" ? false : rightsChecked });
}

export function isPublicationOutcome(value: unknown): value is PublicationOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  if (["conflict", "source-unavailable", "denied", "invalid", "unavailable"].includes(outcome.status as string)) return Object.keys(outcome).length === 1;
  if (!["prepared", "published", "revoked"].includes(outcome.status as string)) return false;
  return typeof outcome.version === "string" && DECIMAL.test(outcome.version) && typeof outcome.generation === "string" && DECIMAL.test(outcome.generation);
}

// 성공 결과를 항목에 반영한다. 결과가 요청과 맞지 않으면(다른 세대·뒤로 간 버전) null → 화면은 다시 불러오기를 요구한다.
export function applyOutcome(item: PublicationItem, action: PublicationAction, outcome: PublicationOutcome, nowMs: number): PublicationItem | null {
  if (outcome.status !== "prepared" && outcome.status !== "published" && outcome.status !== "revoked") return null;
  const expected = { prepare: "prepared", complete: "published", revoke: "revoked" }[action.command];
  if (outcome.status !== expected || action.slug !== item.slug) return null;
  if (big(outcome.version) <= big(item.version)) return null;
  if (action.generation !== null && outcome.generation !== action.generation) return null;
  if (outcome.status === "prepared") {
    if (outcome.generation !== outcome.version) return null;
    return Object.freeze({ ...item, version: outcome.version, pendingGeneration: outcome.generation });
  }
  if (outcome.status === "published") {
    return Object.freeze({ ...item, version: outcome.version, pendingGeneration: null, activeGeneration: outcome.generation, approvedMs: String(nowMs) });
  }
  const g = outcome.generation;
  const activeGone = item.activeGeneration === g;
  return Object.freeze({
    ...item, version: outcome.version,
    pendingGeneration: item.pendingGeneration === g ? null : item.pendingGeneration,
    activeGeneration: activeGone ? null : item.activeGeneration,
    approvedMs: activeGone ? null : item.approvedMs,
  });
}

export type Notice = Readonly<{ tone: "success" | "warning" | "danger"; text: string; reload: boolean; retry: boolean }>;

export function outcomeNotice(command: PublicationCommand, outcome: PublicationOutcome): Notice {
  switch (outcome.status) {
    case "prepared": return { tone: "success", text: `게시 준비를 마쳤어요(세대 ${outcome.generation}). 확인 뒤 게시해 주세요.`, reload: false, retry: false };
    case "published": return { tone: "success", text: `공개 목록에 게시했어요(세대 ${outcome.generation}).`, reload: false, retry: false };
    case "revoked": return { tone: "success", text: `세대 ${outcome.generation}을 철회했어요. 공개 목록과 표지 주소에서 내려가요.`, reload: false, retry: false };
    case "conflict": return { tone: "warning", text: "그사이 다른 곳에서 상태가 바뀌었어요. 목록을 다시 불러온 뒤 확인해 주세요.", reload: true, retry: false };
    case "source-unavailable": return { tone: "warning", text: "원본 완성본이 바뀌었거나 아직 완성되지 않았어요. 원본을 확인해 주세요.", reload: true, retry: false };
    case "denied": return { tone: "danger", text: "이 작품을 게시하거나 철회할 권한이 없어요.", reload: false, retry: false };
    case "invalid": return { tone: "danger", text: "요청이 올바르지 않아 처리하지 않았어요. 목록을 다시 불러와 주세요.", reload: true, retry: false };
    case "unavailable": return { tone: "warning", text: `${command === "revoke" ? "철회" : "게시"} 요청을 처리하지 못했어요. 같은 요청으로 다시 시도할 수 있어요.`, reload: false, retry: true };
  }
}
