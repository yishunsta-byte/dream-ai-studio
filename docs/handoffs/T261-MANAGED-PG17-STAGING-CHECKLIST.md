# T261 관리형 PG17 스테이징 실행 체크리스트

2026-11-18 KST · Codes(Backend) · 절차 정리 완료, 실제 실행 전

**첫 실행 조건은 승인된 별도 Supabase 시험 대상과 그 대상만 바라보는 보호된 Vercel 시험 환경을 식별하는 것이다.** 현재 저장소 기록에는 두 환경의 매핑을 확인한 증거가 없다. Master가 기존 승인 범위에서 대상을 확정하면 Backend는 읽기 전용 사전점검부터 시작할 수 있다. 이 문서는 실제 접속·설정·배포의 배정을 대신하지 않는다.

기준 `aa79427f8eb1c85f8f260730b71e17ea6cc1c682`, 배정 `msg_764788c6a1eb`, 수락 `msg_ed1a5042b40b`. 수용된 근거는 PG17.12 비슈퍼유저·제한 DB 로그인과 합성 A/B, 깨끗한 사본의 전체 타입 검사다. 실제 관리형 환경의 권한·TLS, 공급자 로그인을 통한 A/B 요청, Vercel 시험 HTTP와 운영 분리는 아래에서 새로 확인한다. [T256-R](T256-R-MANAGED-PG17-PREFLIGHT-REVIEW.md) · [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md) · [T260-R](T260-R-WHOLE-TYPECHECK-RECOVERY-REVIEW.md)

T261-F1은 `1b42550a128dd41cacb48864ae45ac2142b966cf` 기준의 독립 검토를 반영했다. 배정 `msg_6c39da479550`, 수락 `msg_54271c9f025e`. [T261-R](T261-R-MANAGED-PG17-STAGING-CHECKLIST-REVIEW.md)

각 단계에서 **확인됨 / 미확인 / 중단**과 UTC 관측 시각, 책임자, 고정 소스 SHA, 대상 일치 여부, 관측값, 다음 조건을 한 줄로 남긴다. 이관 증거에는 target hash와 필요한 manifest·카운트·안전한 오류 코드만 남긴다. 계정은 A/B로 표기하고, DSN·토큰·비밀번호·쿠키·사용자 식별자 원문은 지정 보안 채널 밖에 남기지 않는다.

## 대상 식별과 DB 적용

