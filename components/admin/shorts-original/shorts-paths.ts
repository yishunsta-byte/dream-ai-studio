// P1-08 원본 Shorts Viral Studio v2.01 전용 화면의 경로·이름·단계 목록.
// 서버 페이지(app/admin/shorts-analysis)와 클라이언트 셸이 함께 쓰므로 지시어 없는 모듈에 둔다
// ("use client" 모듈의 값은 서버에서 클라이언트 참조가 되어 href·redirect에 쓰면 깨진다. P1-06 33ff5a0 참고).
// 단계 이름·설명은 원본 src/components/layout/Sidebar.tsx FLOW_STEPS, 앱 이름·버전은 src/lib/version.ts를 그대로 옮겼다.
export const shortsAnalysisPath = "/admin/shorts-analysis";

export const SHORTS_APP = {
  line1: "AI 쇼츠 떡상 분석",
  line2: "대본 자동화",
  full: "AI 쇼츠 떡상 분석 및 대본 자동화",
  version: "v2.01",
} as const;

/** 원본 6단계(①검색 ②구조 해체 ③소재 ④주제·전략 ⑤대본 ⑥9:16 프롬프트). */
export const SHORTS_FLOW = [
  { step: 1, id: "search", icon: "🔎", label: "쇼츠 떡상 검색", desc: "VPH & 대박 영상 탐지" },
  { step: 2, id: "analyze", icon: "🧬", label: "바이럴 구조 해체", desc: "첫 3초 훅 & 락인 공식" },
  { step: 3, id: "ideate", icon: "💡", label: "킬러 소재 발굴", desc: "새 소재 6종 제안" },
  { step: 4, id: "select", icon: "🎯", label: "주제·전략 확정", desc: "타겟 시청층 & 훅 선택" },
  { step: 5, id: "script", icon: "📝", label: "15·30·60s 대본", desc: "씬별 1문장 원칙 나레이션" },
  { step: 6, id: "prompts", icon: "🎨", label: "9:16 비주얼 프롬프트", desc: "미드저니 & 영상 NLE 직결" },
] as const;

export type ShortsStepId = (typeof SHORTS_FLOW)[number]["id"];
/** 화면 하나: 홈, 6단계, 프롬프트 보관함. */
export type ShortsView = "home" | ShortsStepId | "vault";

export const SHORTS_VIEWS: readonly ShortsView[] = ["home", ...SHORTS_FLOW.map(item => item.id), "vault"];
export const isShortsView = (value: string): value is ShortsView => (SHORTS_VIEWS as readonly string[]).includes(value);

/** 관리자 허브의 설정·매뉴얼 위치(전용 화면은 다른 주소라 해시만으로는 열리지 않는다). */
export const SHORTS_SETTINGS_HREF = "/admin#admin-api-integrations";
export const SHORTS_GUIDE_HREF = "/admin#admin-manual";
