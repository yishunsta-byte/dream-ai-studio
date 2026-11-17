# B6 managed Postgres 사전점검 · 적용 절차

- 담당 Codex(Backend), 상위 CX-MASTER-01, 요청 msg_1649441b2561.
- 문서 기준 HEAD `57c5ba030e178589f5a4acc5c2a90c1528039e74`, B5 구현 `82e5745`. B5-R 독립 검수 진행 중임을 전제로 한다.
- 상태 **ready_review / 명세만 작성**. CLI/코드 대조와 문서 공백 검사만 수행했다. 실제 환경변수·비밀·DSN 조회, managed 접속/SQL/DDL/role/provision, 외부 설정·유료/신규 프로젝트 생성은 하지 않았다.
- 이번 유일 변경은 이 문서다. T207/adapter/service/Auth/제품 파일/B5 검수 대상은 변경하지 않았다.

## 1. 먼저 확정할 target 기록

당시 live Auth 공개 URL은 **https://osvjfyjlbixmvnjkxdry.supabase.co**. 근거는 Master msg_9da1ba1cca7c가 전달한 Front T179 V0 msg_377e681fe114와 재확인 msg_eb75ca2fe4c9다. 이는 당시 star/dream-ai-studio/Seoul 보고이며, 현재 소유·DB 상태·권한을 독립 확인한 증거가 아니다. **기존 live Auth ref를 staging으로 간주하지 않는다.**

Master는 다음 실제 실행 배정에서 승인된 비운영 target의 ref·환경 분류·소유 조직·데이터 존재 여부·migration 실행자·secret operator를 기록한다. 이미 승인된 staging이 있으면 해당 범위의 읽기 점검을 배정하면 된다. 없다고 새 프로젝트·유료 자원을 자동 생성하지 않는다. 이번 문서는 별도 사용자 승인 절차를 만들거나 실제 접속 권한을 확대하지 않는다.

준비 기록은 아래 항목으로 제한한다. DSN/password/토큰은 기록하지 않는다.

| 항목 | 확인 책임/근거 |
|---|---|
| 정확한 project ref와 live/staging 분류 | Master·기존 승인/소유 확인. 공개 URL의 철자만으로 분류하지 않음 |
| direct DB endpoint/port/db/operator | 지정 secret operator가 승인된 서비스의 연결 정보와 대조. 보고서에는 targetHash만 |
| migration owner와 runtime login 분리 | Master가 담당/권한 범위 지정. HTTP service_role key를 DB password로 사용하지 않음 |
| runtime pooler 종류·지원 방식 | 담당자가 실제 프로젝트의 제공 연결 방식으로 확인. ref에서 pooler host를 추정하지 않음 |
| TLS CA·네트워크 경로 | secret/operator 담당. 인증서 검증을 끄지 않음 |
| 코드/SQL/manifest 기준 | B5-R 수용된 정확한 SHA, 고정 SQL3 checksum, 적용 범위 |

## 2. 실제 지원 CLI와 안전한 환경 주입

현재 CLI 인자는 **fingerprint / dry-run / apply / provision-template** 네 가지뿐이다. `status`, `rollback`, `reset`, `down`, `--force`, `pooler-test` 명령은 없다. 운영 DSN을 인자로 넘기거나 일반 DATABASE_URL을 migration 입력으로 사용하지 않는다.

secret operator가 실행 프로세스에만 아래 이름을 주입한다. 채팅·저장소·스크린샷·셸 명령행·출력에 값을 넣지 않는다. 소유자만 접근 가능한 기존 비밀 전달 경로를 사용하며, 이번 문서 작성을 위해 값을 요청하지 않는다.

- DREAM_PG_MIGRATION_URL
- DREAM_PG_MIGRATION_PROFILE: 승인된 managed 시험이면 명시 managed-staging
- DREAM_PG_MIGRATION_PROJECT_REF: 이번 승인 target의 ref, 위 live ref 자동 사용 금지
- DREAM_PG_MIGRATION_TARGET_HASH: 아래 fingerprint를 승인 target 정보와 별도로 대조한 뒤 주입
- DREAM_PG_MIGRATION_CA: 플랫폼에 필요한 경우의 신뢰 CA

