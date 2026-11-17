# B20-R3 Closure linkage 재검수 — PASS (선택 DDL 범위)

- 검수자 Codex / CX-REVIEW-01, 원 B20-R/R2와 동일 담당. task `task_f20aaed523b1`, dispatch `ctx_ecde1737ac42`.
- 고정 **9d388993a480a9ec0881484dd14b45bba1de3c03**, SQL LF SHA256 **61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c**.
- 자기 새 archive `D:/starwork/b20-r3-9d38899`와 자기 물리 복사 서명 PG18.7/새 합성 cluster에서 검증했다. 제품/SQL/기존 기대는 수정하지 않았다.
- **원3 FAIL 및 R2-F1 해소, 이번 지정 선택 DDL 증거 연결 범위 PASS**, 필수 잔존 발견0. 원 FAIL `6595bfee58b9d548b3bf7dde0420d0464d51fab2` 보고서 diff0이며 과거 FAIL을 덮어쓰지 않는다.
- SQL4는 여전히 미발행/manifest 미등록이다. 이 판정은 full executor/model/runtime/운영 readiness 수용이나 발행·managed 적용 승인이 아니다.

## 독립 실행 수량·기대 보존

| 집합 | 이번 결과 | 중복 설명 |
|---|---|---|
| 고정 원 fixture | **104 PASS**, skip0, exit0, 2026-11-18 00:22:46 KST | 원80 + 이식 R2의8 + 새16. |
| 원80 |104의 부분집합 모두 PASS|원17/원 B20-R8/JSON 추가55를 포함한다. |
| 이식 R2의8 |104의 부분집합 모두 PASS|원R2-F1의23514 거부 기대, 정상 marker/rollback 경계 유지. |
| 작성자 새16 |104의 부분집합 모두 PASS|failure8/cancel3/cleanup5 대조. 새 독립16개로 다시 합산하지 않는다. |
| 자기 확장 fixture |**110 PASS**, skip0, exit0, 00:25:21|위104 재사용 + 이번 독립6. 104 중복을 고유 coverage로 더하지 않는다. |
| 이번 독립6만 |**6 PASS**|아래 정상·부분변조/statement 순서/기록 보존 대조. loop assertion 수를 별도test로 더하지 않는다. |
| 원 typegen / tsc / targeted lint |각 exit0, lint 경고0|자기 원 archive/config, 추가 검수 TS 생성 전 실행. |

원80 prefix는 그대로다. R2 독립8 block도 LF 기준 원 재현물과 동일하며 두 SHA256은 **985b7956d9cc434672d9d880f27db932d0ddb54816a6c2c9ea6c170373970878**다. attribution comment와 뒤 새16을 제외한 실제 code/expectation/transaction/SET CONSTRAINTS/marker가 보존됐다. 이전 baseline87PASS/1FAIL은 이전 R2의 독립 증거로 남아 있으며 이번 새 실행 수량에 합산하지 않는다.

## R2-F1 해소와 reason별 의미

고정 SQL의 `storage_consistency_guard`는 owner/object/kind=initial로 operation을 찾은 뒤 verification_failure이면 그 row가 실제 존재하고 closure.operationId==op.id인지 명시적으로 검사한다. 그 다음 기존 status/worker/time/aggregate completion revision/historical authorizers를 대조한다. 따라서 형식이 맞는 임의 UUID/다른 row만으로 통과할 수 없다.

작성자16의 실제 SQL에서 다음을 확인했다:

- failure의 missing/null/nonexistent ID, 다른 object의 실제 initial OP1, 실제 reverify OP2, 별도 owner의 실제 operation을 참조하면23514로 거부했다. correct same-owner/object initial failed operation은 deferred 검사 후 정상 marker까지 도달했다. 같은 object의 initial operation 자체가 없는 failure도 거부했다.
- cancel은 owner/singleton authorizers에 더해 explicit JSON null operationId를 요구한다. 기존/nonexistent non-null ID를 거부하고 early cancel의 null을 허용했다.
- cleanup은 explicit JSON null operationId와 실제 cleanup claim reference를 요구한다. missing/non-null operationId 및 실제 claim이 없는 cleanup cause를 거부하고, 일치하는 실제 claim/null operation을 허용했다. 기존 claim FK/link/time/revision 검사는 유지됐다.

