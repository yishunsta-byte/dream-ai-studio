"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./admin-platform-integrations.module.css";

// P1-00-ADMIN-PLATFORM-CONSOLE-OPTION3(주인님 선택 3안 · 연동 콘솔): 왼쪽 플랫폼 목록(좁은 화면은 위), 오른쪽 고른 플랫폼 상세.
// 계정 연결(OAuth)은 아직 없으므로 모든 플랫폼 상태는 '계정 연결 준비 중'이고 입력 항목은 시안대로 비활성이다. 값을 받거나 보내지 않는다.
// 네 플랫폼 상세는 처음부터 모두 그리고 고르지 않은 칸만 hidden으로 둔다(서버 렌더에도 설정 순서·권한·가이드가 남음).

type SetupStep = {
  title: string;
  detail: string;
  values?: readonly string[];
};

type PlatformGuide = {
  slug: string;
  name: string;
  glyph: string;
  purpose: string;
  href: string;
  fields: readonly [string, string, string];
  steps: readonly SetupStep[];
};

export const platformGuides: readonly PlatformGuide[] = [
  {
    slug: "threads",
    name: "Threads",
    glyph: "@",
    purpose: "Threads 계정으로 게시",
    href: "https://developers.facebook.com/documentation/threads/",
    fields: ["Threads 앱 ID", "Threads 앱 시크릿 코드", "리디렉션 콜백 URL"],
    steps: [
      { title: "Meta 앱 만들기", detail: "Meta 개발자 센터의 내 앱에서 Threads 사용 사례를 추가하세요." },
      { title: "게시 권한 확인", detail: "Threads 계정 확인과 콘텐츠 게시에 쓰는 권한이에요.", values: ["threads_basic", "threads_content_publish"] },
      { title: "앱 도메인과 콜백 준비", detail: "연결 기능이 열리면 Meta 앱에 콜백 URL을 등록하고 개발 모드에서 테스트 계정을 추가하세요." },
    ],
  },
  {
    slug: "instagram",
    name: "Instagram",
    glyph: "◎",
    purpose: "프로페셔널 계정으로 콘텐츠 게시",
    href: "https://developers.facebook.com/documentation/instagram-platform/content-publishing",
    fields: ["Instagram 앱 ID", "Instagram 앱 시크릿", "유효한 OAuth 리디렉션 URI"],
    steps: [
      { title: "Instagram Login 설정", detail: "Meta 앱에 Instagram Login을 추가하고 비즈니스 또는 크리에이터 계정을 준비하세요." },
      { title: "게시 권한 확인", detail: "Instagram Login으로 계정 정보 확인과 콘텐츠 게시를 허용하는 권한이에요.", values: ["instagram_business_basic", "instagram_business_content_publish"] },
      { title: "계정 승인 준비", detail: "연결 기능이 열리면 앱에 리디렉션 URI를 등록하고 앱 역할을 확인하세요." },
    ],
  },
  {
    slug: "youtube",
    name: "YouTube",
    glyph: "▶",
    purpose: "내 채널에 영상 업로드",
    href: "https://developers.google.com/youtube/data/reference/rest/v3/videos/insert",
    fields: ["OAuth 클라이언트 ID", "클라이언트 보안 비밀", "승인된 리디렉션 URI"],
    steps: [
      { title: "YouTube Data API 사용 설정", detail: "Google Cloud 프로젝트에서 YouTube Data API v3를 사용 설정하세요." },
      { title: "채널 업로드 권한 확인", detail: "내 채널 업로드에는 OAuth 웹 클라이언트와 채널 승인이 필요해요.", values: ["https://www.googleapis.com/auth/youtube.upload"] },
      { title: "채널 연결 준비", detail: "연결 기능이 열리면 Google Cloud에 업로드용 리디렉션 URI를 등록하세요." },
    ],
  },
  {
    slug: "drive",
    name: "Google Drive",
    glyph: "△",
    purpose: "프로젝트 파일과 저장소 연결",
    href: "https://developers.google.com/workspace/drive/api/guides/api-specific-auth",
    fields: ["OAuth 클라이언트 ID", "클라이언트 보안 비밀", "승인된 리디렉션 URI"],
    steps: [
      { title: "Google Drive API 사용 설정", detail: "Google Cloud에서 Drive API를 켜고 OAuth 웹 애플리케이션 클라이언트를 준비하세요." },
      { title: "파일 접근 권한 확인", detail: "앱에서 만들거나 사용자가 앱으로 연 파일에 접근하는 범위예요.", values: ["https://www.googleapis.com/auth/drive.file"] },
      { title: "저장소 연결 준비", detail: "OAuth 동의 화면에서 테스트 사용자를 준비하고 연결 기능이 열리면 리디렉션 URI를 등록하세요." },
    ],
  },
];

/** 같은 화면의 'YouTube Data API v3 등록' 칸(공개 쇼츠 검색 키) 제목 id. admin-platform-integrations.tsx의 h3 id와 같아야 한다(서버 부품이라 글자로 둠, 시험이 같은지 확인). */
export const youtubeSearchKeyHeadingId = "youtube-data-title";
/** 배정 2 바로가기 대상: 'AI 분석 엔진'(키 등록 맨 앞)과 '내 채널 및 저장소 연동 방법'(플랫폼 목록 바로 위) 제목 id. 위와 같이 h3 id와 같아야 한다. */
export const analysisKeysHeadingId = "image-engine-title";
export const platformListHeadingId = "publishing-platforms-title";
const narrowQuery = "(max-width: 720px)";

