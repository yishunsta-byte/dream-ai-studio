// 탭 사이 로그인 변경 알림과 서버 재확인(T-213, F209-1). 브라우저 전용.
// 알림은 "무언가 바뀌었다"는 신호뿐이다: 토큰·이메일·사용자 id를 싣지 않고, 권한 근거로 쓰지 않는다.
// 받은 탭은 반드시 서버(/api/auth/session)에 다시 묻고, 그 답으로만 표시를 정리한다.
const CHANNEL = "dream-auth-session";
const STORAGE_KEY = "dream-auth-session-signal";

export function announceSessionChange() {
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage("changed"); channel.close(); } catch { /* 지원하지 않으면 storage 신호만 */ }
  // storage 이벤트는 다른 탭에서만 발생한다. 값은 매번 달라야 하므로 시각+난수만 쓴다.
  try { localStorage.setItem(STORAGE_KEY, `${Date.now()}-${Math.random().toString(36).slice(2)}`); } catch { /* 저장소가 막히면 focus 복귀 재확인으로 대신한다 */ }
}

export function onSessionSignal(listener: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = () => listener(); } catch { channel = null; }
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { channel?.close(); window.removeEventListener("storage", onStorage); };
}

export type SessionCheck = "same" | "changed" | "signed-out" | "forbidden" | "unavailable" | "offline";

export async function checkSession(account: string): Promise<SessionCheck> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  let response: Response;
  try {
    response = await fetch("/api/auth/session", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
  } catch { return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable"; }
  if (response.status === 401) return "signed-out";
  if (response.status === 403) {
    const body = await response.json().catch(() => ({})) as { code?: string };
    return body.code === "AUTH_FORBIDDEN" ? "forbidden" : "unavailable";
  }
  if (!response.ok) return "unavailable";
  const body = await response.json().catch(() => ({})) as { state?: string };
  if (body.state === "same" || body.state === "local") return "same";
  if (body.state === "changed") return "changed";
  return "unavailable";
}

// 계정이 바뀐 것을 확인하면 전체 문서를 다시 받는다(레이아웃·router cache의 이전 표시 제거).
// 같은 탭에서 짧은 시간에 두 번 넘게 다시 받지 않는다(무한 새로고침 방지). 막히면 false.
const RELOAD_KEY = "dream-auth-session-reloaded";
export function reloadOnce(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < 15_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch { return false; }
  window.location.reload();
  return true;
}

export type SessionDecision =
  | { view: "current" | "checking" | "offline" | "unavailable" | "keep"; go?: undefined }
  | { view: "checking"; go: "reload" | "login" | "forbidden" };

// 서버 답 → 표시. suspect: 다른 탭 알림·pageshow 복원 뒤라 이전 표시를 믿을 수 없는 상태.
// keep: 의심 근거 없이 조용히 물었는데 확인하지 못함 → 지금 표시를 그대로 둔다(근거 없이 숨기지 않음).
export function decideSession(result: SessionCheck, suspect: boolean): SessionDecision {
  if (result === "same") return { view: "current" };
  if (result === "changed") return { view: "checking", go: "reload" };
  if (result === "signed-out") return { view: "checking", go: "login" };
  if (result === "forbidden") return { view: "checking", go: "forbidden" };
  return suspect ? { view: result } : { view: "keep" };
}
