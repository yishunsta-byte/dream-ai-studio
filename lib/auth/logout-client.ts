// 브라우저에서 로그아웃을 부르고 결과를 정직하게 나눈다(T-186, F184-2).
export type LogoutResult =
  | { state: "ended" }                 // 로그아웃 완료(이미 로그인이 없던 경우 포함)
  | { state: "partial"; message: string } // 이 브라우저 로그인은 지웠지만 서버 확인 실패
  | { state: "failed"; message: string }; // 로그인이 남아 있을 수 있음

export async function requestLogout(): Promise<LogoutResult> {
  let response: Response;
  try { response = await fetch("/api/auth/logout", { method: "POST" }); }
  catch { return { state: "failed", message: "인터넷 연결을 확인하지 못해 로그아웃하지 못했어요. 다시 시도해 주세요." }; }
  if (response.ok) return { state: "ended" };
  const body = await response.json().catch(() => ({})) as { code?: string; error?: string; localCleared?: boolean };
  if (response.status === 401 || body.code === "AUTH_REQUIRED") return { state: "ended" };
  if (body.code === "LOGOUT_PARTIAL" && body.localCleared) return { state: "partial", message: body.error ?? "이 브라우저의 로그인은 지웠어요." };
  return { state: "failed", message: body.error ?? "로그아웃하지 못했어요. 다시 시도해 주세요." };
}
