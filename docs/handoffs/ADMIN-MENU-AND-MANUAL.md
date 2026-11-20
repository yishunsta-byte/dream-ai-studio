# 관리자 메뉴와 사용매뉴얼

기준은 운영 원격 `2e5b9b7`이다. `관리 화면` 제목 아래에 이미지·음악·쇼츠 분석을 배치하고 각 분석기의 입력과 결과를 짧게 설명했다. 메뉴·작업 화면·공개 초안에 표시되는 이미지 분석 명칭을 통일했다. `#admin-style-dna`와 구 통합 분석 주소는 이미지 분석으로 연결된다.

상단의 `계정설정 및 API 연동`에서 비밀번호 변경과 세 분석기의 서버 설정을 확인한다. 기존 `#admin-api-integrations`와 분석기의 API연동 링크는 통합 화면의 API 영역으로 직접 이동한다. `운영 연결 범위`는 상단 메뉴에서 열고 분석 화면에는 노출하지 않는다.

상단 맨 오른쪽의 `사용매뉴얼`에서 분석 순서, Gemini 및 Vercel 설정, YouTube·Suno 사용법, 분석 결과 공개와 철회를 안내한다. 관리자 화면에 표시되는 사용법은 `components/admin/admin-manual.tsx`에서 함께 관리한다. 배포 서버 키와 모델 ID의 값은 화면에 표시되지 않는다. 저장소 매뉴얼과 이미지 URL 입력 기능은 Front가 맡는다.

## 자체 검수

- `node node_modules/vitest/vitest.mjs run tests/t243-admin-login.test.ts tests/api-auth.test.ts tests/admin tests/reference-analysis --maxWorkers=1` 통과. 17개 파일, 317개 테스트.
- 변경 파일 ESLint, `next build --webpack`, `node scripts/verify-build.mjs` 통과.
- `tests/admin/admin-premiere-publication.ego.mjs`에서 390·1440px 및 글자 확대 320·1280px로 위치, 키보드 이동, 기존 링크, 로그인 복귀 주소, 설정 응답, 결과 공개·철회를 확인했다. 화면 테스트는 로컬 모의 API를 사용했다. 증거 파일은 `D:/starwork/design-analysis-check/admin-menu-manual-final`에 있다.

Master에게 전달할 내용. 관리자 메뉴·사용매뉴얼 통합 후보를 준비했다. 기존 해시와 로그인 복귀 주소를 포함해 변경 사항을 검수한다. 운영 쓰기 없이 검증했으며, Front의 문서 및 이미지 URL 입력 후보와 통합한 뒤 보호 Preview에서 동일 위치와 명칭을 확인한다.

## 운영 `705fb6e` 후속

사용자 지시로 `콘텐츠 분석기`를 첫 관리자 메뉴로 배치했다. 이 메뉴에서 기존 분석 결과 목록을 열고, 결과 화면과 이미지·음악·쇼츠 분석 화면 안에서만 분석기 카드가 표시된다. 기존 관리자 주소와 공개·철회 흐름을 유지한다. 공통 상단의 `관리 화면`은 화면 판독기용 제목으로 유지하고 화면에 표시되던 제목과 여백을 제거했다.
