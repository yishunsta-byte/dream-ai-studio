# T358 프로젝트 HTTPS 조회 전용 DB 설치 후보

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_cd7690f053c1` · T356 기준 `633c10b`

별도 SQL로 `project_read.project_list`와 `project_read.project_detail`을 설치한다. T349/T351의 호출자 권한 뷰와 T356의 명시적 선택 방식을 유지했다. 저장소의 기반 마이그레이션과 제품 기본 설정을 변경하지 않았다. [설치 SQL](../../lib/db/postgres/project-https-read/0001_install.sql) · [복귀 SQL](../../lib/db/postgres/project-https-read/0001_remove.sql)

| 항목 | 설치 후보의 동작 |
| --- | --- |
| 적용 전조건 | PG17 이상, 검증된 기반 SQL 1–3, 기반 프로젝트·단계·작업 테이블의 공통 소유자, DB의 스키마 생성 권한, 기존 Supabase의 `auth.uid()`와 `authenticated`·`anon`·`authenticator` 역할이 필요하다. `authenticated`와 `anon`은 직접 로그인 권한이 없어야 한다. 설치 역할에는 `auth.uid()`를 참조할 권한이 있어야 한다. 런타임 로그인이나 새 DB 역할은 생성하지 않는다. |
| 조회 범위 | 개인 승인 목록에 UUID가 등록되어 있고 `auth.uid()`와 소유자가 일치하는 활성 프로젝트만 조회한다. 단계·작업도 소유자와 활성 프로젝트를 함께 확인한다. 내부 승인 정보는 자체 RLS로 자기 UUID만 허용하며 승인 스키마와 `dream`의 직접 `USAGE`는 부여하지 않는다. |
| 최소 권한 | 인증 역할은 조회 프로필의 `USAGE`와 두 뷰의 `SELECT`를 받는다. 호출자 권한 뷰가 참조하는 기반 열에만 `SELECT`를 부여한다. `owner_id`는 정책에서만 쓰며 읽기 권한을 추가하지 않는다. 승인 등록은 비어 있는 상태에서 시작한다. |
| 충돌과 복귀 | 두 예약 스키마 중 하나라도 존재하거나, 예약 정책·기존 브라우저 권한·충돌 정책·열 타입·강제 RLS가 맞지 않으면 설치를 중단한다. 기본 권한에서 예상 밖의 ACL이 생겨도 트랜잭션을 롤백한다. 복귀는 버전 표식이 있는 객체와 후보의 정책·열 권한을 대상으로 하고, 추가 객체나 의존성이 있으면 `RESTRICT`에 따라 전부 롤백한다. |

## 대상 승인 이후 적용과 확인

1. 승인된 대상의 PostgreSQL 버전, 실제 DB와 설치 역할, 기반 이력의 승인된 ID·체크섬, 기존 Data API 노출 스키마, 기존 권한과 정책을 읽기 전용으로 기록한다. 실제 제공자 역할이나 ACL이 전조건과 맞지 않으면 중단해 조정한다.
2. 해당 DB의 검증된 연결에서 공통 소유자 역할로 `psql -X -v ON_ERROR_STOP=1 -f lib/db/postgres/project-https-read/0001_install.sql`을 명시해 실행한다. 파일 자체가 트랜잭션을 사용한다. 기존 쓰기와 잠금이 겹칠 수 있으므로 보수적인 적용 시간대를 잡는다. 연결이 끊겨 결과가 불명확하면 같은 SQL을 다시 실행하기 전에 대상의 스키마 표식·권한·정책을 읽어 적용 여부를 확인한다.
3. 설치 역할에서 `project_read_private.approved_users(id)`에 검증된 계정 UUID만 매개변수로 등록한다. 앱의 기존 허용 이메일 규칙도 함께 충족해야 한다. 위 테이블은 Auth의 쓰기·삭제를 변경하는 외래키나 트리거를 만들지 않으므로 계정 회수 시 승인 UUID도 운영 절차에서 삭제한다.
4. 승인된 스테이징의 Data API 노출 목록에 `project_read`만 추가하고, `dream`, `auth`, `project_read_private`는 노출하지 않는다. 기존 노출 항목은 보존한다. 스키마 캐시 갱신 후 익명 401, 허용 계정 A/B 소유자별 목록·상세, 타인·보관·미승인 조회 빈 결과, 승인 회수, 쓰기 차단을 확인한다. `Accept-Profile: project_read`와 응답 `Content-Profile`, 목록/상세의 `Content-Range`도 확인한다.
5. 확인을 마친 환경만 T356의 `DREAM_PROJECT_READ_BACKEND=supabase-https`, `DREAM_PROJECT_HTTPS_REF`, `DREAM_PROJECT_HTTPS_PROFILE=project_read`를 사용한다. 프로젝트 생성과 기존 쓰기, 기반 이력, 앱 GET의 404·503과 `no-store`를 다시 대조한다. [T356 연결 및 설정](T356-PROJECT-HTTPS-READ-APP-INTEGRATION.md)

## 복귀

앱의 조회 설정을 이전에 승인한 값으로 되돌리고 Data API 노출 목록에서 `project_read`만 제거해 캐시를 갱신한다. 승인 목록의 보존이 필요하면 별도 승인으로 보호된 저장소에 먼저 보관한다. 같은 설치 역할에서 `psql -X -v ON_ERROR_STOP=1 -f lib/db/postgres/project-https-read/0001_remove.sql`을 실행한다. 성공하면 승인 목록도 삭제된다. 이후 두 스키마와 세 후보 정책이 없고 추가한 열 권한이 회수됐는지 확인한다. 기반 이력, 기존 ACL·RLS, 기존 조회·쓰기 동작을 적용 전 기록과 대조한다. 복귀가 거절되면 객체를 강제로 연쇄 삭제하지 않고 대상 상태를 확인한다.

## 자체 검증

- `node --conditions=react-server --import tsx tests/postgres/t358-project-https-read-schema.pg17.ts`로 소유 PG17.12와 PostgREST 16.6의 실제 루프백을 검증했다. 기반 마이그레이션 러너로 생성한 이력, 비슈퍼유저 공통 소유자 설치·복귀, 부분 객체/예약 정책/열 타입/RLS/권한 충돌, 중간 ACL 실패 롤백, 반복 실행 차단, 승인 추가·회수, 페이지 범위와 상세 응답, 익명·다른 프로필·쓰기 차단을 확인했다. 복귀 중 예상 밖 객체가 있으면 모든 변경이 롤백됐다. 정상 복귀와 재설치에서 기존 프로젝트·단계·작업 쓰기와 기반 행·이력·권한·정책·트리거를 대조했다. 소유 프로세스와 포트, 임시 클러스터를 정리했다. [격리 실행기](../../tests/postgres/t358-project-https-read-schema.pg17.ts)
- PostgreSQL·프로젝트 읽기 회귀 1,079개 통과, 환경 조건부 시험 300개 건너뜀. 새 실행기의 ESLint 및 기존 생성 `.next` 검증 파일을 제외한 소스 TypeScript 검사 통과.
- 독립 Tester 검수와 실제 관리형 Supabase 설치 역할·기본 ACL·Data API 노출 확인은 후속이다. 운영 대상 접속, 데이터 이관, 권한 변경 또는 배포는 이번 작업에서 수행하지 않았다.

> T358 조회 전용 설치·복귀 후보와 로컬 PG17/PostgREST 검증을 완료했습니다. 승인된 사용자만 자기 프로젝트를 읽고 승인 회수 즉시 조회가 차단되는 것을 확인했으며, 설치·복귀 전후 기존 쓰기와 기반 이력을 대조했습니다. Tester의 독립 검수를 요청합니다.
