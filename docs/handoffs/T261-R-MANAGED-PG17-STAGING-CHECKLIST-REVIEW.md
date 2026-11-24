# T261-R 관리형 PG17 시험 절차 독립 검토

**판정. 단계와 중단 기준은 대체로 구현과 맞는다. 실제 시험은 1단계의 승인된 대상 매핑이 확인될 때까지 보류한다.** 저장소·기존 로컬 기록에서 별도 Supabase 시험 프로젝트와 그 대상만 사용하는 보호 Vercel Preview의 승인된 쌍을 입증할 자료를 찾지 못했다. 승인된 매핑이 확인되면 폐쇄된 시험 범위에서 읽기 전용 2~3단계부터 시작할 수 있다. 그 전에 필요한 실행 절차의 보완점은 아래에 기록했다.

기준 `1b42550a128dd41cacb48864ae45ac2142b966cf` 및 [T261 체크리스트](T261-MANAGED-PG17-STAGING-CHECKLIST.md). 작업본 문서 SHA-256은 `55a80346763ee5d26fd12fd8569d2bcba0402f13614e7eada24819a5444fe565`다. 이전 `aa79427` 대비 커밋 변경은 체크리스트 한 파일이고 제품 코드·SQL은 동일했다. 지정 검수 경로의 점유 충돌이 없어 Orca `msg_c7ecd93b1c3e`로 수락했다. 외부 서비스 조회, DB 접속·명령, 설정·배포 변경은 수행하지 않았다.

## 단계별 착수 판정

| 단계 | 현재 판정과 재개 조건 |
| --- | --- |
| 1. 시험 쌍 식별 | **미확인.** B7의 Production/Preview 표시는 프로젝트의 환경 이름만 확인한다. B8·B11의 실제 연결은 당시 main/PRODUCTION에 관한 기록이다. 별도 시험 Supabase 프로젝트·Auth·DB, 그 프로젝트만 바라보는 보호 Preview의 ID·고정 SHA·환경 변수 스코프, 운영 Current 분리, 승인 기록을 같은 매핑으로 묶는 근거가 필요하다. 지금 문서·기존 승인 기록을 대조하는 작업은 가능하다. [B7 환경 관측](B7-MANAGED-ENVIRONMENT-CHECK.md) · [B8 연결 진단](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B11 TLS 상태](B11-SSL-CHANGE-READINESS.md) |
| 2. 이관 연결·TLS | **보류.** 승인 매핑과 지정 접속 범위가 확정되면 실행 호스트에서 해당 제공자 Direct 또는 Session으로 읽기 전용으로 시작할 수 있다. 이전 Direct IPv6 경로 실패나 Session 클라이언트 TLS 성공을 새 대상에 승계할 수 없다. 실제 client 검증과 같은 SQL 세션의 backend TLS를 각각 기록한다. |
| 3. 권한·fingerprint·dry-run | **명령 확인, 실제 대상 미확인.** 오프라인 fingerprint 문법이 맞다. DB 읽기에는 1~2단계와 별도 모드 해시가 필요하다. PG17, 역할 속성, FK의 비지연성 등은 B6 예시와 v2 출력만으로 모두 확인되지 않는다. |
| 4. 스키마 3 apply | **보류.** 같은 대상·역할·SHA에서 2~3단계 통과 및 apply 배정이 필요하다. 로컬 비슈퍼유저 증거는 지원 범위를 보여 준다. 관리형 CREATEROLE, 카탈로그, Auth 객체와 role graph는 실제 읽기 결과로 판정한다. |
| 5. 제한 로그인 역할쌍 | **보류.** 정상 스키마 3과 v2 재검사, 기존 역할쌍 유무·정확한 grantor 확인을 선행한다. 두 역할이 이미 정상이라면 재생성하지 않는다. 한 로그인만 있는 상태는 별도 판정이 필요하다. |
| 6. 보호 Preview·런타임 | **보류.** 보호된 정확한 배포와 시험용 Auth·제한 API DSN의 일치, 실제 Preview 런타임에서 동일 pg 경로의 TLS 수집 방법을 먼저 고정한다. 운영 Current 및 환경 스코프의 변경 없음은 각각 증거로 남긴다. |
| 7. 실제 Auth A/B와 fixture | **보류.** 시험 전용 실제 사용자 두 계정과 Preview의 신뢰 origin 및 사용 중인 콜백 경로를 확인한다. 승인된 쓰기 및 폐기 범위를 고정한 뒤 제한 로그인과 검증된 actor로 fixture를 준비한다. |
| 8. 독립 합격 시험 | **보류.** 로컬 T259의 4건은 실제 DB와 합성 `getUser` 경로다. 같은 범위를 실제 지명 Preview와 독립 A/B 세션에서 다시 관측해야 한다. 403, 401, 정상 빈 목록, 제어된 DB 실패를 낼 선행 상태를 먼저 정한다. [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md) |
| 9. 종료·복구 | **절차 확인, 실행 전.** 접근 중지, 설정과 배포 복귀, 새 런타임, 자격 회수와 fixture 폐기 조건을 최초 상태와 함께 미리 고정한다. 복구할 실제 대상이나 실행 결과는 없다. |

