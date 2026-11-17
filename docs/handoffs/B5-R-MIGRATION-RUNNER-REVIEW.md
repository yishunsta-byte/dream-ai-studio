# B5-R migration runner 독립 검수 — FAIL

- 검수자: Codex / CX-REVIEW-01, 작성자 Backend와 별도 검수. 상위 CX-MASTER-01, task `task_188c992d8aec`, dispatch `ctx_f2ea846eeaa7`.
- 고정 검수 SHA: `82e57451057461fa7d28adc646cd766ad5f1ec42`. 검수 시각 2026-11-17 19:26~19:31 KST. 공유 HEAD 시작 관찰 `57c5ba030e178589f5a4acc5c2a90c1528039e74`; 실제 실행 소스는 아래 git archive 사본만 사용했다.
- 결론: 원 runner의 unit13 + actual PostgreSQL12는 독립 재현 PASS(25/25, skip0, exit0). 별도 필수 부정대조6은 PASS4/FAIL2(exit1)로, 최소권한 상태 검사 및 승인 target/pool 결합 문제가 남아 **수용 FAIL**이다. 작성자 결과218건 등은 합산하지 않았다. 부정대조의 기대값을 성공으로 바꾸거나 skip하지 않았다.

## 필수 수정 B5-R-F1 — runtime 역할의 간접 membership 권한 상승을 정상 상태로 수용 (P1)

위치: `lib/db/postgres/migration-runner.ts:32-38`; `provision-template.ts`의 restricted runtime role 검사도 role flags만 본다.

현재 membership 검사는 `member.rolname IN ('dream_api_login','dream_worker_login')` 두 LOGIN의 직접 membership만 검사한다. `dream_api`/`dream_worker` 자체의 부모 역할 및 그 경로의 SET 권한은 검사하지 않는다. NOINHERIT와 NOBYPASSRLS 등 role flags가 그대로여도 LOGIN은 SET TRUE인 간접 membership 경로로 더 강한 다른 역할을 선택할 수 있다.

자기 synthetic cluster에서만 다음을 수행했다:

```sql
CREATE ROLE b5_r_extra NOLOGIN;
GRANT USAGE ON SCHEMA dream_migrations TO b5_r_extra;
GRANT DELETE ON dream_migrations.history TO b5_r_extra;
GRANT b5_r_extra TO dream_api WITH INHERIT FALSE, SET TRUE;
-- 실제 dream_api_login으로 접속:
BEGIN;
SET LOCAL ROLE b5_r_extra;
DELETE FROM dream_migrations.history; -- 실제 rowCount=3 확인
ROLLBACK; -- 이력3행 원복
```

그 상태에서 원 `runPostgresMigrations(... mode:'apply')`는 MIGRATION_STATE 거부 대신 `applied:0,pending:0` 성공을 반환했다. dry-run도 동일하게 수용했다. 부정대조에서 LOGIN의 실제 DELETE 성공 assertion은 통과했고, 이어진 runner 거부 assertion이 실패했다. 테스트 finally에서 자기 생성 membership/권한/역할을 제거했다. 기본 설치 직후 권한이 안전하다는 원12건의 성공과, 변조 후 검사가 이를 탐지하지 못한다는 사실은 구분한다.

요구: runtime 역할의 추가 부모 membership 및 LOGIN으로부터 도달 가능한 SET ROLE 경로를 제한된 허용 그래프로 검사하고, template도 동일 경계를 검사해야 한다. 이는 일반 함수/인덱스 full schema diff 요구가 아니라, 현재 주장하는 제한 membership/최소권한의 직접적인 우회다. 수정 후 위 실제 LOGIN 대조와 apply/dry-run 거부를 재검증해야 한다.

## 필수 수정 B5-R-F2 — 승인 target hash와 주입된 pool의 endpoint가 결합되지 않음 (P2)

위치: `lib/db/postgres/migration-runner.ts:10-12,47-55`; `migration-target.ts`.

공개 runner API는 pool과 target을 별도로 받는다. target hash에는 hostname이 들어가지만 실제 client 검사는 database/session_user/current_user/port만 비교한다. 따라서 IPv4 `127.0.0.1:61030` pool을 유지하고 target만 IPv6 `[::1]:61030`으로 바꿔 그 target hash를 전달해도 실제 IPv4 서버에서 apply 성공이 반환된다. 소유 서버는 `-h 127.0.0.1`로만 시작했다. 다른 endpoint hash로 승인했지만 실행은 원 pool endpoint였다.

재현한 target hash: 실제 IPv4 `06be38d1d0aefb6cb577c462fb5c65a95f23e794c7fccc6c83e625f2f5a46c76`, 다른 IPv6 `79c9b473aa660b3b90d75b6f13cba04addb27321f882f015f62395c9195bb60f`. 실제 두 호출 모두 적용 완료 DB에서 실행했으므로 신규 SQL 변경은 없었고, 거부를 기대한 apply/dry-run이 `applied:0,pending:0`을 반환한 사실을 확인했다.

