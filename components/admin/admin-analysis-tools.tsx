"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button, Card } from "@/components/ui/primitives";
import { MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { SHORTS_ANALYSIS_URI } from "@/lib/reference-analysis/shorts-analysis-contract";
import { analysisPrograms, useAdminSection } from "./admin-navigation";
import { ANALYSIS_URI } from "./admin-reference-analysis-model";
import styles from "./admin.module.css";

const checks = [
  { program: "image", path: ANALYSIS_URI, description: "이미지 Style DNA 모델 설정" },
  { program: "music", path: MUSIC_SEMANTIC_URI, description: "음악 의미 분석 모델 설정" },
  { program: "shorts", path: SHORTS_ANALYSIS_URI, description: "YouTube Shorts 분석 모델 설정" },
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

  return <Card className={styles.apiCard}>
    <div className={styles.apiIntro}>
      <div><h3>분석기 서버 설정</h3><p className={styles.note}>각 프로그램의 Gemini 설정 상태를 조회해요. 모델 응답은 분석 화면에서 확인해요.</p></div>
      <Button type="button" variant="secondary" aria-disabled={checking} onClick={() => void checkApis()}>
        {checking ? "응답 확인 중" : "API 응답 확인"}
      </Button>
    </div>
    <ul className={styles.apiRoutes}>
      {checks.map(({ program, path, description }, index) => {
        const { id, label } = analysisPrograms[index];
        const result = results[index];
        const tone = result?.kind === "configured" ? "success" : result?.kind === "failed" ? "danger" : result && "warning";
        return <li key={program}>
          <div>
            <h4><a className={styles.link} href={`#${id}`}>{label} <Icon name="arrow" /></a></h4>
            <p className={styles.apiMethod}><strong>GET</strong> <code>{path}</code></p>
            <p className={styles.note}>{description}</p>
          </div>
          <p className={styles.apiStatus} role="status" aria-label={label} data-tone={tone}>
            {result ? settingsMessage(result) : checking ? "확인 중" : "확인 전"}
          </p>
        </li>;
      })}
    </ul>
  </Card>;
}

export function AdminApiIntegrations() {
  const current = useAdminSection();
  return <>
    <h2 id="admin-api-integrations-title" tabIndex={-1}>API연동</h2>
    {current === "admin-api-integrations" && <ApiSettingsCard />}
  </>;
}
