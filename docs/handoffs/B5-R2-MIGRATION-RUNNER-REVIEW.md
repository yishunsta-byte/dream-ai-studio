# B5-R2 migration runner 독립 재검수 — PASS

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01. task `task_726bdac58abf`, dispatch `ctx_747b29b9ef18`.
- 고정 SHA **52ea968e41e2224c8febae5571c5871086f9126c**, 2026-11-17 19:50~19:55 KST. 공유 HEAD 관찰 `40cee4d2060573a56f1e88becd97f4da03bb6702`; 실행은 별도 고정 archive에서만 했다.
- 원 B5-R FAIL 보고/커밋 `b073269e4836020f6efa716740fab13933e1e26e`는 수정하지 않았다. 작성자 B5-FIX 보고와 원B5-R harness를 참고하되 결과 수치는 가져오지 않았다.
- 판정: **F1/F2 수정의 지정 로컬 synthetic 범위 PASS**, 필수 수정 잔존 발견0. 원 runner33/33 PASS(skip0, exit0), 별도 독립 harness16/16 PASS(exit0). 이 실행의49건이며 이전 B5-R 수치·작성자218건·반복 실행을 합산하지 않았다. 운영Supabase 적용 승인이나 managed 안전성 전체를 뜻하지 않는다.

## F1 재검수: 실제 권한 상승 상태를 먼저 만든 후 거부 확인

독립 harness `D:/starwork/b5-r2-52ea968/review/independent.mjs`에서 다음 실제 부정상태를 만들었다. 모든 grant/role/DELETE/cleanup은 새 자기 cluster의 synthetic 객체에만 실행했다.

- 원B5-R과 같은 단일 부모 경로 `dream_api → r2_chain0`: 부모에 migration schema USAGE/history DELETE 권한을 부여했다. 실제 API LOGIN으로 `BEGIN; SET LOCAL ROLE r2_chain0; DELETE FROM dream_migrations.history`의 rowCount3을 확인하고 ROLLBACK했다. 원 이력3행 유지 후 runner apply/dry-run 모두 MIGRATION_STATE로 거부했다.
- 3단계 부모 경로 `dream_api → r2_chain0 → r2_chain1 → r2_chain2`도 실제 API LOGIN의 최종 역할 SET/DELETE3/ROLLBACK 후 두 mode 거부를 확인했다.
- LOGIN이 없는 상태의 worker 3단계 부모 경로에서 template는 `Unexpected runtime role graph`로 거부했고 LOGIN 생성0, runner 두 mode 거부를 확인했다.
- unknown principal의 inbound `r2_unknown → dream_api`를 SET/INHERIT/ADMIN 모두 FALSE로 만들어도 template/runner 두 mode 모두 거부했다. 권한 사용 가능 경로만 걸러내는 검사가 아님을 대조했다.
- runtime의 추가 부모 edge를 SET/INHERIT/ADMIN 모두 FALSE로 만들어도 runner 두 mode가 거부했다.
- 허용 예외인 migration owner `dream_test_admin → dream_api`, ADMIN TRUE/INHERIT FALSE/SET FALSE는 정상 수용했다. 이 edge가 있는 상태에서 template가 제한 LOGIN2개를 만들고 runner apply0/dry-run0을 반환했다. 허용 root를 무조건 거부하는 회귀가 없었다.

코드 검토: 재귀 CTE는 reserved4개부터 모든 부모 edge를 UNION으로 순회하고, reserved로 들어오는 unknown inbound도 검사한다. runtime 부모 edge에는 허용식이 없으므로 깊은 경로의 첫 edge부터 거부된다. LOGIN→해당runtime의 정확한 제한 옵션과 session_user인 migration owner→reserved 예외만 허용하며 기존 role flags/직접 membership2개 검사도 유지됐다. template는 같은 SQL을 사용한다. runner는 schema/history owner를 먼저 검사하고 template는 history owner를 검사한다. 이 trusted admin root 자체의 외부 권한 전체를 sandbox하는 보장은 아니다.

## F2 재검수: 옛 pool 필드 거부 이외의 연결 결합 검증

- JavaScript 객체로 독립 IPv4 pool과 다른 IPv6 target/hash를 전달한 apply/dry-run은 모두 MIGRATION_TARGET으로 거부됐다(독립 harness2건 및 원33 내 대조).
- target에 getter를 달고 API 호출 직후 원 객체 connectionString을 IPv6로 바꿨다. getter 읽기1회, 실제 내부 Pool.options.connectionString은 승인한 원 IPv4 문자열이며 dry-run0이 성공했다. await 이전 snapshot이 이후 caller 변경으로 흔들리지 않았다.
- 같은 호출에 `poolFactory`, `createPool` 함수를 주입했지만 호출0이었다. 별도 public factory hook은 코드에도 없었다.
- 독립 pool 필드 없이 IPv6 target/hash를 전달하면 내부 pool이 실제 그 IPv6 connectionString을 사용하고 접속 실패 MIGRATION_FAILED가 됐다. IPv4 서버로 fallback하지 않았고 owned pool.end1회를 확인했다. 자기 서버는 IPv4에만 bind했다.

