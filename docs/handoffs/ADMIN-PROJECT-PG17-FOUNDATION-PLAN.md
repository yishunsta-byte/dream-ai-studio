# 관리자 내 프로젝트 운영 PG17 기반 적용 순서

2026-11-20 · Master 배정 `msg_4921a8cf21a3` · 관리자 구현 `29860f3` 및 격리 검수 `7a73cb9`.

Master의 읽기 전용 SQL Editor 관측에 따르면 기존 Dream AI Studio Supabase는 PG 17.12(`170012`)이고 `dream.projects`, `dream.stage_states`, `dream.jobs`, `dream_api`, `dream_worker`, `project_read`, `project_read_private`가 없다. 같은 대상의 공개 Data API에서도 `project_read` 미노출을 확인했다. 남은 `dream`·`dream_migrations` 스키마, 이력, 예약 로그인, Auth 계약과 실효 권한은 적용자 세션의 읽기 검사에서 확인해야 한다. [운영 Data API 사전 점검](ADMIN-PROJECT-PRODUCTION-READ-PREFLIGHT.md)

## 적용 후보와 검증 순서

1. **기존 운영 DB와 이관 주체를 지정한다.** 동일 대상과 `UTF8`, 실제 설치 역할의 DB `CREATE`·`CREATEROLE`, `auth` `USAGE`, `auth.users(id uuid)`의 PK/UNIQUE 및 `REFERENCES`, 기존 `auth.uid()`의 안정성·`authenticated` 실행 권한, Supabase 게이트웨이 역할 전환과 기본 ACL을 읽는다. 이관 주체가 새 기반 테이블의 공통 소유자가 돼야 T358도 같은 주체로 적용할 수 있다. 예약 스키마·이력·역할의 예상 밖 일부 객체가 있으면 상태 판정부터 한다. 과거 Session 접속의 클라이언트 쪽 TLS와 DB 세션 SSL 결과는 별개다. 실제 운영 연결의 대상·CA·역할 및 TLS 관측이 필요하다. [T346 접속 판정](T346-EXISTING-PROJECT-READ-PREFLIGHT.md) · [T362 카탈로그 검사](T362-CATALOG-ACCESS-STATUS.md)
2. **고정 v2 러너에서 스키마 3을 적용한다.** [CLI](../../scripts/postgres/migrate-v2.ts)의 `fingerprint --schema 3 --mode dry-run`과 `fingerprint --schema 3 --mode apply`가 각각 대상·모드·[고정 매니페스트](../../lib/db/postgres/migration-manifest-v2.ts)를 묶는다. 권한자가 대상과 실행을 승인한 뒤 `dry-run --schema 3`에서 `pending=3`을 확인하고 `apply --schema 3`을 사용한다. 승인 실행은 파일 순번대로 SQL과 `dream_migrations.history`를 같은 트랜잭션에 기록하고 전체 카탈로그와 역할을 대조한다. 적용 뒤 이력 3개와 `pending=0`을 다시 읽는다. SQL 파일을 개별 실행하면 러너의 고정 이력이 남지 않는다. PostgreSQL 17.12에서 스키마 3 최초 적용 3건, 재실행 0건, 카탈로그 변형 차단과 비슈퍼유저 설치 및 제한 API A/B 검수를 확인했다. [T258-R](T258-R-PG17-SCHEMA3-CATALOG-REVIEW.md) · [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)
3. **T358 조회 권한을 별도로 설치한다.** 기반 공동 소유자가 같은 DB에서 [T358 설치 SQL](../../lib/db/postgres/project-https-read/0001_install.sql)을 적용한다. 기반 3표의 ENABLE/FORCE RLS·동일 소유·열 계약, 브라우저 역할의 기반 스키마 접근과 기존 승인 없는 SELECT/ALL 정책 부재가 선행조건이다. 두 스키마와 승인 표, 호출자 권한 뷰 3개, 세 기반 정책 및 필요한 열의 SELECT만 더한다. `authenticated`에는 공개 목록·상세만 열리고 `anon`·`authenticator`의 직접 조회, 기반 스키마와 승인 스키마 `USAGE`, 쓰기와 재부여 권한을 검증한다. 설치 후 T362의 목록·정의·권한·RLS 검사를 재실행한다. [T358 설치 및 복귀](T358-PROJECT-HTTPS-READ-SCHEMA-CANDIDATE.md)
4. **승인 계정과 표시할 자료를 결정한다.** 운영 권한자가 실제 대표 계정의 Auth UUID를 확인하고 해당 읽기용 승인만 등록한다. 빈 신규 DB를 사용할지 기존 작업실 자료를 옮길지를 먼저 정한다. 부가 검수를 위한 A/B 계정·자료가 승인되면 익명·타인·보관 상세 차단과 승인 회수·복구를 확인한다. `project_read` 공개 프로필만 기존 Data API 노출 목록에 추가하고 캐시를 새로 읽힌다. `dream`, `auth`, `project_read_private`는 비공개로 유지한다.
5. **앱 읽기를 마지막에 전환한다.** 확인한 대상에서 `DREAM_PROJECT_READ_BACKEND=supabase-https`, 운영 프로젝트 참조, `DREAM_PROJECT_HTTPS_PROFILE=project_read`와 검수된 제품 후보를 연결한다. 같은 계정의 관리자·개인 목록, 실제 상세, 재조회, 오류와 정상 0건, `no-store`, 인증 거절을 확인한다. 앱의 생성·편집·렌더 쓰기는 읽기 전환과 별도다. [T356 앱 조립](T356-PROJECT-HTTPS-READ-APP-INTEGRATION.md)