| 순서 | 확인 경로와 책임자 | 통과 기준과 증거 | 중단·재개·복구 |
| --- | --- | --- | --- |
| ☐ 1. 두 시험 환경 식별 | **Master**가 승인·담당 기록을 대조한다. **플랫폼 담당**은 향후 배정 후 Supabase Dashboard의 조직·프로젝트 및 Connect 화면과 Vercel의 프로젝트·Deployments·환경변수 적용 범위를 확인한다. | 정확한 Supabase 시험 project ref와 DB, 제공 endpoint/port, 대응하는 Auth URL, Vercel 프로젝트·보호된 Preview/시험 URL·환경 범위를 한 쌍으로 고정한다. 데이터 유무와 시험 쓰기 범위, 복귀할 Preview·설정 및 DB 복원 기준을 기록한다. 승인된 Preview 후보와 운영 Current의 배포 ID·환경·소스 SHA를 각각 기록하고, 시험 브랜치 연동이 운영 배포를 일으키지 않음을 확인한다. | 승인 또는 매핑이 불명확하면 DB·Auth·Vercel 작업을 보류한다. 기존 승인 대상을 찾을 수 없을 때만 Master가 환경 선택을 취합한다. 과거 main/PRODUCTION의 B8/B11 환경은 운영 이력으로만 사용한다. |
| ☐ 2. 이관 연결과 TLS | **Backend + 지정 비밀 담당**이 실행할 호스트에서 Connect의 정확한 Direct 또는 shared Session 경로를 사용한다. Direct는 `managed-staging`, 승인된 Session 5432는 `managed-session-staging`을 선택한다. Session은 제공 host/port/database/라우팅 username과 실제 SQL role을 각각 바인딩한다. | 동일한 접속에서 승인한 PG major 17, 실제 minor·collation, DB·`session_user=current_user`·backend port 일치를 기록한다. 검증된 CA·일치하는 호스트/SNI·`rejectUnauthorized=true`의 클라이언트 TLS와, 그 세션의 `pg_stat_ssl`에서 `pg_backend_pid()`에 대한 정확히 한 행의 `ssl=true`를 확인한다. Session은 두 관측을 따로 기록한다. | Direct 경로가 닫혀 있으면 승인된 Session 연결 대상으로 다시 대조한다. 신뢰 실패, role/ref 불일치, SSL false·NULL·행 부재면 해당 연결에서 진입을 멈춘다. 검증 해제·임의 pooler 추정·transaction 6543·live 프로필·다른 자격으로 재시도하지 않는다. CA 또는 연결 조건을 수정한 뒤 새 접속으로 이 항목을 다시 확인한다. |
| ☐ 3. 읽기 전용 권한·상태 확인 | **Backend**가 2번과 같은 migration login으로 B6 읽기 검사, 아래 FK 적격성 조회와 v2 스키마 3 fingerprint/dry-run을 실행한다. 대상 hash와 모드별 approval hash는 **Master/지정 실행자**가 승인된 정보에 대조한다. | 비슈퍼유저·NOBYPASSRLS·NOINHERIT 이관 역할의 CONNECT/DB CREATE·CREATEROLE, `auth` USAGE·`auth.users` REFERENCES가 유효하다. Auth의 `id`는 UUID·NOT NULL이며 실제 FK가 참조 가능한 유효·비부분·비지연 단일 키다. 사용자 행 조회는 이 검사에 필요 없다. fresh는 `dream`/이력/예약 역할 부재와 `fromVersion=null, applied=0, pending=3`, 이미 적용된 정확한 3은 `3/0/0`이다. 마이그레이션 프로세스의 DSN·CA·프로필은 앱에 전달하지 않는다. | 권한 부족, FK 검사 false, 대상 불일치, 미확인/부분 이력·역할 또는 카탈로그 차이는 안전한 상태·오류로 반환한다. 이전 객체를 채택하거나 이력을 직접 보정하지 않는다. 별도 판정 뒤 동일 대상·동일 역할로 읽기부터 재개한다. |
| ☐ 4. 이관과 보존 검사 | **Backend**가 승인된 동일 대상·SHA에서 v2 schema 3 apply를 실행한다. `apply` 전용 approval hash를 쓰고, 고정 SQL과 이력 3개를 사용한다. | fresh apply는 `null/3/0`. `dream`과 이력은 migration 소유, 정확한 이력 ID·checksum 3행, 기존 Auth 및 관련 밖 객체 보존, FORCE RLS 18표와 36정책 확인. 자동 migration→API/worker 간선은 grantor를 붙여 ADMIN true/INHERIT false/SET false로 기록한다. 적용 뒤 별도 dry-run `3/0/0`과 이력 시각 보존을 대조한다. 정확한 기적용 대상이면 무변경 상태를 기록하고 신규 적용·중복 provision을 피한다. | COMMIT 전 확정 실패는 ROLLBACK 뒤 별도 읽기로 이력·스키마·역할의 초기 상태를 확인한다. 불확실한 결과는 같은 target의 최신 이력·카탈로그를 읽어 fresh/완료/불일치로 판정할 때까지 apply를 반복하지 않는다. COMMIT 이후 복구는 9번 경계로 처리한다. |

v2 CLI의 실제 문법이다. 값은 지정 비밀 채널에서 해당 프로세스에만 주입한다. 두 fingerprint는 오프라인에서 계산하며, 같은 target hash를 기대하되 approval hash는 dry-run/apply에 각각 대응한다.

```powershell
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts fingerprint --schema 3 --mode dry-run
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts dry-run --schema 3
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts fingerprint --schema 3 --mode apply
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts apply --schema 3
```