원 R2 최소 재현의 정상 branch는 계속 수용되고 wrong-ID branch는23514로 거부됐다. 원 B20-R의 missing JSON/boolean coercion3건도 원80 안에서 계속 거부됐다. BEFORE 형식 거부와 deferred 관계 거부의 시점 차이는 기대 완화가 아니다. 정상 case는 `SET CONSTRAINTS ALL IMMEDIATE`를 거쳐 marker Error로 의도적으로 rollback한다.

## 이번 독립6 SQL 대조

자기 `tests/postgres/b20-r3-independent.test.ts`의 `r3Failure()`는 새 object/intent/initial operation을 만들고 claim→초기 INVALID_BYTES 실패→first closure를 transaction 안에서 구성한다. marker 도달은 실제 제약 수용의 증거이며 잘못된 상태를 COMMIT하지 않는다. trigger 비활성화/교체는 없다.

1. **올바른 failure ID도 나머지 증거와 결합:** 같은 actual opId를 유지한 채 closure.at/revision 또는 principal+authorizers를 바꾸면23514로 거부하고, 완전한 정상 tuple은 통과했다.
2. **실제 다른 범위의 ID:** null/nonexistent/원fixture의 다른 object initial·reverify를 거부했다. 별도 B owner/object의 실제 initial operation을 새로 만든 뒤 그 ID를 A의 failure closure에 넣어도 거부했다. 단순 임의 UUID만 이용한 cross-owner 주장이 아니다.
3. **deferred 실행 경계:** object를 먼저 closed/failure closure로 갱신하고 그 뒤 operation을 failed로 마무리해도 최종 상태가 일치하면 `SET CONSTRAINTS ALL IMMEDIATE`를 통과했다. BEFORE shape guard가 정상 multi-statement 원자 전이를 과도하게 거부하지 않았다.
4. **실패 후 cleanup 보존:** correct non-null failure operationId를 가진 first closure 뒤 실제 GC claim을 만들고 cleanup_claimed로 진행했다. old failure closure/raw text/operation ID를 그대로 보존하며 통과했다. cleanup 상태라고 과거 failure closure의 ID까지 null로 바꾸지 않는다.
5. **cleanup/cancel null과 실제 claim 관계:** cleanup의 null+실제 claim은 정상, claim time/revision과 다른 closure 또는 non-null ID는 거부했다. owner cancel의 explicit null은 정상이고 기존 OP1을 넣으면 거부했다.
6. **검증 뒤 raw evidence 불변:** 공백 포함 정상 failure closure raw text는 그대로 보존됐다. deferred 검증 후 semantic-equivalent 재serialize raw text로 바꾸는 UPDATE도23514로 거부됐고 SAVEPOINT rollback 뒤 원 raw text가 남았다.

원104의 추가16과 논리적으로 겹치는 대조도 있으므로 이를 새로운 독립 상태공간/완전성 증명으로 제시하지 않는다. 이 six-test 집합은 reviewer가 별도 SQL을 작성·실행한 지정 관계 대조다.

## 기존 계약·불변성과 한계

원104 안에서 SQL1~3 hashes/manifest/history3/기존18표 columns·FK·RLS·rolegraph, atomic middle-DDL rollback,30 tables/43 policies/18 old guards/12 new guards/18 original Auth FKs, 새12 FORCE-RLS/7 owner SELECT/API write·worker deny/SECURITY DEFINER0, R1/R2 raw receipt/creationV2/revocation/cleanup/outbox 및 v1 runner의 SQL4 `MIGRATION_STATE` 거부가 회귀 통과했다. old runner/manifest를 완화하거나 draft를 등록하지 않았다.

full B19 causal prefix, runtime ordered policy/object/operation/state/outbox locks, expectedRevision CAS/current clock, 실제 worker/owner 인증, owner-ledger adapter, bytes/native/provider/no-overwrite/quiescence/운영 readiness는 기존 future executor 경계다. trusted synthetic admin의 SET LOCAL ROLE은 실제 Auth resolver/API end-to-end 인증 검증이 아니다. 이번 선택된 recorded-evidence 관계 PASS를 전부 구현됐다는 주장으로 확대하지 않는다.

