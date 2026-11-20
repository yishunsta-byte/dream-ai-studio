// 분석 부품의 '설정이 필요해요' 안내에서 여는 설정 위치. 관리자 화면은 기본값(API연동 섹션)을 쓰고,
// 다른 화면(2안 작업실 등)은 자기 설정 주소를 넘기거나 null로 링크를 숨긴다.
export const ADMIN_SETTINGS_HREF = "#admin-api-integrations";
export type SettingsHref = string | null;

export function SettingsLink({ href, className }: { href: SettingsHref; className?: string }) {
  return href ? <a className={className} href={href}>API연동 보기</a> : null;
}