실제 명령 순서:

```powershell
# 접속하지 않고 입력의 비밀 제외 target identity SHA256만 계산
node --conditions=react-server --import tsx scripts/postgres/migrate.ts fingerprint
# 승인 target 대조 후 해당 hash를 프로세스에 주입한 다음 실제 읽기 전용 점검
node --conditions=react-server --import tsx scripts/postgres/migrate.ts dry-run
```

fingerprint 성공은 소유/접속/권한/TLS 성공이 아니다. hash는 profile/host/port/db/operator를 고정하지만 password는 포함하지 않는다. 따라서 비밀번호 교체는 같은 hash일 수 있으며, 성공한 접속·권한 증거는 dry-run이 별도로 필요하다. CLI는 managed migration에 `db.<명시-ref>.supabase.co` direct host만 허용한다. 현재 이 검사에 pooler 주소를 맞추려고 host/profile/인증서 검증을 우회하면 안 된다.

dry-run은 READ ONLY, 적용0이며 schema/role/history를 생성하지 않는다. 출력은 targetHash·mode·count·고정 manifest id/checksum만 보존한다. raw driver error/DSN/사용자 식별자는 출력하지 않는다. 실패 원인 추가 점검은 아래의 승인된 동일 migration 연결에서 읽기 전용 SQL로 수행한다. Dashboard SQL 세션이 다른 계정이라면 그 결과를 CLI migration login의 권한 증거로 대체하지 않는다.

## 3. 적용 전 읽기 전용 SQL

다음은 **미래에 해당 target 읽기 점검이 배정된 경우에만** 실행할 SQL이다. 이번에는 실행하지 않았다. 동일 접속에서 순서대로 실행하고, 오류가 나면 ROLLBACK으로 읽기 transaction만 끝낸다. 식별자 원문 대신 boolean/count를 결과 기록으로 남긴다.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_setting('server_version_num')::int >= 160000 AS supported_version,
       current_user = session_user AS direct_operator_context,
       has_database_privilege(current_database(),'CREATE') AS can_create_schema,
       r.rolcreaterole OR r.rolsuper AS can_create_runtime_roles
FROM pg_roles r WHERE r.rolname = session_user;

SELECT to_regclass('auth.users') IS NOT NULL AS auth_users_exists;
SELECT count(*) = 1 AS auth_uuid_fk_target_ok
FROM pg_attribute a
WHERE a.attrelid=to_regclass('auth.users') AND a.attname='id'
  AND NOT a.attisdropped AND a.attnotnull AND a.atttypid='uuid'::regtype
  AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid
    AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
    AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum);

-- auth.users_exists=true の場合だけ実行。falseならここで中断。
SELECT has_schema_privilege('auth','USAGE') AS auth_schema_usage,
       has_table_privilege('auth.users','REFERENCES') AS auth_fk_references;

SELECT to_regnamespace('dream') IS NOT NULL AS dream_exists,
       to_regnamespace('dream_migrations') IS NOT NULL AS history_schema_exists,
       to_regclass('dream_migrations.history') IS NOT NULL AS history_exists;
SELECT count(*) AS reserved_roles_found
FROM pg_roles WHERE rolname IN
  ('dream_api','dream_worker','dream_api_login','dream_worker_login');
SELECT COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false)
       AS transport_tls;
COMMIT;
```

위 SQL은 raw target 주소/DB명/계정명·Auth 사용자 목록을 출력하지 않는다. TLS 서버 관찰값은 암호화 여부일 뿐 **client의 인증서 검증 설정을 증명하지는 않는다**. 실제 client 설정의 rejectUnauthorized=true/신뢰 CA 및 검증 오류 발생 시 접속 실패까지 별도 증거가 필요하다.

fresh 기대 상태는 dream/history 없음·reserved role0, 지원 버전/직접 operator/CREATE/CREATEROLE/Auth UUID FK·REFERENCES 모두 통과다. managed의 postgres 계정을 슈퍼유저라고 가정하거나 protected Auth 권한을 임의 GRANT/ALTER하지 않는다.

history_exists=true일 때만 추가 읽기를 검토한다. 먼저 owner/구조가 이미 알려진 target인지 확인한 뒤 B5 dry-run으로 완전한3행 ordinal/id/checksum·owner/flags/18표 FORCE RLS·36정책·18guard 검사를 받는다. 필요 시 다음 SELECT의 비밀 없는 이력만 고정 manifest와 대조한다.

```sql
BEGIN READ ONLY;
SELECT ordinal,id,checksum FROM dream_migrations.history ORDER BY ordinal;
SELECT count(*) AS schemas_owned_by_operator FROM pg_namespace
WHERE nspname IN ('dream','dream_migrations') AND nspowner=(
  SELECT oid FROM pg_roles WHERE rolname=session_user);
