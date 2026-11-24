# 공개 재생·운영 조회·콘텐츠 URL 분석 결과

2026-11-19 KST · Master 통합 보고

| 작업 | 기준과 검증 결과 | 운영 상태 |
|---|---|---|
| T369 공개 홈 | `8508349` 기능 독립 검수에서 게시·철회·재게시·만료에 맞춰 홈과 표지가 바뀌었다. Chromium 1280·390·320px에서 카드·표지 6개, 음악 필터, 상세 닫기 후 초점 복귀를 확인했다. 처음 개발 서버에서 필터 클릭 1회가 반영되지 않아 준비 후 재시험했다. | 운영 홈 GET 200 및 소개 작품 제목 6개를 확인했다. |
| T370 영상·음악 | `review/t370-playback-20261119`의 `8918cde`. 비공개 파일 버전을 고정한 구간 읽기, 권리 재확인, 게시 증빙·PG17 v3 선택 설치를 연결했다. 6,751,180바이트 영상 전체의 해시 일치와 MP4/M4A 탐색을 확인했다. 최종 SHA 독립 검수에서 첫 바이트 전 철회는 404, 전송 중 철회는 200·206 모두 262,144바이트 뒤 본문 읽기 오류, 같은 세대의 후속 요청은 404/no-store였다. 이미 받은 분량은 재생될 수 있다. | 운영 버킷의 버전 보장, 실작품 권리, Vercel 전송 시간·비용, 모바일 실기기 확인이 남았다. 스트리밍 응답에는 Vercel 일반 응답의 4.5 MB 제한이 적용되지 않는다. |
| T362 관리자 | 운영 Supabase Data API가 `project_read` 목록 조회(limit=0)에 HTTP 406/PGRST106을 반환했다. 노출 목록은 `public`, `graphql_public`이다. 이번 요청에서 읽은 프로젝트 행은 없다. | `project_read`의 DB 내부 설치와 실효 권한은 제한 카탈로그 조회가 필요하다. 전담자에게 인계했다. 게시 관리에는 별도의 PostgreSQL 역할과 비공개 저장소가 필요하며 운영 쓰기 연결은 미확인이다. |
| URL 분석 | `1ae0e2e` 로컬 작업실에 사용권을 확인한 공개 직접 파일 URL을 입력해 Chromium 결과 화면까지 확인했다. 이미지 17개 색상 제안, MP3 2채널 RMS 13%, MP4 첫 프레임 관찰과 프롬프트를 확인했다. 격리 등록 후 제품 POST를 통한 3종 검증도 별도로 통과했다. | 운영 비로그인 `/cloud/reference-analysis`는 로그인으로 307, API는 401이다. 기존 운영 기준 `3c57eff`에는 분석 페이지가 없고 개발 클라우드 화면은 비활성 셸이다. 서버 분석 공급원과 보호된 결과 전달이 연결돼야 운영 분석을 배포할 수 있다. |

## 고정 사본 검증

- 재생 후보 `8918cde`의 표준 빌드와 산출물 검사를 통과했다. Vitest는 151개 파일, 2,895건 통과, 387건 건너뜀이다. 별도 PG17 게시 설치 시험도 통과했다. Tester가 같은 SHA에서 철회 차단을 확인했다(msg_3990ea86ae2d). 최초 사본의 Node 등록 파일 누락과 타입 호환 문제를 수정하고 임시 디렉터리를 준비해 다시 검증했다.
- 분석 후보 `1ae0e2e`의 독립 사본에서 프로젝트 기본 빌드(Next 16.4.6 Turbopack 및 verify-build)를 통과했다. 별도 Webpack 실험에서는 기존 프로젝트 GET의 생성 타입 검사가 실패했다. 로컬 URL 폼·등록 HTTP 등 관련 시험 38개가 통과했다.
- 재생 후보는 로컬 통합 기준 `6164808`에서 분기했다. 검수 SHA 뒤 브랜치의 `668dcdb`에서는 시험 파일 서식만 정리했다. 운영 후보 `8508349`에는 아직 병합하지 않았다. 운영 푸시·배포·DB 변경은 없었다.

## 재현 근거

- [T369 기능 검수](T369-HOME-PUBLICATION-FUNCTIONAL-REVIEW.md) · [화면 폭별 검수](T369-R-PUBLIC-HOME-SCREEN-REVIEW.md)
- [재생 HTTP·화면 실측](T370-PUBLIC-PLAYBACK-HTTP-VERIFICATION.md) · [철회 독립 검수](T370-R-PLAYBACK-REVOCATION-REVIEW.md) · [PG17 게시 검증](T370-PLAYBACK-PUBLICATION-PG17.md) · [Vercel 함수 제한](https://vercel.com/docs/functions/limitations#request-body-size)
- [Supabase 운영 Data API](T362-DATA-API-LIVE-READ.md) · [운영 DB 카탈로그 접근 상태](T362-CATALOG-ACCESS-STATUS.md)
- [콘텐츠 URL 분석 검증](REA-PUBLIC-URL-LOCAL-STUDIO.md)

> Master 전달문 — 공개 재생의 구현과 철회 독립 검수, 로컬 작업실의 실제 URL 3종 분석을 마쳤습니다. 기존 운영 홈은 소개 작품 6개입니다. 운영 프로젝트 조회는 project_read 미노출, 분석 운영 배포는 클라우드 공급원·보호된 결과 전달 미연결로 보류했습니다.