환경 키는 `DREAM_PG_MIGRATION_URL`, `DREAM_PG_MIGRATION_PROFILE`, `DREAM_PG_MIGRATION_PROJECT_REF`, `DREAM_PG_MIGRATION_CA`, `DREAM_PG_MIGRATION_TARGET_HASH`, `DREAM_PG_MIGRATION_APPROVAL_HASH`다. Session에서 `DREAM_PG_MIGRATION_SESSION_HOST`, `_PORT`, `_DATABASE`, `_USERNAME`, `_ROLE` 전체를 추가한다. 승인된 DSN은 query/fragment 없이 설정한다. B6의 v1 명령 예시는 절차 참고용이고 여기서는 위 v2 CLI를 사용한다. [v2 CLI](../../scripts/postgres/migrate-v2.ts) · [대상 검사](../../lib/db/postgres/migration-target.ts) · [B6](B6-MANAGED-PREFLIGHT.md) · [B8](B8-MANAGED-CONNECTION-DIAGNOSIS.md)

**3단계의 비지연 FK 적격성은 같은 migration login의 읽기 전용 세션에서 별도로 확인한다.** B6와 현 v2 조회는 비지연성까지 확인하지 않는다. 아래 쿼리는 카탈로그를 읽어 boolean 1개를 반환한다. 결과가 true일 때만 통과하며, `auth.users`의 데이터 행을 읽지 않는다. [v2 상태 검사](../../lib/db/postgres/migration-state-v2.ts)

```sql
BEGIN TRANSACTION READ ONLY;
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_index AS i ON i.indrelid = a.attrelid
  WHERE a.attrelid = pg_catalog.to_regclass('auth.users')
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attnotnull AND a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
    AND i.indisunique AND i.indisvalid AND i.indimmediate
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum
) AS auth_id_fk_eligible;
ROLLBACK;
```

## 제한 로그인과 시험 배포

