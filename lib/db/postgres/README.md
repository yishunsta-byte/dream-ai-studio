# Postgres 스키마·RLS v1

이 SQL은 SQLite migration 0001~0010을 교체하지 않는 별도 클라우드 시작점이다. 앱/worker 시작 시 자동 실행하지 않는다. B4-G 읽기 GET의 런타임 연결과 migration 적용은 별개다. 새 빈 **검증용 Postgres**에서 먼저 검증한다.

1. `0001_schema.sql`: 18개 표, 소유자 FK, 같은 소유자끼리의 복합 FK, 안전 정수·SHA·상태 제약, owner 기반 object key.
2. `0002_invariants.sql`: 이력 불변·같은 프로젝트 참조·타임라인/렌더 raw SHA·입력 봉투·export manifest의 DB 수준 보호.
3. `0003_rls.sql`: 제한된 `dream_api`, 신뢰된 처리기 `dream_worker`, 18표 ENABLE/FORCE RLS 및 36개 정책.

각 발행 파일은 자체 트랜잭션이며 기존 schema/role이 있으면 실패한다. 사용자나 표를 덮는 IF EXISTS/DROP/UPSERT는 없다. B5 runner는 아래 설명대로 원문 checksum 확인 후 외부 BEGIN/COMMIT만 분리하여 세 파일과 전용 적용 이력을 한 트랜잭션으로 실행한다. SQLite journal에 이 SQL을 등록하지 않는다. 실제 데이터 변환기는 아직 없다.

## 접속과 권한

선행 조건은 Supabase의 `auth.users(id uuid)`와 schema/role/function/table 생성 권한을 가진 별도 migration 주체다. 일반 PostgreSQL 검증용으로만 합성 `auth.users`를 만들어 쓸 수 있다. 이 SQL은 실제 Auth 사용자나 login/password를 생성하지 않는다.

`dream`은 비공개 서버 schema다. `anon`/`authenticated`/`authenticator`에 schema/표/role 권한을 부여하지 않는다. 브라우저는 기존 `/api`만 사용한다. Supabase Data API에 schema를 노출하거나 임의 SQL 실행 RPC를 추가하지 않는다. `service_role` 키는 Postgres 접속 암호나 `dream_worker` 역할이 아니므로 처리기용 DB login을 별도로 provision해야 한다. 기존 Supabase 관리자 역할에 대한 권한 확장도 이번 SQL에 없다.

API 접속 login과 worker 접속 login은 별도 비밀 자격으로 provision하고 각각 필요한 단일 NOLOGIN 역할만 사용할 수 있게 한다. migration owner/superuser/BYPASSRLS 연결을 API에 사용하지 않는다. 계정 provision/grant는 Master가 실제 프로젝트에서 검토한 후 별도 수행한다.

API에서는 검증된 Supabase 사용자 UUID를 사용해 **매 트랜잭션마다** 다음 순서로 실행한다. 아래 `$1`은 드라이버 바인딩 변수이며, HTTP body의 owner_id를 그대로 넣는 값이 아니다.

```sql
BEGIN;
SET LOCAL ROLE dream_api;
SELECT set_config('dream.actor_id', $1, true);
-- 같은 드라이버 transaction handle로 repository 호출
COMMIT;
```

오류 시 반드시 ROLLBACK하고 연결을 반환한다. session 단위 SET, `set_config(...,false)`, transaction 밖 actor 설정은 금지한다. API 역할의 자격을 가진 신뢰된 서버는 actor를 지정할 수 있다. 이 정책은 DB 자격 자체가 유출되거나 서버가 잘못 검증한 사용자까지 방어하는 인증 장치가 아니다. Auth 검증·허용 목록·Origin·서비스 승인 검사는 여전히 필요하다. pooler의 실제 역할 전환/설정 초기화는 staging에서 다시 검증한다.

worker는 `SET LOCAL ROLE dream_worker`를 사용하며 교차 소유자 SELECT/INSERT/UPDATE가 명시적으로 허용된다. DELETE/TRUNCATE/DDL은 없다. 이력 trigger는 worker에도 적용된다. 이 역할은 작업별 capability 제한이나 큐 claim 프로토콜을 구현하지 않으며, 실제 처리기 코드에서 claim 검증·시도 fencing·동시 실행1을 구현해야 한다.

## 기존 저장 형식과 차이