function CopyValue({ value }: { value: string }) {
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("복사했어요.");
    } catch {
      setMessage("자동으로 복사하지 못했어요. 값을 선택해 복사해 주세요.");
    }
  }

  return <div className={styles.copyField}>
    <div className={styles.copyValue}>
      <code>{value}</code>
      <Button type="button" size="sm" variant="secondary" aria-label={`${value} 복사`} onClick={copy}>복사</Button>
    </div>
    <span className={styles.copyStatus} role="status">{message}</span>
  </div>;
}

// 해시를 바꾸지 않는다(허브는 해시로 메뉴를 고르므로 모르는 해시면 홈으로 간다). 같은 화면의 칸 제목으로 초점과 스크롤만 옮긴다.
// 초점을 먼저 주면 허브의 고정 머리 여백(.target :focus의 scroll-margin-top)이 적용돼 제목이 머리에 가리지 않는다. 입력은 그대로 둔다(언마운트 없음).
function focusSectionHeading(id: string) {
  const heading = document.getElementById(id);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: "start" });
}

// P1-00-ADMIN-PLATFORM-CONSOLE-OPTION3 배정 2: 키 등록 칸은 위에 그대로 두고, 설정 맨 위에서 3안의 두 영역으로 바로 간다.
export function AdminSettingsShortcuts() {
  return <div className={styles.shortcuts} role="group" aria-label="설정 바로가기">
    <button type="button" onClick={() => focusSectionHeading(analysisKeysHeadingId)}>분석 API 설정</button>
    <button type="button" onClick={() => focusSectionHeading(platformListHeadingId)}>채널·저장소 연동</button>
  </div>;
}

// 플랫폼 칸 끝에서 키 등록 맨 앞으로 돌아간다.
export function BackToAnalysisKeys() {
  return <button type="button" className={styles.backToKeys} onClick={() => focusSectionHeading(analysisKeysHeadingId)}>
    <span aria-hidden="true">↑</span> 분석 API 설정으로 돌아가기</button>;
}

export function AdminPlatformGuides() {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const query = window.matchMedia(narrowQuery);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  function select(index: number, focus: boolean) {
    setSelected(index);
    if (focus) tabs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = platformGuides.length - 1;
    const forward = narrow ? "ArrowRight" : "ArrowDown";
    const backward = narrow ? "ArrowLeft" : "ArrowUp";
    let next: number | undefined;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === forward) next = index === last ? 0 : index + 1;
    else if (event.key === backward) next = index === 0 ? last : index - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(next, true);
  }

  return <div className={styles.platformConsole} data-platform-console="">
    <div className={styles.platformPicker} role="tablist" aria-label="연동 플랫폼" aria-orientation={narrow ? "horizontal" : "vertical"}>
      {platformGuides.map(({ slug, name, glyph, purpose }, index) => <button key={slug} ref={node => { tabs.current[index] = node; }}
        type="button" role="tab" id={`${id}-tab-${slug}`} aria-controls={`${id}-panel-${slug}`} aria-selected={index === selected}
        tabIndex={index === selected ? 0 : -1} data-platform={slug} onClick={() => select(index, false)} onKeyDown={event => onKeyDown(event, index)}>
        <span className={styles.platformIcon} data-platform-icon={slug} aria-hidden="true">{glyph}</span>
        <span className={styles.platformName}><strong>{name}</strong><small>{purpose}</small></span>
        <span className={styles.listStatus} aria-hidden="true">준비 중</span>
      </button>)}
    </div>

    <div className={styles.platformPanels}>
      {platformGuides.map(({ slug, name, glyph, purpose, href, fields, steps }, index) => <section key={slug} className={styles.platformPanel}
        id={`${id}-panel-${slug}`} role="tabpanel" aria-labelledby={`${id}-tab-${slug}`} hidden={index !== selected} data-platform-panel={slug}>
        <header className={styles.platformHeading}>
          <div>
            <span className={styles.platformIcon} data-platform-icon={slug} aria-hidden="true">{glyph}</span>
            <div><h4>{name}</h4><p>{purpose}</p></div>
          </div>
          <span className={styles.platformStatus}>계정 연결 준비 중</span>
        </header>
        {slug === "youtube" && <p className={styles.lookupNote}>공개 쇼츠 검색 키는 같은 화면의{" "}
          <button type="button" onClick={() => focusSectionHeading(youtubeSearchKeyHeadingId)}>YouTube Data API v3 등록</button>에서 관리해요.</p>}
        <section className={styles.platformBox} aria-labelledby={`${id}-fields-${slug}`}>
          <h5 id={`${id}-fields-${slug}`}>연결에 필요한 항목</h5>
          <fieldset className={styles.platformFields} disabled aria-label={`${name} 연결에 필요한 항목`}>
            <label>{fields[0]}<input placeholder="플랫폼에서 발급" /></label>
            <label>{fields[1]}<input placeholder="••••••••" /></label>
            <label>{fields[2]}<input placeholder="연결 기능이 열리면 표시돼요" /></label>
          </fieldset>
          <p className={styles.platformHint}>계정 연결이 제공되면 입력할 수 있어요.</p>
        </section>
        <section className={`${styles.platformBox} ${styles.platformSteps}`} aria-labelledby={`${id}-steps-${slug}`}>
          <h5 id={`${id}-steps-${slug}`}>설정 순서</h5>
          <ol>
            {steps.map(({ title, detail, values }) => <li key={title}>
              <div>
                <strong>{title}</strong>
                <p>{detail}</p>
                {values?.map(value => <CopyValue key={value} value={value} />)}
              </div>
            </li>)}
          </ol>
        </section>
        <a className={styles.platformGuideLink} href={href} target="_blank" rel="noreferrer">{name} 설정 가이드 <span aria-hidden="true">↗</span></a>
      </section>)}
    </div>
  </div>;
}