| 순서 | 확인 경로와 책임자 | 통과 기준과 증거 | 중단·재개·복구 |
| --- | --- | --- | --- |
| ☐ 5. 역할쌍과 자격 | **Backend**가 migration 연결에서 정확한 이력과 제한 역할을 확인한다. 새 역할쌍이 필요한 경우 기존 템플릿을 로컬에서 출력해 검토한 뒤 승인된 migration 연결에서 적용한다. **비밀 담당**은 제한 API login만 시험용 자격으로 주입한다. | API·worker 두 로그인은 `PASSWORD NULL`로 생성되고 각자 자기 역할에 ADMIN false/INHERIT false/SET true 멤버십만 가진다. 이관 login은 별도이고 API login은 비소유자·NOSUPERUSER·NOBYPASSRLS·NOINHERIT·NOCREATEROLE이다. worker는 이 읽기 시험에서 인증 자격을 발급하지 않는다. 마이그레이션 재검사 `3/0/0`과 이력 시각 보존. | 한 로그인만 있거나 예상 밖 grantor·역할 간선이면 기존 상태를 보존한다. 현재 v2는 API-only 구성을 거절한다. 확정 롤백은 역할과 간선이 사전 상태와 일치하는지 확인한다. COMMIT이 불확실하면 9단계에서 분류할 때까지 템플릿 적용과 자격 발급을 보류한다. |
| ☐ 6. Preview 선택 및 런타임 연결 | **Front/배포 담당**이 보호된 Preview의 고정 SHA·Ready·환경 대상과 운영 Current를 대조한다. **비밀 담당**은 시험 환경에만 app Auth 및 제한 API login 연결을 주입한다. **Backend**는 아래 제한된 런타임 접속 절차를 수행한다. | `DREAM_AUTH_MODE=supabase`, 시험용 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`, 시험 계정용 `DREAM_ALLOWED_EMAILS`, 제한 API `DATABASE_URL`이 같은 시험 쌍을 가리킨다. 읽기 플래그를 닫아 둔 채 실제 제한 런타임의 양 구간 TLS를 검증한다. 통과 뒤 승인된 보호 Preview 범위에서만 opt-in한다. 시험 결과에서 URL/ref·커밋·Preview ID 일치 및 운영 Current·환경 불변을 확인한다. | 실제 런타임의 증거 수집 방법, TLS 또는 환경 격리가 확인되지 않으면 읽기를 닫아 둔다. 앱의 기본 풀에는 migration CA가 자동 전달되지 않는다. 기본 신뢰 저장소로 검증이 안 되면 검증된 CA를 서버 쪽 풀에 주입하는 좁은 별도 변경을 배정받아 진행한다. |
| ☐ 7. 실제 Auth A/B와 합성 데이터 | **시험 계정 담당**은 승인된 스테이징의 Supabase Auth에서 두 시험 계정과 보호 Preview의 신뢰 origin·콜백을 확인한다. **Backend**는 제한 API login과 신뢰된 actor 트랜잭션으로 승인된 합성 자료만 준비한다. | 각 계정은 서로 다른 검증된 UUID를 가지며 서버 `getUser`와 시험 허용 목록이 A/B와 일치한다. 서로 다른 브라우저 프로필/세션을 사용한다. A 활성 1건·보관 1건, B 활성 2건과 유효한 단계 자료를 소유자별로 시드한다. 실제 Auth FK와 합성 프로젝트·종속 자료를 복구용 식별 목록에 묶는다. | 실제 세션·origin·콜백이 확인되지 않으면 시드를 보류한다. 기존 운영 계정과 자료는 격리한다. 시험 데이터 적재는 기존 HTTP POST 생성 경로와 분리한다. fixture COMMIT 결과가 불확실하면 9단계에서 분류하기 전 추가 시드를 보류한다. |

템플릿 출력 명령은 `node --conditions=react-server --import tsx scripts/postgres/migrate.ts provision-template`이다. 이 명령은 SQL을 출력한다. 적용과 자격 설정은 지정 실행자의 별도 연결에서 진행하며, 이후 v2 schema 3으로 상태를 확인한다. Preview에는 migration env나 worker 자격을 전달하지 않는다. [프로비저닝 계약](../../lib/db/postgres/provision-template.ts) · [프로젝트 읽기 풀](../../lib/services/postgres/project-read-pool.ts) · [pg TLS 설정](../../lib/db/postgres/connection.ts)

**6단계의 opt-in 전 검증 방식.** 제품 GET은 플래그가 꺼져 있으면 pg 풀을 열지 않는다. Backend와 Front는 실행 전 승인된 보호 Preview Node 런타임에서만 시작할 수 있는 일회성 서버 측 읽기 점검과 기록 경로를 지정한다. 후보 배포 SHA·Preview ID·리전·제한 API login의 target과 동일한 앱 pg 풀 및 신뢰 설정을 사용한다. 일반 웹 경로에 진단을 공개하지 않는다. 승인된 수단이 없으면 필요한 최소 시험 도구를 별도 배정받을 때까지 플래그를 닫아 둔다. [읽기 선택자](../../lib/services/postgres/project-read-backend.ts) · [런타임 풀](../../lib/services/postgres/project-read-pool.ts)

1. 확보한 **같은 제한 client**의 검증 TLS 세션에서 CA 신뢰, 대상 호스트/SNI 일치, 인증서 검증 성공을 확인한다. 실행 설정과 실제 성공 결과를 함께 기록한다. 읽기 전용 트랜잭션을 열고 SQL에서 PG17·DB·port·`session_user=current_user`와 실제 제한 역할 일치, 앱 풀 startup 옵션 수용을 대조한다.
2. 같은 트랜잭션에서 `SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()`를 실행한다. **정확히 1행이며 `ssl=true`**일 때만 DB 구간 통과다. false·NULL·0행은 구분해 기록하고 확인 후 ROLLBACK하고 연결을 닫는다. 데스크톱이나 migration login의 TLS 증거는 각자의 관측으로 보관한다.
3. 두 구간과 런타임 대상 일치가 모두 확인된 후에만 승인된 Preview에서 opt-in한다. opt-in 뒤에도 Preview ID·SHA·환경 범위 또는 런타임 연결 조건이 바뀌면 변경된 대상에서 TLS 증거를 다시 확보한다.

**7단계의 신뢰 origin과 콜백.** 실제 테스트할 HTTPS origin을 Preview 범위의 `DREAM_SITE_URL` 및 앱이 읽는 `VERCEL_URL`·`VERCEL_PROJECT_PRODUCTION_URL`로 계산된 신뢰 목록과 대조한다. 그 origin에서 같은 origin의 로그인 요청과 시험 프로젝트의 `getUser`를 확인한다. 사용하기로 한 가입·복구 흐름이 있다면 해당 스테이징 Supabase Auth의 리다이렉트 허용 목록에서 정확한 `https://<preview-host>/auth/callback`과 시험 반환 경로를 대조한다. 로그인·콜백이 다른 호스트로 넘어가면 멈추고 대상·origin을 재확인한다. [신뢰 origin 구현](../../lib/auth/config.ts) · [인증 콜백](../../app/auth/callback/route.ts)

