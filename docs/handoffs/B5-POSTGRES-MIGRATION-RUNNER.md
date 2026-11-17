# B5 Postgres migration 실행기 · managed 적용 준비

- 담당 Codex(Backend), 상위 CX-MASTER-01, 요청 msg_2ecb1bad9563.
- 착수 SHA `357bf1ff3d79d2df901c28897f46825aad8c2c01`. 검증 중 공유 HEAD `2b2d2e89e689f669159285487570666864260c4b` 확인.
- 상태 **ready_review / 구현자 자체 검증**. 실행기와 합성 DB 검증을 구현했다. managed 프로젝트 SQL/role 적용·실 DSN 조회·외부 publish는 하지 않았다.
- B4-G 독립 수용은 Master msg_a1046872bd9a로 수신했다. 그 수용이 이번 신규 migration runner의 독립 수용을 대신하지 않는다.

## 구현 범위

| 파일 | 구현 |
|---|---|
| `lib/db/postgres/migration-manifest.ts` | 발행 SQL3개 고정 checksum, LF canonical 검사, 정확히 검증된 source의 바깥 BEGIN/COMMIT만 분리 |
| `lib/db/postgres/migration-target.ts` | 명시 synthetic/managed-staging profile, full DSN 검증, 비밀을 제외한 target SHA256, 관리 대상 DB/operator/port 추출 |
| `lib/db/postgres/migration-runner.ts` | 동일 client의 advisory transaction lock, target/권한/Auth FK/기존 상태 검사, 전용 적용 history, SQL3개+이력 단일 atomic transaction, 재실행0 |
| `lib/db/postgres/provision-template.ts` | migration owner용 password-free API/worker 별도 LOGIN template. 기존 login 거부·제한 단일 membership·PASSWORD NULL |
| `scripts/postgres/migrate.ts` | 안전한 fingerprint/dry-run/apply/provision-template CLI. DSN은 별도 env만, 일반 DATABASE_URL fallback/inline password 인자 없음 |
| `tests/postgres/migrations.test.ts` | source 변조·target/hash·profile·CLI/no-secret unit13건 |
| `tests/postgres/migrations-integration.test.ts` | 실제 apply/rollback/동시성/history/권한/provision/CLI integration12건 |
| `tests/postgres/run-migrations-local.mjs` | 신규 portable 합성 cluster 실행기. 기존 B3/B4 fixture/runner는 변경하지 않음 |
| `lib/db/postgres/README.md`, `.env.example` | managed 준비 판단·재현법·당시 project 공개 식별 근거, 새 변수 이름만 |

그 외 Auth/API/service/UI/worker/package·기존 SQLite1~10/고정 fixture/발행 SQL3개는 변경하지 않았다. 자동 초기화/import-time 접속·운영 DB 조작을 추가하지 않았다.

## 실행 계약과 원자성

1. 세 파일 전체의 canonical SHA256을 **connect 전** 검증한다. CRLF→LF만 허용하며 공백/주석/BOM/SQL 변경은 거부한다. sourceRoot는 테스트용 알려진 파일 사본에도 사용할 수 있지만 임의 manifest/SQL 배열은 입력받지 않는다.
2. target은 명시 profile/user/password/host/port/database, 예상 target hash가 필요하다. synthetic은 loopback dream_test_*만, managed-staging은 명시 projectRef와 일치하는 db.<ref>.supabase.co direct host만 받는다. 실제 current_database/session_user/current_user/backend port도 비교한다. pooler를 direct endpoint로 추측하지 않는다.
3. 적용은 BEGIN(READ COMMITTED) → 고정 pg_advisory_xact_lock(1725031001,5) → 상태 재검사 → 전용 dream_migrations.history 생성 → SQL1/이력1→SQL2/이력2→SQL3/이력3→후검사→COMMIT이다. 잠금 대기 뒤 새 상태를 보도록 적용에는 REPEATABLE READ를 사용하지 않는다. 제공 provision template도 같은 lock을 사용한다. 외부 비협조 SQL을 막는 lock은 아니다.
4. 각 발행 파일의 자체 BEGIN/COMMIT은 **메모리에서만** 통제 추출한다. trigger/DO 내부 BEGIN은 그대로 보존한다. 따라서 실패가 SQL2/SQL3에서 나더라도 첫 schema·이력·role까지 전부 rollback한다. 원문 SQL/SQLite journal을 수정하지 않는다.
5. 알려진 이력이 없는 기존 dream/history/role/login은 adopt/drop/alter하지 않고 거부한다. 이력은 현재 정확한3개 ordinal/id/checksum을 요구한다. 정상 재실행/완료 dry-run은0, unknown/변조/partial 이력은 실패다. 역할 flags, login2개가 있으면 각 단일 ADMIN FALSE/INHERIT FALSE/SET TRUE membership, schema/table owner·18 FORCE RLS·36정책·18guard를 후검사한다.
6. 지원 서버16+, effective CREATE/CREATEROLE 또는 superuser와 auth.users(id uuid unique not-null)/REFERENCES가 필요하다. app/runtime 계정은 migration 주체로 거부한다. managed 계정이 해당 권한을 가진다고 가정하지 않는다.
7. dry-run은 READ ONLY이고 target/권한/기존 이력을 읽지만 schema/history/role은 만들지 않는다. fingerprint/실행 출력에는 targetHash와 mode/count/고정 manifest id/checksum만 담는다. DSN/host/db/user/password·driver stack/cause/SQL 메시지는 출력하지 않는다. COMMIT/rollback/연결 불확실 client는 폐기한다.