- 기존 UUID는 보존한다. 새 owner_id는 검증된 Auth user로 별도 매핑한다. settings는 `(owner_id,key)`가 PK다. 전역 운영 설정/worker heartbeat 분리는 후속 서비스 계약이다.
- 모든 raw JSON은 `text`이며 hash 검사는 저장 원문의 UTF-8 바이트를 사용한다. JSON 유효성 확인용 cast는 저장값을 정규화하지 않는다. timestamp는 timestamptz로 바뀌므로 API에서 UTC ISO 문자열로 직렬화한다.
- 기존 boolean 표시 열은 0/1 정수 계약을 유지한다. bigint는 JS Number 안전 범위로 제한하되 드라이버 반환을 검증 후 명시적으로 변환한다.
- 파일은 로컬 상대 경로가 아닌 `{owner}/{project 또는 _library}/{id}.{ext}` object key다. renders/exports의 결과 경로는 `{owner}/{project}/{id}.mp4`와 `.zip`으로 고정된다. 실제 bytes와 mapping을 먼저 이전해야 한다. 백업의 path는 아직 복구 세트 계약 전이며 로컬 ZIP을 자동 이전하지 않는다.
- SQL이 전체 Zod schema를 대체하지 않는다. JSON 안에 들어 있는 asset/character/source ID의 권한·중복·파일 해시·샘플 표시, manifest의 상세 파일/권리 규칙, 승인/검수 게이트는 기존 서비스 검사를 비동기 계층에서도 유지해야 한다. SQL만 적용해 기능을 공개할 수 없다.
- Storage 버킷/`storage.objects` 정책, Auth 설정, pg-boss/claim, 기존 자료 import·과거 완료 render 복원·롤백 runner는 이 작업 범위에 포함하지 않는다. queued-only INSERT guard가 있으므로 완료 이력 import는 별도 검증된 전용 절차가 필요하다.

## 재현 검사

저장소 의존성을 바꾸지 않고 ignored tmp 폴더에 고정 검증 의존성을 설치한다.

```powershell
npm.cmd install --prefix tmp/pg-schema-validation --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.5.16
node tests/postgres/schema-rls.mjs
```

PGlite(PostgreSQL 18.6, WASM)에서 합성 Auth 두 사용자로 48개 검사 통과. managed Supabase의 Auth/RLS 통합·실제 login/풀러·동시 트랜잭션·네트워크·Storage·성능 검증은 별개다.

정책 의미의 근거: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html). FORCE RLS도 superuser/BYPASSRLS를 제한하지 않으며, TRUNCATE는 RLS 대상이 아니므로 해당 권한을 부여하지 않았다. 공식 문서 확인일: 2026-11-17.

## B3 driver 연결 기반 (제품 경로 미전환)

`createPostgresPool({connectionString})`은 명시 DSN만 받으며 환경변수·SQLite fallback이 없다. import/생성 시 접속이나 DDL을 실행하지 않는다. 호출자가 pool 하나를 유지하고 종료 시 `pool.end()`를 호출한다. 원격 TLS는 인증서를 확인하며, CA는 별도 `ca` 옵션으로 전달한다. URL의 query/hash는 SSL·startup 옵션 덮어쓰기를 피하려고 거부한다. TLS 비활성은 loopback의 명시 `dream_test_*` DB에만 허용된다. `DATABASE_URL`은 후속 호출자용 변수 이름일 뿐 현재 앱에 연결되지 않는다.

`actorFromVerifiedUserId`는 UUID 형식 검사와 내부 타입 표시만 한다. 인증기가 아니며, 이후 Auth 담당이 검증한 `getUser().user.id`로만 생성해야 한다. HTTP owner 필드에서 생성하지 않는다. `withActorTransaction`은 단일 client의 BEGIN/local role/local actor/await callback/COMMIT를 관리한다. callback 중첩을 거부하고 미대기 query도 종료 전에 수집한다. callback 종료 후 tx 사용은 거부된다. SQL/driver 오류는 비밀·입력·쿼리를 담지 않는 코드로 변환한다. COMMIT/ROLLBACK/연결 오류 시 불확실한 client를 폐기한다. tx.query는 신뢰된 repository용 SQL 실행기이며 비신뢰 SQL이나 역할/트랜잭션 제어를 넘기는 인터페이스가 아니다.

`postgresProjectsRepository`는 list/get/stages/jobStates 조회만 제공한다. owner 조건+RLS, 원문 JSON, 안전 정수와 UTC ISO 변환을 유지한다. 신규 쓰기 서비스·Storage·worker·기존 API/화면은 아직 연결하지 않았다.

### 실제 driver 재현 (Windows, 설치·서비스 등록 없음)