SELECT count(*) AS forced_rls_tables FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='dream' AND c.relkind IN ('r','p')
  AND c.relrowsecurity AND c.relforcerowsecurity;
COMMIT;
```

알 수 없는 기존 dream/schema/role/login, partial·unknown·checksum 불일치 history는 **미해결 상태 그대로 보고**한다. 기존 SQL을 직접 다시 실행하거나 history만 맞춰 넣어 채택하지 않는다. runner는 full ACL/함수 정의 drift 검사기가 아니므로 알려진 이력도 임의 외부 수정까지 정상이란 뜻은 아니다.

## 4. 비파괴 중단 기준

| 결과 | 중단 후 조치 |
|---|---|
| ref/환경/live 여부/승인 target hash가 불명확 | 접속/적용 진행 금지. Master가 기존 승인과 소유 근거를 정리 |
| DNS/네트워크/인증/TLS 실패 | 해당 비밀·CA 담당에게 안전한 오류 코드만 전달. 인증서 검증 해제·다른 host/pooler·service_role/owner 자격 fallback 금지 |
| CREATE/CREATEROLE/Auth REFERENCES·UUID FK 불충족 | readonly 결과만 반환. Auth 스키마/권한 수정은 이번 계획으로 허가되지 않음 |
| 기존 unknown schema/role/history·소유자/flags/membership 불일치 | DROP/adopt/ALTER/이력 보정 금지. 별도 원인·이관 설계 필요 |
| source checksum mismatch/지원하지 않는 서버 버전 | 코드/발행물/버전 근거 대조. 잠금 hash·검증을 완화해 진행하지 않음 |
| dry-run 완료0/정확한3행 | 이미 적용된 상태로 기록. fresh라고 다시 provision하지 않음 |
| 연결 종료/COMMIT 결과 미확정 | 성공/롤백 어느 쪽도 추정하지 않고 아래 읽기 재확인부터 수행 |

비밀 교체·새 권한·새 프로젝트·유료 자원이 필요하면 Master가 기존 승인 범위를 확인하고 실제로 새 결정이 필요한 항목만 취합한다. 이번 문서가 그러한 조작을 자동 허용하지 않는다.

## 5. 검증 통과 뒤의 실제 적용 순서 (현재 실행 금지)

이 순서는 **B5-R 수용 및 Master의 실제 target/범위 배정 뒤** 수행할 작업이다. 새 사용자 승인 단계를 임의로 추가한 것이 아니라 현재 배정의 문서 전용 경계를 유지한 것이다.

1. 고정 SHA·manifest·공인 targetHash·readonly 결과·기존 환경 보존/복구 기준을 기록한다. 기존 live Auth와3013은 변경하지 않는다. fresh와 already-applied를 구분한다.
2. 동일 migration credentials/target에서 CLI apply를 실행한다. 대상/상태는 lock 뒤 다시 검사된다. fresh면 applied3/pending0, 재실행이면 applied0이다. 출력 hash·manifest와 실제 적용 범위를 기록한다.
3. 같은 target에서 dry-run을 다시 실행하여 applied0/pending0 및 알려진 이력/owner/RLS/role 상태를 확인한다. 이것만으로 managed runtime/Storage까지 수용하지 않는다.
4. 아직 provision되지 않은 known runtime roles 상태일 때만 provision-template로 SQL을 **출력**해 검토한다. CLI에 provision 실행 명령은 없다. 지정 migration owner가 승인된 동일 연결에서 template를 별도 적용한다. 기존 login이 있으면 실패를 유지하고 덮지 않는다.
5. template는 API/worker 별도 LOGIN PASSWORD NULL과 단일 restricted membership만 만든다. secret operator가 승인된 채널에서 서로 다른 자격을 provision/rotation/환경 주입한다. NULL password 상태를 사용 가능한 접속으로 보고하지 않는다. migration DSN을 앱/worker에 재사용하지 않는다.
6. 실제 migration 계정과 분리된 runtime login, 실제 Auth A/B 테스트 identity·합성 staging row를 대상으로 다음 절을 확인한다. 준비되지 않았다면 runtime 미검증으로 남긴다. staged Auth 사용자/합성 데이터 쓰기도 별도 실제 시험 배정 범위에서만 수행한다.

적용 명령 자체는 실제 지원 범위 그대로다.

```powershell
node --conditions=react-server --import tsx scripts/postgres/migrate.ts apply
node --conditions=react-server --import tsx scripts/postgres/migrate.ts dry-run
node --conditions=react-server --import tsx scripts/postgres/migrate.ts provision-template
```

## 6. runtime pooler/TLS/SET LOCAL 검증

fresh 사전점검에는 아직 API/worker role·secret이 없을 수 있다. 그때 runtime 접속 검사는 **해당 없음/미검증**이다. readonly preflight를 통과시키려고 role/login을 미리 만들지 않는다. migration direct 접속 성공은 runtime pooler 성공을 대신하지 않는다.

후속 실제 시험 배정에서 provider가 제공하는 정확한 direct/session/transaction pooler endpoint와 제한 login 형식을 확인한다. B5 migration CLI는 direct만 지원하므로 pooler 검증 도구로 사용하지 않는다. 기존 local 합성 test runner도 managed DSN을 받아 검사하는 도구가 아니다. 필요 managed 전용 실행기는 별도 구현·검수 대상이며 현재 없는 CLI 명령을 제시하지 않는다.

검증 SQL의 핵심은 다음과 같다. 아래 verified UUID placeholder는 승인된 staging Auth 사용자로만 바꾸고 요청 body/header의 owner를 사용하지 않는다. 실제 행 SELECT는 승인된 합성 row만 대상으로 하며 live 사용자 데이터를 조회하지 않는다.

```sql
BEGIN READ ONLY;
SET LOCAL ROLE dream_api;
SELECT set_config('dream.actor_id','<verified-staging-user-A-uuid>',true);
-- actor_id는 UUID를 출력하지 않고 일치 boolean으로만 관찰
SELECT dream.actor_id()='<verified-staging-user-A-uuid>'::uuid AS actor_matches;
SELECT has_schema_privilege(current_user,'dream','CREATE') AS can_create_dream;
COMMIT;

