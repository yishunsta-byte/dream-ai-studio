# B4-C 프로젝트 읽기 연결 계약 확정안

- 담당 Codex(Backend), 상위 CX-MASTER-01, 요청 msg_f8473a3e51d9.
- 기준 SHA `7d61d5bc6214169cbcf4c4d246c3299e19121206`, B3 구현 `994a894`, 공통 계획 `0ac750b` v1.1.
- 상태 **ready_review / 계약 문서만 작성**. cloud read는 아직 미연결이다. B3-R 독립 검수 결과는 이 문서로 대체하지 않는다.
- 이번 허용 변경은 이 문서 한 파일. Auth/T186, 제품 repo/service/page/API, B3 코드·SQL·migration·DB는 변경하지 않았다. 실제 DSN/운영 환경값을 읽지 않았다.

## 1. 실제 호출면

| 위치 | 현재 호출과 주의 |
|---|---|
| `app/(studio)/page.tsx:9` | 동기 Home → checkStartup → listProjects, 별도로 SQLite readRecentOperations. 조회만 await로 바꾸어도 로컬 startup/최근 활동 의존성이 남음 |
| `app/(studio)/menus/[menuId]/page.tsx:14` | listProjects().filter(menuId). await 후 동일 필터/DTO 필요 |
| `app/(studio)/menus/[menuId]/new/page.tsx:13` | projectChoices는 로컬 assets/characters와 실제 파일 존재 검사. B3 프로젝트 조회 repo만으로 전환 불가 |
| `app/(studio)/projects/[id]/[stage]/page.tsx:21` | readProject 뒤 readPlanning/readProduction/readEditing/readReview/readExports로 이어짐. readProject만 Postgres로 교체하면 같은 UUID의 SQLite 데이터/조작과 섞일 수 있음 |
| `app/(studio)/projects/[id]/render/page.tsx:16` | readProject 뒤 로컬 readEditing/readRenders. 동일 혼합 위험 |
| `app/api/projects/route.ts:7` | **POST 생성만 존재**, GET 목록·단건 API는 없음. client ProjectForm은 이 POST를 사용함. GET 추가는 신규 계약이며 기존 조회 API 전환으로 표현하면 안 됨 |
| `lib/services/projects.ts:51`~`:63` | list/get DTO 조합과 외부 wrapper가 sync. get 없음은 WorkflowError(NOT_FOUND,404), choices/create는 로컬 고유 의존 |
| `components/studio-layout.tsx:9` | currentAccountEmail(getUser 별도) → 로컬 checkStartup → Vercel 실패 시 CloudPending. 자식 화면/API의 데이터 권한 검사 자체를 대신하지 않음 |
| `lib/auth/api.ts:12` | Response 또는 null. off는 null, 인증된 허용계정도 null이므로 user UUID/인증 종류를 알 수 없음 |

권고 순서는 **Auth 결과 계약 → cloud 조회 service/격리 API → 실제 RSC 호출자 이관**이다. 첫 단계에 전체 작업실을 열지 않는다. 클라우드 조회를 로컬 작성 화면과 곧바로 연결하지 않는다.

## 2. Auth 담당에게 Master가 배정할 반환 계약

Front 단일 작성으로 공통 검증 함수(이름 제안 `resolveServerAuth`)를 추출한다. Backend가 이 파일을 동시에 수정하지 않는다.

```ts
type ServerAuthResult =
  | { kind: 'local' }
  | { kind: 'verified'; userId: string; email: string }
  | { kind: 'denied'; status: 401 | 403 | 503;
      code: 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'AUTH_UNAVAILABLE' };
```

