# T369 공개 홈 게시·철회 기능 검수

Front 후보 `8508349`를 별도 작업본에서 검수했다. 관리자 게시 HTTP 처리기와 홈 페이지 서버 렌더링, 표지 GET·HEAD 라우트를 합성 작품 하나로 연결했다. 테스트에서 공개 읽기 공급원을 주입했다.

| 전환 | 홈과 표지 결과 |
|---|---|
| 게시 준비 | 홈 HTML에 작품 표지 경로가 없고 GET·HEAD 모두 404 |
| 게시 확정 | 홈 HTML에 1세대 표지 경로 표시. GET 200 및 바이트 일치, HEAD 200 및 빈 본문 |
| 철회 | 다음 홈 렌더에서 작품 표지 경로 제거. 기존 GET·HEAD 모두 404 |
| 재게시·권리 만료 | 홈에 4세대 표지 표시, 기존 1세대 404. 만료 후 4세대도 홈에서 제거되고 GET·HEAD 모두 404 |

후보 회귀 실행 `node node_modules/vitest/vitest.mjs run tests/public-showcase tests/t241-public-home-route.test.ts` 결과 10개 파일 113건 통과. 격리 작업본 D:/starwork/t369-independent에서 추가한 렌더링 시험 `node node_modules/vitest/vitest.mjs run tests/public-showcase/t369-independent.test.ts -t "reflects committed"` 1건 통과. 서버 렌더 기준이며 브라우저에서 확인하는 화면 폭별 검수는 별도다.

T368 기준 `c6c49c5`의 기존 독립 검수 기록과 대조하고 공용 저장소에서 `node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs`를 재실행했다. 소유 PG17에서 중복·응답 유실, 소유권·검증 철회, 정책 변경 순서 및 전체 롤백 검증을 통과했고 프로세스·리스너·임시 클러스터 정리를 확인했다.

> Master 전달문 — T368 핵심 PG17 시험 재통과. T369 게시·철회가 격리 홈 HTML과 표지 라우트에 반영됐습니다. 후보 기본값은 소개 작품 6개이며 운영 실제 작품 전환에는 공개 DB·표지 저장소 연결 및 활성화가 남았습니다.
