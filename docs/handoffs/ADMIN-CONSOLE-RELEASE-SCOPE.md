# 관리자 작업 콘솔 운영 반영 범위

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_f11a24e44842`

운영 기준은 `origin/master`의 `3c57eff6724886d104faab1937059579647e5ffb`다. **관리자 화면과 미연결 표시를 반영할 때 필요한 제품 소스는 11개 경로다.** 고정 개발본 `ff4f9af`는 운영 기준보다 489커밋 앞서 있다. 아래 경로의 변경만 운영 기준 위에 조립한 뒤, 그 조합을 대상으로 빌드와 보호 환경 검수를 다시 진행한다. 이번 대조는 Git 객체와 기존 검수 기록을 읽어 수행했다.

## 제품 소스와 반영 순서

| 순서 | 소스 경로 | 반영할 내용과 선행 의존성 |
| --- | --- | --- |
| 1. 렌더 조회 서비스 | `lib/services/postgres/admin-render-queue.ts` | `83e42e8`. 검증 계정의 UUID로 본인 활성 프로젝트에 속한 `render-prepare`·`render`만 조회한다. 생성 시각과 ID 역순으로 최대 50건을 반환한다. 운영 기준에 있는 `withActorTransaction`의 읽기 전용 모드, `dream_api` 역할 전환과 행 정책을 사용한다. |
| 2. 인증 GET | `lib/services/postgres/admin-render-queue-http.ts`, `app/api/admin/render-queue/route.ts` | `ff0887d`. 기존 서버 인증 및 허용 이메일, 프로젝트 읽기 설정·풀을 재사용한다. Node 런타임의 동적 GET에 한정한다. 이 단계에서 루프백 격리 조건과 캐시 금지를 유지한다. |
| 3. 프로젝트 상세 제목 이동 | `components/cloud/admin-project-heading-focus.tsx`, `components/cloud/project-detail-readonly.tsx` | `0e373e7`. 기존 상세 화면에서 `#admin-project-heading`으로 진입할 때 제목을 표시하고 초점을 옮긴다. 운영 기준의 상세 라우트는 이미 이 읽기 전용 컴포넌트를 사용한다. |
| 4. 콘솔 및 메뉴 | `components/admin/admin-hub.tsx`, `components/admin/admin-navigation.tsx`, `components/admin/admin-projects.tsx`, `components/admin/admin-project-console.tsx`, `components/admin/admin.module.css` | `0e373e7`. 기본 프로젝트 탭, 이름·상태 검색, 상세 이동, 미연결·실패·빈 결과 구분을 반영한다. 상태 카드·도움말과 실제 요청을 보내는 재조회 링크에 `d939b59`·`8168b89`의 선행 변경을 포함한다. 미연결 부가 기능 6개의 접기·펼치기는 `3762939` 변경을 함께 포함한다. 세 선행 커밋은 이 행의 제품 경로에 해당하는 변경으로 한정한다. |
| 5. 렌더 대기열 메뉴 | `components/admin/admin-render-queue.tsx`와 4단계의 허브·메뉴·CSS | `ff4f9af`. 2단계 GET, 3단계 상세 링크, 4단계의 메뉴와 세션 표시 경계에 의존한다. 접속 실패 시 다시 조회할 수 있고, 연결된 격리 환경에서 본인 작업의 대기·진행 중·성공·실패·취소 상태를 표시한다. |

`ff4f9af`의 11개 제품 경로를 `3c57eff`에 대입해 직접 import를 대조했다. 기준 트리에 외부 로컬 참조 13개가 있고 미해결 경로는 0개였다. Next 16.4.6, React 19.3.1, Zod 4.6.7, pg 8.23.1, server-only 0.0.1과 lockfile이 기준본과 일치한다. 개발본에서 달라진 직접 의존성 두 곳은 기준본의 인터페이스로 충족한다.

