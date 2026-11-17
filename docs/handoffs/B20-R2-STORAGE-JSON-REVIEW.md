# B20-R2 Storage JSON evidence 재검수 — FAIL

- 검수자 Codex / CX-REVIEW-01, 원 B20-R과 동일 담당. task `task_b0ba79569521`, dispatch `ctx_3e03ef64ee4e`.
- 고정 **eeca88d0fa71639f3fd99bce184f2f727f62523a**, draft LF SHA256 **7568cf313b3fb203bda8a8d810b62d8345c0d158931902bef06dffa6703566d4**.
- 자기 새 archive `D:/starwork/b20-r2-eeca88d`와 물리 복사한 서명 PG18.7/자기 합성 cluster에서 실행했다. 제품/SQL/원 기대를 수정하지 않았다. 원 FAIL `988da2a706e483899bd7421dc24dc41a6cf8ad01` 보고서 diff0이다.
- **기존3건은 해소됐으나 새 독립8 중7 PASS / 1 FAIL로 전체 FAIL.** closure JSON 형식은 정상이어도 `verification_failure.operationId`가 실제 초기 실패 operation을 가리키지 않아도 deferred 검사를 통과한다.
- 필수 잔존을 즉시 Master에 `msg_3f8272710af0`로 보고했다. 지정 wake 한 번에서 `msg_c4714ac46bf7`의 필수 수정/B20-FIX2 별도 배정을 확인했다. 새 수정본은 혼입하지 않았다.

## 정확한 독립 수량·원 기대 보존

| 집합 | 이번 결과 | 중복 설명 |
|---|---|---|
| 고정 원 fixture | **80 PASS**, skip0, exit0, 2026-11-18 00:13:43 KST | 원17+이식8+새55. |
| 원17 |80의 부분집합 모두 PASS|원 fixture prefix 불변. |
| 이식된 원 독립8 |80의 부분집합 모두 PASS|기존3 거부 기대/정상 marker/transaction/SET CONSTRAINTS 경계 그대로. |
| 작성자 추가55 |80의 부분집합 모두 PASS|closure missing/null/type17+bad-value12+valid1; observation missing/null/type12+bad-value8+true/false4+integer-decimal1. |
| 자기 확장 fixture |**88 중87 PASS / 1 FAIL**, skip0, exit1, 00:15:35|위80 재사용 + 이번 추가8. 80을 추가 고유 coverage로 합산하지 않는다. |
| 이번 추가8만 |**7 PASS / 1 FAIL**|아래 linkage 거부 기대1개 실패. 기대 완화/skip 없음. |
| 원 typegen / tsc / targeted lint |각 exit0, lint 경고0|자기 원 archive/tsconfig, 추가 검수 TS 생성 전 검사. |

이식8의 attribution comment/뒤 추가55를 제외한 block은 원 독립8과 LF 기준 동일하다. 두 block SHA256은 모두 `371fa55397ed70c04c6b1a1874f9bec789fb3fac5f4d1af0aaf1b5381773ddb2`이며, 원17 prefix도 동일하다. 기대23514와 수용 후 rollback marker 및 실행경계가 변경되지 않았다. 이전 실행/검수 수량이나 matrix 내부 assertion을 새 고유test로 더하지 않는다.

## 기존3 FAIL 해소와 BEFORE 거부 판정

원 closure reason/at 누락, observation at 누락, JSON 문자열 yes의3 거부 기대가 모두 통과했다. 새 BEFORE shape guard는 필수키·키 집합·JSON kind·safe integer·UUID/digest/authorizer를 먼저 검사하고 전체 조건을 `IS NOT TRUE`로 거부한다. 따라서 원 test 이름에 deferred라고 적혀 있어도 잘못된 입력을 **더 이른 BEFORE에서23514로 거부하는 것은 정당한 수정**이다. 원 기대는 특정 trigger 단계까지 수용하라는 뜻이 아니다. 정상 case는 여전히 `SET CONSTRAINTS ALL IMMEDIATE`를 지나 marker rollback까지 도달한다.

문자열 boolean cast를 JSON true equality로 대체했고, 정수/범위 확인 뒤 numeric→bigint를 사용하여 정수값의 소수 표기 raw text를 보존한다. nullable operationId의 explicit JSON null과 미관측 claim의 SQL NULL observation은 정상 허용해야 하며 실제로 그 대조를 통과했다.

## 필수 잔존 R2-F1 — failure closure와 실제 operationId의 연결 누락 (P2)

위치: `lib/db/postgres/drafts/0004_storage_verification.sql:474`~`:478`. 현재 deferred guard는 owner/object의 initial operation을 별도로 찾은 뒤 worker/time/revision/status를 대조하지만, **그 operation.id와 closure.operationId를 비교하지 않는다**. BEFORE는 operationId가 null 또는 UUIDv7 형식인지만 확인한다.

