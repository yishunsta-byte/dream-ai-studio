import "server-only";
import { redirect } from "next/navigation";
import { CloudPending } from "@/components/auth/cloud-pending";
import { loginPath } from "./config";
import { legacyDataAvailable } from "./legacy-gate";
import { getRenderAuth } from "./render";

// 미전환 legacy(이 PC SQLite·파일) 화면 입구 가드(T-200).
// Next는 레이아웃과 페이지를 함께(병렬로) 그리므로 레이아웃만 막아서는 페이지 로더 실행을 막지 못한다.
// 그래서 각 legacy 페이지와 레이아웃이 **로더보다 먼저** 이 함수를 부른다.
// 인증은 getRenderAuth(React cache)로 한 번의 화면 그리기 안에서 1번만 판별한다.
export type LegacyPageDecision =
  | { kind: "open" }
  | { kind: "redirect"; to: string }
  | { kind: "pending"; account: string | null };

export async function legacyPageDecision(env: Readonly<Record<string, string | undefined>> = process.env): Promise<LegacyPageDecision> {
  const auth = await getRenderAuth();
  if (auth.kind === "denied") {
    // proxy와 같은 의미: 401 로그인으로, 403 허용 안 됨 안내, 503 인증 확인 불가 안내.
    if (auth.status === 401) return { kind: "redirect", to: loginPath() };
    return { kind: "redirect", to: loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }) };
  }
  if (!legacyDataAvailable(env)) return { kind: "pending", account: auth.kind === "verified" ? auth.email : null };
  return { kind: "open" };
}

// 페이지·레이아웃 입구용: null이면 그대로 진행, 아니면 이 화면을 대신 돌려준다(로그인 이동은 redirect로 끝남).
export async function legacyPageGate() {
  const decision = await legacyPageDecision();
  if (decision.kind === "redirect") redirect(decision.to);
  if (decision.kind === "pending") return <CloudPending account={decision.account} />;
  return null;
}
