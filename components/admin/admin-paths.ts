// P1-06: 관리 화면 경로 상수. 서버 컴포넌트(admin-hub.tsx)와 클라이언트 컴포넌트(admin-navigation.tsx 등)가 함께 쓴다.
// "use client" 모듈에서 내보낸 값은 서버에서 클라이언트 참조(함수)로 바뀌어 href에 넣으면 깨지므로, 지시어 없는 이 모듈에 둔다.
/** 원본 Style DNA v1.39 전체 화면(관리자 보호 경로). */
export const styleDnaPath = "/admin/style-dna";
/** 기존 이미지 분석 결과 공개 준비(ImageWorkspace·onPrepare) 칸. '완성본 검수·게시'의 링크로만 연다. */
export const imageShareSection = "admin-image-publication";
/** 관리자 운영 현황 홈(2안, Master msg_d8399b51662f). /admin 기본 칸이자 '콘텐츠 분석기' 메뉴의 목적지. 기존 #admin-analysis-results(공개 준비·게시·철회)와 분리한다. */
export const homeSectionId = "admin-home";
/** 완성본 검수·게시 칸. */
export const reviewSectionId = "admin-review";
export const apiPlatformLabel = "API키등록·플랫폼연동";