영향 범위: 현재 CLI는 같은 target.connectionString으로 pool을 생성하므로 CLI의 해당 경로에서 이 불일치를 관찰한 것은 아니다. 독립적으로 주입 가능한 공개 runner API의 target fail-closed 보장 결함이다. runner가 검증한 target으로 연결을 직접 만들거나, 연결/target을 분리할 수 없는 신뢰 경계를 제공해야 한다. hostname 문자열과 서버IP의 단순 비교만으로 일반 DNS/TLS endpoint 바인딩이 완성된다고 주장하면 안 된다.

## 실행 및 격리 근거

작업 사본 `D:/starwork/b5-r-82e5745`, evidence `D:/starwork/b5-r-82e5745/tmp/b5-postgres-ae5543ee-6d0e-460b-844f-a5c7edf9f36a`.

실행한 핵심 명령(각 디렉터리에서 실행):

```powershell
# 공유 저장소: checkout 없이 고정 archive
New-Item -ItemType Directory -Path D:/starwork/b5-r-82e5745
git archive --format=tar --output=D:/starwork/b5-r-82e5745/source.tar 82e57451057461fa7d28adc646cd766ad5f1ec42
tar -xf D:/starwork/b5-r-82e5745/source.tar -C D:/starwork/b5-r-82e5745
Copy-Item -LiteralPath D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql -Destination D:/starwork/b5-r-82e5745/pgsql -Recurse
New-Item -ItemType Junction -Path D:/starwork/b5-r-82e5745/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하 격리 사본 cwd
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/b5-r-82e5745/pgsql/bin
# 추가 검수: 같은 자기 cluster만 재시작; B5_R_URL은 원 runner가 만든 dummy 자격/DB/port를 사용
./pgsql/bin/pg_ctl.exe -D D:/starwork/b5-r-82e5745/tmp/b5-postgres-ae5543ee-6d0e-460b-844f-a5c7edf9f36a/cluster -l D:/starwork/b5-r-82e5745/tmp/b5-postgres-ae5543ee-6d0e-460b-844f-a5c7edf9f36a/review-postgres.log -o '-h 127.0.0.1 -p 61030' -w start
$env:B5_R_URL='postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:61030/dream_test_b3' # 자기 합성 dummy만
node node_modules/vitest/vitest.mjs run tests/postgres/b5-r-independent.test.ts
./pgsql/bin/pg_ctl.exe -D D:/starwork/b5-r-82e5745/tmp/b5-postgres-ae5543ee-6d0e-460b-844f-a5c7edf9f36a/cluster -m fast -w stop
python integrity.py
```

원 runner/원 테스트/제품/SQL을 변경하지 않았다. 추가 harness는 격리 사본의 `tests/postgres/b5-r-independent.test.ts`에만 있다. 첫 추가 대조는 dry-run, 두 번째는 apply로 실행했으며 반복6건을 새 성과로 더하지 않는다. 최종 고유 수량은 원25 + 추가6 =31, PASS29/FAIL2/skip0이다. 추가 harness는 실제 PG client를 감싼 BEGIN 오류/COMMIT 오류/ROLLBACK 오류/COMMIT의 ROLLBACK command 반환 4가지에서 release(true)를 관찰했다. 이 4건은 실패 주입 검증이며 실제 네트워크 단절이나 실제 서버 COMMIT 장애 재현으로 확대하지 않는다.

- `source.tar` SHA256 `27d3d2654672fb47933a6ae177db550cea7ea9826801671e8bc83cbce3eefe5d`.
- `review-integrity.json`: archive 원본840파일 모두 archive 대비 변경0. PG 물리복사1592파일의 공유 원본/사본 SHA256 불일치0; pgsql 아래 reparse point0. node_modules만 읽기용 junction으로 재사용했다(설치·의존성 변경 없음).
- 원 runner 사본 SHA256 `847f99ddba1def84be867730faf010e96e932f36a076eaa823943eee9db78399`.
- `version.txt`: PostgreSQL18.7. `signatures.log`: postgres/initdb/pg_ctl/createdb 모두 Valid EnterpriseDB. 공유 .tools에서 실행하지 않았다.
- `tests.log`: 2 files/25 passed, 19:27:24, exit0. source unit13 및 실제 DB integration12를 원본 그대로 독립 실행했다.
- `independent-tests.log`: 최종 추가6 중2 failed/4 passed, 19:29:35, exit1. 이전 dry-run 로그 `independent-tests-dryrun.log`도 보존했다.

## 필수 계약 대조 결과