정확한 자기 최소 재현: `D:/starwork/b20-r2-eeca88d/tests/postgres/b20-r2-independent.test.ts:439`, `exercise(false)`와 `exercise(true)`. 원 fixture의 helper로 아래 정상 초기 실패를 transaction 안에 구성한다:

```text
synthetic owner A = 00000000-0000-4000-8000-000000000001
object = 019b9000-0000-7000-8000-000000000bb8
intent = ...0bba, initial operation = ...0bbb
reserve operation -> object revision1
claim WORKER ...0008 / lease2030-01-01+90ms -> object revision2
initial INVALID_BYTES failure at2030-01-01+1ms
completed_state_revision0 / completed_aggregate_revision3
```

그 뒤 같은 실패 record의 worker/time/revision을 유지한 closure를 기록한다. 정상/부정 차이는 operationId 한 값이다:

```sql
UPDATE dream.storage_objects
SET initial_closed=true, revision=3, closure_json=$2
WHERE id='019b9000-0000-7000-8000-000000000bb8';
-- $2 정상: {"revision":3,"at":1893456000001,
-- "principalId":"019b9000-0000-7000-8000-000000000008",
-- "authorizers":["019b9000-0000-7000-8000-000000000008"],
-- "reason":"verification_failure",
-- "operationId":"019b9000-0000-7000-8000-000000000bbb"}
-- 부정: 위 operationId만 유효하지만 존재하지 않는 ...000000000f9f로 교체
SET CONSTRAINTS ALL IMMEDIATE;
-- 정상과 부정 모두 ACCEPT -> 검수 marker Error로 ROLLBACK
```

정상 대조는 의도한 marker까지 도달했다. 부정 대조의 기대는23514 거부지만 실제로도 같은 marker를 받아 테스트가 실패했다. trigger 비활성화/교체나 제품 기대 변경은 없고, 잘못된 상태는 COMMIT하지 않았다.

수용 B19 `state.ts:25` 부근에서 owner cancel과 first cleanup의 operationId는 **null**, verification_failure는 **그 ID로 찾은 실제 initial failed operation**이다. selected DDL도 필수 operationId를 저장하고 first closure↔initial completion을 검증한다고 명시한다. 이는 full executor/worker 인증/전이 전체 동등성을 요구하는 것이 아니라 동일 보존 증거의 ID 관계 누락이다. 이번 실SQL 실패의 직접 증명은 failure의 다른 UUID case이며, cancel/cleanup null 의미와 혼동하지 않는다.

**요구 수정:** verification_failure closure가 같은 owner/object의 실제 initial failed operation.id를 가리키도록 deferred linkage를 강제하고, reason별 null/nonnull 의미를 명시적으로 보존한다. 형식이 올바른 임의 UUID를 통과시키는 것으로 닫지 않는다. 기존3 shape/NULL 수정과 원80 기대를 유지하여 별도 고정 SHA에서 재검수해야 한다. 현재 API에 새 table write가 없어 end-user/API exploit이나 새 Storage/ready 권한 우회를 입증한 것은 아니다.

## 이번 추가 정상·부정 대조(나머지7 PASS)

- whole JSON null root인 closure/observation과, 이미 관측된 claim의 SQL NULL reset은23514로 거부했다. 미관측 새 claim의 SQL NULL observation은 정상이고 explicit null operationId를 가진 정상 closure도 deferred 검사를 통과했다.
- observation time의 raw `1893456000002.000`, `1.893456000002e12`, safe max `9007199254740991`은 정상 허용/원 raw text 유지였다. JSON 정수 의미와 raw byte 보존을 구별했다.
- JS number에서 소실될 만큼 작은 fractional raw JSON `1893456000002.0000000000000000000001`, `9007199254740991.1`, unsafe `9007199254740992`, 미세 음수는23514로 거부했다. SQL numeric 검사를 실제 raw 입력으로 대조한 것이다.
- PostgreSQL boolean spelling 문자열 on/t/1/off/f/0은 JSON booleans로 coercion되지 않았다. 실제 false/false는 정상 허용됐다. 원55의 네 genuine boolean 조합도 전부 통과했다.
- 형식이 맞아도 observation flags와 tombstone lifecycle 불일치, wrong identity target, 과거 관측시각은 거부했다. 후자는 기존 단조시각 BEFORE 검사에서 먼저 거부될 수 있다. shape 검사만으로 deferred 관계 검사가 제거된 것이 아니다.
- 정상 shape의 다른 owner cancel authority와 object revision을 넘는 closure revision은 거부됐다. 정상 owner/nullable operation closure는 통과했다.

원80의 middle-DDL rollback/SQL3 hashes/history3/18표/FKs/role graph/FORCE-RLS12/owner SELECT7/APIwrite·workerdeny/SECDEF0/receipt1:N/rawhash/creationV2/revocation/cleanup/outbox/v1 MIGRATION_STATE 회귀도 유지됐다. 이는 실제 Auth/API/runtime worker나 future executor를 수용한 것이 아니다.

