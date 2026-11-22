"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./admin-platform-integrations.module.css";

type SetupStep = {
  title: string;
  detail: string;
  values?: readonly string[];
};

type PlatformGuide = {
  name: string;
  purpose: string;
  href: string;
  steps: readonly SetupStep[];
};

const guides: readonly PlatformGuide[] = [
  {
    name: "Threads",
    purpose: "Threads 계정으로 게시",
    href: "https://developers.facebook.com/documentation/threads/",
    steps: [
      { title: "Meta 앱 만들기", detail: "Meta 개발자 센터의 내 앱에서 Threads 사용 사례를 추가하세요." },
      { title: "게시 권한 확인", detail: "Threads 계정 확인과 콘텐츠 게시에 쓰는 권한입니다.", values: ["threads_basic", "threads_content_publish"] },
      { title: "승인과 테스트 준비", detail: "개발 모드에서는 연결할 Threads 계정에 테스트 권한을 부여하세요. 콜백 주소와 계정 연결은 준비 중이에요." },
    ],
  },
  {
    name: "Instagram",
    purpose: "프로페셔널 계정으로 콘텐츠 게시",
    href: "https://developers.facebook.com/documentation/instagram-platform/content-publishing",
    steps: [
      { title: "Instagram Login 설정", detail: "Meta 앱에 Instagram Login을 추가하고 비즈니스 또는 크리에이터 계정을 준비하세요." },
      { title: "게시 권한 확인", detail: "Instagram Login을 사용하는 콘텐츠 게시 권한입니다.", values: ["instagram_business_basic", "instagram_business_content_publish"] },
      { title: "계정 승인 준비", detail: "연결할 계정에 필요한 앱 역할을 확인하세요. 콜백 주소와 계정 연결은 준비 중이에요." },
    ],
  },
  {
    name: "YouTube",
    purpose: "내 채널에 영상 업로드",
    href: "https://developers.google.com/youtube/data/reference/rest/v3/videos/insert",
    steps: [
      { title: "Google Cloud 프로젝트 확인", detail: "YouTube Data API v3를 사용 설정하세요. 공개 쇼츠 검색 키는 위의 YouTube Data API v3 등록에서 관리해요." },
      { title: "채널 업로드 권한 확인", detail: "업로드에는 별도의 OAuth 웹 애플리케이션 클라이언트와 채널 승인이 필요해요.", values: ["https://www.googleapis.com/auth/youtube.upload"] },
      { title: "채널 연결 준비", detail: "내 채널 업로드용 콜백 주소와 계정 연결은 준비 중이에요." },
    ],
  },
  {
    name: "Google Drive",
    purpose: "프로젝트 파일과 저장소 연결",
    href: "https://developers.google.com/workspace/drive/api/guides/api-specific-auth",
    steps: [
      { title: "Google Drive API 설정", detail: "Google Cloud에서 Drive API를 사용 설정하고 OAuth 웹 애플리케이션 클라이언트를 준비하세요." },
      { title: "파일 접근 권한 확인", detail: "앱에서 만들거나 사용자가 앱으로 연 파일에 접근하는 범위입니다.", values: ["https://www.googleapis.com/auth/drive.file"] },
      { title: "저장소 연결 준비", detail: "Drive용 콜백 주소와 계정 연결은 준비 중이에요." },
    ],
  },
];

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

export function AdminPlatformGuides() {
  return <div className={styles.guideList}>
    {guides.map(({ name, purpose, href, steps }, index) => <details className={styles.guide} key={name} open={index === 0}>
      <summary className={styles.guideSummary}>
        <span><strong>{name}</strong><span className={styles.guidePurpose}>{purpose}</span></span>
        <span className={styles.guideStatus}>계정 연결 준비 중</span>
      </summary>
      <div className={styles.guideBody}>
        <ol className={styles.guideSteps}>
          {steps.map(({ title, detail, values }) => <li key={title}>
            <strong>{title}</strong>
            <p>{detail}</p>
            {values?.map(value => <CopyValue key={value} value={value} />)}
          </li>)}
        </ol>
        <a className={styles.setupLink} href={href} target="_blank" rel="noreferrer">{name} 설정 가이드</a>
      </div>
    </details>)}
  </div>;
}
