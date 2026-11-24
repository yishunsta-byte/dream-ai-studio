# T256 관리형 PostgreSQL 17 이관·프로젝트 읽기 사전점검

2026-11-18 KST · Codes(Backend) · 독립 검토 대기

기준 커밋 `5e07360e0834e6fd1c2264172a53ebd6d93f84b6`. 배정 `msg_fafb5e00284e`, 수락 회신 `msg_d2cf795eee91`. 배정 시점의 [백엔드 실행표 4단계](../MASTER_DEVELOPMENT_PLAN.md#4-클라우드-전환-순서)와 [TEAM.md](../TEAM.md)를 대조했다. Front/Tester의 T255 작업과 Recovery의 Storage·쓰기 배정이 별도이며, 지정 신규 보고 경로에 기존 파일이나 작업 충돌이 없었다. 제품 소스와 기존 증거만 읽었다. 새 DB·테스트 실행, 운영 접속·비밀 조회·설정·배포는 0건이다.

## 프로젝트 읽기 경로와 소유권

| 경로 | 확인한 동작 |
| --- | --- |
| [GET 목록](../../app/api/projects/route.ts)과 [GET 상세](../../app/api/projects/%5Bid%5D/route.ts) | Node.js 경로에서 요청마다 `createProjectReadRequest`를 생성한다. 상세 ID는 인증 뒤 읽는다. 모든 응답은 `Cache-Control: no-store`. 같은 목록 라우트의 POST는 기존 로컬 생성 코드에 연결된다. |
| [클라우드 목록·상세 공통 함수](../../lib/cloud/project-read-page.ts)와 [개인 관리](../../app/%28cloud%29/cloud/manage/page.tsx) | `/cloud/projects`, `/cloud/projects/[id]`, `/cloud/manage`가 같은 읽기 어댑터를 쓴다. 화면은 표시용 필드만 추린다. 관리 화면 집계는 성공한 자신의 목록만 사용하며, 작업 처리기·파일 저장소·백업은 연결 대기 상태다. |
| [서버 인증](../../lib/auth/resolve.ts)과 [요청 어댑터](../../lib/services/postgres/project-read-request.ts) | Supabase `getUser()`와 허용 이메일을 확인한 뒤 검증된 UUID로 actor를 만든다. 요청에서 받은 owner 값을 쓰지 않는다. 같은 요청 안에서 인증 판정을 공유한다. 선택한 백엔드가 비활성이거나 데이터베이스 접근이 실패하면 안전한 503으로 처리한다. |
| [읽기 서비스](../../lib/services/postgres/project-reads.ts), [저장소](../../lib/repo/postgres/projects.ts), [트랜잭션](../../lib/db/postgres/transaction.ts) | 한 클라이언트로 `REPEATABLE READ READ ONLY`를 시작하고 `SET LOCAL ROLE dream_api`와 트랜잭션 로컬 actor를 설정한다. 프로젝트·단계·작업 조회 모두 바인딩된 `owner_id`를 사용한다. 목록·상세는 보관됨을 제외한다. 다른 소유자와 존재하지 않는 정상 UUID는 같은 404, 형식 오류는 400이다. 롤백이나 연결 정리에 실패한 클라이언트는 폐기한다. |
| [SQL 1](../../lib/db/postgres/0001_schema.sql)과 [SQL 3](../../lib/db/postgres/0003_rls.sql) | 소유자 UUID는 `auth.users(id)`를 참조한다. 18개 테이블의 ENABLE/FORCE RLS와 API 역할 정책이 별도 소유권 검사를 한다. actor가 없는 API 역할은 행을 읽을 수 없다. DB login은 신뢰된 서버 경계에 둔다. 해당 역할로 전환 가능한 서버는 actor를 설정할 수 있으므로 서버 인증과 DB 자격 보호가 모두 필요하다. |

`dream_api`에는 SQL 3의 DML 권한도 있다. 이번 읽기 경로의 쓰기를 차단하는 실제 경계는 읽기 전용 트랜잭션과 서버 호출 범위다. `DREAM_PROJECT_READ_BACKEND=postgres`를 켜면 이미 연결된 목록·상세·개인 관리가 함께 영향을 받는다. [백엔드 선택기](../../lib/services/postgres/project-read-backend.ts)는 Supabase 모드와 명시 DSN을 요구하며 DSN query/fragment를 거부한다. [런타임 풀](../../lib/services/postgres/project-read-pool.ts)은 기본 옵션으로 만들어지고, [공통 pg 설정](../../lib/db/postgres/connection.ts)은 인증서 검증과 호스트 검증을 유지한다. 마이그레이션 CLI의 CA 설정은 런타임 풀에 전달되지 않는다.

## 이관 순서와 PostgreSQL 버전별 증거

| 범위 | 확인한 사항과 적용 경계 |
| --- | --- |
| 스키마 3 · SQL 1→2→3 | 순서대로 테이블/FK, 이력·데이터 불변 규칙, 역할·RLS를 생성한다. 프로젝트 읽기가 참조하는 테이블과 정책은 이 범위에 있다. v1 runner는 빈 상태 또는 정확한 스키마 3 이력을 검사한다. [B5 독립 재검수](B5-R2-MIGRATION-RUNNER-REVIEW.md)와 [B3 격리 검수](B3-POSTGRES-INDEPENDENT-REVIEW.md)는 로컬 PG18.7 범위다. |
| 스키마 3·4 · v2 | [manifest](../../lib/db/postgres/migration-manifest-v2.ts), [runner](../../lib/db/postgres/migration-runner-v2.ts), [CLI](../../scripts/postgres/migrate-v2.ts)는 3과 4를 명시 선택한다. 4는 SQL 4의 저장소 검증 스키마다. runner는 해시 고정 파일을 순서대로 적용하고, dry-run은 읽기 전용이며, apply는 같은 세션에서 advisory lock을 잡은 뒤 이력·카탈로그를 다시 검사한다. fresh 3/4, 정확한 3→4, 같은 버전 재실행 0건, 역행·부분 이력·변조 거부가 [B23](B23-R-VERSIONED-RUNNER-REVIEW.md)과 [B24](B24-R-VERSIONED-CLI-REVIEW.md)의 PG18.7 시험 범위다. 코드의 최소 버전 16 검사만으로 17의 catalog 표현, 역할 그래프나 실제 DDL 성공을 판정할 수 없다. |
| 스키마 5 · v3 | [manifest v3](../../lib/db/postgres/migration-manifest-v3.ts)는 SQL 1~5의 고정 소스를 제공한다. [catalog v3](../../lib/db/postgres/migration-catalog-v3.ts)는 PG18만 허용하고 `pg_constraint.conenforced`, `conperiod` 등을 읽는다. 예약 시도 계약도 major 18을 고정한다. [B47-R](B47-R-DESCRIPTOR4-NATIVE-REVIEW.md)은 PG18.7 관측을 독립 재현했으며 결과는 승인·기준값 미확정이다. [B48-R](B48-R-OID-EQUIVALENCE-REVIEW.md)은 첫 정리 가드 불일치 뒤 독립 B 미실행, [B55-R](B55-R-METADATA-STARTUP-EVIDENCE-REVIEW.md)은 Startup 메타데이터 한정이다. schema 5 기준 카탈로그·상태 비교·runner·CLI와 PG17 지원 근거가 남아 있다. |
| 로컬 PG17.12 | T253은 별도 공개 승인·철회 시험이다. [첫 실패와 수정](T253-FIX3-JSONB-VALIDATION.md), 기존 재시험 `tmp/t253-r3-ecc6807-review/first-run.exit`의 0, `tmp/t253_c983fa283cf14ea4879d2fc3ac47164c/result.json`의 17.12·14개 검사·잠금 대기 2개·pidfile 부재·ECONNREFUSED를 읽었다. SQL SHA는 FIX3과 일치한다. 이 자료의 적용 범위는 T253 합성 fixture이며 프로젝트 읽기 스키마, v2 runner, 공급자 Auth·TLS 검증은 각각 남아 있다. |
| 관리형 PG17.12 | [B8 기존 읽기 진단](B8-MANAGED-CONNECTION-DIAGNOSIS.md)에서 main/PRODUCTION의 Session 연결이 17.12로 응답했다. 그 시점에 operator는 superuser가 아니고 CREATEROLE/database CREATE, `auth` USAGE, `auth.users` REFERENCES 및 적합한 UUID 고유 키가 관측됐다. 앱 스키마·이력·예약 역할은 당시 부재했다. Direct IPv6는 당시 실행 호스트에서 ENETUNREACH였다. 조회 당시의 자격과 대상 상태이며, 승인된 별도 스테이징, 적용·프로비저닝·런타임 검증 여부는 미확인이다. |

## 스테이징 실행 전제

1. 승인된 별도 스테이징의 환경·프로젝트 ref·DB·접속 프로필·실제 migration role을 고정한다. 직접 연결은 그 실행 호스트에서 경로가 확인된 경우 사용한다. Session은 공급자가 제시한 5432 주소·`role.ref` 라우팅 이름·실제 SQL role·DB/포트를 각각 바인딩하고 연결 뒤 대조한다. 현재 CLI 계약은 transaction 6543을 받지 않는다. migration DSN·CA와 승인 해시는 런타임 DSN과 분리한다. [B9 독립 검수](B9-R-SESSION-MIGRATION-REVIEW.md)
2. 서버 major·인코딩·collation, `session_user=current_user`, 유효 CREATE/CREATEROLE/REFERENCES, `auth.users` PK 또는 적합한 유일 키, 기존 이력·스키마·역할·grantor 관계를 확인한다. 승격하거나 기존 객체·역할을 인수할 권한을 추정하지 않는다. API login은 비소유자·NOSUPERUSER·NOBYPASSRLS·NOINHERIT이며 의도된 `dream_api`로만 SET 가능하도록 점검한다. migration·worker·API 자격은 분리한다. [기존 프로비저닝 템플릿](../../lib/db/postgres/provision-template.ts)은 정확한 스키마 3 이력을 요구하고 API와 worker를 함께 생성하므로, 읽기 전용 스테이징의 API login 단독 설정은 별도 검토 범위다.
3. B8/B11 마지막 기존 증거는 Session의 검증된 클라이언트 TLS와 own backend `pg_stat_ssl.ssl=false`다. [B11](B11-SSL-CHANGE-READINESS.md)에는 운영 enforcement OFF와 재시작을 수반하는 변경 절차가 기록돼 있다. **DEC-SSL-01 결정 대기를 유지한다.** 별도 승인된 스테이징에서 migration과 읽기 런타임 각각의 CA·호스트 검증을 확인하고 Session 양 구간의 증거를 남긴다. 운영 변경과 현재 TLS 상태 재확인은 이번 범위 밖이다.
4. 동일 소스·같은 대상의 승인된 dry-run에서 명시 버전과 예상 이력 상태를 확인한다. 이후 승인된 경우에만 해당 버전 apply를 실행한다. target/mode/manifest에 묶인 해시는 실행 대상을 확인하는 수단이며 승인 기록은 따로 둔다. 이력이나 카탈로그가 다르면 중단하고 차이를 반환한다.

## 두 계정 검증과 복구

1. 먼저 폐기용 로컬 PG17.12에서 고정 스키마 3으로 기존 runner/fixture의 dry-run, fresh apply, zero reapply, 실패 시 이력·객체 비적용을 시험한다. 현재 PG18.7 전용 launcher를 사용 중이면 별도 소유 PG17 launcher를 배정받아 고정 SQL과 검증 조건을 유지한다. 실제 실행이 통과한 뒤 승인된 스테이징에서 해당 범위를 재검증한다.
2. 스테이징 Auth의 합성 A/B 두 계정은 서로 다른 UUID로 검증하고 허용 목록에는 시험 계정만 둔다. A와 B 각각에 고유 표식의 활성 프로젝트, 완전한 단계 상태, 작업 상태를 넣고 A의 보관 프로젝트도 준비한다. fixture 입력은 별도 승인된 준비 주체가 만들며 HTTP POST를 시험용 데이터 적재에 사용하지 않는다.
3. 두 세션으로 목록 GET·상세 GET·클라우드 목록과 상세·개인 관리 화면을 확인한다. 각 세션은 자기 프로젝트와 집계만 200으로 받고 상대·보관·없는 상세는 같은 404여야 한다. 빈 목록의 200과 DB 장애의 503을 구분한다. 미인증·만료 401, 허용 밖 403, 잘못된 UUID 400, 민감한 DB 정보가 없는 오류, API no-store를 기록한다. 인증 전 거부에서 DB에 접근하지 않는지도 확인한다.
4. 동일한 런타임 login으로 actor 없이 DB 행이 보이지 않는지, pool max 1의 동일 backend를 A→B와 롤백 뒤 재사용할 때 role·actor가 원상 복귀하는지 확인한다. max 2에서는 동시 요청 간 격리를 확인한다. 시험 범위 안에서 읽기 전용 트랜잭션의 쓰기 거부, 읽기 실패의 안전한 503, 손상 연결 폐기와 다음 정상 요청의 회복을 관측한다. 기록은 상태·개수·교차 비교 결과만 남긴다. [B3 두 actor 검증](B3-POSTGRES-INDEPENDENT-REVIEW.md) · [기존 요청 통합 시험](../../tests/postgres/project-read-request-integration.test.ts)
5. 읽기 연결 실패 때는 스테이징의 읽기 플래그를 내려 사전 상태로 되돌리고 새 런타임을 띄워 이전 풀을 종료한다. 플래그를 끈 GET은 현재 계약상 비가용 상태를 돌려주므로 향후 별도 릴리스 적용 시에는 직전 배포도 복원 대상으로 기록한다. SQL 오류에서 확실한 ROLLBACK은 이전 상태로 검증한다. COMMIT 결과가 불확실하면 신규 읽기 전용 연결로 동일 대상의 이력과 카탈로그를 대조하고 판정이 끝날 때까지 재적용하거나 보상 DDL을 실행하지 않는다. 이미 적용된 스키마에는 자동 down 경로가 없다. 백업·복구가 필요한 대상은 실행 전에 복원 시험과 복구 시점을 별도로 정한다.

## 후속 최소 구현안

첫 후속 단위로 **고정 SQL 1~3과 기존 v2 schema 3 dry-run/apply를 재사용하는 폐기용 PG17.12 검증**을 제안한다. 정확한 스키마의 초기 적용·재실행과 위 A/B 읽기·정리 판정을 고정 보고로 반환한다. PG17 카탈로그 차이가 나오면 차이와 원인을 고정하고, 버전별 정규화나 reference 변경은 그 차이만 대상으로 검토한다. 기존 런타임에서 스테이징 CA 신뢰가 재현되지 않으면 다음 코드 변경은 서버 전용 읽기 풀에 검증된 CA를 명시적으로 bind하는 데 한정한다. 관리형 스테이징의 대상·권한·양 구간 TLS·API login을 확인한 뒤 기존 GET만 연결한다. 기존 자료의 SQLite→Postgres 데이터 변환과 Storage 의존 쓰기는 별도 단위다.

Master 전달문 — T256 보고 준비 완료. 기준 `5e07360`에서 목록·상세·개인 관리 경로, getUser→UUID→읽기 전용 트랜잭션/RLS, 마이그레이션 3/4/5와 PG18·로컬 PG17·관리형 PG17의 증거 범위를 대조했습니다. 우선 고정 스키마 3을 폐기용 PG17.12에서 이관·두 계정으로 검증하고, 양 구간 TLS 및 역할이 확인된 별도 스테이징에서 읽기만 연결하는 안을 제시했습니다. DEC-SSL-01 결정 대기를 유지합니다. Tester 독립 절차 검토에 바로 사용할 수 있습니다.