| 계약 | 독립 결과/근거 |
|---|---|
| SQL3 checksum 고정·connect 전 변조 거부 | 원 unit PASS. 아래 raw/LF 재대조. archive840파일 변경0 |
| 일반 target/profile/hash/인라인DSN/default fallback 거부 | 원 unit PASS. 별도 pool 바인딩 F2 FAIL |
| secret 비노출 | 실제 합성 인증실패 CLI 및 성공 출력 원12 안에서 PASS. 실제 secret/managed 접속 없음 |
| readonly dry-run | 원 코드 BEGIN REPEATABLE READ READ ONLY, 실제 pending3/적용0 및 schema/history/role없음 PASS |
| SQL2 중간 실패 all rollback | 원 event trigger로 실제 SQL2 CREATE FUNCTION 실패, SQL1 schema/history/role 전부0 PASS |
| 두 runner advisory 대기 및 apply3/0 | gate client 보유 중 pg_stat_activity advisory wait2, 해제 후 [0,3]/history3 원 테스트 PASS |
| checksum 변조/unknown 이력/기존role/schema 거부 | 원 실제 PG 테스트 PASS |
| template 최소 flags/직접 membership/password NULL/기존 LOGIN 거부 | 기본 설치 실제 PASS. runtime 부모 membership 확장 검사 F1 FAIL |
| 18 FORCE RLS/36 policy/18 guard, A/B owner 격리 | 기본 설치 원 실제 PG 테스트 PASS |
| LOGIN DDL/history 차단, worker TRUNCATE 차단 | 기본 설치 PASS. 간접 SET ROLE 뒤 history DELETE는 F1에서 실제 허용됨 |
| transaction/commit실패 client disposal | 코드 검토 및 추가4 실패 주입 PASS |

SQL3 재대조(시작 기준 archive 보존 및 종료 재읽기):

| SQL | archive/공유 raw SHA256 | LF canonical SHA256 (=고정 git blob/manifest) |
|---|---|---|
| 0001_schema.sql | c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3 | 3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19 |
| 0002_invariants.sql | 4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1 | 1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100 |
| 0003_rls.sql | f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd | 7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d |

archive raw는 CRLF이며 git blob의 LF raw와 다르다. 이는 review-integrity.json의 archive_equals_git=false에도 명시돼 있다. LF canonical은 3건 모두 일치하며, 검수 사본과 archive 원본의 차이는0이다.

## 코드 검토 범위와 미검증

BEGIN 성공 후에만 begun=true, apply는 같은 client의 xact advisory lock을 잡고 READ COMMITTED로 재검사하며, SQL/이력은 단일 transaction이다. COMMIT 응답 command도 확인한다. 시작 불명/commit 불명/rollback 실패/error event는 destroy 처리하며 추가 실패 주입4건은 이를 확인했다. 검증된 source만 바깥 BEGIN/COMMIT을 추출하므로 임의SQL을 실행하는 설계는 아니다.

catalog 검사는 표명·owner·RLS flags·policy 총수·guard 총수·기지 이력에 한정된다. policy 정의/대상role/식, trigger 활성 상태/함수 본문, ACL/인덱스 정의의 완전 일치는 검사하지 않는다. 일반적인 외부 변조 미검출은 작성자가 명시한 full schema diff 미지원 한계로 기록하되, F1의 role graph 누락을 그 일반 면책으로 안전하다고 간주하지 않는다. Auth 열/unique index 검사도 완전한 FK 실행 가능성의 증명은 아니며 apply의 SQL 실행이 최종 판정이다.

실managed 환경/실Auth/실TLS/pooler/실네트워크 단절/전체suite/lint/type/build는 이번 미실행이다. 제품 무변경의 독립runner 검사에 한정하며 shared.next/3013은 기동·조작하지 않았다. 실.env.local/DSN/실계정/URL접속, 서비스/PATH/설치, 원fixture 변경, push/deploy 없음. 운영Supabase 적용 승인 작업이 아니다.

## 자기 PID·port 종료와 잔여물

- 원runner run.json: PID66192, 127.0.0.1:61030. listener.log는 해당PID의 loopback listener 소유를 확인. 원 stop.log는 server stopped.
- 추가dry-run 재시작PID52232, 추가apply 재시작PID3384. 모두 같은 자기cluster/port만 사용. review-stop.log 및 review-final-stop.log는 server stopped.
- 최종 종료 확인 review-termination-final.json: 2026-11-17 19:31:37 KST, 3PID 불재, postmaster.pid 없음, 61030 Listen0.
- archive, 물리PG사본, 합성DB, dummy자격파일, 로그, 검증harness는 모두 자기 격리 디렉터리에 보존했다. 삭제를 시도하지 않아 삭제거절/우회 없음. 공유untracked의 다른 작업 파일은 건드리지 않았다.

Master 반환: B5-R FAIL. 고정82e5745의 원runner25/25 독립 재현, 추가4 PASS/2 FAIL. runtime role 간접membership으로 API LOGIN이migration이력3행 DELETE 가능한 상태를runner가 수용(F1), 독립pool과 승인target의endpoint불일치 수용(F2). 보고서만 선택commit, 수정구현은 Backend 담당에게 반환. 수정후 고정SHA 재검증 필요.