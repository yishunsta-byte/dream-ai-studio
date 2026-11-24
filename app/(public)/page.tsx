// T-241 공개 메인("/"). 방문자에게 공개 작품 화면을 보여 준다.
// T-255: 요청마다 서버에서 목록 상태를 새로 정한다(캐시 없음).
//   예시 모드·정상 0건 → 예시 6개, 정상 승인 목록 → 승인 작품만, 공급원 장애·계약 오류 → 장애 안내(로그인 링크 유지).
// T-255-F2/F3: 모든 상태에 문서 인라인 철회 가드를 둔다. 승인 작품은 HTML hidden으로 시작해 가드가 설치된 문서에서만 드러나고,
//   가드가 없으면(스크립트 꺼짐·CSP 차단+번들 실패) 승인 작품 대신 안내와 로그인 탐색만 보인다(showcase-guard.tsx).
// 개인 프로젝트·DB 직접 조회·저장 파일·로그인 사용자 정보를 읽지 않는다.
import type { Metadata } from "next";
import { NeonShowcase } from "@/components/public-showcase/neon-showcase";
import { ShowcaseGated, ShowcaseGuard, ShowcaseScriptFallback } from "@/components/public-showcase/showcase-guard";
import { getPublicationPublicReaders } from "@/lib/public-showcase/publication-runtime";
import { loadShowcaseFeed } from "@/lib/public-showcase/showcase-feed";

export const metadata: Metadata = {
  title: "DREAM SCREEN",
  description: "영상부터 음악까지, 크리에이터의 공개 작품을 둘러보세요.",
};

export const dynamic = "force-dynamic";

const LOGIN_HREF = "/login?next=%2Fstudio";

// 화면 준비 전 첫 필터 클릭은 GET ?kind=<종류>로 들어온다. 값 확인은 화면(NeonShowcase)이 정해진 종류만 받는다.
// Next는 페이지에 props를 항상 넘긴다. 기본값(= {})을 두면 생성되는 PageProps 타입 검사가 실패한다.
export default async function PublicHomePage(props: { searchParams?: Promise<{ kind?: string | string[] }> }) {
  const kind = (await props.searchParams)?.kind;
  const { showcaseSource } = await getPublicationPublicReaders();
  const feed = await loadShowcaseFeed(showcaseSource);
  if (feed.state === "unavailable") return <><ShowcaseGuard /><NeonShowcase works={feed.works} status="error" loginHref={LOGIN_HREF} requestedFilter={kind} /></>;
  if (feed.state !== "published") return <><ShowcaseGuard /><NeonShowcase works={feed.works} loginHref={LOGIN_HREF} requestedFilter={kind} /></>;
  return (
    <>
      <ShowcaseGuard />
      <ShowcaseScriptFallback loginHref={LOGIN_HREF} />
      <ShowcaseGated><NeonShowcase works={feed.works} loginHref={LOGIN_HREF} requestedFilter={kind} /></ShowcaseGated>
    </>
  );
}
