"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button, Card } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { SHORTS_ANALYSIS_URI } from "@/lib/reference-analysis/shorts-analysis-contract";
import { accountSettingsId, analysisPrograms, useAdminSection } from "./admin-navigation";
import { ANALYSIS_URI } from "./admin-reference-analysis-model";
import styles from "./admin.module.css";

// 공급자와 모델은 서버 환경 변수로만 정한다. 화면에는 변수 이름과 설정 여부만 보여 준다(값·키는 보내지 않음).
const checks = [
  { program: "image", path: ANALYSIS_URI, modelVariable: "DREAM_REFERENCE_GEMINI_MODEL" },
  { program: "music", path: MUSIC_SEMANTIC_URI, modelVariable: "DREAM_MUSIC_SEMANTIC_GEMINI_MODEL" },
  { program: "shorts", path: SHORTS_ANALYSIS_URI, modelVariable: "DREAM_REFERENCE_SHORTS_GEMINI_MODEL" },
] as const;
const manualLink = "#admin-manual";
// 긴 변수 이름이 좁은 화면에서 가로로 넘치지 않게 밑줄 뒤에서 줄을 바꿀 수 있게 한다.
const breakable = (name: string) => name.split("_").flatMap((part, index) => index ? [<wbr key={index} />, "_" + part] : [part]);
const loginLink = adminLoginPath({ next: "/admin#admin-api-integrations" });

// 설정 여부 조회 결과만 말한다. '연결됨'은 실제 Gemini 호출을 하지 않으므로 쓰지 않는다.
function cardStatus(result: AnalysisSettings | undefined, checking: boolean) {
  if (!result) return { text: checking ? "확인 중" : "확인 전", tone: undefined };
  switch (result.kind) {
    case "configured": return { text: "설정 확인됨", tone: "success" } as const;
    case "not_configured": return { text: "서버 설정 필요", tone: "warning" } as const;
    case "login": return { text: "관리자 로그인 필요", tone: "warning" } as const;
    case "forbidden": return { text: "관리자 권한 필요", tone: "warning" } as const;
    default: return { text: "설정을 확인하지 못했어요", tone: "danger" } as const;
  }
}

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

function ApiSettingsCard() {
  const [results, setResults] = useState<readonly AnalysisSettings[]>([]);
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function checkApis() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setResults([]);
    const outcomes = await Promise.all(checks.map(({ program }) => readAnalysisSettings(program, controller.signal)));
    if (controller.signal.aborted) return;
    request.current = null;
    setResults(outcomes);
    setChecking(false);
  }

  const needsSetup = results.some(result => result.kind === "not_configured");
  const needsLogin = results.some(result => result.kind === "login");
  return <Card className={styles.apiCard}>
    <div className={styles.apiIntro}>
      <div>
        <h4>분석기 연결 설정</h4>
        <p className={styles.note}>현재 배포에 Gemini 서버 설정이 있는지 확인해요. 실제 Gemini 연결과 모델 응답은 각 분석기에서 분석을 실행할 때 확인돼요.</p>
      </div>
      <Button type="button" variant="secondary" aria-disabled={checking} onClick={() => void checkApis()}>
        {checking ? "확인 중" : results.length ? "다시 확인" : "서버 설정 확인"}
      </Button>
    </div>
    <ul className={styles.apiRoutes}>
      {checks.map(({ program, modelVariable }, index) => {
        const { id, label } = analysisPrograms[index];
        const status = cardStatus(results[index], checking);
        return <li key={program}>
          <div>
            <h5><a className={styles.link} href={`#${id}`}>{label} <Icon name="arrow" /></a></h5>
            <p className={styles.note}>제공사 Google Gemini · 서버에서 정한 모델 <code>{breakable(modelVariable)}</code></p>
          </div>
          <p className={styles.apiStatus} role="status" aria-label={label} data-tone={status.tone}>{status.text}</p>
        </li>;
      })}
    </ul>
    {needsLogin && <a className={styles.link} href={loginLink}>관리자 로그인</a>}
    <p className={styles.note}>
      키와 모델은 Vercel 프로젝트의 Settings → Environment Variables에서 적용할 환경(Preview 또는 Production)을 골라 서버에만 저장하고, 새로 배포한 뒤 다시 확인해요. 이 화면에서는 키를 입력하거나 보여 주지 않아요.
    </p>
    <a className={styles.link} href={manualLink}>{needsSetup ? "서버 설정 필요: " : ""}키와 모델 설정 방법 <Icon name="arrow" /></a>
    <details>
      <summary>기술 정보</summary>
      <ul className={styles.apiRoutes}>
        {checks.map(({ program, path }, index) => <li key={program}>
          <span>{analysisPrograms[index].label}</span>
          <p className={styles.apiMethod}><strong>GET</strong> <code>{path}</code></p>
        </li>)}
      </ul>
    </details>
  </Card>;
}

export function AdminApiIntegrations() {
  const current = useAdminSection();
  return <>
    <h3 id="admin-api-integrations-title" tabIndex={-1}>API연동</h3>
    {current === accountSettingsId && <ApiSettingsCard />}
  </>;
}