- `components/ui/primitives.tsx`의 Button은 기존에도 `aria-disabled`와 이벤트를 전달한다. 개발본의 다른 화면에서 쓰는 `focusableWhenBlocked` 이전은 필요하지 않다. 처리 중의 시각 상태는 후보 브라우저에서 확인한다.
- `lib/cloud/project-read-page.ts`의 기존 목록 DTO와 읽기 전용 상세 DTO가 콘솔의 표시 필드를 제공한다. 개발본의 편집 리비전·타임라인 필드와 HTTPS 분기 이전은 별도 범위다. 작업 콘솔의 내용 버전과 출력 파일은 `확인 불가`를 유지한다.
- 기존 `app/admin/page.tsx`의 인증·세션 경계와 게시 큐 할당, 로그인·계정 관리, `/cloud/projects/[id]`의 소유자 판정, 프로젝트 읽기 풀·트랜잭션, 기반 SQL·역할 정의를 사용한다. 공급원 설정, `proxy.ts`, 공용 UI, 빌드 설정과 프로젝트 생성·렌더 실행·게시 API 변경은 별도 범위다.

## 운영 미연결 유지와 실제 연결 조건

| 구분 | 현재 코드가 지원하는 범위 | 운영 연결 판단에 필요한 근거 |
| --- | --- | --- |
| 관리자 프로젝트 목록·상세 | `loadAdminProjects`는 `DREAM_PROJECT_READ_BACKEND=postgres`에서만 기존 PostgreSQL 읽기를 호출한다. 현재 운영 미연결 구성을 그대로 반영하면 프로젝트 탭에 연결 안내가 표시된다. 이미 연결을 선택한 환경의 조회 실패와 성공한 0건은 별도 표시다. | 운영 DB의 실제 설정·역할·RLS 설치는 확인되지 않았다. PostgreSQL을 검토하려면 승인된 대상의 서버 전용 제한 로그인, TLS 검증, 제한 역할 및 허용 계정 A/B의 본인 목록·상세, 타인·보관 상세 404를 보호 환경에서 대조한다. |
| 프로젝트 HTTPS 읽기 | 개발본의 T356은 일반 프로젝트 GET과 클라우드 읽기의 선택형 `supabase-https`를 지원한다. 운영 기준과 이번 콘솔 범위에는 해당 연결이 들어 있지 않다. 관리자 `loadAdminProjects`도 현재 이 값을 선택하면 미연결로 표시한다. | T362 운영 읽기에서 HTTP 406/PGRST106 및 노출 스키마 `public`, `graphql_public`을 관측했다. `project_read`의 DB 내 설치, 실효 SELECT 권한과 행 격리는 미확인이다. 승인된 제한 카탈로그 조회와 T358의 노출·소유자 격리 검증을 거친 뒤 관리자 진입점 연결을 별도 후보에서 검수한다. [운영 Data API 관측](T362-DATA-API-LIVE-READ.md) · [제한 카탈로그 조회 경로](T362-CATALOG-ACCESS-STATUS.md) · [앱 HTTPS 연결](T356-PROJECT-HTTPS-READ-APP-INTEGRATION.md) |
| 관리자 렌더 대기열 | Vercel 또는 `NODE_ENV=production`에서는 허용 계정에서도 공급원 503을 반환한다. 지원하는 조회 환경은 루프백 요청과 루프백 `dream_test_*` DB를 쓰는 개발 실행이다. Supabase Auth 허용 계정, `DREAM_PROJECT_READ_BACKEND=postgres`, 서버용 PostgreSQL DSN, 풀의 TLS 인증서 검증이 필요하다. | 운영에서 렌더 목록을 연결하려면 조회 전용 공급원과 권한 경계를 별도로 구현하고 검증해야 한다. `project_read`의 프로젝트 뷰 설치나 노출을 확인해도 이 대기열의 운영 권한은 입증되지 않는다. [GET 연결 계약](ADMIN-RENDER-QUEUE-HTTP.md) |
| 완성본 검수·게시와 운영 도구 | 기존 게시 큐·계정 설정 진입을 사용한다. 렌더 취소·재시도, 자료 관리, 백업·복원, 운영 로그, 회원 관리, 서비스 상태는 운영 연결 안내로 표시된다. | 게시 저장소와 비공개 Storage 자격·역할, 게시·철회 검증은 기존의 별도 트랙이다. 프로젝트 읽기 또는 대기열 상태로 게시의 운영 가용성을 판정할 수 없다. [게시 진입 조건](T345-ADMIN-PUBLICATION-STAGING-ENTRY.md) |

