import Link from "next/link";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { Icon, type IconName } from "@/components/ui/Icon";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Card, StatusPill } from "@/components/ui/primitives";
import { AdminIntegrationCredentials } from "./admin-integration-credentials";
import { apiPlatformLabel } from "./admin-paths";
import { AdminPlatformGuides, AdminSettingsShortcuts, BackToAnalysisKeys } from "./admin-platform-guides";
import { YouTubeSettingsCard } from "./admin-youtube-settings";
import admin from "./admin.module.css";
import styles from "./admin-platform-integrations.module.css";

const analyzers = [
  { id: "admin-style-dna", name: "이미지 분석", icon: "flask", services: "Gemini · OpenAI · Claude",
    usage: "선택한 엔진으로 스타일을 분석하고 보정해요. 분석기 안의 시험 이미지는 Gemini로 생성해요." },
  { id: "admin-music-analysis", name: "음악 분석", icon: "clock", services: "Gemini",
    usage: "음악·음성 분석과 Suno용 프롬프트 작성에 사용해요. 음악 전용 키를 등록하세요." },
  { id: "admin-shorts-analysis", name: "쇼츠 분석", icon: "play", services: "Gemini · YouTube Data API",
    usage: "Gemini는 영상 분석과 제작 초안에, YouTube Data API는 공개 쇼츠와 공개 지표 조회에 사용해요." },
] as const satisfies readonly { id: string; name: string; icon: IconName; services: string; usage: string }[];

const platformGroups = [
  { name: "이미지 생성", status: "done", label: "시험 이미지 생성",
    use: "Gemini 키를 등록하고 이미지 분석기의 결과 테스트에서 Nano Banana 모델을 선택하세요. OpenAI GPT Image는 제작 연결 후보예요." },
  { name: "음악 생성", status: "approval", label: "제작 연결 준비 중",
    use: "Google Lyria로 음원 파일을 생성하는 연결을 준비 중이에요. 현재는 원본 오디오 분석기가 만든 Suno용 프롬프트를 사용할 수 있어요." },
  { name: "영상 생성", status: "approval", label: "제작 연결 준비 중",
    use: "Google Gemini Omni와 Veo는 영상 생성 후보예요. 완성한 파일은 프로젝트에서 함께 관리하는 흐름으로 연결할 예정이에요." },
  { name: "Suno · Udio", status: "approval", label: "프롬프트 사용",
    use: "음악 또는 쇼츠 분석에서 만든 프롬프트를 복사해 각 플랫폼에 붙여넣으세요." },
  { name: "Kling · Runway · Luma", status: "approval", label: "프롬프트 사용",
    use: "쇼츠 연출과 장면 프롬프트를 복사해 영상 생성 플랫폼에 붙여넣으세요." },
] as const;

export function AdminIntegrationSettings() {
  return <div className={styles.vault}>
    <AdminSettingsShortcuts />
    <section className={styles.vaultSection} aria-labelledby="image-engine-title">
      <div className={styles.sectionHeader}>
        <div><h3 id="image-engine-title">AI 분석 엔진</h3><p>OpenAI·Claude·Gemini 중 선택해 키와 최신 모델을 등록하세요.</p></div>
      </div>
      <AdminIntegrationCredentials />
      <ul className={styles.analyzerGrid}>
        {analyzers.map(({ id, name, icon, services, usage }) => <li key={id}>
          <Card className={styles.analyzer}>
            <span className={styles.icon}><Icon name={icon} /></span>
            <h4>{name}</h4>
            <p className={styles.service}>{services}</p>
            <p>{usage}</p>
            <a href={id === "admin-style-dna" ? "/admin/style-dna" : `/admin#${id}`}>{name} 열기 <Icon name="arrow" /></a>
          </Card>
        </li>)}
      </ul>
    </section>

    <section className={styles.vaultSection} aria-labelledby="production-platforms-title">
      <div className={styles.sectionHeader}>
        <div><h3 id="production-platforms-title">이미지·음악·영상 생성 API</h3><p>제작 도구와 현재 사용할 수 있는 동작을 확인하세요.</p></div>
      </div>
      <ul className={styles.platforms}>
        {platformGroups.map(({ name, status, label, use }) => <li key={name}>
          <div><h4>{name}</h4><p>{use}</p></div>
          <StatusPill status={status}>{label}</StatusPill>
        </li>)}
      </ul>
    </section>

    <section className={styles.vaultSection} aria-labelledby="youtube-data-title">
      <div className={styles.sectionHeader}>
        <div><h3 id="youtube-data-title">YouTube Data API v3 등록</h3><p>공개 쇼츠 검색과 채널·조회수 데이터에 사용해요.</p></div>
        <a className={styles.setupLink} href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">Google 키 발급</a>
      </div>
      <YouTubeSettingsCard />
    </section>

    <section className={styles.vaultSection} aria-labelledby="publishing-platforms-title">
      <div className={styles.sectionHeader}>
        <div><h3 id="publishing-platforms-title">내 채널 및 저장소 연동 방법</h3><p>플랫폼을 고르면 연결에 필요한 항목과 설정 순서, 필요한 권한을 볼 수 있어요.</p></div>
      </div>
      <AdminPlatformGuides />
      <BackToAnalysisKeys />
    </section>
  </div>;
}

export function AdminPlatformIntegrations({ email }: { email: string }) {
  return <SessionBoundary account={email}>
    <div className={admin.console}>
      <header className={admin.header}>
        <Link className={admin.brand} href="/admin" prefetch={false}>
          <BrandLogo markSize={30} />
          <span className={admin.brandScope}>운영 관리자</span>
        </Link>
        <AccountMenu email={email} />
      </header>
      <main id="main-content" className="content">
        <ProtectedContent>
          <div className={styles.page}>
            <header className={styles.pageHeading}>
              <a className={styles.back} href="/admin#admin-api-integrations">관리자 메뉴로 돌아가기</a>
              <h1>{apiPlatformLabel}</h1>
            </header>
            <AdminIntegrationSettings />
          </div>
        </ProtectedContent>
      </main>
    </div>
  </SessionBoundary>;
}
