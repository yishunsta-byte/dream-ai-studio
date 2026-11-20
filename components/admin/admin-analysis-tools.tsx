"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button, Card } from "@/components/ui/primitives";
import { referenceFileByteLimit, referenceUploadByteLimit } from "@/lib/reference-analysis/input";
import { MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { SHORTS_ANALYSIS_URI } from "@/lib/reference-analysis/shorts-analysis-contract";
import { ANALYSIS_URI, MEDIA_LABEL, PUBLICATIONS_URI, SUPPORTED_FORMATS, SUPPORTED_ORIGINS } from "./admin-reference-analysis-model";
import styles from "./admin.module.css";

const MiB = 1024 * 1024;
const checks = [
  { label: "미디어 분석", path: ANALYSIS_URI, probe: "options", methods: "POST", description: "URL과 파일 업로드를 분석해요." },
  { label: "Gemini · 이미지 Style DNA", path: ANALYSIS_URI, probe: "image", methods: "GET", description: "서버의 이미지 분석 키와 모델 설정을 확인해요." },
  { label: "Gemini · 음악 의미 분석", path: MUSIC_SEMANTIC_URI, probe: "music", methods: "GET", description: "서버의 음악 의미 분석 설정을 확인해요." },
  { label: "Gemini · YouTube Shorts 분석", path: SHORTS_ANALYSIS_URI, probe: "shorts", methods: "GET", description: "서버의 YouTube Shorts 분석 설정을 확인해요." },
  { label: "분석 결과 공개", path: PUBLICATIONS_URI, probe: "publications", methods: "GET · POST · DELETE", description: "공개 목록 조회, 공개, 철회에 사용해요." },
] as const;

function extensionList(extensions: string | readonly string[]) {
  return typeof extensions === "string" ? extensions : extensions.map(extension => extension.toUpperCase()).join(" · ");
}

export function AdminAnalysisGuide() {
  return <aside aria-label="분석기 도움말" className={styles.analysisGuide}>
    <details className={styles.guideCard}>
      <summary><Icon name="info" />사용 매뉴얼</summary>
      <div className={styles.guideBody}>
        <ol>
          <li><strong>소스 선택</strong><p>URL 주소 또는 파일 업로드를 선택한 뒤 이미지, 음악, 영상 중 하나를 고르세요.</p></li>
          <li><strong>권리 확인하고 분석</strong><p>분석할 권리가 있는 자료를 넣고 버튼을 누르세요. 파일은 {referenceUploadByteLimit / MiB} MiB까지 업로드할 수 있어요.</p></li>
          <li><strong>결과 확인</strong><p>분석 근거와 생성 프롬프트를 확인하세요. 공개가 필요하면 결과를 골라 제목·요약·프롬프트를 공개할 수 있어요.</p></li>
          <li><strong>의미 분석</strong><p>Style DNA로 분석을 누르면 Gemini에 분석용 이미지 사본이 전송돼요. 음악과 쇼츠는 선택한 음악 원본 또는 공개 YouTube 영상 주소 전송에 동의한 뒤 각각 음악 의미 분석 실행 또는 쇼츠 분석을 누르세요. 결과 공개 동의는 공개 준비에서 따로 받아요.</p></li>
        </ol>
        <h3>지원 형식</h3>
        <dl className={styles.guideFormats}>
          {SUPPORTED_FORMATS.map(format => <div key={format.media}>
            <dt>{MEDIA_LABEL[format.media]}</dt>
            <dd>{extensionList(format.extensions)}{format.limit ? ` · ${format.limit}` : ""}</dd>
          </div>)}
        </dl>
        <h3>분석 결과에서 볼 수 있는 항목</h3>
        <ul>
          <li>이미지의 영역별 팔레트와 밝기 분포</li>
          <li>이미지에서 Style DNA로 분석을 누르면 Gemini가 인물·사물·행동·맥락·구도·조명을 해석하고 한영 프롬프트를 제안해요.</li>
          <li>음악의 채널, 구간별 음량, 추정 박자</li>
          <li>영상의 프레임 시간, 장면 전환 후보, 생성용 프롬프트</li>
        </ul>
        <h3>URL로 분석하기</h3>
        <p>아래 도메인의 HTTPS 직접 파일 주소를 사용하세요. 최대 {referenceFileByteLimit / MiB} MiB이며 주소에서 쿼리와 프래그먼트를 빼 주세요.</p>
        <ul>
          {SUPPORTED_ORIGINS.map(url => <li key={url}><code>{new URL(url).hostname}</code></li>)}
        </ul>
        <p>Threads 같은 게시물 링크를 가진 경우, 권한이 있는 원본 파일을 직접 업로드하세요.</p>
      </div>
    </details>
    <a className={styles.guideLink} href="#admin-api-integrations"><Icon name="settings" />API 연동 보기<Icon name="arrow" /></a>
  </aside>;
}

type ApiCheck = { tone: "success" | "warning" | "danger"; message: string };

async function probeApi({ path, probe }: typeof checks[number]): Promise<ApiCheck> {
  try {
    const response = await fetch(path, {
      method: probe === "options" ? "OPTIONS" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401) return { tone: "warning", message: "다시 로그인해 주세요." };
    if (response.status === 403) return { tone: "warning", message: "관리자 권한이 필요해요." };
    if (response.status === 503) return { tone: "warning", message: "현재 서비스에 연결할 수 없어요." };
    if (response.ok) {
      if (probe === "options" && response.headers.get("allow")?.split(",").some(method => method.trim() === "POST")) {
        return { tone: "success", message: "POST 경로 확인" };
      }
      if (probe !== "options" && response.headers.get("content-type")?.includes("application/json")) {
        const data: unknown = await response.json();
        if (probe === "publications" && typeof data === "object" && data !== null && "items" in data && Array.isArray(data.items)) {
          return { tone: "success", message: "공개 목록 조회 확인" };
        }
        if (probe !== "publications" && typeof data === "object" && data !== null && "semantic" in data &&
          typeof data.semantic === "object" && data.semantic !== null) {
          const status = (data.semantic as Record<string, unknown>)[probe];
          if (status === "configured") return { tone: "success", message: "서버 설정 확인" };
          if (status === "not_configured") return { tone: "warning", message: "Gemini 서버 설정 필요" };
        }
      }
    }
    return { tone: "danger", message: `응답을 확인해 주세요. (HTTP ${response.status})` };
  } catch {
    return { tone: "danger", message: "응답이 없어요. 연결을 확인해 주세요." };
  }
}

export function AdminApiIntegrations() {
  const [results, setResults] = useState<readonly ApiCheck[]>([]);
  const [checking, setChecking] = useState(false);

  async function checkApis() {
    if (checking) return;
    setChecking(true);
    setResults([]);
    const outcomes = await Promise.all(checks.map(probeApi));
    setResults(outcomes);
    setChecking(false);
  }

  return <>
    <div className={styles.sectionHead}>
      <h2 id="admin-api-integrations-title" tabIndex={-1}>API 연동</h2>
      <a className={styles.analysisBack} href="#admin-reference-analysis">분석기로 이동 <Icon name="arrow" /></a>
    </div>
    <Card className={styles.apiCard}>
      <div className={styles.apiIntro}>
        <div><h3>콘텐츠 분석 API</h3><p className={styles.note}>기본 분석과 공개 기능은 관리자 로그인으로 사용해요. 이미지 기본 분석에는 별도 API 키는 필요 없어요. 이미지·음악·쇼츠 의미 분석은 Gemini 서버 설정을 사용해요.</p></div>
        <Button type="button" variant="secondary" aria-disabled={checking} onClick={() => void checkApis()}>
          {checking ? "응답 확인 중" : "API 응답 확인"}
        </Button>
      </div>
      <ul className={styles.apiRoutes}>
        {checks.map(({ path, label, methods, description, probe }, index) => <li key={probe}>
          <div>
            <h4>{label}</h4>
            <p className={styles.apiMethod}><strong>{methods}</strong> <code>{path}</code></p>
            <p className={styles.note}>{description}</p>
          </div>
          <p className={styles.apiStatus} role="status" aria-label={label} data-tone={results[index]?.tone}>
            {results[index]?.message ?? (checking ? "확인 중" : "확인 전")}
          </p>
        </li>)}
      </ul>
      <p className={styles.note}>응답 확인은 GET·OPTIONS로 내부 API와 서버 설정 상태만 조회해요. 실제 모델 응답은 각 분석 화면에서 확인할 수 있어요.</p>
    </Card>
  </>;
}