## 고정 구현과 실행 전 보완

1. **CLI와 승인 바인딩.** v2의 `fingerprint --schema 3 --mode dry-run|apply`, `dry-run --schema 3`, `apply --schema 3` 문법과 명시적 env 키를 확인했다. fingerprint는 로컬 manifest를 검증하고 네트워크를 사용하지 않는다. `managed-staging`은 제공된 Direct host를 ref와 대조하며 `managed-session-staging`은 제공 host, 5432, DB, `role.ref` 라우팅과 실제 SQL role을 명시적으로 비교한다. target hash는 논리 대상에 묶이고 approval hash는 runner v2·스키마·모드·고정 manifest를 추가로 묶는다. 해시에 암호·CA·DB 상태나 실제 승인 기록은 포함되지 않는다. CLI는 dry-run/apply마다 자체 연결을 열므로, 앞선 접속 관측은 동일한 승인 프로필과 실제 실행 환경에서 연결 조건을 재대조하는 근거로 사용한다. [v2 CLI](../../scripts/postgres/migrate-v2.ts) · [대상 검사](../../lib/db/postgres/migration-target.ts) · [v2 runner](../../lib/db/postgres/migration-runner-v2.ts)
2. **읽기 전용 사전점검을 보강한다.** B6의 예시와 v2는 `auth.users.id`의 UUID·NOT NULL·유효·고유·비부분·단일 키를 확인하지만 `pg_index.indimmediate`를 확인하지 않는다. 같은 읽기 세션에서 비지연 FK 적격성까지 확인해야 T261의 합격 기준을 충족한다. v2 입구의 서버 버전 검사는 `>=160000`이다. PG17 스키마 3의 전용 카탈로그 비교가 있는 것과 별개로, 승인한 major 17, 실제 minor·collation, `CONNECT`, migration role의 `NOBYPASSRLS`·`NOINHERIT` 및 대상 식별은 추가 읽기 receipt에 포함한다. 이전 Auth 사용자 행을 읽을 필요는 없다. [B6 사전점검 SQL](B6-MANAGED-PREFLIGHT.md) · [v2 상태 검사](../../lib/db/postgres/migration-state-v2.ts)
3. **두 TLS 경계와 Preview 연결 지점을 분리한다.** CLI Session은 명시 CA를 요구하고 공유 pg 설정은 `rejectUnauthorized: true`를 유지한다. B8·B11은 당시 클라이언트→pooler 인증서·호스트 검증과 자체 `pg_stat_ssl.ssl=false`를 각각 기록했다. B6의 `COALESCE` 예시로는 backend TLS false와 행 부재를 구별해 기록할 수 없다. 승인 대상에서는 클라이언트 CA·호스트 검증 및 같은 SQL 세션의 `pg_stat_ssl` 행 수와 값, 실제 풀의 startup 옵션 수용을 관측한다. Preview 앱은 migration CA를 상속하지 않고 `DATABASE_URL`의 형식만 검사하므로, Auth 프로젝트와 DB 타깃의 일치를 운영자가 확인해야 한다. 읽기 opt-in이 꺼진 상태에서 제품 GET은 pg pool을 열지 않는다. 6단계에서 opt-in 전 앱 경로의 TLS 증거를 요구한다면 승인된 보호 런타임의 제한 읽기 검증 수단을 먼저 정해야 한다. 별도 데스크톱 연결이나 보호되지 않은 진단 엔드포인트로 대신하지 않는다. [연결 생성](../../lib/db/postgres/connection.ts) · [런타임 풀](../../lib/services/postgres/project-read-pool.ts) · [읽기 선택자](../../lib/services/postgres/project-read-backend.ts)
4. **기존 역할쌍과 이력 보존.** `migrate.ts provision-template`는 고정 SQL 문자열만 출력한다. 템플릿의 SQL 1~3 체크섬은 v2 schema 3과 일치한다. 적용 시 이력 소유자·정확한 3행·역할 그래프를 검사하고 두 제한 로그인을 트랜잭션으로 만든다. SQL 3이 생성한 역할에는 18개 테이블 FORCE RLS 및 정책 36개가 있다. T259 격리 증거는 비슈퍼유저의 admin-only 자동 간선과 정상 역할쌍 reapply를 입증한다. 런타임 `dream_api`에는 DML 권한이 있으므로 GET의 쓰기 차단은 `REPEATABLE READ READ ONLY` 트랜잭션과 호출 범위로 검증할 필요가 있다. API-only 또는 예상 밖 간선은 별도 판정한다. [템플릿](../../lib/db/postgres/provision-template.ts) · [RLS](../../lib/db/postgres/0003_rls.sql) · [actor 트랜잭션](../../lib/db/postgres/transaction.ts)
5. **실제 Auth의 성공과 거부를 별도 조건으로 둔다.** 요청 origin은 `DREAM_SITE_URL` 또는 앱이 인정하는 Vercel 제공 URL에 들어야 한다. 확인된 Preview의 실제 호스트와 사용 중인 Supabase 콜백 허용 경로를 맞춘다. 현재 로그인 POST는 시험 allowlist 밖 이메일을 유효한 세션을 만들기 전에 `400 INVALID_CREDENTIALS`로 거절한다. 따라서 보호 GET의 403은 이미 유효한 시험 세션이 있으면서 앱의 허용 목록에서 제외된 조건을 승인된 방식으로 마련해야 한다. 로그인 POST 거절이나 Preview 보호 화면을 앱 GET 403 대신 세지 않는다. 만료 대조는 갱신으로 회복되는 access token 만료와 실제 인증이 끊긴 세션을 구분한다. 정상 빈 목록은 fixture 시드 전 또는 활성 자료 없는 지정 계정에서 확인하고, DB 오류 503은 별도 승인된 실패 조건으로 준비한다. [로그인 POST](../../app/api/auth/login/route.ts) · [신뢰 origin](../../lib/auth/config.ts) · [서버 인증](../../lib/auth/resolve.ts) · [GET 읽기](../../lib/services/postgres/project-read-request.ts)
6. **종료와 불확실성 판정.** `apply`와 역할쌍 provisioning에서 COMMIT이 불확실하면 새 읽기 연결로 저널·카탈로그 또는 역할쌍·간선을 확인하기 전 재실행하지 않는다. 기존 역할 존재를 정상 원복으로 추정하지 않는다. 프로세스 풀은 한 DSN에 고정되고 플래그 off의 GET은 비가용이어서, 이전 동작 복구를 목표로 하면 테스트 설정·이전 배포를 복원하고 새 런타임에서 실제 응답을 확인한다. 합성 fixture의 Auth FK가 `ON DELETE RESTRICT`인 점을 반영해, 계정 폐기 전에 승인된 종속 자료 정리 또는 합의된 시험 DB 복원을 고정한다. 서비스를 다시 여는 시점은 복구 검증 후다. [v2 정리와 결과 분류](../../lib/db/postgres/migration-runner-v2.ts) · [프로젝트 읽기 풀](../../lib/services/postgres/project-read-pool.ts) · [소유 관계 스키마](../../lib/db/postgres/0001_schema.sql)