-- 같은 logical pool client의 다음 transaction에서 role/actor 잔류 여부
BEGIN READ ONLY;
SELECT current_user=session_user AS role_reset,
       COALESCE(current_setting('dream.actor_id',true),'')='' AS actor_cleared;
ROLLBACK;
```

기대값은 actor_matches=true, can_create_dream=false, role_reset=true, actor_cleared=true다. 이어 B actor/no actor/거부/rollback/동시 A·B/max1 재사용·disconnect를 대조하고, 한 요청의 Auth UUID와 DB owner가 일치하는지 확인한다. transaction pooler는 물리 backend PID가 바뀔 수 있으므로 local max1의 동일 PID 관찰을 그대로 요구하지 않는다. 역할·actor 격리와 정상/부정 대조가 기준이다. server TLS 관찰과 client 인증서 검증 모두 필요하다.

readonly SQL만으로 INSERT/FK/DDL 거부·불변 trigger 전부를 시험했다고 할 수 없다. 실제 Auth FK·교차 owner 쓰기·API/history/DDL 제한·worker의 의도된 cross-owner 범위/claim fencing은 승인된 합성 staging 쓰기 시험으로 별도 수행해야 한다. worker는 API actor 모델로 위장하지 않고 dream_worker 역할 범위를 검증한다. pooler가 SET LOCAL ROLE/config를 허용하지 않으면 owner/BYPASSRLS로 우회하지 말고 지원 연결 방식의 대안을 Master에 반환한다.

## 7. rollback 가능한 범위와 불가능한 범위

| 시점/범위 | 처리 가능 범위 · 한계 |
|---|---|
| fingerprint/dry-run/readonly SQL | 영속 변경 없음. 열린 readonly transaction은 ROLLBACK/연결 종료. 이미 읽은 결과/운영 로그가 사라지는 것은 아님 |
| apply에서 COMMIT 전의 확정 SQL 실패 | 같은 transaction의 dream/history/new roles는 runner가 rollback. 기존 Auth/다른 schema를 되돌리는 도구가 아님 |
| COMMIT 응답 유실/접속 종료 | 적용 여부 불명. blind retry/성공 선언 금지. 동일 target dry-run/history/catalog로3행 완료인지 fresh인지 재확인. 모순이면 중단 |
| apply COMMIT 성공 후 | CLI에 down/rollback 없음. ROLLBACK 명령으로 이미 commit한 DDL을 취소할 수 없음. schema DROP/role 제거/이력 삭제를 임의 실행하지 않음 |
| provision template COMMIT 전 실패 | template transaction에서 새 login/membership rollback. 기존 login은 수정하지 않음 |
| secret/외부 환경 주입 후 | secret provider·환경·열린 pool·DB가 한 transaction이 아님. 지정 담당이 연결 사용 중단/자격 rotation/환경 복구를 범위대로 수행해야 함 |
| 런타임 read 개방 후 | backend opt-in 중지/배포 복귀는 Master 운영 범위. Vercel에서 SQLite로 fallback시키지 않고 준비 중/503을 유지. 새 쓰기나 데이터 이관이 있었다면 별도 백업·복원 계획 필요 |

현재 로컬3013/SQLite는 그대로 보존한다. B5는 fresh schema 실행기이며 실데이터 import·Storage/worker·백업 복구나 포괄적 down migration을 제공하지 않는다. managed 적용 뒤 원복 범위를 과장하지 않는다.

## 8. 사용자에게 필요한 일과 Master가 처리할 일

- **Master/지정 담당이 처리:** 기존 승인 target 근거 확인·read-only 배정, 코드/manifest pin, credential 역할 분리와 비밀 채널 주입 조정, 지원 CLI/SQL 실행·오류 조사·결과 기록, 독립 검수·적용 범위/공개 시점 조정. 이미 승인된 일반 확인/검증을 단계마다 사용자에게 재승인받지 않는다.
- **사용자 조치가 실제로 필요한 경우만:** 승인된 staging이 없고 새 자원/비용/환경 선택이 필요할 때의 결정, 사용자만 가능한 서비스 로그인/MFA·계정 소유 확인, 기존 승인 밖 live 데이터/운영 영향 범위 결정. 비밀을 채팅에 붙여 넣도록 요구하지 않는다.
- 지금 사용자에게 요청할 실행/비밀 제공은 없다. 현재 배정은 문서이며 실제 접속·적용은 후속 Master 배정으로 관리한다. 플랫폼 권한이 없는 상황을 승인되었다고 추정하지 않는다.

## 반환

B5 CLI 네 mode·target/profile·manifest/권한/role/history 검사·provision template를 코드와 대조했다. SQL 예제와 절차는 문서 검토만 했으며 managed 실행 결과로 표시하지 않는다. 고유 파일 diff 공백 검사 후 선택 commit으로 반환한다.

Master 복사용:

> B6 명세 ready_review. docs/handoffs/B6-MANAGED-PREFLIGHT.md에 실제CLI4mode·readonly SQL/targetHash/권한·AuthFK/기존schema-role-history·runtime poolerTLS/SETLOCAL·중단기준·적용순서·commit 전후rollback 한계·secret operator/사용자-Master역할을 구체화했습니다. 기존live Auth ref를 staging/default로 쓰지 않으며 managed runtime 검사는 아직미실행입니다. 실제env/DSN/접속/DDL/외부설정/신규유료자원 없이 문서1개만 작성, B5-R/T207/제품범위 불변입니다.