검사는 manifest/history와 명시 catalog 경계 검사다. 모든 함수/ACL/인덱스 정의의 외부 변조를 탐지하는 full schema diff나 migration owner의 악의적 SQL sandbox로 표현하지 않는다.

## 발행 파일 불변 근거

| 파일 | Windows 원문 SHA256 (착수=종료) | manifest LF canonical SHA256 |
|---|---|---|
| 0001_schema.sql | c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3 | 3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19 |
| 0002_invariants.sql | 4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1 | 1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100 |
| 0003_rls.sql | f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd | 7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d |

source 변조 검사는 ignored tmp의 별도3파일 사본을 변경해서 실행했다. 원본 SQL은 변경하지 않았다.

## 실제 driver 검증

```text
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
node --conditions=react-server --import tsx scripts/postgres/migrate.ts provision-template
```

| 검사 | 최종 결과 |
|---|---|
| 신규 runner 새 cluster 실제 재현 | **2파일25 PASS = unit13 + 실제 PG integration12**, exit0, 19:19 KST |
| 관련8파일(migrations/connection/backend/request/projects/api-auth/t191/maintenance) | **218 PASS**, exit0, 19:18 KST |
| `npm.cmd run lint` | exit0, 경고0 |
| `npx.cmd tsc --noEmit --incremental false` | exit0, 단위 test tuple typing 수정 후 |
| CLI 실제 process provision-template | exit0, 비밀번호 없는 SQL만 출력, ignored preview 보존 |
| `git diff --check`, SQL 원문 hash 재대조 | exit0 / 3개 모두 불변 |

처음 unit의 it.each tuple이 positional 인자로 펼쳐져 typecheck가 실패했다. 객체 `{args}` 형태로 수정하여 실제 인자 배열 계약을 명확히 하고 typecheck·218회귀·최종25검사를 재실행했다. 기대값 완화/skip으로 해결하지 않았다. 최초 hash 계산용 node -e의 PowerShell quote 실패는 읽기 도구 오류였고 PowerShell UTF-8 hash로 다시 계산했다. source/DB 실패로 세지 않는다. 중간23/25 PASS 반복을 별도 새 검사로 합산하지 않는다.

실제 integration12는 다음을 증명했다.

- missing Auth table와 잘못된 text id FK 거부, fresh dry-run pending3/적용0/namespace·role 없음.
- 합성 fixture가 만든 unknown dream_api 및 dream_api_login, 기존 dream schema는 거부·미변경. 각 negative 뒤 테스트가 **자기 생성한 합성 객체만** 제거했다. runner의 기존 환경 DROP/adopt 기능은 없다.
- test 전용 event trigger가 SQL2의 CREATE FUNCTION dream.guard_row에서 실제 예외를 발생시킴. SQL1이 이미 실행된 상태인데 dream/history/roles 모두0으로 rollback됨 확인.
- 별도 gate client가 같은 advisory lock을 잡은 동안 두 runner가 실제 pg_stat_activity wait_event=advisory에서2개 대기함을 확인. gate 해제 뒤 적용 결과[3,0], 이력3행. 단지 두 호출의 우연한 순차 실행을 lock 증거로 쓰지 않았다.
- 재실행/dry-run0, checksum 변조/unknown4번째 이력 거부. 테스트 admin이 자기 합성 이력만 원래대로 복원했다.
- 18표 FORCE RLS/owner·36정책·guard 후검사, template API/worker 로그인2개 password NULL·제한 membership. 같은 template 두 번째 실행은 기존 login을 거부했다. 테스트 전용 dummy 암호만 별도로 설정해 실제 login했다.
- app login의 dream DDL/직접 read/history DELETE/migration 실행 거부, SET LOCAL dream_api+actor의 A/B 격리·타 owner INSERT 거부·owner 변경 불변, worker의 의도된 cross-owner SELECT·TRUNCATE 거부.
- timeline raw JSON 공백 보존과 SHA 검사, 잘못된 hash23514·이력 DELETE23514 실제 거부.
- 실제 CLI 함수 dry-run 성공 결과에는 hash/manifest만, 잘못된 합성 암호로 apply 접속 실패해도 출력은 MIGRATION_FAILED만. 실제 secret/DSN/host/operator 원문 없음.