공식 [PostgreSQL Windows 다운로드](https://www.postgresql.org/download/windows/)가 연결하는 [EDB portable binaries](https://www.enterprisedb.com/download-postgresql-binaries)에서 지원 버전 압축을 별도 ignored `.tools`에 준비한다. 다운로드 출처·SHA256·압축 목록을 보관하고 실행 파일의 EnterpriseDB Authenticode 서명을 확인한다. runner는 바이너리를 다운로드하거나 시스템 PATH/서비스를 변경하지 않는다.

```powershell
node tests/postgres/run-local.mjs --bin D:/path/to/pgsql/bin
```

runner는 매번 새 `tmp/b3-postgres-<uuid>` 클러스터·미사용 loopback 포트·`dream_test_b3` DB·합성 Auth 사용자·제한 API login을 만든다. 실제 운영 환경변수나 DSN을 읽지 않는다. 시험 후 자기 cluster만 `pg_ctl stop`하고 증거/데이터를 보존한다. DB·schema·기존 역할을 덮어쓰지 않으며 재실행은 새 클러스터를 만든다. dummy 암호는 합성 시험 전용이다.

실제 검증 서버가 이미 준비된 경우에는 `DREAM_PG_INTEGRATION=1`, 명시 `DREAM_PG_TEST_ADMIN_URL`을 설정하고 `npm.cmd test -- tests/postgres/connection.test.ts tests/postgres/projects.test.ts`를 실행한다. fixture는 127.0.0.1/명시 포트/dream_test_* DB/dream_test_admin/빈 schema만 허용하고, 일반 DATABASE_URL·실제 Supabase·기존 테스트 DB를 재사용하지 않는다. 환경변수 미설정 시 실제 integration은 기본 시험에서 명시 skip이다. unit PASS나 skip을 실제 DB PASS로 계산하지 않는다.

driver 근거(2026-11-17): [동일 client transaction](https://node-postgres.com/features/transactions), [pool/release와 client 폐기](https://node-postgres.com/apis/pool), [TLS/DSN SSL 옵션 상호작용](https://node-postgres.com/features/ssl), [SET LOCAL ROLE 권한](https://www.postgresql.org/docs/current/sql-set-role.html). 실제 managed Supabase login/role membership·pooler·Auth FK 통합은 별도 staging 검증이 필요하다.

## B5 migration runner / managed 적용 준비

`migration-manifest.ts`는 발행 SQL3개를 고정 SHA256으로 잠근다. Git checkout의 CRLF만 LF로 정규화한 checksum이며 공백/주석/BOM/SQL 변경은 거부한다. 원문 파일은 수정하지 않는다. `migration-runner.ts`는 같은 migration client에서 transaction advisory lock → target/권한/Auth FK/기존 상태 검사 → 전용 `dream_migrations.history`와 SQL3개 적용 →18표 owner/FORCE RLS·36정책·18guard 검사→COMMIT한다. 중간 오류는 schema/history/role 모두 rollback하며 COMMIT/연결 불확실 client는 폐기한다.

지원 서버는 PostgreSQL16 이상이다. 새 빈 dream/history/role 상태만 초기화한다. 기존 schema/role인데 자기의 완전한3개 이력이 없거나 checksum/ordinal/id/owner/role flags가 다르면 거부한다. 전용 login2개가 있으면 제한 flags와 각 단일 membership의 ADMIN/INHERIT/SET도 검사한다. B5-FIX는 runner/template 공통의 재귀 role graph 검사를 추가했다. 허용 runtime 경로는 api_login→api, worker_login→worker뿐이며 runtime 부모/간접 상위역할과 unknown inbound grant를 거부한다. 이력 소유 migration operator만 관리 root로 예외 처리한다. schema DROP, role ALTER/adopt, 이력 자동 보정은 하지 않는다. 정상 재실행은 적용0이다. advisory lock은 이 runner와 제공 template의 협조 실행을 직렬화하며 외부 관리자의 임의 SQL을 막는 장치는 아니다. 이력+catalog 검사이지 모든 권한/함수 정의의 외부 변조를 탐지하는 전체 schema diff는 아니다.

B5-FIX migration API는 target/hash 검증과 실제 연결을 분리할 수 없도록 내부에서 같은 immutable target으로 pool을 생성·종료한다. 독립 pool/factory를 입력받지 않으며 과거 pool 필드는 JavaScript 호출에서도 명시 거부한다. 일반 B3/B4 pool API는 변경하지 않았다. managed TLS/DNS hostname 검증은 기존 pg/TLS 경계를 유지하고, 서버IP 문자열 비교를 일반 DNS/TLS 보장으로 사용하지 않는다. 성공·상태 검증 실패·BEGIN/COMMIT/rollback 실패에도 소유 pool을 종료한다.

CLI는 별도 migration 환경변수만 읽고 일반 DATABASE_URL·앱 자격으로 fallback하지 않는다. URL은 명령행 인자로 받지 않는다. `DREAM_PG_MIGRATION_PROFILE`은 명시 synthetic 또는 managed-staging, URL은 full user/password/port/db와 query 없는 형식이다. `fingerprint`는 비밀을 제외한 profile/host/port/db/operator의 SHA256만 출력한다. 승인된 target 정보를 별도로 대조한 뒤 그 hash를 `DREAM_PG_MIGRATION_TARGET_HASH`로 주입해야 dry-run/apply가 가능하다. `dry-run`은 READ ONLY이고 schema/role/history를 만들지 않는다. 출력은 target hash·mode·적용/대기 개수·고정 manifest id/checksum뿐이며 실제 host/db/user/DSN은 출력하지 않는다.

```powershell
node --conditions=react-server --import tsx scripts/postgres/migrate.ts fingerprint
node --conditions=react-server --import tsx scripts/postgres/migrate.ts dry-run
node --conditions=react-server --import tsx scripts/postgres/migrate.ts apply
node --conditions=react-server --import tsx scripts/postgres/migrate.ts provision-template
node tests/postgres/run-migrations-local.mjs --bin D:/path/to/signed/pgsql/bin
```

`provision-template`는 실행 없이 password-free SQL만 반환한다. 별도 migration owner가 알려진 이력·제한 role·login 미존재를 확인하고 API/worker 각각 LOGIN PASSWORD NULL, NOINHERIT/NOBYPASSRLS, ADMIN FALSE/INHERIT FALSE/SET TRUE 단일 membership을 만들도록 한다. 기존 login은 실패하며 변경하지 않는다. NULL password로는 password 로그인할 수 없다. 실제 secret operator가 승인된 보안 채널에서 비밀번호/rotation/환경 주입을 따로 수행해야 하고 실제 값을 파일/채팅/명령행/로그에 기록하면 안 된다. HTTP service_role key는 Postgres password가 아니다.

### 정확한 기존 managed 식별 근거와 다음 적용 조건

Master 수신 원메시지 `msg_377e681fe114`(Front T179 V0 생성 보고), `msg_eb75ca2fe4c9`(같은 region/ref 재확인)를 Master `msg_9da1ba1cca7c`로 전달받았다. 당시 공개 Auth URL은 **https://osvjfyjlbixmvnjkxdry.supabase.co**, 조직 star / dream-ai-studio / Seoul ap-northeast-2 / NANO, Data API on·auto-public off·auto-RLS on 보고였다. 이는 당시 보고의 공개 식별자이며 현재 project 소유/DB 빈 상태/접속 자격·권한/실제 region을 독립 확인한 증거가 아니다. 이 ref/URL을 runner default로 넣지 않았으며 기존 Auth 운영 프로젝트를 임의 staging 대상으로 삼지 않는다.

다음 managed 적용은 runner 독립 수용 후 Master가 **정확한 비운영 target/project ref와 migration owner/범위**를 지정한 다음에만 수행한다. 이번 B5에서는 managed URL 접속, SQL/role 적용, 새 프로젝트/계정/paid 생성, 실 DSN 조회를 하지 않는다.

1. 별도 staging인지, 기존 Auth/데이터가 있는 live 프로젝트인지 확인한다. 기존 dream/history/role 상태가 다르면 거부 결과를 Master에 반환하고 DROP/adopt하지 않는다.
2. migration 실행자의 effective database CREATE·CREATEROLE/REFERENCES auth.users(id uuid unique not-null), 현재 session/operator와 이후 schema/table 소유권을 검사한다. managed 권한으로 안 되는 작업이 있으면 제한 사유를 먼저 반환한다. 슈퍼유저라고 가정하지 않는다.
3. migration profile은 명시 `db.<project-ref>.supabase.co` **direct host**만 받는다. username/db/실제 backend port도 target과 대조한다. pooler 주소를 임의 유추하거나 direct migration이 성공했다고 runtime pooler SET LOCAL/reset까지 확인됐다고 하지 않는다.
4. managed TLS는 인증서 검증을 유지하고 필요 CA는 `DREAM_PG_MIGRATION_CA`로 명시한다. 서비스용 API/worker login은 migration owner와 분리한다. 비밀 provision/rotation은 지정된 담당만 수행하고 application login에 DDL/history 권한을 주지 않는다.
5. 실제 Auth A/B UUID FK, API RLS/no actor/교차 owner/DDL 차단, worker의 의도된 cross-owner 범위·claim fencing, runtime 선택 pooler의 역할 전환/동시 재사용/rollback/disconnect를 검증한다. 이 로컬 runner 시험은 실제 managed Auth/pooler/Storage를 대신하지 않는다.

공식 근거(2026-11-17): [PostgreSQL transaction advisory lock](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [GRANT membership options](https://www.postgresql.org/docs/current/sql-grant.html), [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles). SQL3개 외부 source/history 무결성과 full schema drift 검사의 차이를 유지한다.
