# B1 Postgres 최소 연결 구현 범위 확정안

- 담당: Codex(Backend), 상위 CX-MASTER-01.
- 요청: msg_bdcf40f03d46. 신규 기존 작업 없음으로 B1 수락, B2 긴급 회귀를 우선 완료한 뒤 반환.
- 최초 조사 SHA: a278e80d9ae9ed88cfbd4939c5b8fccb3bd23ecf.
- 통합 재확인 SHA: d16755091dc77352ed49c82ebb02e18654650a89. B2 테스트 수정 e60b1c0은 별도.
- 상태: ready_review, 코드 근거 분석과 구현 범위 제안 완료. Postgres 연결 구현·외부 적용 완료가 아니다.
- 이번 변경 허용: 이 문서 한 파일. 제품·인증 코드·공용 문서·DB·비밀값 변경 없음.

## 1. 지금 구현된 것과 연결되지 않은 것

| 영역 | 코드 근거 | 실제 상태 / 연결 시 해야 할 일 |
|---|---|---|
| Postgres 스키마 | `lib/db/postgres/0001_schema.sql` | 별도 dream schema 18표, Auth owner FK/복합 FK, safe bigint, raw JSON text, 파일 object key 제약 구현. SQLite journal 0001~0010 대체나 자동 실행 아님 |
| DB 불변식 | `0002_invariants.sql` | 이력·승인기획·완료결과 불변, revision 후퇴 금지, raw hash·render envelope 보호 구현. Zod·서비스 승인/권리/파일 해시 검사를 대체하지 않음 |
| 권한·RLS | `0003_rls.sql:4`와 `:24` 이후 | NOLOGIN dream_api/dream_worker, FORCE RLS, owner/worker 정책 구현. 실제 앱 DB login provision·pool·actor 전달·worker claim은 미구현 |
| API 인증 | `lib/auth/api.ts:13`, `app/api/projects/route.ts:8` | 각 보호 API의 getUser/허용 이메일 독립 검사 통합됨. 반환은 Response 또는 null이므로 사용자 UUID를 repository로 전달하지 않음 |
| 제품 연결 | `lib/db/connection.ts:2`, `lib/db/server.ts:12` | better-sqlite3 + 동기 Drizzle, data/app.db 열기·검사·닫기. Postgres driver/pool이 없음 |
| 프로젝트 repository | `lib/repo/projects.ts:6` | 동기 `.all/.get/.run`, owner 조건 없음. SQLite 단일 사용자 저장계층이며 RLS 접속이 아님 |
| 프로젝트 서비스 | `lib/services/projects.ts:20`, `:51`~`:63` | sync repo + immediate transaction, 파일 존재 검사·stage/log 묶음·입력 검증. async callback을 기존 withDatabase에 넣으면 Promise 완료 전에 finally가 실행되므로 재사용 불가 |
| workflow | `lib/services/workflow.ts:24` | SQLite immediate 원자성으로 승인·revision·이력 검증. 단순 await 치환만으로 동시성 보존 불가 |
| worker | `worker/main.ts:1`, `lib/jobs/runner.ts:17` | SQLite 핸들·로컬 파일·기존 lease/heartbeat 사용. Postgres worker role/claim/Storage 연결 아님 |

처음 a278e80에서는 SQL/API guard가 별도 backend-cloud 브랜치에만 존재했다. Master의 선별 통합 msg_707fa0c3bfa2 이후 실제 main 파일과 HEAD d167550을 다시 읽었다. 원본 863ff58/d956078/dbc13ae는 각각 87723ba/0daab31/d167550으로 통합되었으며, 최초 브랜치 차이는 이제 차단이 아니다. 새 코드에는 이 통합본을 기준으로 한다.

## 2. T179/T181에서 현재 코드 기준으로 정정할 계약

- T179의 로그인 없음과 Vercel/Supabase 미연결 상태는 당시 기록이다. 현재 저장소에는 로그인·가입·찾기·password API가 있다. 계정/배포의 최신 외부 상태는 이번 코드 조사로 재확인하지 않았다.
- T181의 매직링크/GitHub 전제 대신 현재 T184 이메일·비밀번호/가입/재설정 동작을 보존한다. 새 인증 흐름을 B1에서 구현하지 않는다.
- T181의 worker 서비스 키 접속 문구는 SQL 계약과 다르다. `lib/db/postgres/README.md:15`대로 service_role HTTP key는 DB login이나 dream_worker 역할이 아니다. 별도 DB login+단일 role membership이 필요하다.
- API는 `/api` 경계를 유지한다. private dream schema를 Supabase Data API에 노출하거나 임의 SQL RPC를 만들지 않는다. 일반 API 접속에 owner/superuser/BYPASSRLS 자격을 사용하지 않는다.
- T181의 일괄 `{error,code}`는 현 `/api/projects`의 `{errors:{_form...}}`와도 차이가 있다. 이번 최소 연결에서 기존 응답을 재설계하지 않는다.
- T181의 19 API/17표/22 transaction 같은 과거 집계로 현재 완료 범위를 판단하지 않는다. B2 기준 API route 파일24개(공개 인증3/자체 인증1/공통 guard20), SQL표18개이며 메서드 수와 파일 수는 다르다.