격리 시험의 읽기 전용 트랜잭션과 테스트 로그인은 운영 런타임 권한의 근거와 구분한다. 운영 공급원을 추가로 검토할 때는 같은 대상에서 TLS와 인증 계정 매핑, 역할 상속·전환, 실제 조회 권한 및 쓰기 거절까지 확인한다.

## 빌드 및 후보 검수

1. 운영 기준에 11개 제품 경로와 관련 검사만 적용한다. `tests/api-auth.test.ts`의 보호 라우트 목록은 `admin/render-queue` 한 항목, `tests/t198-legacy-gate.test.ts`의 클라우드 메서드 목록은 같은 경로의 GET 한 항목을 반영한다. `tests/admin/admin-hub-information-architecture.test.ts`, `tests/t283-admin-overview-projects.test.ts`는 5개 메뉴·기본 탭·상태 카드·실제 재조회·상세 링크 기대값을 고정본과 대조한다.
2. 후보의 깨끗한 빌드에서 운영 기준의 lockfile과 Node 범위를 사용한다. `npm run typecheck`, 콘솔·관리자 로그인·비밀번호 재설정·인증 경계·기존 게시 큐 검사 및 `npm run build`를 실행한다. 빌드의 `scripts/verify-build.mjs`로 비공개 운영 파일·비밀 설정·렌더 실행 도구의 추적 제외와 화면 번들 서비스 키 부재를 확인한다.
3. 고정 개발본에서 통과한 실제 PG17 TLS 증거를 후보에서도 재현한다. `tests/postgres/admin-render-queue.pg17.mjs`는 T367과 T281 시험 실행기에 고정된 bootstrap을 사용한다. TLS 보조 파일과 두 관리자 브라우저 시험도 테스트에서만 사용한다. 운영 기준 위 재현에 필요한 시험 기반은 격리 환경에서 재사용하거나 동등한 시험으로 옮긴다. 테스트 실행기의 의존 파일을 운영 제품 변경에 합치지 않는다.
4. 390px·1440px에서 기본 메뉴, 검색·상태 필터, 직접 해시와 뒤로/앞으로, 키보드 초점, 마지막 행의 상세 제목 가시성, 가로 넘침, 기존 게시·계정 진입을 확인한다. 격리 계정으로 실제 빈 목록, 실패 뒤 Enter 재조회·복구, 본인 최대 50건·타 계정 제외·다섯 상태, 쓰기 0을 대조한다. `0e373e7`의 독립 화면 검수는 `e388493`, `ff0887d`의 독립 HTTP 검수는 `aa4ffe3`를 참조한다. `ff4f9af` 작성자 검증은 관련 회귀 435건, 고정본 타입검사, 실제 PG17 TLS와 390px·1440px까지 완료했다.

## 운영 확인과 되돌림

1. Master가 승인한 보호 환경부터 프로젝트·렌더 대기열과 기존 게시의 미연결 상태를 확인한다. 익명 `/admin`은 기존 관리자 로그인으로 이동하고, 렌더 GET의 익명 401·비허용 403, 허용 계정의 `503 ADMIN_RENDER_QUEUE_UNAVAILABLE`과 캐시 금지를 확인한다. 허용 계정의 POST 405, 목록 행이나 성공 0건 표시가 나오지 않는 상태, 재조회 후에도 미연결 표시를 대조한다.
2. 배포 승인을 받은 경우에만 동일한 반영 SHA에서 운영의 관리자 로그인·콘솔, 기존 공개 홈, 계정 진입과 닫힌 게시 공급원을 읽기 확인한다. 환경 변수와 비공개 자격의 값은 기록하지 않는다. 운영 DB에서 실제 목록이나 권한을 확인하려면 위 표의 승인된 연결 및 검증 경로를 사용한다.
3. 기존 인증·공개 화면에 회귀가 있거나 운영에서 예상 밖 200·행 표시가 나오면 반영을 보류한다. 공개한 후보에서 문제가 발견되면 기존 미연결 구성과 `3c57eff` 배포로 복귀하는 절차를 Master와 대조한다.

이번 산출물은 범위 판정이다. `3c57eff`에 조립한 후보의 빌드·보호 환경 검수와 운영 로그인 후 검증은 이후 단계다.