코드 검토: 승인 target은 primitive string 필드의 shallow frozen snapshot이고 hash 검사와 createPostgresPool에 같은 connectionString을 전달한다. public runner 인자에는 pool/factory가 없고 JS pool 필드도 명시 거부한다. CLI도 독립 pool을 생성하지 않는다. 기존 createPostgresPool의 managed TLS rejectUnauthorized/CA 경계를 유지했다. 서버의 database/session_user/current_user/port 검사는 그대로다. 실제 managed DNS/TLS 접속을 수행한 결과는 아니며 모든 JS monkeypatch/driver 자체 변조를 막는 sandbox 주장도 아니다.

## owned client/pool lifecycle

별도 독립 harness6건은 실제 PG client를 사용하되 실패4건에만 Pool.prototype.connect/query wrapper로 오류를 주입했다. 테스트 후 prototype은 복원했다.

| 상황 | 독립 관찰 |
|---|---|
| 정상 dry-run 완료 | release(false), owned pool.end1회 |
| role graph validation failure | ROLLBACK 후 release(false), owned pool.end1회; pool 종료로 실제 재사용 없음 |
| BEGIN 오류 | release(true), owned pool.end1회 |
| COMMIT 오류/불확실 | release(true), owned pool.end1회 |
| 검사 오류 뒤 ROLLBACK도 실패 | release(true), owned pool.end1회 |
| COMMIT 요청이 ROLLBACK command 반환 | release(true), owned pool.end1회 |

추가 IPv6 connect 실패에서도 pool.end1회를 관찰했다. source/hash/profile 검증은 pool 생성 전에 수행한다. 실패 주입은 driver 오류 경로 검증이며 실제 네트워크 단절/물리 COMMIT 장애를 재현했다는 뜻은 아니다.

## 원33과 불변 계약

원 `tests/postgres/run-migrations-local.mjs`를 변경 없이 실행했다. unit13+실제PG20=33 PASS, skip0/exit0, 19:51:18 KST. 원25의 검사 기대가 API pool 인자 제거 이외에 약화되지 않았음을 82e5745→52ea968의 test diff로 검토했다.

- SQL3 canonical checksum 및 connect 전 source 변조 거부, target/profile/hash/CLI secret 비노출 유지.
- fresh READ ONLY dry-run pending3/적용0/schema·role없음 유지.
- 실제 SQL2 event-trigger 예외 후 SQL1 schema/history/roles 전부 rollback 유지.
- gate lock 보유 중 두 runner의 실제 pg_stat_activity advisory 대기2, 해제 후 apply3/0 및 history3 유지.
- 이력 checksum/unknown/기존role/schema 거부, template PASSWORD NULL/제한 membership, 18 FORCE RLS/36정책/18guard 검사 유지.
- 실제 API A/B RLS/owner 불변, DDL/history DELETE 차단, worker TRUNCATE 차단, timeline raw/hash·append-only 조건 유지.

SQL3 raw SHA256(archive/종료시 shared 읽기 모두 동일):

| 파일 | raw SHA256 | LF canonical (=고정 git blob/manifest) |
|---|---|---|
| 0001_schema.sql | c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3 | 3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19 |
| 0002_invariants.sql | 4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1 | 1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100 |
| 0003_rls.sql | f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd | 7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d |

archive raw는 CRLF이므로 LF git blob과 raw byte 비교는 false이며 canonical은 모두 일치한다. 무변경 검사는 archive 파일920개 전부 archive 원본 대비 차이0이었다. package/SQL3/tsconfig는 원B5 기준과 수정SHA 사이 git diff도0이었다.

## 명령·격리·타입/lint

```powershell
# 공유 저장소 cwd: checkout 없이 고정 archive만 생성
New-Item -ItemType Directory -Path D:/starwork/b5-r2-52ea968
git archive --format=tar --output=D:/starwork/b5-r2-52ea968/source.tar 52ea968e41e2224c8febae5571c5871086f9126c
tar -xf D:/starwork/b5-r2-52ea968/source.tar -C D:/starwork/b5-r2-52ea968
Copy-Item -LiteralPath D:/starwork/b5-r-82e5745/pgsql -Destination D:/starwork/b5-r2-52ea968/pgsql -Recurse
New-Item -ItemType Junction -Path D:/starwork/b5-r2-52ea968/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하 새 격리 사본 cwd
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/b5-r2-52ea968/pgsql/bin
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run lint
# 자기 synthetic cluster 재시작 후 독립 대조
./pgsql/bin/pg_ctl.exe -D D:/starwork/b5-r2-52ea968/tmp/b5-postgres-f5a9bf31-f267-433d-971e-d53d00e58eb3/cluster -l D:/starwork/b5-r2-52ea968/tmp/b5-postgres-f5a9bf31-f267-433d-971e-d53d00e58eb3/review-postgres.log -o '-h 127.0.0.1 -p 53855' -w start
$env:B5_R2_URL='postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:53855/dream_test_b3' # 자기 synthetic dummy
node --conditions=react-server --import tsx review/independent.mjs
./pgsql/bin/pg_ctl.exe -D D:/starwork/b5-r2-52ea968/tmp/b5-postgres-f5a9bf31-f267-433d-971e-d53d00e58eb3/cluster -m fast -w stop
python review/integrity.py
```

