# Postgres 스키마·RLS v1

이 SQL은 SQLite migration 0001~0010을 교체하지 않는 별도 클라우드 시작점이다. 현재 앱/worker에는 연결하지 않았고 자동 실행하지 않는다. 새 빈 **검증용 Postgres**에서 먼저 세 파일을 순서대로 적용한다.

1. `0001_schema.sql`: 18개 표, 소유자 FK, 같은 소유자끼리의 복합 FK, 안전 정수·SHA·상태 제약, owner 기반 object key.
2. `0002_invariants.sql`: 이력 불변·같은 프로젝트 참조·타임라인/렌더 raw SHA·입력 봉투·export manifest의 DB 수준 보호.
3. `0003_rls.sql`: 제한된 `dream_api`, 신뢰된 처리기 `dream_worker`, 18표 ENABLE/FORCE RLS 및 36개 정책.

각 파일은 트랜잭션이며 한 번만 적용한다. 기존 schema/role이 있으면 실패한다. 사용자나 표를 덮는 IF EXISTS/DROP/UPSERT는 없다. 적용 이력·checksum runner와 실제 데이터 변환기는 아직 없으므로 현재 앱의 journal에 이 SQL을 등록하지 않는다.

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