## 명령·무결성·검토 범위

```powershell
# 공유 repo에서 자기 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b20-r2-eeca88d/source.tar eeca88d0fa71639f3fd99bce184f2f727f62523a
tar -xf D:/starwork/b20-r2-eeca88d/source.tar -C D:/starwork/b20-r2-eeca88d
New-Item -ItemType Junction -Path D:/starwork/b20-r2-eeca88d/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 자기 이전 검수의 서명 native 도구를 새 자기 경로로 물리 복사
Copy-Item -LiteralPath D:/starwork/b20-r-ef38db7/native/pgsql -Destination D:/starwork/b20-r2-eeca88d/native/pgsql -Recurse
# 이하 자기 archive cwd
node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/b20-r2-eeca88d/native/pgsql/bin
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
node tests/postgres/run-b20-r2-independent.mjs --bin D:/starwork/b20-r2-eeca88d/native/pgsql/bin
python review-integrity.py
```

독립 runner는 원 runner의 test path만 자기 확장 fixture로 바꿔 signature/target/PID/stop guard를 유지했다. archive SHA256 `41f1e42651bc1bcc601e86ee9ee18dbf57670d0187c385f0e843f418a776d813`, 원1002파일 대비 변경0. 원17 prefix/독립8 block 동일, 원 runner도 byte 동일이다. SQL1~3/v1 runner·manifest·target/B19 네 module은 이전 고정 검수 archive와 byte 동일이며 `review-integrity.json`에 개별 결과를 저장했다.

SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` 불변. 이번 draft hash는 위7568cf다. 원 정적 검사는 자기 추가 TS 생성 전 원 config로 실행했고, 추가 harness의 정적 검사라고 확대하지 않는다.

실제로 읽은 범위: AI_TEAM_RULES1.1/유일한 root AGENTS, 원 B20-R 보고/원 fixture와 독립8, FIX handoff 전문, 고정 SQL 변경 diff 전체와 관계검사 문맥/원80의 추가55, B19 reason별 operationId 구현. 원문·기대/SQL hash를 대조했으며 다른 WIP 내용/실env/managed/Storage/SSL/API는 접근·변경하지 않았다.

증거: 자기 root의 `review-original80.log`, `review-independent.log`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json`, `review-cleanup-final.json`, `tests/postgres/b20-r2-independent.test.ts`, `tests/postgres/run-b20-r2-independent.mjs` 및 아래cluster logs.

## 소유 정리·전달·마지막 확인

| 자기 cluster suffix | PID / loopback port | 결과 |
|---|---|---|
| `c4e77858-2329-460c-b89b-42744fa7f1b8` |75636 /59020|원80 PASS|
| `0b27dcf3-e8bc-4689-aa92-c6da08e9da5f` |53624 /57578|확장88:87 PASS/1 FAIL|

runner는4 exe 모두 Valid EnterpriseDB 서명과PG18.7을 확인했다. 물리 copy의 postgres SHA256 `4e67c961ac182a36c44a18fefcb5548d1ad5b40b252abb9cfa1259112d7faf75`는 이전 copy와 같다. shared.tools는 수정하지 않았다. 두 cluster는fast stop했고 cleanup-safe flags=true다. **00:17:08에 실제 두 process/listener/postmaster.pid 부재**를 재확인하여 `review-cleanup-final.json`에 기록했다. 증거 디렉터리를 삭제하지 않았다.

Master의 명시 허용에 따라 Backend terminal에 재현 경로/정상대조/명령/cleanup을 `msg_708beea60c35`로 handoff 전송했다. 송신 receipt는 있지만 terminal-only 비영구 mailbox warning이 있어 읽음·수용을 주장하지 않는다. 새 수정본 검수는 별도 배정이다.

최종 **B20-R2 FAIL**. 원3 해소와 신규 linkage1 잔존을 구분한다. SQL4는 여전히 미발행/manifest 미등록이고, full executor/model/ordered locking/CAS/current-clock/worker 인증/owner-ledger adapter/provider·운영 readiness는 미구현·미검증 경계다. 이번 필수 결함을 그 미래 범위와 합산하지 않는다.

마지막 확인 **2026-11-18 00:19:55 KST**: fixed 결과/원3 해소·신규1FAIL/무결성/원 정적 검사/두cluster 실제 종료/원FAIL 보존/shared git를 확인했다. 공유 HEAD 관찰은 `44a537e916dac677180bf8c5725134939b448d3c`이며 실행 기준으로 사용하지 않았다. 타WIP/실env/managed/Storage/SSL/API/발행/배포/3013/shared.next/package는 무실행·무변경이며 자기 .next typegen만 생성했다. 지정 wake 외 polling/턴 밖 자동점검/스케줄러 미설정. 고유 보고서만 선택 commit한다.