가장 먼저 필요한 입력은 승인 근거를 포함한 **별도 시험 Supabase–보호 Preview 매핑**이다. 기존 승인 매핑이 확인되면 이미 허용된 범위에서 담당자가 읽기 사전점검을 진행할 수 있다. 환경 생성·비용·소유자 인증을 새로 결정해야 하는 경우에만 해당 결정을 구분한다. 운영 `DEC-SSL-01`은 기존 대기 상태다.

## Master 전달용

> T261-R 독립 절차 검토 완료. 1b42550과 로컬 근거를 대조했습니다. 승인된 별도 Supabase–보호 Vercel Preview 매핑 근거가 없어 실제 착수를 보류합니다. v2 명령·해시·역할쌍·복구 절차는 고정 코드와 일치합니다. 승인 매핑 뒤 읽기 전용 2~3단계로 시작하며, FK 비지연성/PG17·권한 확인, 실제 Preview 런타임에서 양 구간 TLS 수집 방법, 신뢰 origin과 유효 세션의 GET 403 조건을 먼저 고정해야 합니다. 결과 `docs/handoffs/T261-R-MANAGED-PG17-STAGING-CHECKLIST-REVIEW.md`에 단계별 상태와 보완점을 기록했습니다. 외부/DB 접속과 운영 변경은 없었고 DEC-SSL-01은 대기입니다.
