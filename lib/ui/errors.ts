// One place for job error code → user sentence, next action and retry decision
// (DESIGN 5.2 / T-013 3.2). Pure module: safe for server DTOs and client components.

// Must match the `retryable` set in lib/services/jobs.ts (tests/ui-errors.test.ts checks both).
export const RETRYABLE_JOB_CODES = ["PROVIDER_DOWN", "RATE_LIMITED", "TIMEOUT", "STORAGE_FAILED"] as const;
export function isRetryableCode(code: string | null | undefined) {
  return !!code && (RETRYABLE_JOB_CODES as readonly string[]).includes(code);
}

export type ErrorAction = "retry" | "retry-storage" | "recreate" | null;
export type ErrorLinkKey = "plan" | "library" | "jobs" | "budget";
export type ErrorCopy = {
  title: string;
  next: string;
  action: ErrorAction;
  actionLabel: string | null;
  links: { key: ErrorLinkKey; label: string }[];
  code: string;
  codeLine: string;
  autoRetry: boolean;
};

const SAMPLE_CHARGE = "청구 없음(샘플)";

// Provider/worker text shown as the reason line. Anything that looks like a path, key or token is dropped.
export function safeReason(message: string | null | undefined, title?: string) {
  if (!message) return null;
  const text = message.replace(/\s+/g, " ").trim();
  if (!text || text === title) return null;
  if (/[A-Za-z]:[\\/]|\\\\|(^|[\s(])\/(Users|home|tmp|var|private|mnt|opt|etc)\b|file:\/\//i.test(text)) return null;
  if (/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}|bearer\s|api[_-]?key|token\s*[=:]|secret|password/i.test(text)) return null;
  if (/[A-Za-z0-9+/_-]{32,}/.test(text)) return null;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function at(iso: string | null | undefined) {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
}

export function sceneErrorCopy(input: { code: string | null | undefined; retryable: boolean; willRetryAt?: string | null; attempts?: number }): ErrorCopy {
  const code = input.code || "UNKNOWN", tries = input.attempts ? ` · 시도 ${input.attempts}회` : "";
  const waiting = !!input.willRetryAt && ["PROVIDER_DOWN", "RATE_LIMITED", "TIMEOUT", "STORAGE_FAILED"].includes(code);
  if (waiting) {
    const title = code === "RATE_LIMITED" ? "잠시 요청이 많아요." : code === "TIMEOUT" ? "시간이 너무 오래 걸려 멈췄어요." : code === "STORAGE_FAILED" ? "결과는 받았지만 저장하지 못했어요." : "제공사가 잠시 응답하지 않아요.";
    const when = at(input.willRetryAt);
    return { title, next: when ? `${when}쯤 자동으로 다시 시도해요.` : "잠시 뒤 자동으로 다시 시도해요.", action: null, actionLabel: null, links: [], code, codeLine: `코드 ${code}${tries}`, autoRetry: true };
  }
  switch (code) {
    case "CONTENT_REJECTED":
      return { title: "제공사가 이 장면을 만들 수 없다고 했어요.", next: "장면 설명이나 참조 자료를 바꾼 뒤 새로 만들어 주세요. 기획을 고치면 다시 승인해야 해요.", action: null, actionLabel: null, links: [{ key: "plan", label: "기획 고치기" }, { key: "library", label: "자료 바꾸기" }], code, codeLine: `코드 ${code} · 자동 재시도 안 함 · ${SAMPLE_CHARGE}`, autoRetry: false };
    case "STORAGE_FAILED":
      return { title: "결과는 받았지만 저장하지 못했어요.", next: "저장 공간을 확인한 뒤 저장만 다시 해 주세요. 다시 만들지 않아요.", action: input.retryable ? "retry-storage" : null, actionLabel: input.retryable ? "저장 다시 시도" : null, links: input.retryable ? [] : [{ key: "jobs", label: "작업 대기열 보기" }], code, codeLine: `코드 ${code}${tries} · ${SAMPLE_CHARGE}`, autoRetry: false };
    case "PROVIDER_DOWN":
    case "RATE_LIMITED":
    case "TIMEOUT": {
      const title = code === "TIMEOUT" ? "시간이 너무 오래 걸려 멈췄어요." : code === "RATE_LIMITED" ? "잠시 요청이 많아요." : "제공사가 잠시 응답하지 않아요.";
      return { title, next: input.retryable ? "같은 내용으로 다시 시도해 보세요." : "작업 대기열에서 자세히 확인해 주세요.", action: input.retryable ? "retry" : null, actionLabel: input.retryable ? "다시 시도" : null, links: input.retryable ? [] : [{ key: "jobs", label: "작업 대기열 보기" }], code, codeLine: `코드 ${code}${tries} · ${SAMPLE_CHARGE}`, autoRetry: false };
    }
    case "INVALID_INPUT":
      return { title: "만들 때 필요한 내용이 빠졌어요.", next: "기획의 장면 설명을 확인해 주세요.", action: null, actionLabel: null, links: [{ key: "plan", label: "기획 보기" }], code, codeLine: `코드 ${code}`, autoRetry: false };
    case "BUDGET_EXCEEDED":
      return { title: "이번 달 예산을 넘어 시작하지 않았어요.", next: "한도를 올리거나 다음 달에 다시 시도해 주세요.", action: null, actionLabel: null, links: [{ key: "budget", label: "설정 > 예산" }], code, codeLine: `코드 ${code} · 예약하지 않았고 청구 없음`, autoRetry: false };
    default:
      return { title: "결과를 만들지 못했어요.", next: input.retryable ? "다시 시도해 보세요." : "작업 대기열에서 자세히 확인해 주세요.", action: input.retryable ? "retry" : null, actionLabel: input.retryable ? "다시 시도" : null, links: input.retryable ? [] : [{ key: "jobs", label: "작업 대기열 보기" }], code, codeLine: `코드 ${code}${tries}`, autoRetry: false };
  }
}

export function exportErrorCopy(input: { code: string | null | undefined; retryable: boolean; message?: string | null }): ErrorCopy & { reason: string } {
  const code = input.code || "UNKNOWN", title = "묶음을 만들지 못했어요.";
  const reason = code === "EXPORT_INVALID"
    ? (input.message?.includes("해시") ? "결과 파일이 등록 기록과 달라요." : "내용이 바뀌었거나 검수가 유효하지 않아요.")
    : code === "STORAGE_FAILED" || code === "DISK_FULL" ? "묶음을 저장하거나 검증하지 못했어요. 저장 공간이 부족하거나 파일이 없을 수 있어요."
    : code === "TIMEOUT" ? "묶음을 만드는 시간이 너무 오래 걸렸어요."
    : code === "EXPORT_CANCELED" ? "만들기를 취소했어요."
    : "원인을 확인하지 못했어요.";
  if (code === "EXPORT_INVALID") return { title, reason, next: "장면 결과와 검수를 확인한 뒤 현재 내용으로 새로 만들어 주세요.", action: "recreate", actionLabel: "현재 내용으로 새로 만들기", links: [], code, codeLine: `코드 ${code}`, autoRetry: false };
  if (input.retryable) return { title, reason, next: "저장 공간과 파일을 확인한 뒤 다시 시도해 주세요.", action: "retry", actionLabel: "다시 시도", links: [], code, codeLine: `코드 ${code}`, autoRetry: false };
  return { title, reason, next: "작업 대기열에서 자세히 확인하거나 현재 내용으로 새로 만들어 주세요.", action: "recreate", actionLabel: "현재 내용으로 새로 만들기", links: [{ key: "jobs", label: "작업 대기열 보기" }], code, codeLine: `코드 ${code}`, autoRetry: false };
}