- 검증 순서는 현재 guard와 같게 유지한다: local off → 설정 확인 → createSupabaseServer/getUser 1회 → error/사용자 없음 → 허용 이메일 → UUID 형식 검증. user+error 동시 반환도 허용하지 않는다. malformed/누락 user UUID는 Auth 계약 실패 503으로 닫는다. 이메일을 UUID로 매핑하거나 요청 owner_id/header/캐시 쿠키 원문을 신뢰하지 않는다.
- `requireApiAuth(): Promise<Response|null>`는 공통 결과를 기존 response로 직렬화하는 호환 adapter로 유지한다. 인증 정상/local은 기존대로 null. 401/403/503 본문 `{error,code}`·no-store·redirect 없음과 실패 시 body/params/서비스 미접근을 보존한다.
- 새 읽기 API는 공통 결과를 **한 번** 얻어 denied를 응답하거나 verified.userId를 actor 생성기로 전달한다. 같은 handler에서 requireApiAuth 후 다시 getUser하지 않는다. service/repo/transaction은 Auth 네트워크를 호출하지 않는다.
- Server Components의 layout 계정 표시와 page loader는 같은 request 단위 resolver snapshot을 공유한다. React cache를 쓴다면 **한 번 생성해 export한 동일 함수**만 공유하고 RSC 요청 안에서만 사용한다. route handler는 React cache에 의존하지 않고 명시 auth 결과를 전달한다. module 전역 Map/Promise, unstable_cache/영속 cache, 사용자 구분 없는 project 결과 cache는 금지한다.
- proxy의 getUser는 독립 1차 보호라 유지한다. 목표는 proxy 검증 삭제가 아니라 handler/RSC 내부의 불필요한 재조회 제거다. 두 HTTP 요청 간 인증 snapshot은 재사용하지 않는다. 각 요청·새 계정·만료 시 재검증한다.
- 로그인/signup/reset/password/logout의 Origin/JSON/content-type, 실패 처리, local 동작(T186)은 보존한다. 새 query service를 위해 인증 공개 경로를 변경하지 않는다.

