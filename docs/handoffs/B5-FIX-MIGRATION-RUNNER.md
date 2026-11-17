# B5-FIX F1/F2 필수 수정

- 담당 Codex(Backend), 상위 CX-MASTER-01, 요청 msg_e86c5000f7fb, 방안 확인 msg_3b1f5f66ea9d.
- 기준 B5 `82e5745`, 독립 FAIL `b073269e4836020f6efa716740fab13933e1e26e` 및 원본 negative harness를 읽었다. 수정 착수 HEAD `db77e072696cd708669277c59d3f6ce3eb97eb99`.
- 상태 **ready_review / 구현자 자체 재검증**. F1/F2 수정과 회귀를 반환하며 독립 재검수 수용을 대신하지 않는다.

## F1/P1: runtime 간접 SET ROLE 권한 상승

원 runner는 api_login/worker_login 직접 membership만 검사해 runtime 부모 역할을 통해 migration history DELETE가 가능한 상태를 수용했다. 실제 권한 상승이며 full schema diff 미지원으로 면책할 수 없는 경계 누락이었다.

`migration-runner.ts`에 `restrictedRoleGraphViolationsSql`을 추가하고 `provision-template.ts`도 **동일 SQL**을 사용한다. reserved 역할4개부터 재귀적으로 모든 부모 경로를 따라가며 SET/INHERIT/ADMIN 옵션 전체와 unknown inbound grant를 검사한다.

허용 graph:

- dream_api_login → dream_api: ADMIN FALSE / INHERIT FALSE / SET TRUE.
- dream_worker_login → dream_worker: 같은 제한.
- runtime 두 역할에는 추가 부모 경로가 없다.
- history/schema owner로 이미 확인된 migration operator의 reserved 역할 관리 membership만 trusted admin root로 허용한다. 다른 unknown principal의 inbound grant는 거부한다.

기존 role flags/직접 membership 수·필수 edge 검사는 유지한다. runner는 unknown graph에 MIGRATION_STATE를 반환하고 권한을 자동 REVOKE/ALTER하지 않는다. template는 같은 graph에 `Unexpected runtime role graph`로 중단해 새 login을 생성하지 않는다.

### 실제 F1 대조

합성 cluster에만 api→parent→extra의 **2단계 SET TRUE 경로**를 만들고 extra에 history schema USAGE/DELETE를 주었다. 실제 dream_api_login이 SET LOCAL ROLE extra 후 history **3행 DELETE**에 성공하는 것을 확인하고 ROLLBACK했다. 즉 부정 상태 자체가 실재함을 먼저 확인했다.

그 상태의 새 runner apply/dry-run은 모두 MIGRATION_STATE로 거부하고 각 소유 pool 종료를 확인했다. template는 LOGIN이 아직 없는 별도 합성 상태에서 worker 부모 경로를 넣어 실행했으며, graph 오류로 거부하고 LOGIN 생성0을 확인했다. 자기 fixture에 만든 권한/역할만 cleanup했다. managed 권한은 변경하지 않았다.

## F2/P2: target과 독립 pool 분리 제거

`runPostgresMigrations`의 독립 pool 입력을 제거했다. **TypeScript 선언만 제거한 것이 아니라 JavaScript에서 pool 필드가 있으면 명시 MIGRATION_TARGET으로 거부**한다. 테스트용 pool/factory를 공개 API로 다시 열지 않았다.

runner는 target의 immutable snapshot 하나로 hash/profile을 검증하고, 같은 connectionString으로 내부 소유 pool을 생성해 접속한다. 관리 TLS CA 옵션은 기존 B3 createPostgresPool로 전달하며 managed rejectUnauthorized/DNS hostname 검증 경계를 유지한다. 서버 IP 비교로 일반 DNS/TLS 보장을 주장하지 않는다.

CLI는 새 migration API를 호출하고 별도 pool을 만들지 않는다. 일반 B3/B4 pool/adapter/service 계약은 바꾸지 않았다. 성공/상태 검증 실패/BEGIN 실패/COMMIT 불확실/rollback 실패 때에도 소유 pool을 종료한다. 검증이 connect 전 실패하면 pool 자체가 생성되지 않는다.

