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
