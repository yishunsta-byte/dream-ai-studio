"use client";

import { MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { SHORTS_ANALYSIS_URI } from "@/lib/reference-analysis/shorts-analysis-contract";
import { GeminiSettingsCard } from "./admin-gemini-settings";
import { accountSettingsId, useAdminSection } from "./admin-navigation";
import { ANALYSIS_URI } from "./admin-reference-analysis-model";

// 분석 화면이 쓰는 분석기별 설정 조회(분석 실행 전 상태 표시용).
const checks = [
  { program: "image", path: ANALYSIS_URI },
  { program: "music", path: MUSIC_SEMANTIC_URI },
  { program: "shorts", path: SHORTS_ANALYSIS_URI },
] as const;

type Program = typeof checks[number]["program"];
export type AnalysisSettings =
  | { kind: "configured" | "not_configured" }
  | { kind: "login" | "forbidden" | "failed"; message: string };

export async function readAnalysisSettings(program: Program, signal: AbortSignal): Promise<AnalysisSettings> {
  const check = checks.find((item) => item.program === program)!;
  try {
    const response = await fetch(check.path, {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (response.status === 401) return { kind: "login", message: "다시 로그인해 주세요." };
    if (response.status === 403) return { kind: "forbidden", message: "관리자 권한이 필요해요." };
    if (response.status === 503) return { kind: "failed", message: "현재 서비스에 연결할 수 없어요." };
    if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && "semantic" in data &&
          typeof data.semantic === "object" && data.semantic !== null) {
        const status = (data.semantic as Record<string, unknown>)[program];
        if (status === "configured" || status === "not_configured") return { kind: status };
      }
    }
    return { kind: "failed", message: `응답을 확인해 주세요. (HTTP ${response.status})` };
  } catch {
    return { kind: "failed", message: "응답이 없어요. 연결을 확인해 주세요." };
  }
}

export function settingsMessage(status: AnalysisSettings) {
  if ("message" in status) return status.message;
  return status.kind === "configured" ? "서버 설정 확인" : "Gemini 서버 설정 필요";
}

export function AdminApiIntegrations() {
  const current = useAdminSection();
  return <>
    <h3 id="admin-api-integrations-title" tabIndex={-1}>API연동</h3>
    {current === accountSettingsId && <GeminiSettingsCard />}
  </>;
}