## 3. 다음 구현 B3 권고: 제품 미전환 상태에서 연결·actor·조회 repository를 실제 완성

Master가 다음 배정으로 확정할 최소 단위다. 작업 결과를 운영 연결 완료로 부르지 않는다.

1. 서버 전용 Postgres driver adapter와 pool 수명 관리. `pg` 계열 driver를 후보로 하되 버전/lock 변경은 배정 시 확정한다. 모듈 import·build만으로 접속/DDL/seed를 실행하지 않는다. 비밀 DSN은 서버 주입만 받으며 예외·로그·보고서에 노출하지 않는다. PostgreSQL 접속 실패를 SQLite로 조용히 우회하지 않는다.
2. `withActorTransaction(verifiedActor, operation)`은 **한 pool client**에서 BEGIN → SET LOCAL ROLE dream_api → 바인딩 `set_config('dream.actor_id',$1,true)` → await operation(tx) → COMMIT 순서로 실행한다. BEGIN/role/actor/query/commit 실패 모두 고려하고, rollback 실패·연결 단절 시 해당 client를 폐기한다. 성공·실패 모두 반환/해제가 정확히 한 번 이루어져야 한다. 고정 role literal만 쓰고 session SET/false 옵션/pool.query로 transaction 분산을 금지한다. 중첩 transaction은 첫 단위에서 거부한다.
3. 검증된 사용자 UUID는 HTTP body/query/임의 header에서 받지 않는다. 이 단계의 호출자는 테스트가 제공하는 명시적 actor뿐이며 실제 Auth 연결은 다음 절의 순차 작업이다. auth off인 기존 로컬 모드에 임의 cloud actor를 만들어 주지 않는다.
4. `postgresProjectsRepository(tx)`의 async `list/get/stages/jobStates` 조회를 구현한다. SQL은 dream schema 명시·값 바인딩·archived 필터·기존 updatedAt 정렬을 유지하고 owner 조건을 추가 방어로 둔다. RLS는 같은 tx actor와 일치해야 한다. 숫자는 유한 안전 정수 검사 후 변환, timestamp는 UTC ISO, raw JSON text는 원문 그대로 반환한다. bigint 전역 파서 변경은 피한다. DTO 필드는 기존 camelCase와 일치시킨다.
5. pool client로 반환된 tx가 callback 밖에서 다시 사용되지 않게 한다. 실패 후 다음 actor 재사용·동시 A/B 요청·pool size1 재사용·rollback·연결오류를 실제 driver 통합 테스트로 검증한다.

첫 단위에서 production route/service는 새 repo를 호출하지 않는다. 대신 실제 Postgres 검증 DB에 합성 사용자 A/B와 프로젝트를 넣고 위 연결/조회/transaction을 실행하는 것이 완료 기준이다. 단순 mock 순서 시험이나 PGlite SQL PASS만으로 driver 연결을 수용하지 않는다.

## 4. B3 제안 허용 경로와 후속 서비스 연결 분리

| 제안 경로 | 다음 배정에서 허용할 일 |
|---|---|
| `lib/db/postgres/connection.ts`, `transaction.ts`, `types.ts` | 새 driver adapter/tx/actor 타입만 |
| `lib/repo/postgres/projects.ts` | 신규 async 조회 repo만 |
| `tests/postgres/connection.test.ts`, `tests/postgres/projects.test.ts` 및 전용 fixture helper | 합성 데이터·명시 test DSN 대상 통합 검사만 |
| `package.json`, `package-lock.json` | Master 단일 소유로 driver/타입·검증 명령 추가. 다른 의존성 일괄 갱신 금지 |
| `.env.example`, `lib/db/postgres/README.md`, 고유 B3 보고서 | 변수 이름·실행법·제한만, 실제 값 없음 |