RSC cache 제안의 근거: [React cache 공식 문서](https://react.dev/reference/react/cache), 2026-11-17 확인. 문서상 요청별 무효화와 동일 export 함수 공유, RSC 밖 비적용을 확인했다. 이 저장소 실제 RSC/SDK에서의 단일 호출 보장은 후속 integration으로 증명해야 한다.

## 3. 데이터 선택과 실패 정책

새 이름 제안: `DREAM_PROJECT_READ_BACKEND=sqlite|postgres`. 인증 모드와 저장소 모드는 별개다. 현재 코드에는 이 selector가 없으며 아래는 후속 구현 계약이다.

| 환경/선택 | 정책 |
|---|---|
| 로컬, 변수 없음 또는 sqlite | 기존 SQLite read/write와 auth off 동작 유지. 인증을 켠 로컬이면 기존 인증 정책도 유지 |
| postgres 명시 | verified UUID와 명시 server-only DATABASE_URL, B3-R 수용된 pool이 모두 필요. 어느 하나라도 없으면 503, SQLite fallback 없음 |
| postgres + auth off/local 결과 | 임의 local-user actor 생성 금지, 503 AUTH_UNAVAILABLE. cloud 조회를 열지 않음 |
| postgres + Auth denied | 기존 401/403/503·no-store 우선. pool 생성/접속/DB query 없음 |
| Vercel에서 변수 없음/sqlite | 준비 중 화면 유지. 새 데이터 read 진입은 503 PROJECT_READ_UNAVAILABLE, 로컬 SQLite/폴더 점검으로 우회하지 않음 |
| 알 수 없는 selector, DSN 없음/불량/접속실패 | 503 PROJECT_READ_UNAVAILABLE, raw driver 정보 없음. backend를 자동 교체하지 않음 |

DATABASE_URL은 server만 읽고 브라우저·HTML·JSON·로그·보고서에 값/부분 URL을 싣지 않는다. pool은 runtime 단위 재사용하되 actor/tx는 요청마다 새로 만든다. import/build에서 접속하거나 자동 migration하지 않는다. full DSN/인증서 옵션과 B3 reject 정책을 그대로 사용하고 검증 생략 옵션을 추가하지 않는다.

**혼합 저장소 차단 조건:** postgres opt-in 상태에서는 미전환 쓰기/자료/작업/백업 경로가 SQLite로 실행되지 않아야 한다. CloudPending은 화면 안내이며 API/자식 RSC 보호 증거가 아니다. 이 차단 없이 해당 env로 외부 배포하지 않는다.

Master에 권고하는 범위 분할은 다음과 같다. (a) B4-A Auth 결과 계약·호환 adapter, (b) B4-S 새 cloud project 조회 service와 내부/시험용 API, (c) B4-G 미전환 legacy API/RSC 실행 차단, (d) B4-U 읽기 전용 목록/등록정보 표시다. G/U 배정 전 기존 layout/페이지의 cloud 개방을 유지 보류한다. G는 공통 guard가 인증 후 legacy-data 접근을 거부하는 방식 등을 별도 검토하되 logout 등 인증 전용 조작은 계속 가능해야 한다. 이 제안은 현재 제품 코드 변경 권한을 확대하지 않는다.

## 4. 조회 service · DTO · 트랜잭션

- 신규 `lib/services/project-reads.ts` 등에 명시 request scope를 받는 `listProjectReads(scope)` / `getProjectRead(scope,id)`를 둔다. 기존 sync projectService/create/choices와 구분한다. API/loader가 auth/selector를 해결하고 전달하므로 service 내부에서 인증·runtime 환경을 다시 추측하지 않는다.
- Postgres는 withActorTransaction(scope.actor, ...) 안에서 B3 repo를 사용한다. list의 project/stages/jobStates, get의 project/stages는 한 연결·한 transaction을 유지한다. 여러 query 사이 일관된 read snapshot이 필요한 DTO이므로 PostgreSQL REPEATABLE READ read-only transaction을 **실제 지원·검증한 뒤** 사용한다. 현재 B3 BEGIN은 기본 isolation이므로 이미 snapshot 일관성이 보장됐다고 주장하지 않는다. B3-R 중 파일 수정 금지, 후속 transaction 옵션은 별도 배정한다.
- DB callback 안에서는 DB row만 모아 반환한다. commit이 끝난 뒤 Zod decode/DTO 조합/도메인 오류를 만든다. 이렇게 해야 현재 wrapper가 임의 callback error를 PG_TRANSACTION으로 바꾸어 NOT_FOUND를 잃는 문제를 피한다. 예상된 도메인 오류를 driver 오류와 이름만으로 혼동하지 않는다.
- list DTO는 `{id,title,menuId,menuLabel,aspect,lengthSec,updatedAt,status,states,nextStage}` 그대로. menuLabel은 저장된 templateSnapshotJson에서 decode, status는 기존 projectDisplayState(states,jobStates), nextStage는 stageOrder의 첫 미승인 단계 또는 export. 기존 정렬/archive 필터/기본 목록 범위를 보존한다.
- get DTO는 `{project,snapshot,inputs,states}` 그대로. project는 기존 camelCase/null/number/UTC ISO, snapshot은 menuSnapshotSchema, inputs는 jsonObject. raw JSON hash 입력은 정규화하거나 재저장하지 않는다. states의 note/승인정보를 보존한다. ownerId는 client DTO에 불필요하게 추가하지 않는다.
- 모든 list/get/stages/jobStates는 같은 verified actor. 타 owner ID·없는 ID·archive된 ID는 동일 NOT_FOUND 404. UUID 모양이 틀린 project id는 바인딩 전 400 INVALID_INPUT, user UUID와 project UUID를 구분한다. 다른 owner 자료의 존재·제목을 에러에 포함하지 않는다.
- stages 7개 누락/알 수 없는 enum/손상 snapshot·JSON/안전 정수 초과는 무조건 빈 목록/기본 단계로 보정하지 않는다. 503 PROJECT_READ_UNAVAILABLE로 닫고 민감값 없는 내부 코드만 남긴다.

## 5. 공개 오류와 페이지 처리

| 상황 | 신규 읽기 API |
|---|---|
| Auth 실패 | 기존 AUTH_REQUIRED 401 / AUTH_FORBIDDEN 403 / AUTH_UNAVAILABLE 503 |
| 잘못된 project id | 400 `{error:'프로젝트 주소를 확인해 주세요.',code:'INVALID_INPUT'}` |
| 없음/타 owner/archive | 404 `{error:'프로젝트를 찾을 수 없어요.',code:'NOT_FOUND'}` |
| DB 설정·접속·query·손상 DTO | 503 `{error:'프로젝트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',code:'PROJECT_READ_UNAVAILABLE'}` |

새 API 모든 성공/실패는 `Cache-Control: no-store`를 붙이고 요청 간 shared caching을 허용하지 않는다. 신뢰된 typed error factory만 status/code/public message를 만들며 arbitrary object의 message/status/code를 그대로 내보내지 않는다. PG_CONFIG/PG_UNAVAILABLE/PG_TRANSACTION/PG_DATA, SQLSTATE/stack/cause/쿼리/DSN은 외부에 전달하지 않는다. 기존 POST의 `{errors:{_form}}` 오류 모양은 변경하지 않는다.

페이지는 같은 typed NOT_FOUND만 notFound(), AUTH_REQUIRED는 안전한 next 경로로 로그인, forbidden/unavailable은 해당 안전 안내를 표시한다. Next redirect/notFound 제어 예외를 포괄 catch로 503으로 바꾸지 않는다. 스트리밍 RSC의 HTTP status와 화면 상태는 API의 정확한 status 검사와 별도로 검증한다.

## 6. 제안 변경 경로와 배정 순서

| 순서/담당 | 후속 제안 경로 | 완료 조건 |
|---|---|---|
| 1 Front, Master 경유 | `lib/auth/api.ts`, `lib/auth/server.ts`, 필요 신규 auth context/type, auth 테스트 | 호환 guard+verified UUID 반환, API 1회/RSC request 공유, 기존 인증 회귀 |
| 2 Backend, B3-R 이후 | 신규 `lib/config/project-read.ts`, `lib/services/project-reads.ts`, typed read 오류/adapter, B3 transaction에 명시 read isolation 옵션 | selector truth table, actor 전달, async DTO/typed 오류, 실제 driver repeatable-read 대조 |
| 3 Backend | `app/api/projects/route.ts`의 GET 추가, 신규 `app/api/projects/[id]/route.ts` GET, api-auth inventory·전용 integration | POST 그대로, 신규 GET 직접 호출 Auth/owner/no-store 검증. 경로 추가 자체는 Master가 승인한 범위에서만 |
| 4 Master 별도 G/U 배정 | legacy route/RSC 차단, `components/studio-layout.tsx`, Home/menu/상세 read 전용 분기와 관련 UI | 미전환 서비스 호출 0, 로컬 정상 동작, 실제 browser cloud read-only·local 1280/390 확인 |

기존 stages/render 화면의 list/read 함수에 일괄 await만 넣는 방식은 채택하지 않는다. Cloud GET 2개를 만들었다고 기존 API 전체가 이전됐다고 하지 않는다. 새 API 필요성이 없으면 Master가 단계3 대신 전용 RSC loader를 택할 수 있으나 사용자별 인증·동일 DTO·fail-closed 검증은 동일하다.

## 7. 구현 수용 검사

1. Auth: allowed UUID 정상, user+error 동시/expired/없음/허용 밖/이메일·UUID 없음/provider throw/config 누락. body/params/DB 미열람. API handler getUser 1회, service 0회. RSC layout+page 같은 요청 1회와 다른 요청/사용자 재검증을 실제 app에서 확인한다. proxy 호출은 별도 집계한다.
2. selector: 모든 truth table, Vercel missing/sqlite/unknown/postgres+auth off/DSN 누락을 검사하고 SQLite openDatabase/checkStartup/file probe 호출이 0인지 대조한다. cloud 실패→SQLite 자동 fallback은 negative control로 검출한다.
3. 실제 Postgres: 새 합성 cluster A/B, 동일 project UUID를 로컬 대역에 별도 넣어 혼합 방지를 확인한다. 타 owner/없는/archive/잘못된 UUID, list/get DTO·정렬/states/jobs/raw/date/safe integer, snapshot 손상/단계 누락, 동시 수정 중 read snapshot을 검증한다.
4. 오류: driver 예외에 DSN/개인정보 sentinel을 넣어 API/HTML/로그에 나타나지 않는지 검사한다. typed NOT_FOUND가 503으로 바뀌지 않고 예상 밖 Error가 임의 status/message로 노출되지 않아야 한다.
5. route inventory/기존 auth·projects·cloud-pending·planning/jobs·관련 회귀, lint/type, 격리 build. UI를 열 경우 실제 1280/390·계정 변경/만료·404/503·새로고침·back 링크를 검증한다. 전체 로컬 작성/렌더 흐름이 cloud read 배정으로 바뀌지 않아야 한다.
6. B3-R PASS와 후속 변경 독립 검수 없이는 cloud read 수용/운영 배포로 올리지 않는다. 구현자 시험/독립 시험/managed 시험을 구분한다.

## 8. managed staging 최소 증거와 provisioning 책임

- **지금은 managed SQL/실제 DSN 불필요**, portable synthetic 환경으로 계약 구현 가능. 현재 실제 Supabase의 DB login/membership/pooler/TLS 상태는 조사하지 않았으므로 미확인이다.
- Master가 정확한 비운영 staging 프로젝트/빈 schema·migration 실행자·API login 작성자를 지정한다. 계정/role/권한 provision은 승인된 운영 담당이 비밀 채널에서 수행한다. Backend에게 서버 환경 주입으로 필요한 최소 DSN/CA만 제공하며 채팅/보고서에 값 기록을 요구하지 않는다. service_role HTTP key를 DB 암호로 쓰지 않는다.
- migration owner와 API login 분리, NOSUPERUSER/NOBYPASSRLS/비소유자/NOINHERIT 및 dream_api로 SET 권한 확인. 실제 Auth A/B UUID와 auth.users FK, RLS 강제/부재 actor/교차 owner 대조 필요. fake auth stub 검사는 managed Auth 증거가 아니다.
- 실제 선택한 direct/session/transaction pooler마다 동일client 트랜잭션·SET LOCAL role/actor·commit/rollback 뒤 재사용·동시 A/B·disconnect를 검증한다. pooler가 해당 역할 전환을 허용한다고 추정하지 않는다. 불가하면 제한 login/direct 또는 지원된 접속 방식의 구체 대안을 Master에게 제출한다.
- 인증서 검증을 켠 TLS, 서버 네트워크/접속 제한·타임아웃, 비밀 로그/빌드 유출 없음 확인. 기존 SQL3개 checksum/history·독립 SQL 검수, managed privilege 적용 가능 여부는 별도 확인한다. B4 읽기 배정에서 운영 SQL 재실행/새 계정/유료 생성/production DDL을 하지 않는다.

## 확인 범위 · 인계

rg로 실제 listProjects/readProject/projectChoices/requireApiAuth 호출 위치를 조사하고 해당 page/service/Auth/layout/cloud-pending/기존 테스트를 읽었다. 코드 실행·DB 접속·제품 검증은 하지 않았다. 문서의 파일/계약 대조와 diff 공백 검사만 수행한다. 다른 담당의 Design·테스트 WIP와 기존 고유 보고서를 보존한다.

복사/전달 메시지:

> B4-C 계약 ready_review. cloud read 아직 미연결. 현재 조회는 RSC직접호출이며 /api/projects는POST만, stages/render는SQLite서비스연쇄라 부분전환혼합차단 필요. Auth공통결과(local/verifiedUUID/denied)+호환guard·API명시전달/RSC요청범위공유, backend opt-in/failclosed, DTO·typed오류·실제snapshot검사, 전환순서A/S/G/U와미전환쓰기차단·managed최소증거를 docs/handoffs/B4-PROJECT-READ-CONTRACT.md에 제안. B3-R대상/Auth/제품/SQL/실DSN변경없음. Master확정후 단일작성자범위로 구현배정 요청.
