# B23-R versioned runner independent review — PASS

검토 고정 SHA: `ea5a477d622ac3d839035e9abfbdcb88770e37a5`. Master 배정 `msg_22cc5b4dd83b`, 착수 회신 `msg_9734748fee35`. 2026-11-18 KST, 기존 Windows Tester 세션에서 B23 handoff/B21 계약/공통 v1.4와 지정 4개 파일을 읽고 독립 검수했다. 새 agent/window/worktree/scheduler는 만들지 않았다.

**판정 PASS: 고정 source/catalog에 기반한 opt-in v2 runner의 지정 synthetic 범위를 수락한다.** 원본 66개와 추가 독립 29개가 통과했다. 승인 binding, 원자적 fresh/upgrade, lock 이후 재관측, stale dry-run 거절, COMMIT 불확실성 및 cleanup 결과 구분을 확인했다. 제품 수정은 없고 공유 쓰기는 이 고유 보고서뿐이다. 이 결과는 managed 운영, 실제 물리 네트워크 장애, 배포 또는 사용자 승인 자체를 증명하지 않는다.

## 고정 입력과 출처

- 새 archive: `D:/starwork/b23r-source.zip`; owned copy: `D:/starwork/b23r-runner-ea5a477`. LF 보존 git archive 후 deps와 PostgreSQL 도구 전체를 물리 복사했다. tracked 1,020개 blob이 실행 전후 고정 SHA와 모두 일치했다.
- runner LF SHA256은 요청과 동일한 `11005c7a0ac75cc11db34dfd5afc88822f0e898acfb87d1e4e218622f5efa431`이다.
- candidate commit 변경은 새 runner, 원본 test, owned runner script, B23 handoff 4개다. v1/target/connection/state/manifest/SQL1–4/B19/runtime/package/기존 CLI는 변경되지 않았다. 이전 foundation 이후의 Master 문서 기록은 제품 변경과 구분했다. 기존 app/lib/scripts에서 새 runner를 자동 호출하는 import는 발견되지 않았다.
- 재사용한 source 감사는 SQL1–4 canonical hash, SQL4와 draft 바이트 일치, LF-only, 고정 manifest와 함수 선언을 확인했다. SQL4 SHA256은 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`다.
- B22 reference SHA `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`를 검증하고 알려진 reference의 의미 principal 슬롯만 tagged 형식으로 대조했다. version3/4의 9개 category literal 및 9개 함수 declared arguments가 일치했다. 대상 DB로부터 기대값을 학습하지 않는다. 세부 hash/counts/protected14-path diff는 `evidence/provenance-audit.json`에 있다.

## 승인·실행·오류 경계

승인은 target hash + explicit schema3/4 + mode + ordered fixed manifest id/checksum + runnerVersion2의 fingerprint다. 독립 JSON/SHA 계산으로 일치 확인했고 manifest 순서 변경이나 dry-run binding의 apply 전용은 거절됐다. fingerprint는 사람 승인 증명이 아니며 trusted caller가 이미 검토한 값을 제공해야 한다.

첫 await 전에 closed data property를 복사한다. top/target accessor·symbol·외부 prototype·비열거 injection을 거절하고 getter를 실행하지 않았다. null-prototype의 정상 닫힌 데이터는 허용한다. mutable target/version/mode/hash/CA/source URL 변경 후에도 원 snapshot으로 한 번의 내부 max1 pool을 만들었다. caller pool/factory/client/hooks는 받지 않는다. 고정 source 검증은 pool 생성 전에 수행한다. managed Direct/Session profile·ref·host·port·database·routing username/실제 role·CA와 TLS 옵션은 기존 함수 경계를 재사용하고 mock으로만 확인했다.

apply는 READ COMMITTED → LOCAL pg_catalog → 공유 transaction advisory lock `(1725031001,5)` → 실제 상태 검사를 수행한다. 사전 계획을 DDL 권한으로 사용하지 않는다. fresh4는 complete3 prefix를 같은 transaction 안에서 확인한 뒤 SQL4/history4와 최종 catalog를 검증하고 한 번만 COMMIT한다. complete3→4는 SQL4/row4만 추가한다. complete3→3/complete4→4는 applied0, complete4→3 및 unknown/partial/drift/historyless 상태는 거절한다. 원 데이터/기존 history를 수리하거나 재작성하지 않는다.

dry-run은 READ ONLY REPEATABLE READ이며 advisory apply lock/DDL/history write가 없다. 실제 RR snapshot 중 외부에서 history를 변경한 독립 사례에서 dry-run은 이전 정상 snapshot의 pending1을 반환했지만, 이후 apply는 새 상태를 읽어 HISTORY로 거절했다. dry-run은 예약이나 apply 승인 권위가 아니다.

공개 성공 결과는 redacted hash/version/mode/counts/fixed manifest만 포함한다. 공개 오류는 closed code/message와 필요한 outcome이며 raw driver message/cause/DSN/password/CA를 붙이지 않는다. 연결/BEGIN/lock/DDL/검사 실패는 rollback과 destroy/end 경로를 검증했다. rollback 미확인과 COMMIT 응답 불확실성은 unknown이다. COMMIT 불확실성에는 후속 ROLLBACK/보상 삭제/재시도가 없었다. 확인된 COMMIT 뒤 release/end 실패는 성공으로 반환하지 않고 committed outcome을 보존한다. committed는 dry-run/no-op transaction에도 적용되며 새 schema 적용 수와 다르다.

## 실제 실행 수량

| 실행 | 결과 | 범위/중복 |
| --- | --- | --- |
| 원본 B23 owned runner | 66 PASS / 0 skip, exit0 | admission/lifecycle mock46 + 실제 PG20 |
| 추가 독립 최종 runner | 29 PASS / 0 skip, exit0 | mock16 + 실제 PG13 |
| v1+B22+B23 pure 회귀 | 81 PASS / 86 skip, exit0 | v1 pure13+B22 pure22+B23 pure46; DB86은 이 명령에서 미실행 |
| 최종 TypeScript noEmit | exit0 | owned reviewer fixture/감사 포함 |
| targeted original ESLint | exit0, warnings0 | 새 runner, 원본 test, 원본 local runner |

pure46은 원본66에 포함되어 중복 가산하지 않는다. B22 real66은 이번에 재실행하지 않았다. 기존 B22-R2 수락과 state 불변을 근거로 하며 이번 추가 PG3개에서 principal 회귀를 새 runner를 통해 확인했다. 29개는 실제 독립 test case 수이며 원본과 일부 경로가 겹친다. 이전 실패 실행은 coverage 총수에 더하지 않는다.

원본 실제 PG20에서 fresh3/4 및 zero-reapply, complete3→4와 business/history byte 보존, SQL2/SQL4 실패 원자 rollback, row4 후 postcatalog 거절, partial/checksum/unknown/catalog/historyless 거절, fresh4/4·upgrade4/4·양방향 v1/v2·첫 caller rollback 경쟁, stale dry-run, pool 종료, real COMMIT 뒤 응답 유실을 재현했다. 경쟁 5개 기록 각각에 두 native waiter PID와 `wait_event_type=Lock`, `wait_event=advisory`를 확인했다. 단순 지연만으로 잠금을 추정하지 않았다.

추가 mock16:

- 독립 ordered approval SHA 계산/순서 변경 거절 1개.
- symbol/accessor/target prototype/nonenumerable injection 경계 5개.
- 정상 null-prototype와 한 번의 max1 ownership 1개.
- source URL/CA/target/version/mode/hash snapshot 1개.
- non-URL sourceRoot 거절 3개.
- row4 insert 오류, 잘못된 final version, 잘못된 rollback command, COMMIT 전 client error, release/end/client-close 동시 오류 각각 1개.

추가 실제 PG13:

| 사례 | 실제 관측 |
| --- | --- |
| row4 서버 삽입 후 응답 오류: fresh, upgrade (2개) | 같은 client에서 history4 및 SQL4 객체 존재 확인 후 fault. COMMIT 없음/ROLLBACK/destroy. fresh는 journal·roles·DDL 없음, upgrade는 history3/원본 JSON bytes 유지. |
| upgrade postcatalog drift (1개) | row4 삽입 후 extra column을 추가한 test-only instrumentation. STATE 거절, complete3 history/business 및 SQL4 부재 확인. |
| upgrade real COMMIT 뒤 응답 버림 (1개) | unknown, destroy, COMMIT 1회, ROLLBACK/재시도 없음. 별도 admin이 complete4/첫 history3 보존 확인. 별도 승인값의 다음 호출은 applied0. |
| 실제 COMMIT 후 release/end 오류 (2개) | 실제 cleanup을 수행한 뒤 test-only 예외. 공개 실패 outcome=committed. 별도 native complete4와 API backend0 확인. |
| 실제 공유 lock timeout (1개) | 외부 owned gate를 잡고 native waiter를 관측. statement timeout은 not-applied로 실패하고 fresh 유지/API backend0. |
| v2 upgrade4 승자 뒤 schema3 요청 (1개) | 두 실제 waiter 관측. 첫 호출 applied1, 다음 호출은 complete4 재관측 후 STATE 거절. |
| RR dry-run/stale apply (1개) | 실제 isolation/read_only 값 확인, 외부 committed checksum drift 후에도 RR 정상 snapshot. 이후 apply HISTORY 거절, 잘못된 checksum을 수리하지 않음. |
| principal 회귀 (3개) | foreign `$owner` journal owner, 정상 함수 owner의 foreign EXECUTE grantee, policy target role. 모두 새 API에서 STATE/history 미독출, 정상값 복원 후 applied0 대조. |
| fresh dry-run의 COMMIT 후 cleanup 오류 (1개) | committed failure이나 schema/history/role write 없음, API backend0. |

새 API에 test hook을 추가하지 않았다. 일부 장애는 owned test가 실제 connection factory를 passthrough하면서 query/release/end 응답을 조작한 것이다. 실제 SQL은 PG에서 실행됐고 그 뒤 상태를 별도 admin으로 확인했다. 이 방식은 물리적인 네트워크 단절/서버 crash를 재현한 것이 아니다.

## 검토 fixture 수정 구분

최초 추가 실행은 28 PASS/1 FAIL이었다. 검토자가 실제 policy `owner_access` 대신 존재하지 않는 `assets_owner`를 지정한 fixture 오류다. SQL3에서 실제 이름을 확인해 mutation/복원 이름만 수정했고 제품의 STATE/history 미독출 기대값을 유지했다. 최종29 PASS다. 최초 로그는 보존하며 제품 결함으로 계산하지 않는다.

최초 TypeScript는 검토 mock의 광범위한 `vi.fn` 타입을 호출하는 3곳에서 TS2348을 보고했다. 검토 파일의 함수 타입 annotation만 구체화했고 최종 noEmit은 통과했다. runtime assertion/제품 원본은 바꾸지 않았다. 최종 실행 후 이 타입 annotation만 바뀌었으며 실행 의미는 같다.

## 재현 명령과 증거

cwd는 owned copy다. 독립 runner는 원본 runner의 test filename/root prefix만 바꿨다. 독립 suite는 공용 setup/mock helpers를 재사용하되 assertion과 실험은 별도 작성했다. fresh owned Auth UUID fixture와 작업별 reset만 사용했다.

```text
node tests/postgres/run-versioned-migrations-local.mjs --bin D:/starwork/b23r-runner-ea5a477/.tools/pgsql/bin
node tests/postgres/b23r-run-independent.mjs --bin D:/starwork/b23r-runner-ea5a477/.tools/pgsql/bin
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts
node --conditions=react-server --import tsx tmp/b23r/audit.ts
node tmp/b23r/verify-baseline.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-runner-v2.ts tests/postgres/versioned-migrations.test.ts tests/postgres/run-versioned-migrations-local.mjs --max-warnings 0
```

owned `tests/postgres/b23r-independent.test.ts`가 추가29 fixture다. `evidence/`에는 original-run.log, independent-run.log, independent-final-run.log, pure-regression.log, provenance-audit.json/log, baseline-integrity.json, static-checks.json, static-final.json, type.log, type-final.log, lint-final.log, cleanup-audit.json을 보존했다. 각 cluster root에 run.json/tests.log/signatures.log/version.txt/start.log/stop.log/cleanup-safe.json, concurrency에는 lock-observations.jsonl, 독립 실행에는 reviewer-observations.jsonl이 있다.

| owned `tmp/` root | PID / port | 결과 |
| --- | --- | --- |
| b23-postgres-1aa5d02b-4d80-4918-aba4-c3fa3d16f7dd | 76556 / 64162 | 원본66 PASS |
| b23r-independent-48b8c68b-21cf-4b86-b56f-8d974c3c2f97 | 73664 / 56831 | 추가 최초28/1, fixture 오류 |
| b23r-independent-0232e067-1516-45a9-8a51-4d48399cb288 | 75352 / 59739 | 추가 최종29 PASS |

runner가 4개 PG 도구의 유효 EnterpriseDB 서명과 PG18.7, owned loopback listener를 검증했다. 01:46 KST 전후 종료 재확인에서 3개 PID/listener 모두 없고 cleanup-safe의 postmasterPidAbsent/listenerAbsent는 모두 true였다. owned path의 node/postgres도 없었다. 사용자 3013 PID51032는 그대로였다. 공유 `.next`, 실 env/managed/SSL/Storage/API/타 WIP는 조작하지 않았고 프로덕션 빌드/배포는 실행하지 않았다. 사용자 연결은 Windows이며 Mac mini 실행으로 기록하지 않는다.

## 수락 한계와 후속

실제 검증은 Windows signed PostgreSQL18.7 UTF8/C synthetic에 한정한다. PG16/17/다른 locale/managed Direct·Session 실제 TLS/CA/권한은 새로 검증하지 않았다. managed 검사는 mock이고 실제 접속은 없었다. advisory lock은 같은 키를 사용하는 협조 runner만 직렬화하며 arbitrary admin DDL 전체를 막지 않는다. catalog는 이미 수락한 bounded descriptor 범위다. Storage worker/transition executor/bytes/provider fencing/실운영 준비는 이번 결과에 포함하지 않는다.

COMMIT 응답 유실과 lifecycle fault는 지정된 driver instrumentation/실제 서버 상태 대조다. 모든 crash/partition/드라이버 오류를 포괄 보장하지 않는다. 모의 close 실패 테스트 자체는 실제 자원 종료 증거가 아니며, 이 보고서의 owned 자원 종료는 별도 PID/listener/backend 근거로 확인했다.

중간 결과 `msg_ac476372496c`를 Master에 전달했다. 이 보고서만 선택 commit한 후 고정 SHA/수량/한계/cleanup/commit을 실제 Orca로 반환한다. CLI/runtime 자동 호출이나 운영 migration은 별도 작업 및 구체 대상 승인 범위다. 공용 TEAM/배정 상태는 Master가 기록한다.