## 정확 명령·source hash·검토 범위

```powershell
# 공유 repo에서 자기 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b20-r3-9d38899/source.tar 9d388993a480a9ec0881484dd14b45bba1de3c03
tar -xf D:/starwork/b20-r3-9d38899/source.tar -C D:/starwork/b20-r3-9d38899
New-Item -ItemType Junction -Path D:/starwork/b20-r3-9d38899/node_modules -Target D:/starwork/dream-ai-studio/node_modules
Copy-Item -LiteralPath D:/starwork/b20-r2-eeca88d/native/pgsql -Destination D:/starwork/b20-r3-9d38899/native/pgsql -Recurse
# 이하 자기 archive cwd
node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/b20-r3-9d38899/native/pgsql/bin
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
node tests/postgres/run-b20-r3-independent.mjs --bin D:/starwork/b20-r3-9d38899/native/pgsql/bin
python review-integrity.py
```

독립 runner 변경은 자기 test path 하나뿐이며 원 signature/target/PID/stop guard를 보존했다. archive SHA256 **ef1c96756ec9ff062b8fc25fe910c1454171469c06b82c3a3574b128cdb1b403**, 원1004파일 대비 변경0. SQL1~3/v1 runner·manifest·target/원local runner/B19 네 module은 이전 고정 archive와 byte 동일이다. draft의 새 hash만 위61ceb1이며 새 role/function/policy/grant는 추가하지 않았다.

SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` 불변. native postgres SHA256 **4e67c961ac182a36c44a18fefcb5548d1ad5b40b252abb9cfa1259112d7faf75**는 이전 자기 copy와 같다. 4 exe 모두 runner의 Valid EnterpriseDB 서명 확인과 PostgreSQL18.7 version 확인을 통과했다. shared.tools는 변경하지 않았다.

읽은 범위: 원R2 FAIL/자기 재현, FIX2 handoff 전문, 고정 SQL 변경 전체와 기존 관계 문맥, 이식 R2 eight와 새16 test 전문, 원80 prefix/원runner 및 기존 검수한 B19 reason 의미와 불변 source 대조다. 원 정적 검사는 추가 자기 TS 생성 전 원config로 수행했고 추가 harness의 lint/tsc 통과라고 주장하지 않는다.

증거는 자기 root `review-original104.log`, `review-independent.log`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json`, `review-cleanup-final.json`, 자기 추가 test/runner 및 각 cluster logs에 보존했다.

## 소유 종료·마지막 확인·반환

| 자기 cluster suffix | PID / loopback port | 결과 |
|---|---|---|
| `16db267b-e441-4abc-8310-85e955a85f71` |30748 /54035|원104 PASS|
| `b309d1b9-c97a-4f7c-9766-b176945afbee` |49092 /62547|확장110 PASS|

두 runner가 fast stop 후 cleanup-safe flags=true를 저장했다. **2026-11-18 00:27:15 KST**에 실제 두 process/listener/postmaster.pid 부재도 재확인하여 `review-cleanup-final.json`에 보존했다. 증거 디렉터리/native tools는 삭제하지 않았다. 단기 Node/PG 명령은 모두 반환·종료했다.

마지막 확인 **2026-11-18 00:28:56 KST**: fixed 결과/hash/원FAIL 보존/원 정적 검사/두cluster 종료/shared git 확인. 공유 HEAD 관찰 `ed61cdbac6a9734aa9b085c9bb1519fbcda34c9c`는 실행 기준으로 쓰지 않았다. T122/T137 및 scripts/ops/ 등 다른 WIP/실env/managed/Storage/SSL/API/발행/배포/3013/shared.next/package는 접근·변경하지 않았고 자기 .next typegen만 생성했다. polling/턴 밖 자동점검/스케줄러 미설정, 고유 보고서만 선택 commit한다.

Master 반환: **B20-R3 지정 선택 DDL 증거 연결 PASS**, 필수 잔존 발견0. 원FAIL을 보존하고 원104·추가6 및 미검증 범위를 구별했다. 이후 SQL4 발행/runner upgrade/실 executor·provider 작업은 별도 배정·검수가 필요하며 이번 PASS로 자동 승인되지 않는다.