지속 객체인 dream/history/role 변경 권한을 검증한 것이며, DB의 PUBLIC TEMP 정책 등 전체 DB 보안 정책을 바꿨다고 주장하지 않는다. 전체 test suite·build/typegen은 반복하지 않았고 shared .next를 보호했다.

## 소유 환경 · 종료

B3에서 서명 검증한 portable PostgreSQL18.7의 postgres/initdb/pg_ctl/createdb를 새 runner에서도 매번 Valid EnterpriseDB 서명 확인 후 실행했다. 서비스/PATH/설치 파일 변경 없이 임의 loopback port·새 dream_test_b3 DB·dream_test_admin·dummy 자격만 사용했다. 실제 Auth schema는 합성 stub이며 managed Auth를 변경하지 않았다.

- 최종 `tmp/b5-postgres-7193699d-9c5e-422e-806f-8748af1b3fbe/`: PID76328,127.0.0.1:53998. tests.log/run.json/listener.log/signatures.log/stop.log 보존, exit0·server stopped·PID파일 없음·listener0.
- 이전 `36500e7f-398c-4078-a14e-1e0d8cb437b0`(49907), `a04f1ecd-4aec-4da3-bd34-6899c8464f20`(52247), `c535d17d-dd13-4e71-8cd9-9f60bc7380a9`(53084)도 모두 종료·PID파일 없음·listener0 확인. 증거/합성 DB/변조 사본은 삭제하지 않았다.
- 기존3013/실사용 data/storage/backups/실 `.env.local`/실 DSN/managed project/기존 SQLite fixture는 조작하지 않았다. 테스트 SQL DROP/ALTER는 이 새 합성 cluster의 자체 생성 negative fixture와 dummy login 설정에만 사용했다.

## 정확한 managed 식별과 다음 시험 적용

T179 문서 자체에는 생성 당시 실 URL이 없었으므로 ref를 추정하지 않고 Master에 공개 근거를 요청했다. Master msg_9da1ba1cca7c가 원수신 msg_377e681fe114(Front T179 V0 생성)와 msg_eb75ca2fe4c9(동일 ref/Seoul 재확인)를 제공했다.

당시 보고는 **https://osvjfyjlbixmvnjkxdry.supabase.co**, star 조직/dream-ai-studio/Seoul ap-northeast-2/NANO, Data API on·auto-public off·auto-RLS on이다. README에 출처와 당시 보고/현재 미확인 차이를 명시했다. 이 URL/ref는 코드/env/CLI의 default가 아니며 기존 live Auth 프로젝트를 새 staging이라고 간주하지 않는다. 실제 URL 접속·소유/권한·빈 상태 검증은 하지 않았다.

다음 단계는 Tester의 이 runner 독립 수용 후 Master가 승인된 비운영 target/ref·migration owner·SQL/role 범위를 확정하는 것이다. 지정 secret operator가 별도 migration URL/CA, API/worker 각 LOGIN secret을 보안 채널로 provision한다. target hash를 별도 승인 target과 대조하고 dry-run부터 실행한다. managed CREATE/CREATEROLE/auth FK REFERENCES·schema owner, API/worker NOBYPASSRLS/NOINHERIT/단일 SET membership·history/DDL 차단, 실제 Auth A/B와 RLS, direct TLS를 확인해야 한다. 런타임 pooler의 SET LOCAL/초기화/동시성/장애와 Storage/worker claim은 추가 검증이다. 환경이 다르면 거부 결과를 반환하며 DROP/role 변경/이력 보정으로 우회하지 않는다.

복사/전달 메시지:

> B5 ready_review. 고정 SQL3 canonical checksum·target fingerprint·history/advisorylock·single-TX apply/rollback·safeCLI·password-free API/worker template 구현. 새 PG25PASS(실제12+unit13), 관련218PASS/lint/type exit0, 원SQL3 rawhash불변. 두 runner lock대기2→apply3/0, 중간SQL예외에 schema/history/role전부rollback, unknown/checksum/role거부·API DDL/history차단·rawSHA/invariant 확인. 소유4cluster 정상종료/listener0·증거보존. 정확한 managed공개ref는 Master msg_9da...의 T179원수신근거로만기록, 실env/DSN/managedDDL/role/publish/3013/.next/SQLite/package변경없음. 독립수용후 Master가 다음 managed 시험 target/secret operator/범위를 확정해야 함.
