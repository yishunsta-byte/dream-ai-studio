// T-241 공개 메인("/"). 방문자에게 공개 작품 화면을 보여 준다.
// 명시한 예시 자료(SAMPLE_WORKS)만 넘긴다. 개인 프로젝트·DB·저장 파일·로그인 사용자 정보를 읽지 않는다.
import type { Metadata } from "next";
import { NeonShowcase } from "@/components/public-showcase/neon-showcase";
import { SAMPLE_WORKS } from "@/lib/public-showcase/works";

export const metadata: Metadata = {
  description: "영상부터 음악까지, 크리에이터의 공개 작품을 둘러보세요.",
};

export default function PublicHomePage() {
  return <NeonShowcase works={SAMPLE_WORKS} loginHref="/login?next=%2Fstudio" />;
}