## 번호 SQL과 UUID

| 순번 | 고정 파일 | 역할 |
| --- | --- | --- |
| 1 | [`0001_schema.sql`](../../lib/db/postgres/0001_schema.sql) | 18개 기반 표와 기존 Supabase Auth UUID 외래 키 |
| 2 | [`0002_invariants.sql`](../../lib/db/postgres/0002_invariants.sql) | 이력 불변과 타임라인·요청 검증 트리거 |
| 3 | [`0003_rls.sql`](../../lib/db/postgres/0003_rls.sql) | NOLOGIN `dream_api`·`dream_worker`, 18표 FORCE RLS와 36정책 |

PG17의 `uuid` 열에 앱에서 만든 UUID를 저장한다. 이 번호 SQL은 PostgreSQL의 `uuidv7()` 호출이나 UUID 확장 설치를 요구하지 않는다. 신규 프로젝트 생성 코드의 UUIDv7은 앱의 `uuid` 패키지에서 만든다. 고정 v2의 PG17 지원 경로는 스키마 3이다. 스키마 4 러너 적용은 확인된 PG17 경로가 아니며 SQL5와 소유 로컬 시험용 업로드·출력 SQL도 이번 기반 설치에 포함되지 않는다. [UUID 생성 코드](../../lib/services/postgres/project-create.ts)

현재 소스에서 v2 로더가 번호 SQL 세 파일의 체크섬을 모두 검증했다. v2 마이그레이션·CLI·Session 회귀 126건 통과, 조건부 34건 제외다. 기존 T361의 기본 실행과 관리자 증분의 소유 PG17/HTTPS 시험도 통과했다.

## 기존 프로젝트와 쓰기 결정

스키마 적용은 기존 SQLite 자료를 옮기지 않는다. 로컬 SQLite에는 사용자별 소유자 정보가 없다. 이전할 경우 프로젝트별 소유자 매핑, ID 보존, 원본 JSON 해시·시간·리비전·첨부 확인, 비공개 파일과 상대 경로를 소유자 객체 키로 변환 및 무결성 검증, 완료 이력의 별도 처리와 복구가 필요하다. 기존 변환기나 운영 이관 완료 근거를 확인하지 못했다. 아무 자료도 등록하지 않으면 승인된 계정의 운영 목록은 0건이다. 운영에 새 자료를 생성하려면 별도의 쓰기 서비스와 제한 API/처리기 로그인, Storage 권한·무결성·처리기 검증이 필요하다. 현재 `owned-pg17` 생성 경로는 릴리스 운영 모드에서 닫힌다. 브라우저 역할에 추가 쓰기를 부여할 이유는 없다. [기존 형식 차이](../../lib/db/postgres/README.md) · [현재 생성 경계](../../lib/cloud/local-project-create.ts)

## 복귀와 남은 입력

- 번호 SQL의 실패는 러너가 트랜잭션을 롤백한다. 커밋 결과가 불명확하면 읽기 검사로 이력을 확인한다. 커밋 뒤에는 기존 앱 설정·배포부터 되돌리고 새 조회 노출과 해당 승인을 회수한다. 기반 스키마의 포괄적 내리기 도구는 없다. 기존 자료를 자동 삭제하지 않는다.
- 조회 스키마도 제거해야 하면 승인 기록을 보존할지 확인하고 설치 주체가 [T358 복귀 SQL](../../lib/db/postgres/project-https-read/0001_remove.sql)을 사용한다. 기존 기반 이력, ACL·RLS·트리거와 조회·쓰기 상태를 기준선과 비교한다.
- 미결정 입력은 운영 이관 주체와 접속 프로필, 새 빈 운영 프로젝트 시작 또는 SQLite 자료 이전, 대표 계정 승인 범위와 시험 계정·자료, 기존 운영 배포/설정 기준선이다. 이번 대조에서 운영 DDL, 승인 행, 환경 설정을 적용하지 않았다.

**Master 전달문** · 기존 PG17.12에는 먼저 고정 v2 `--schema 3`으로 SQL 1–3 및 이력을 같은 트랜잭션에 적용하고, 같은 기반 소유자로 T358을 설치하는 순서입니다. SQL에는 PG18 UUIDv7 함수 의존이 없습니다. 빈 운영 프로젝트와 기존 SQLite 자료의 소유자 검증을 거친 별도 이전 중 진행 방식을 결정해야 합니다. 운영 이관 주체·접속 및 승인 계정·자료도 지정해야 합니다.