## 합격 기준과 종료

**☐ 8. Tester가 승인된 시험 Preview에서 독립 판정한다.** 도메인·Preview ID·소스 SHA와 A/B 세션을 시작·종료 시 다시 확인한다. 쿠키/DB 값 원문 없이 상태·개수·일치 여부만 기록한다.

| 확인 경로 | 합격 기준 |
| --- | --- |
| 실제 A/B 세션의 `GET /api/projects`, `GET /api/projects/[id]` | A 목록 1건, B 2건과 자기 상세 200. 상대·보관·존재하지 않는 정상 UUID는 같은 404. 형식 오류는 400, API 응답은 `no-store`. 정상 빈 목록 200은 시드 전 또는 활성 자료가 없는 지정 시험 계정으로 확인한다. 연결 실패의 안전한 503은 승인된 별도 실패 조건에서 확인한다. |
| 유효 세션의 앱 GET 403 | 계정 담당이 승인된 시험 계정의 유효한 Supabase 세션을 먼저 확보한다. 지정 담당이 보호 Preview의 시험 허용 목록에서 그 계정을 한시 제외한다. 설정 반영에 새 배포가 필요하면 동일한 보호 origin과 시험 대상 및 새 배포 ID를 대조한다. 같은 origin의 세션이 여전히 `getUser`에서 유효할 때 Tester는 앱 GET의 `403 AUTH_FORBIDDEN`과 `no-store`를 확인한다. 이후 지정 담당이 시험 허용 목록을 복원한다. 로그인 POST의 `400 INVALID_CREDENTIALS`와 Vercel Preview 보호 응답은 각각 별도 대조다. 승인된 방식으로 이 상태를 만들 수 없으면 GET 403을 미검증으로 기록한다. |
| `/cloud/projects`, `/cloud/projects/[id]`, `/cloud/manage` | 각자 목록·상세에 자기 자료만 보인다. 관리 집계 A 1/B 2와 조회 시각은 성공한 자기 목록에서 계산된다. 읽기 실패의 관리 화면에는 실패 안내가 보이고 성공 집계나 시각이 표시되지 않는다. |
| 익명·만료 세션 | 보호 GET은 401 및 `no-store`, 페이지는 로그인으로 이동한다. 갱신 가능한 access token 만료와 갱신 후에도 인증이 끊긴 세션을 구분한다. 인증 거부 뒤 DB checkout이 없음을 확인하고, Vercel Preview 보호 응답을 앱 401과 구분한다. |
| Backend의 제한 로그인 교차 대조 | 승인된 동일 풀 경로에서 actor 없는 직접 SELECT는 0행이고 actor A/B는 자기 행만 읽는다. 제한 login의 worker 전환 거부와 앱의 읽기 전용 트랜잭션에서 쓰기 거부를 확인한다. 스키마 CREATE와 테이블 TRUNCATE 권한은 실행 없이 조회한다. 정상 종료·rollback 후 role/actor가 원복되고 동시 A/B가 격리된다. 풀 형태별 실제 backend 재사용 증거를 기록한다. 로컬 max 1의 동일 PID 기준을 다른 풀 형태에 그대로 적용하지 않는다. |

어느 예상값이 빗나가면 **Tester는 실패 단계와 실제 상태 코드/개수를 반환하고, Master는 수정 후 해당 단계부터 재개한다.** 교차 소유자 노출, 잘못된 환경 연결, 예상 밖 권한은 즉시 시험 접근과 조회 opt-in을 중지할 사유다. [서버 인증](../../lib/auth/resolve.ts) · [목록·상세 읽기 요청](../../lib/services/postgres/project-read-request.ts) · [개인 관리](../../app/%28cloud%29/cloud/manage/page.tsx)