### 실제 F2 및 disposal 대조

- 실제 IPv4 서버/관리 pool을 확인하고 target만 IPv6로 바꿔 승인 hash를 만들었다. 기존 형태의 독립 pool+다른 target 입력은 apply/dry-run 양쪽 모두 MIGRATION_TARGET, history3행 유지. 불일치 target으로 IPv4 pool을 실행할 수 없다.
- migration API가 pool/factory를 받지 않으므로 fault injection은 **테스트에서 pg Pool.prototype.connect만 감싸는 방식**으로 수행했다. 실제 client를 사용해 BEGIN 실패, COMMIT 실패, ROLLBACK 실패, COMMIT 대신 ROLLBACK command 응답의4개 원 독립 대조를 유지했다.
- 네 경우 release(true) 및 owned pool.end1회를 확인했다. 이는 driver 실패 주입이며 실제 네트워크 단절/물리 COMMIT 장애 전체를 재현했다는 뜻은 아니다. 정상 완료와 F1 validation 실패에서도 pool 종료를 별도로 확인했다.

## 변경 파일

`lib/db/postgres/migration-runner.ts`, `provision-template.ts`, `scripts/postgres/migrate.ts`, `tests/postgres/migrations.test.ts`, `migrations-integration.test.ts`, `run-migrations-local.mjs`, README 및 이 보고서만 변경했다.

원13 unit+12 integration은 새 migration API 호출 형태에 맞게 pool 인자만 제거하고 원 기대를 유지했다. 추가8개는 F1 실제 간접 경로/template, F2 두 mode, disposal4다. 발행 SQL3/SQLite1~10/Auth/API/B3-B4 서비스/T207/package는 변경하지 않았다. 타 세션 staged/미추적 파일은 보호하고 고유 경로만 commit한다.

## 재현 명령과 실제 결과

