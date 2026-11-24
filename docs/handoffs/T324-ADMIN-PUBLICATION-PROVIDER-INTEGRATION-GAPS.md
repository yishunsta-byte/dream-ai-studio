# T324 관리자 게시에서 공개 홈까지의 연결 공백

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_2c56c17bc3bc` · 소스 기준 `0cd4b61`

관리자 게시 화면과 공개 홈은 구현되어 있다. 일반 앱 실행에서 관리자 게시 저장소와 공개 조회 공급원의 초기화가 비어 있어, 관리자가 승인한 완성본을 방문자에게 노출하는 연결이 열리지 않는다. 두 진입점에 같은 게시 DB를 바라보는 서버 조립을 추가하는 것이 다음 최소 구현 범위다.

## 비어 있는 진입점과 필요한 입력

| 진입점 | 현재 동작 | 연결에 필요한 입력 |
| --- | --- | --- |
| `/admin`과 `/api/admin/publications` | 양쪽 모두 `createAdminPublicationHttp()`의 기본 `store`를 사용한다. `productionPublicationStore()`는 `null`을 반환한다. 목록은 `closed`, 인증·출처 검사를 통과한 쓰기는 `503 PUBLICATION_UNLINKED`로 끝난다. | 요청에서 서버가 확인한 운영자 UUID와 현재 게시 권한·작품 소유권을 검증하는 `AdminPublicationStore`. 저장소에는 공통 DB의 제한된 쓰기 자격, 권리 증빙, 소유자 범위 비공개 표지 읽기가 필요하다. 요청별 인증은 현재 `resolveServerAuth` 경로를 유지한다. [HTTP 조립](../../lib/public-showcase/admin-publication-http.ts) · [저장소 계약](../../lib/public-showcase/admin-publication-service.ts) |
| 공개 홈 `/`과 공개 표지 `/media/public/<slug>/<generation>/cover.webp` | 두 라우트가 같은 `publicationShowcaseConnection`을 기다리지만 export가 `createPublicationShowcaseConnection()`을 인자 없이 호출한다. 그 결과 홈은 예시 모드, 표지는 비활성 상태로 `404`를 반환한다. | 같은 게시 DB에서 목록과 표지의 제한 역할을 확인하는 `openVerifiedReaders`. 두 저장소가 `listApproved`, `findCover`, `readObject`, `confirmCover`를 함께 제공해야 한다. `readObject`에는 승인된 키에 한정한 비공개 표지 읽기와 바이트 제한·취소가 필요하다. [공개 조립](../../lib/public-showcase/publication-showcase-connection.ts) · [홈](../../app/(public)/page.tsx) · [표지 경로](../../app/media/public/%5Bslug%5D/%5Bgeneration%5D/%5Bfile%5D/route.ts) |

## 기존 시험에서 재사용할 동작

- **T293**은 운영자별 제한 로그인에서 소유자·작품·리비전을 확인하고, 요청 UUID 원장과 감사·게시 쓰기를 같은 트랜잭션에 묶는다. 시험 어댑터의 명령은 `t293.apply_t253`이며 원래 공개 읽기에는 시한부 권리 만료가 반영되지 않는다. **T295**는 `t295.apply`와 `t295.list_approved()`·`t295.find_cover(slug, generation)`로 현재 공개 세대와 권리 증빙을 함께 평가한다. T306은 T293의 트랜잭션 구조 위에서 `t295.apply`를 호출하고, 준비 manifest·활성 세대의 권리 참조 및 만료 시각·DB 승인 시각과 서비스 결과가 맞지 않으면 롤백한다. [T293 어댑터](../../tests/public-showcase/t293-admin-publication-adapter.ts) · [T295 SQL](../../tests/public-showcase/t295-publication-rights.sql) · [T306 저장소](../../tests/admin/t306-publication-e2e-store.ts)
- **T304**는 홈과 표지를 한 번에 조립하는 계약을 제공한다. 현재 리더 `openIsolatedPublicationPublicReader()`의 입력은 `profile: "t295-loopback-fixture"`, DB 이름·포트, 목록·표지 역할별 암호, 시간 제한과 `readPrivateCover`다. `127.0.0.1`의 지정된 시험 DB와 PG 17.12를 확인하며 TLS가 꺼진 시험 연결만 사용한다. **T306/T308** 격리 사본은 `t306Auth`(합성 쿠키), `t306AdminStore`(A/B 로그인), `t306OpenReaders`(같은 DB와 합성 표지 바이트)를 넣어 세 진입점을 채웠다. 실제 앱에서는 인증을 현재 경로에 두고 두 공급원만 조립한다. [공개 리더](../../lib/public-showcase/publication-public-reader.ts) · [T306 주입](../../tests/admin/t306-publication-e2e-inject.ts) · [T308 보고서](T308-PUBLICATION-PRODUCTION-HYDRATION-CHECK.md)

## 로컬에서 구현하고 닫을 수 있는 단위

1. 공통 게시 DB를 지정하는 서버 조립에서 관리자 쓰기 자격과 목록·표지 읽기 자격을 각각 연다. 현재 관리자 HTTP 호출 계약과 T304의 두 읽기 계약을 재사용한다. 제품 진입점으로 연결한 뒤 격리 PG17과 합성 권리·표지로 검증할 수 있게 입력 경계를 둔다. 권리 만료가 포함된 T295/T306 동작을 기준으로 삼고, 로컬 시험 프로필과 배포 자격은 구분한다. 초기화 실패 시 관리자는 미연결로 닫히며 공개 목록·표지는 함께 비활성화된다. 연결된 목록의 읽기 장애는 기존 오류 안내를 사용한다.
2. 준비 단계에는 홈에 작품이 없고 표지 GET·HEAD가 `404`여야 한다. 게시 커밋 뒤 다음 읽기에서 홈과 표지가 같은 작품·세대를 노출해야 한다. 표지는 정규 키와 실제 바이트의 길이·SHA-256·WebP를 검사하고 응답 직전 동일 권리와 세대를 재확인한다. 철회 커밋 또는 권리 만료 뒤에는 새 홈 목록에서 사라지고 기존 세대 표지 GET·HEAD는 `404`여야 한다. 표지 읽기 중에 철회·만료가 일어난 경우에도 최종 확인에서 공개가 차단되어야 한다. 재승인 시에는 이전 세대 표지가 계속 거절되어야 한다. [목록·표지 권리 조건](../../tests/public-showcase/t295-publication-rights.sql) · [표지 응답 확인](../../lib/public-showcase/cover-source.ts)
3. 게시 요청 재전송은 현재 권한을 다시 검사하고 같은 UUID의 기존 결과를 돌려준다. 원장, 감사, 공개 세대가 중복 생성되지 않아야 한다. 앱·DB 권리 상태가 어긋나거나 트랜잭션이 실패하면 관리자와 공개 조회 모두 커밋 이전 상태를 봐야 한다. 소유자 A/B와 목록·표지 전용 역할을 사용해 타인 작품 및 역할 교차 접근 거절을 확인한다. [T306 시나리오](../../tests/admin/t306-publication-e2e-scenarios.ts)

## 실제 서비스 연결에 필요한 결정과 검증

- **세션·DB·권리.** 운영자 세션 UUID를 게시 권한과 소유권에 연결하는 규칙, 신뢰 서버에만 배정할 제한 자격, 목록·표지 역할이 동일 DB를 조회한다는 시작 검사, 승인된 SQL 적용 위치·TLS 검증이 필요하다. 실제 완성본과 공개 동의·만료 증빙을 연결할 공급원 및 증빙 갱신 경로도 정해야 한다.
- **스토리지·공개 범위.** 게시 증빙의 표지를 승인된 비공개 버킷의 동일 객체에 연결하고 제한 자격으로 읽을 수 있어야 한다. 실제 이미지·음악·영상 상세·재생은 별도의 공개 전달 경로와 권리·철회 검증이 필요하다. 현재 추적한 공개 바이너리 경로는 WebP 표지다.
- **배포 검증.** 실제 호스트에서 정상 운영자 세션, 게시 API의 출처·본문 수신 제한, 새 공개 홈과 표지 GET·HEAD, 철회·만료 후 캐시 및 브라우저 뒤로가기 동작을 확인한다. [최초 개발계획의 게시·공개 작업](../MASTER_DEVELOPMENT_PLAN.md)

## 기준 대비 검증

T308에서 사용한 `f1f0a28`과 현재 `0cd4b61`을 비교했다. 위 관리자·공개 진입점, 공급원과 해당 시험 경로에서 소스 변경이 없었다. 게시 큐·HTTP·서비스·공개 목록·표지·홈 탐색의 기존 Vitest 회귀 13개 파일, 183건이 모두 통과했다. 브라우저와 PG17 종단 결과는 T306/T308의 기존 격리 보고서를 근거로 삼았다. 이번 산출물은 이 문서이며 운영 연결과 배포 상태는 검증 범위 밖이다.