**☐ 9. Master가 종료·복구를 판정한다.** **Front/배포 담당**은 시험 노출을 멈추고 이전 Preview 설정 또는 배포로 복귀하며 새 런타임을 사용해 이전 풀을 교체한다. 읽기 플래그를 내린 GET의 현재 계약은 비가용 응답이다. 이전 기능 동작이 복구 목표라면 직전 Preview 배포도 복원한다. **Backend·시험 계정·비밀 담당**은 승인된 범위에서 아래를 처리한다.

- **이관·프로비저닝 COMMIT 불확실.** 정확한 같은 대상에 새 읽기 전용 연결을 열어 이관은 저널과 카탈로그, 프로비저닝은 역할쌍과 grantor·ADMIN/INHERIT/SET 간선을 각각 사전·기대 상태와 대조한다. 사전 상태와 일치하면 후속 실행 배정 여부를 판단하고, 기대 완료 상태와 일치하면 재실행 없이 이후 검사로 진행한다. 부분 적용·불일치·권한으로 관찰 불가인 경우 중단하고 Master에게 판정을 넘긴다. 분류 전 apply, 템플릿, 자격 설정, 보상 DDL은 보류한다.
- 성공한 이관은 runner에서 자동 역이관할 수 없다. DB 복원이 필요한 시험 대상은 1번에서 기록한 복원 기준과 권한으로 처리한다. 임의 schema/role 삭제로 초기 상태를 만들지 않는다.
- **Fixture COMMIT 불확실·시험 계정 정리.** 사전에 기록한 합성 owner와 프로젝트·종속 행 식별 목록만 새 읽기 연결에서 확인해 미적용·완료·부분/불일치로 구분한다. 확인 전 재시드·계정 폐기를 멈춘다. `auth.users`에 대한 `ON DELETE RESTRICT`를 고려해 승인된 종속 자료를 FK 순서로 정리하고 남은 참조 0을 확인한 뒤 시험 계정을 폐기한다. 안전하게 분리 정리할 수 없으면 사전 합의한 시험 DB 복구 절차를 적용한다. 발급한 시험 자격을 회수하고 Preview 접근 범위와 운영 Current·환경 스코프를 기준과 대조한다. [소유 관계 스키마](../../lib/db/postgres/0001_schema.sql)
- 최종 영수증에 단계별 상태·타깃 hash·manifest·보호 시험 배포 ID/소스 SHA·양 구간 TLS·A/B 수치·복구 및 종료 결과를 남긴다. Master가 독립 증거를 수용하면 스테이징 완료로 기록하며 운영 이관은 별도 배정으로 유지한다.

## 필요한 사람 조치

- **현재 요청 없음.** Master가 기존 승인된 스테이징과 시험 Preview를 먼저 식별한다.
- **기존 승인 시험 대상이 없을 때만** 사용자가 환경 선택을 결정한다. 비용이나 자원 생성이 필요할 때 그 범위도 함께 결정한다.
- **서비스 소유 확인·로그인·MFA가 위임될 수 없을 때만** 소유자가 해당 서비스 화면에서 직접 처리한다.
- 기존 운영 SSL 결정 `DEC-SSL-01`은 현재 대기를 유지한다. 이 체크리스트에서 재요청하거나 운영 SSL 변경을 포함하지 않는다. B8/B11의 과거 운영 Session은 클라이언트 검증 TLS와 backend SSL false를 각각 기록했다. [B8 연결 관측](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B11 SSL 절차](B11-SSL-CHANGE-READINESS.md)

Master 전달문 — T261-F1 보완 완료. 비지연 FK의 카탈로그 조회, opt-in 전 실제 제한 Preview 런타임의 양 구간 TLS, 신뢰 origin·콜백과 유효 세션의 GET 403, 불확실한 COMMIT과 fixture 정리 절차를 고정했습니다. 첫 조건인 승인된 별도 시험 대상과 보호 Preview 매핑은 미확인입니다. DEC-SSL-01은 기존 대기를 유지합니다. 저장소와 과거 기록만 확인했습니다.