```text
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

최종 **2파일33 PASS = 원25 + 신규8**, skip0/exit0, 19:45 KST. 원25의 checksum/dry-run/중간SQL 전체 rollback/동시 advisory 대기2→apply3·0/이력/권한/원불변 조건도 유지됐다. 관련8파일 회귀 **218 PASS**, 최종 lint exit0·경고0, diff --check exit0이다. 반복한 unit을 새 검사로 합산하지 않는다.

초기 새 runner run은 initdb의 파일 sync가60초를 넘어 timeout했다. 로그상 초기화는 이후 성공했고 해당 initdb 프로세스 없음·postmaster PID파일 없음·서버 미시작을 확인했다. timeout을 서버 종료로 추정하지 않았다. sync를 끄지 않고 **소유 initdb에만120초**를 허용하도록 test helper를 보완했다.

첫 실제33 실행에서는 F2 주소 관찰의 `inet_server_addr()::text`가 IPv4에 /32를 붙여 반환해2건이 assertion에서 실패했다(31 PASS/2 FAIL). `host(inet_server_addr())`로 정확한 주소 표현을 얻도록 **관찰 SQL만** 수정했다. 기대 IPv4 값과 불일치 pool 거부 기대를 완화하지 않았다. 최종33에서 F2 두 검사를 실제 수행·통과했다.

## 타입 검사: 원 workspace 실패와 고정 사본 통과 구분

원 workspace `npx.cmd tsc --noEmit --incremental false`는 실패했다. 오류12개는 아래 ignored T207 사본의 **구 migration pool 인자**가 root alias로 새 migration API를 참조한 것으로, 원 product 파일 경로의 오류는 보고되지 않았다.

- tmp/t207-http-1b040787-d2c7-47e1-b601-a161d20a3833/app/tests/postgres/migrations*.ts
- tmp/t207-http-b3d50060-8877-424c-ba61-e895521cdde0/app/tests/postgres/migrations*.ts
- tmp/t207-http-e618dad1-9e1a-4240-97d5-5891b085fb57/app/tests/postgres/migrations*.ts

원 tsconfig를 바꾸지 않았다. 임시 `tmp/b5-fix-typecheck/tsconfig.json`은 원 config를 extends하고 정확히 `../../node_modules`, `../../tmp`만 exclude한 검증용이며 다음 명령 exit0이었다. 이를 원 workspace 기본 typecheck 통과로 표현하지 않는다.

```text
npx.cmd tsc -p tmp/b5-fix-typecheck/tsconfig.json --noEmit --incremental false
```

추가로 **고정 db77e07 archive+자기6파일 overlay**를 `tmp/b5-fix-type-snapshot/`에 만들었다. node_modules만 읽기 junction이고 설치/공유 .next 변경이 없다. 원 tsconfig의 strict 옵션/실제 app/lib/components/worker/scripts/tests를 그대로 검사했다. 사본에서 route types를 생성하고 원 명령으로 통과했다.

```text
node node_modules/next/dist/bin/next typegen
npx.cmd tsc --noEmit --incremental false
```

둘 다 exit0. 최종 overlay를 다시 복사한 후 tsc도 exit0을 확인했다. `overlay-hashes.json`에 base SHA와 수정6파일 hash를 보존했다. 생성 Next types도 검사했으며, product source를 exclude하지 않았다. 이 고정 소스 결과는 concurrent T207 WIP 전체의 검수를 대신하지 않는다.

## 환경·종료·원문 불변

- 최종 `tmp/b5-postgres-9555120b-b901-45ac-bd77-16c4ff0a3ea6/`: PostgreSQL18.7, PID67680,127.0.0.1:60738. tests/signatures/run/listener/stop 로그 보존, server stopped·PID파일 없음·listener0.
- 첫33 실패 run `tmp/b5-postgres-66abe120-87de-46af-a906-839471b4da8e/`(PID45448/56697)도 정상 종료·PID파일 없음·listener0. initdb-only timeout run `0358c7e7-0ee9-4196-b750-9b3ff75cb06b`는 서버 미시작/프로세스 종료 확인 후 보존했다.
- 발행 SQL raw SHA256은 시작/최종 동일: 0001 c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3, 0002 4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1, 0003 f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd.
- 실제 managed/실 DSN·권한·apply/외부 설정/배포·3013/shared .next·원 fixture는 조작하지 않았다. 모든 공격 grant/DELETE/role cleanup은 이번 새 합성 cluster에서만 했고 원 이력은 rollback했다. 데이터/로그/사본 삭제를 시도하지 않았다.

## B7 중단 상태

우선 배정 시 B7 managed SQL/transaction은 시작하지 않았다. 새 조회를 중단하고 Ego TaskSpace37을 정상 finish했다. 완료 사실은 GitHub CLI 기존 인증·대상 repo metadata 접근, Supabase/Vercel CLI 미설치, selective env의 DB URL류 부재·DB password 존재 boolean, 기존 Supabase 로그인 project 이름/ref 일치 확인까지다. endpoint 제공값은 확인 전이며 추정 접속하지 않았다. 비밀값/부분문자·원문 env/토큰/DSN은 기록하지 않았다. safe 결과와 probe만 ignored tmp/b7-managed-01에 보존하고 B7 후속 조회는 Master 재배정 전 재개하지 않는다.

## 반환·한계

실제 F1 경로와 F2 입력 boundary를 수정했지만 managed role graph/TLS/pooler/실네트워크/모든 함수·ACL drift를 검증했다고 주장하지 않는다. 이번33/218/lint·고정 원 tsconfig 증거로 재검수를 요청한다. B5-R 원 FAIL은 역사 기록으로 유지하며 수용은 Master/독립 검수 판단이다.

Master 복사용:

> B5-FIX ready_review. 공통 recursive reserved-role allow graph로 F1 runner/template 모두 거부, F2 공개migrationAPI 독립pool JS입력도거부·검증target내부ownedpool생성/종료로수정. 새 PG 원25+F1/F2/disposal8=33PASS, 영향218PASS/lint0. 원 workspace tsc는ignored T207 old사본12오류로FAIL임을명시; db77고정archive+자기6overlay의원tsconfig typegen/tsc0 별도확보. SQL3rawhash불변·소유PG60738종료/listener0, managed/3013/.next/B3-B4/Auth/T207/package불변. B7새조회중단·브라우저finish/managedSQL없음. 고정SHA 독립재검수 요청.
