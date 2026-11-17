# B9-R Session migration 독립 검수 — PASS (로컬 계약 범위)

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_afa08fc74b72`, dispatch `ctx_cf3e7d2446a6`.
- 고정 SHA **0d851865b6afe751ec9b5ab5507e35a801a7593b**. 공유 시작 HEAD 관찰 `7fac6304d1d77afd2efba71a5c24a640613d5894`; 실행 소스는 고정 archive뿐이다.
- AI_TEAM_RULES **운영1.1 §6**, B9 인계, 이전B5-R2를 읽었다. 원B5-R/B5-R2 보고서 수정 없음.
- 판정: 지정 Session profile/독립 binding/ownedpool 및 B5 회귀의 **로컬 계약 PASS**, 필수 수정 발견0. 실제 managed migration/권한/transport 전체 수용은 아니다.

## 독립 실행 결과와 수량 중복

| 실행 | 이번 독립 결과 | 경계 |
|---|---|---|
| 원6파일 focused | 121 PASS, skip0, exit0, 20:18:28 KST | 이 안에 신규 Session35 포함; Session transport 부분은 mock |
| 원 portablePG runner | 33 PASS, skip0, exit0, 20:19:06 KST | synthetic 실제PG; 13 unit은 focused와 중복 |
| 별도 B5 boundary harness | 16 PASS, exit0 | 이전 자기 harness를 새 fixed 사본/cluster에서 실제 재실행 |
| 별도 Session harness | 15 PASS, exit0 | 실제 localPG client + 명시 transport shim; 외부 접속0 |
| 원tsconfig typegen/tsc, 전체 lint | 각 exit0, lint 경고0 | 자기 사본에서 원 config 그대로, 자체 harness 추가 전 |

35는121에 포함되고,33 중13은121과 겹친다. 각 집합을 위와 같이 보고하며 합계로 coverage를 부풀리지 않는다. 작성자 결과·이전 검수·반복 실행 수치는 합산하지 않았다.

## Session target/역할/port/환경 독립 binding

코드 `lib/db/postgres/migration-target.ts`, `migration-runner.ts`, `scripts/postgres/migrate.ts`, 기존 connection 및 원35를 독립 검토했다.

- Session staging/live는 별도 profile 값과 별도 hash이다. independently supplied host/port/database/routing username/actual expected role/ref가 모두 DSN과 일치해야 한다. CLI가 DSN을 파싱해서 승인 필드를 자동 채우지 않는다.
- AWS shared host 모양을 제한하고 port는 명시5432만 받는다. transaction6543, Direct host, suffix lookalike, unknown profile/role 문법, field 누락/불일치는 거부한다. provider username은 `expected_role.explicit_ref` 전체와 정확히 일치해야 한다.
- inspector는 routing username의 suffix를 추측해서 없애는 대신 explicit sessionRole을 actual 기대값으로 반환한다. runner는 actual database/session_user/current_user/backend port 모두 비교하며 실제 role의 CREATE/CREATEROLE/Auth REFERENCES 등 B5 권한 검사를 유지한다.
- hash에는 profile/host/port/database/routing username 및 Session ref/expected role이 반영된다. password는 제외된다. staging/live label은 물리 환경 판정이나 apply 승인을 증명하지 않는다.
- 기존 synthetic/Direct hash tuple은 유지됐다. 별도 harness에서 기존 알고리즘으로 SHA256을 직접 계산해 두 profile 모두 현재 결과와 일치함을 확인했다. 비Session profile에 Session binding 필드5개를 각각 제공하면 모두 거부됨을 확인했다.
- CA는 실행 전에 비어 있지 않아야 한다. 독립 harness에서 undefined/빈문자/공백 CA는 pool connect 전에 거부됐다. malformed PEM의 적합성·신뢰 provenance를 이 gate가 검증하는 것은 아니며 TLS handshake와 별도 operator 승인이 필요하다.
- 독립 harness는 SSL URL query의 disable/rootcert/verify-full/options 및 fragment를 모두 거부함을 확인했다. 실제 connection 설정은 rejectUnauthorized:true/제공CA/max1/sslnegotiation:postgres를 유지했다.

## 독립 Session 부정대조15의 정확한 transport 범위

`review/session-independent.mjs`는 공개 migration API를 그대로 사용한다. Pool.prototype.connect를 자기 harness에서만 감싸 외부 hostname을 해석/접속하지 않고 자기 localPG client를 돌려준다. actual identity query의 **backend port만5432로 합성**하는 baseline이며, 나머지 query/BEGIN/COMMIT/ROLLBACK/catalog 검사는 실제 localPG에 실행한다. 이는 Supavisor/TLS/네트워크 수용 검사가 아니다.

확인한15개 시나리오:

1. 기존 Direct/synthetic hash 알고리즘 호환.
2. 비Session에 모든 추가 binding field 거부.
3. 모든 DSN SSL override/query/fragment 거부 및 connect0.
4. staging hash를 live에 제공한 apply 거부.
5. 동일 환경 hash 불일치 dry-run 거부.
6. CA 누락/빈값/공백 거부, connect0.
7~10. actual session_user/current_user/database/port 각 불일치를 apply와 dry-run 모두 MIGRATION_TARGET으로 거부하고 ROLLBACK/release(false)/ownedpool.end1회 확인.
11. 합성5432 대신 실제 자기 localPG service port55287을 반환하면 거부. 새로운 Session port 검사도 우회되지 않았다.
12. 모든 target field getter를 두고 호출 직후 DSN/profile/role을 변경해도 각 field snapshot 읽기1회, 승인한 원DSN으로 실제 내부 Pool 설정 생성 및 정상dry-run0; TLS 옵션 유지, ownedpool.end1회.
13~14. JavaScript old pool 필드를 넣은 apply/dry-run 모두 pool 접속 전 MIGRATION_TARGET.
15. actual session_user가 routing username `role.ref`를 그대로 반환하면 거부. routing identity와 실제DB role을 혼동하지 않는다.

초기 자체 harness는14 PASS/1 FAIL이었다. snapshot getter 읽기 수를 잴 때 harness helper가 승인hash를 같은 getter 객체에서 먼저 계산해 읽기1회를 추가한 검증도구 오류였다. 최초 로그 `independent-session-initial-harness-read-count.log`를 보존하고 승인hash는 별도 원target에서 먼저 계산해 전달하도록 고쳤다. 제품/기대읽기1회/skip은 변경하지 않았고 최종15/15을 재확인했다. 반복15는 합산하지 않는다.

## B5 source/graph/atomicity/disposal 회귀

52ea968→0d85186 diff에서 runner 변경은 Session 판정 import와 CA gate뿐이다. role graph SQL/provision template/source/transaction SQL/후검사/disposal/기존 실제PG 테스트는 동일했다.

원 실제33으로 source tamper, READ ONLY fresh pending3/적용0, SQL2 실제 예외 후 schema/history/roles 전체rollback, gate advisory 대기2→apply3/0, history checksum/unknown·기존role/schema 거부, 제한 LOGIN/template/RLS/DDL/history 권한, failure disposal를 재현했다.

별도 `review/b5-boundaries.mjs` 16건으로 단일 및3단계 runtime 부모 경로에서 실제 API LOGIN SET ROLE/history DELETE3/ROLLBACK 후 apply/dry-run 거부, unknown inbound/template거부, nonSET 부모도거부, 허용 migrationowner edge 수용을 확인했다. 또한 synthetic snapshot/실ownedpool DSN 결합/factory주입무호출/별도IPv6접속실패와 lifecycle SUCCESS/VALIDATION/BEGIN/COMMIT/ROLLBACK실패/COMMIT_AS_ROLLBACK을 확인했다. 정상·validation은 release(false)+end1, 불확실 실패4는 release(true)+end1이었다. 실제 물리COMMIT 장애/네트워크단절 재현은 아니다.

## 공식 primary 문서와 코드의 일치

2026-11-17에 아래 공개 문서를 직접 읽었다. 공식 문서의 SQL/설정 명령은 실행하지 않았다.

- [Supabase Prisma](https://supabase.com/docs/guides/database/prisma): Session5432를 migration용으로 허용하는 예시, DB-USER.PROJECT-REF routing 예시를 확인했다. 일반 가이드가 Direct를 추천하는 것과 Session migration 선택지를 구분한다.
- [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres): custom role의 shared username은 role.ref,5432는Session/6543은Transaction이며 pooler host는 region으로 구성하지 말고 provider Connect에서 복사해야 한다. 코드의 supplied host와 explicit ref/role 계약은 이와 일치한다. 이 자료로 실제 role 권한이나 현재 프로젝트 환경을 증명하지 않는다.
- [Supavisor terminology](https://supabase.com/kb/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO): Session은 client에 underlying connection을 전용 제공한다. 이 계약과 동일client BEGIN/lock/SQL/COMMIT 구현을 결합하면 transaction context 유지가 가능하다는 것은 **공학적 추론**이다. 전체 SQL3의 실제managed 성공을 뜻하지 않는다.
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS): transaction-level advisory lock은 transaction 종료 시 해제된다. 기존pg_advisory_xact_lock 구현과 일치한다.
- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement): shared pooler의 client→pooler와 pooler→Postgres 두 구간을 구분한다. 코드의 client CA/hostname 검증만으로 internal leg TLS 수용을 주장할 수 없다. 이 검수는 실제프로젝트 TLS 상태를 확인하거나 설정을 변경하지 않았다.

## 격리·명령·무결성

새 사본 `D:/starwork/b9-r-0d85186`; node_modules만 읽기 junction,PG는 물리복사. 공유 checkout 없음.

```powershell
# 공유 저장소 cwd
New-Item -ItemType Directory -Path D:/starwork/b9-r-0d85186
git archive --format=tar --output=D:/starwork/b9-r-0d85186/source.tar 0d851865b6afe751ec9b5ab5507e35a801a7593b
tar -xf D:/starwork/b9-r-0d85186/source.tar -C D:/starwork/b9-r-0d85186
Copy-Item -LiteralPath D:/starwork/b5-r2-52ea968/pgsql -Destination D:/starwork/b9-r-0d85186/pgsql -Recurse
New-Item -ItemType Junction -Path D:/starwork/b9-r-0d85186/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하 자기 사본 cwd
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/session-migrations.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-request.test.ts tests/postgres/project-read-backend.test.ts tests/project-get-routes.test.ts
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/b9-r-0d85186/pgsql/bin
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run lint
# 자기cluster를 127.0.0.1:55287로 재시작한 뒤
$env:B5_R2_URL='postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:55287/dream_test_b3' # 자기 synthetic dummy
node --conditions=react-server --import tsx review/b5-boundaries.mjs
node --conditions=react-server --import tsx review/session-independent.mjs
python review/integrity.py
```

시작/종료 명령은 사본 `pgsql/bin/pg_ctl.exe -D <아래evidence>/cluster -l <evidence>/review-postgres.log -o '-h 127.0.0.1 -p 55287' -w start`, 종료는 같은-D에 `-m fast -w stop`이다. 모든 명령과 harness/로그는 자기 사본에 보존했다.

- archive SHA256 `27f73d1b0c266fa7c0d0e5bdbff84a425ec20a3b3f7e48f171ec207956037f95`; archive 원933파일 종료검사변경0.
- 물리PG1592파일과 shared 원도구 SHA256 불일치0. 원도구 읽기비교만 수행. postgres/initdb/pg_ctl/createdb Valid EnterpriseDB 서명; PostgreSQL18.7.
- SQL3 raw SHA256: 0001 `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`,0002 `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`,0003 `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd` 모두 archive/최종shared 읽기 동일. LF canonical은 manifest/고정git blob과 일치. archive raw CRLF와 git LF raw의 차이는 review-integrity.json에 명시했다.
- review-focused.log/review-typegen.log/review-tsc.log/review-lint.log 보존. 원tsconfig/전체product·tests·생성route type을 검사했고 별도exclude/overlay 없음. sharedtmp의 과거API사본은 archive에 없으며 그 오염과 product 검사를 분리했다.

## 종료·마지막 점검·미검증

evidence `D:/starwork/b9-r-0d85186/tmp/b5-postgres-4f49c655-7db5-4fef-919b-d4a75827e43f`.

원runner PID76356/port55287(loopback 소유listener 확인), 추가 첫PID74188/최종PID50740 모두 stop 로그 server stopped. `review-termination.json`은 **2026-11-17 20:21:22 KST**에3PID 불재,postmaster.pid없음,55287 Listen0을 확인했다.

마지막 운영1.1 점검: **2026-11-17 20:21:22 KST**, 계기=검수 실행/종료 증거 수집 완료. 실제 확인범위=자기실행결과/무결성/PID·port종료, 공유git status/staged없음 및 최근 handoff파일명·시각 대조. 기존 untracked T122/T137은 다른작업 자료로 수정·stage하지 않았다. queued mailbox/타worker 전체진행은 이번 확인범위가 아니며 Master에 본 결과만 반환한다. 턴밖 자동점검/스케줄러/상주wake 미설정, polling없음.

실managedprobe/실DSN/prod.env/실Auth/권한/DDL·GRANT/계정/네트워크설정/배포는 수행하지 않았다. 모든 SQL변경은 새 synthetic cluster뿐이다.3013/shared.next/원SQL/원fixture/package/다른WIP 변경없음. source/정책/함수/ACL 전체drift 탐지는 기존한계, 전체suite/build/실pooler startup parameter 수용/실TLS두구간/실lock·DDL·rollback·provisioning은 미검증이다. 자료는 삭제하지 않고 보존했다.

Master 반환: B9-R 로컬 계약 PASS. focused121(내부Session35),원실PG33(중복unit13별도),독립B5경계16/Session15 PASS;원tsc/lint0,소유PG모두종료. 실제managed권한/transport전체/적용승인으로 확대하지 않는다.