- typegen0/tsc0/lint0(경고0). logs `review-typegen.log`, `review-tsc.log`, `review-lint.log`는 사본 root에 보존했다. 자체 harness 추가 전 깨끗한 archive에서 수행했다.
- 원 tsconfig 그대로 실제 product/tests와 생성 route types를 검사했다. 별도 exclude/overlay/tsconfig 완화 없음. node_modules만 읽기 junction이며 공유tmp의 구 migration API 사본들은 archive에 포함되지 않으므로 이번 product typecheck 결과와 분리된다. 공유 workspace 기본 tsc를 실행하거나 그 통과를 주장하지 않는다.
- typegen은 자기 사본 .next에만 생성했다. 공유.next/3013/실.env.local/DSN/실Auth/managed권한/서비스/PATH/설치/package/발행SQL/원fixture/다른WIP/배포 변경 없음.
- archive SHA256 `1e2b78893d7c3e94bd06382ecd0bf79d76b4384566c866271fb62639cfa63cca`; 원 runner SHA256 `5302126257ebf161f869214d7a89ce418759d808c7bd54a2a5f18053a6c82eff`.
- PG 물리복사1592파일을 shared 원본과 각각 SHA256 비교, 불일치0. 공유.tools는 읽기 비교만 수행. postgres/initdb/pg_ctl/createdb 모두 Valid EnterpriseDB 서명, version PostgreSQL18.7.

## harness 초기 cleanup 오류와 종료 증거

추가 harness 첫 실행은15 PASS/1 cleanup error였다. 허용 migrationowner→dream_api ADMIN edge로 LOGIN을 생성한 뒤 그 edge를 바로 REVOKE하려고 해 PostgreSQL이 dependent privileges exist로 cleanup을 거부했다. 실제 정상수용/거부 assertion 실패가 아니라 자기 fixture의 dependency 정리 순서 오류였다. 첫 로그 `independent-initial-cleanup-error.log`를 보존하고 자기 LOGIN을 먼저 제거한 뒤 admin edge를 정리했으며, harness에서는 허용 edge를 마지막까지 유지하고 최종 LOGIN 종료/제거 후 edge를 정리하도록 바꿨다. 제품/검증 기대/skip은 변경하지 않았고 최종16/16 exit0. 첫 시도16을 최종 수량에 더하지 않는다.

evidence: `D:/starwork/b5-r2-52ea968/tmp/b5-postgres-f5a9bf31-f267-433d-971e-d53d00e58eb3`.

- 원runner run.json: PID54236, 127.0.0.1:53855. listener.log는 그 PID의 loopback listener 소유 확인; stop.log는 server stopped.
- 추가 첫 실행PID78600, 최종PID64944. review-pid.txt/review-final-pid.txt와 review-stop.log/review-final-stop.log 보존, 모두 server stopped.
- review-termination.json: 19:53:47 KST에 3PID 모두 불재, postmaster.pid 없음, port53855 Listen0.
- 원B5-R 자료와 새 archive/PG사본/합성DB/로그/harness를 보존했다. 삭제 시도/삭제거절/우회 없음.

## 수용 범위·미검증·반환

F1 role graph와 F2 target/ownedpool 수정은 이번 독립 대조 범위에서 수용 가능하다. 기존 제한인 policy/trigger/function/ACL/index 정의의 full schema drift 검사는 여전히 제공하지 않는다. managed DNS/TLS/실Auth/실권한/실운영 DB/pooler/실네트워크 장애/전체suite/build는 이번 미검증이다. 일반 app/worker가 악의적인 trusted migration owner를 방어하는 sandbox도 아니다.

Master 반환: B5-R2 PASS, 고정52ea968 원33+독립16 전부 PASS, lint/typegen/원tsconfig tsc0, SQL3 불변, 자기3PID/53855 종료. 원B5-R FAIL 기록은 보존. 운영Supabase 적용 승인으로 확대하지 말고 별도 배정/target/secret operator/권한 범위 확인을 유지한다.
