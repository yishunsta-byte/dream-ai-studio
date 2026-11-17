# Postgres 스키마·RLS SQL 작성 인계

- task: `task_1dfdbf56976c` / dispatch: `ctx_865b58285a0a`
- 작성자: 배정된 Codex worker / 반환 대상: Codex Master
- 기준: `ac374c00f84db8833c993b98442619a86b248421` / `yishunsta-byte/backend-cloud` / 2026-11-17 KST
- 범위: 신규 Postgres SQL·설명·독립 실행 SQL 검증 스크립트. **ready_review, 자체 검증이며 독립 검수 아님.**

## 변경 파일

| 경로 | 내용 |
|---|---|
| `lib/db/postgres/0001_schema.sql` | 현재18표 대응, uuid owner/FK, 복합 소유 FK, 안전 정수·JSON·hash·상태/파일 제약, owner index |
| `lib/db/postgres/0002_invariants.sql` | 이력 불변, 같은 프로젝트 참조, timeline/render 원문 SHA, render 상태·봉투, export manifest 보호 |
| `lib/db/postgres/0003_rls.sql` | API/worker NOLOGIN 제한 역할,18표 FORCE RLS·36정책, 브라우저 역할 권한 미부여 |
| `lib/db/postgres/README.md` | 적용 전제, 트랜잭션별 actor 주입, 역할 provision·형식 변화·미구현 경계 |
| `tests/postgres/schema-rls.mjs` | 합성 Auth 사용자 A/B와 PostgreSQL 엔진을 사용한48개 검사 |
| 이 보고서 | 실제 실행 결과와 검수 요청 |

기존 SQLite migrations/fixtures/package.json/lockfile/환경값/제품 호출자/공용 TEAM·PROGRESS는 수정하지 않았다. 시작 시 존재하던 `BACKEND-CLOUD-PLAN-task_57a02a1aaf36.md`는 이전 작업 산출물로 보존했다. 이번 작업의 고유 경로만 반환하며 공용 진행 상태 갱신은 Master에 요청한다.

## 설계와 계약 보완

T181의 화면→기존 API→서버 흐름을 따른다. 브라우저가 승인 검사를 우회해 표를 수정하지 않게 비공개 `dream` schema에 API 역할만 권한을 준다. API는 검증한 사용자 UUID를 transaction-local `dream.actor_id`로 주입한다. 누락은 default deny, 잘못된 UUID는 오류, 트랜잭션 종료 후 초기화됨을 직접 검증했다. 이 접속 자격은 서버만 보유해야 한다.

T181의 worker 서비스 키만으로 직접 SQL 접속할 수 있다는 표현은 보완이 필요하다. 이번 SQL은 Postgres용 `dream_worker` NOLOGIN 역할만 정의하며, 접속 login·암호·membership provision은 실행하지 않았다. 이 역할은 명시적 교차 소유자 정책이며 BYPASSRLS가 아니고 이력 trigger는 그대로 적용된다.

기존 hash 대상 JSON은 text 원문으로 보존한다. 실제 object key 이전·시간 DTO 직렬화·bigint 변환·기존 settings 운영값 분리·완료 이력 import는 별도 후속이다. 더 강한 owner/id 불변 및 자산 file identity 보호, 원문 hash 검사를 포함하므로 기존 데이터를 무조건 수용한다고 가정하지 않는다.

## 실행 명령과 실제 결과

1. PLAN/REVIEW/TEAM/T181, schema.ts 및 SQLite0001~0010의 관련 DDL/trigger를 읽었다. 현재18개 표·19개 route를 기준으로 했다.
2. `npm.cmd view @electric-sql/pglite version` → `0.5.16` 확인.
3. `npm.cmd install --prefix tmp/pg-schema-validation --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.5.16` → 검증 전용 패키지1개 설치. 기존 product 의존성은 설치/변경하지 않았다.
4. `node tests/postgres/schema-rls.mjs` → **48 checks PASS**, PostgreSQL **18.6(PGlite WASM)**. 합성 in-memory DB만 사용했고 종료 시 close했다.
5. 새 파일의 공백 검사와 로컬 참조 확인. 기존 tracked diff 변경 없음, 새 파일만 존재한다.

검증 범위: 모든18표 ENABLE/FORCE RLS·36정책, 역할 속성, A/B 격리·위조 owner INSERT 거절·다른 사용자 UPDATE/DELETE0행, cross-owner 복합 FK, 모든 표 타 owner 숨김, missing/invalid actor 및 transaction-local reset, anonymous/authenticated 권한 부재, TRUNCATE/DDL 거절, safe integer/JSON/경로·raw hash, 같은 프로젝트 조건, approved/finished 이력 불변, render job identity·상태·file tuple·동시 active index, silent v2 envelope, manifest v2/null timeline, worker 교차 조회·DELETE 거절·불변 규칙 적용.

## 미구현·미검증 및 다음 조건

- managed Supabase에 적용하지 않았다. 실제 auth.users/로그인 역할 권한·풀러와 드라이버·TLS·동시성·두 worker 경합 검증은 없다. 실제 데이터/키/운영3013/배포는 접근·변경하지 않았다.
- 기존 앱/worker는 SQLite를 계속 사용한다. 전체 앱 build/lint/typecheck/test는 의존성 미설치 및 SQL 전용 범위라 실행하지 않았다.
- SQL은 서비스의 전체 Zod·승인·샘플·권리·JSON 내부 ID 권한 검사를 대체하지 않는다. 검증 스크립트의 축약 JSON은 SQL-level 봉투를 시험하며 실제 서비스에서 그대로 승인되는 입력이라고 주장하지 않는다.
- 큐(pg-boss/자체claim), Storage RLS/예약 업로드/검사 상태, backups 복구 세트, 운영 settings/heartbeat 분리, 실제 과거 이력 import/전환 도구와 journal/checksum runner는 없다.
- 완료 render는 INSERT queued-only 규칙 때문에 일반 import로 직접 넣을 수 없다. 전용 검증 복원 경로 없이 trigger를 임의 비활성화하지 않는다.
- SQL은 새 검증 DB 전용의1회 적용이다. 기존 객체가 있으면 실패하며 재적용·부분 적용 recovery 자동화는 없다. 각 파일의 transaction rollback은 엔진에서 적용 성공으로 확인했으나 모든 DDL 실패 주입 matrix를 돌리지 않았다.

Master 검수 요청: SQL 역할/권한 모델과 T181 차이를 먼저 검토하고, 별도 검수자가 clean managed PostgreSQL/Supabase에서 합성 계정·실제 login/transaction pooler로 재현하도록 배정해 주세요. API/worker 자격과 schema 경로 계약을 확정한 뒤 비동기 repository 하나부터 연결할 수 있습니다. 이번 반환은 실제 발송 영수증이 확인하는 수준까지만 전달 완료이며 Master 수용/통합·독립 검수 PASS는 별도입니다.

**복사용 전달 메시지:** Master께 Postgres 스키마·RLS SQL을 반환합니다. 기존 SQLite 발행본은 보존하고 새18표·owner 복합FK·36 RLS정책·불변/봉투 trigger를 작성했으며 PGlite PostgreSQL18.6 합성 DB48검사를 통과했습니다. API의 transaction-local actor와 별도 worker DB 자격 계약을 검토하고 managed Supabase 독립 검수 및 repository 연결 범위를 배정해 주세요. 실제 Supabase 적용·Storage 정책·큐·데이터 이전·배포는 수행하지 않았습니다.
