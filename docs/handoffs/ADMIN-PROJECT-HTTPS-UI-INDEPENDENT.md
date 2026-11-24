# 관리자 내 프로젝트 HTTPS 조회 화면 독립 검수

2026년 11월 20일 · Design · Master 배정 `msg_391251a7155c` · 후보 `b8152706bbd45ab266b13ad81dda4e9d213fe443`.

후보의 `AdminHub`, `AdminNavigation`, `AdminProjectsSection`, `AdminProjectConsole`, 관리자 CSS를 Git 아카이브에서 추출하고 각 파일 해시가 후보와 일치하는지 확인했다. Chromium에 후보 UI와 CSS를 그렸으며 네 가지 조회 상태와 두 프로젝트는 합성 입력이다. `next/link`는 같은 `href`가 있는 앵커로 대체했다. 재조회는 후보 화면의 실제 앵커를 사용해 루프백 서버에 새 문서를 요청했다. 실제 조회 연결은 Backend의 Next·PostgREST·PG17 시험 범위다. [Backend 통합 검수](ADMIN-PROJECT-HTTPS-IMPLEMENTATION.md)

| 검수 항목 | 390px·1440px 결과 |
|---|---|
| 미연결 | 미연결 표시, 조회 시각과 재조회 없음, Space로 도움말을 펼친 후 초점 유지 |
| 정상 0건 | 계정 기준 0건과 조회 시각 표시, 재조회 1개, 전체 목록 링크 확인 |
| 정상 목록 | 항목 2개와 조회 시각, 이름 검색, 상태 조건에 맞는 결과 없음 안내, 상세 링크와 전체 목록 링크 확인 |
| 오류·재조회 | 오류 안내와 재조회 1개, 조회 시각 없음. Enter로 새 문서 요청 후 정상 목록 표시, 새 재조회 주소 생성, 상단 메뉴 아래에 보이는 프로젝트 콘솔 제목으로 초점 이동 |
| 기존 상단 메뉴 | 여섯 항목의 대상·선택 표시·제목 초점, 개요의 클라우드 관리 및 프로젝트 링크, 공개 결과 및 비밀번호 변경 링크 확인 |
| 반응형 | 네 상태 및 메뉴 이동에서 가로 넘침 0 |

- 실행: `node D:/starwork/design-analysis-check/serve-admin-projects.mjs`와 `ego-browser nodejs -e "await import('file:///D:/starwork/design-analysis-check/check-admin-projects.mjs')"`.
- 검수 근거: `D:/starwork/design-analysis-check/admin-project-b815270-ui-evidence.json` 및 `D:/starwork/design-analysis-check/admin-project-fixture-requests.ndjson`. 루프백 로그에서 폭마다 재조회 문서 GET을 1건씩 확인했다.
- 공유 작업본의 `tests/t283-admin-overview-projects.test.ts`, `tests/postgres/t356-project-https-read-app.test.ts`는 20건 통과했다. 이 실행은 위 고정 후보 브라우저 확인과 별도다.
- 운영 연결, 관리자 인증 후 권한별 실제 프로젝트, 분석 422는 이번 검수 범위 밖이다. 제품 코드·DB·운영 변경 없음.

**Master 전달문** · `b815270` 관리자 내 프로젝트의 390·1440px 독립 UI 검수를 통과했습니다. 합성 네 상태와 후보 UI를 사용했고 재조회는 새 문서 요청 및 제목 초점까지 확인했습니다. 기존 상단 메뉴 여섯 개와 링크, 가로 넘침 0을 확인했습니다. 운영 DB·조회 스키마·승인 실계정 연결은 별도 검증이 남았습니다.