이 목록은 **제안이며 현재 편집 권한 확대가 아니다**. 고정 SQLite migrations/fixture와 기존 Postgres SQL3개, lib/auth/**, proxy.ts, app/api/auth/**, 기존 lib/services/**·lib/db/server.ts·worker/main.ts는 첫 연결 단위에서 수정 제외한다.

후속 B4는 인증 담당이 `requireApiAuth`와 같은 거부 규칙을 가진 verified user id 반환 계약을 별도 단일 작업으로 제공한 뒤 진행한다. 기존 Response|null 호출자 호환성을 보존하고 getUser 중복 호출을 피하는 계약이 필요하다. Backend는 인증 파일을 동시에 수정하지 않는다. B4에서 읽기 서비스부터 async 경계를 연결하고 호출 페이지/route를 함께 점검한다. 쓰기 전환은 프로젝트+stage/link/log 원자성, revision CAS/행 잠금, 승인 게이트를 보존하는 별도 단위다. 기존 SQLite sync 서비스에 Promise를 끼워 넣지 않는다. 전체 서비스·Storage·worker 전환 전 V2/V4 완료를 선언하지 않는다.

## 5. 실제 managed Supabase 적용 필요 여부

- 지금 B1은 적용 불필요하며 외부 SQL/role/표 생성은 하지 않았다.
- B3의 코드/합성 integration은 격리된 로컬 Postgres로 진행할 수 있다. 테스트 전용 DB 식별자·서버·비운영 자격이 명시되지 않았으면 연결을 추측하거나 기존 DATABASE_URL을 재사용하지 않는다. 이 문서를 위해 환경파일/키를 열지 않았다.
- managed 운영 연결 수용 전에는 별도 **staging Supabase**에서 auth.users 실제 FK, 제한 login membership/NOINHERIT/NOBYPASSRLS, role 전환 권한, 실제 pooler actor 초기화·동시성·TLS·네트워크를 확인해야 한다. 로컬 DB/PGlite는 이 증거를 대신하지 않는다.
- migration 주체와 API/worker login을 분리해야 한다. 앱 role에는 DDL/TRUNCATE 권한이 없다. 초기 SQL은 신규 빈 schema/role 전제이며 기존 대상에 임의 재실행하지 않는다. checksum/history runner 미구현 상태도 유지한다.
- Storage 버킷·정책·signed URL·파일 변환, 작업 claim/fencing, 완료 이력 import·백업 복구는 후속이다. 특히 queued-only INSERT guard 때문에 완료 render 이력을 보통 INSERT로 옮길 수 없다.

## 6. 테스트 DB와 로컬 production 보존

1. 현재 3013 서버·공유 .next·실사용 data/storage/backups·원본 fixture를 읽거나 쓰거나 중지하지 않는다. DREAM_DATA_ROOT를 실사용 위치로 설정하는 시험을 금지한다.
2. 검증 DSN은 별도 TEST_DATABASE_URL 같은 이름으로 명시 주입하고, 예상 test DB/schema 확인을 통과한 경우에만 테스트를 시작하도록 설계한다. production DATABASE_URL fallback은 없다. 실제 값·URL/암호를 로그에 남기지 않는다.
3. 합성 UUID 두 사용자와 새 빈 테스트 DB만 사용한다. 테스트용 auth.users stub은 일반 로컬 Postgres에서만 생성하며 managed Auth의 실제 사용자 표를 흉내 내어 변경하지 않는다.
4. SQL 3개 초기화와 role provision은 테스트 fixture owner가 수행하고 app code에는 권한을 주지 않는다. 파괴적 정리는 명시 테스트 대상만 수행한다. DB transaction/role의 session 범위 때문에 공유 운영·테스트 schema 공존으로 격리를 대신하지 않는다.
5. B3 수용: 같은 client actor/role 순서, A/B 조회·쓰기 차단, actor 없음 차단, commit/rollback 이후 누출 없음, callback/commit/rollback 오류의 client 폐기, 동시성, 조회 DTO/정렬/원문 보존. baseline 기존 회귀+lint/type 검사를 포함하며 실제 integration 미실행은 차단으로 보고한다.
6. 실데이터 이전/외부 배포/운영 자격 provision은 B3에 포함하지 않는다. 현재 로컬 운영본은 되돌리기 기준으로 보존한다. 두 저장소에 동시 쓰기·자동 역동기화를 추가하지 않는다.

## 7. 수행한 확인과 인계

- T179/T181, AGENTS/CLAUDE/공통·역할 지침, PLAN/REVIEW/TEAM의 관련 기록, 기존/통합 SQL·API guard·repository/service/worker 코드를 읽었다.
- `git show`로 원본 커밋을 읽고, `git merge-base --is-ancestor`의 최초 비조상 결과와 Master 통합 후 실제 파일/HEAD를 구분했다. branch/worktree 상태는 읽기만 했다.
- B1은 문서만 작성하므로 DB·서버·브라우저·managed 접속·build/test를 실행하지 않았다. B2의 관련143 PASS/lint/type는 B2 회귀 근거이며 Postgres 연결 증거가 아니다.
- 명령/산출물: git status/rev-parse/log/show/ls-tree/merge-base/worktree list, rg 및 대상 코드 읽기. 비밀값 조회/출력·운영DB/외부표 변경·push/배포 없음.
- Master에 요청: 위 B3 연결+actor+조회 범위를 확정하고 고유 경로/driver lock 작성자를 지정한다. 인증 담당 verifiedActor 계약은 B4 전에 순차 배정한다. 독립 검수 및 실제 test DB를 확보하기 전 연결 완료로 보고하지 않는다.

복사/전달 메시지:

> B1 ready_review. d167550 SQL/API guard 통합 재확인, 최초 미통합 차단 해소. 제품은 여전히 SQLite 동기 repo/service/worker이며 user UUID·Postgres transaction/pool이 미연결. B3는 신규 driver+transaction-local actor+프로젝트 async 조회 repo+합성 Postgres integration으로 한정, 제품/인증 경로 전환은 B4 순차 작업 권고. managed SQL 적용은 지금 불필요하며 staging 실제 login/pooler/Auth 검증은 운영 연결 수용 전 필요. docs/handoffs/B1-BACKEND-CONNECTION.md에 허용경로·완료조건·test DB/3013 보존·T184 차이를 기록. B3 배정 즉시 구현 가능, 외부DB/인증코드/운영본 변경 없음.
