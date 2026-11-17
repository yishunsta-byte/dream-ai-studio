# B20-R Storage schema draft 독립 검수 — FAIL

- 검수자 Codex / CX-REVIEW-01. task `task_e12f87e6d8a9`, dispatch `ctx_a75929128d41`.
- 고정 **ef38db7965ad1794f00925251e5dcf019646b17f**. 자기 archive `D:/starwork/b20-r-ef38db7`, 정적 검사 전용 동일 고정 사본 `D:/starwork/b20-r-static-ef38db7`에서만 검증했다.
- **원17 PASS, 새 독립8 중5 PASS / 3 FAIL로 전체 FAIL.** selected DDL의 closure/cleanup 필수 JSON 필드·형·NULL 검사에 결함이 있다. 제품/SQL/원 fixture의 기대를 수정하지 않았다.
- 즉시 Master에 `msg_92dd9a49cbe9`로 보고했다. 지정 wake 한 번에서 `msg_144639798822`의 필수 수정/B20-FIX 별도 배정을 확인했고 새 수정본은 이번 검수에 섞지 않았다.

## 이번 독립 수량

| 집합 | 결과 | 중복 설명 |
|---|---|---|
| 원 runner / 원 fixture | **17 PASS**, skip0, exit0, 2026-11-17 23:59:15 KST | 새 합성 cluster, 물리 복사 서명 PG18.7. |
| 독립 확장 fixture 최종 | **25 중22 PASS / 3 FAIL**, skip0, exit1, 2026-11-18 00:05:20 | 원17 prefix 재사용 + 새8. 원17을 새 coverage로 더하지 않는다. |
| 새8만 구분 | **5 PASS / 3 FAIL** | 아래3 거부 기대 실패. skip/완화/기대 역전 없음. |
| 확장 중간 실행 | 동일25 중22 PASS / 3 FAIL, 00:02:10 | 이후 같은 positive test 안에 catalog assertion을 추가하여 최종 재실행했다. 중복 합산하지 않는다. |
| 원 typegen / tsc / targeted lint | 각각 exit0, lint 경고0 | 독립 검수 TS를 섞지 않은 별도 fixed archive, 원 tsconfig/config. |

모든 부정 대조는 **trigger 비활성화/교체 없이** 실행했다. SQL 뒤 `SET CONSTRAINTS ALL IMMEDIATE`까지 수용되면 marker Error를 던져 rollback한다. 실패 로그의 `INDEPENDENT_CONSTRAINTS_ACCEPTED_ROLLED_BACK`는 DB가 거부했다는 뜻이 아니라 **deferred 검사도 수용했다는 증거**다. 잘못된 상태의 실제 COMMIT/잔류는 만들지 않았다. 원17의 middle-DDL event-trigger 대조도 자기 합성 DB에서만 실행했다.

## 필수 F1 — closure reason/time 누락이 NULL 조건으로 통과 (P2)

위치: `lib/db/postgres/drafts/0004_storage_verification.sql:437` 부근 `storage_consistency_guard`의 closure 분기와 테이블의 `closure_json` object CHECK. 일부 revision/authorizer만 강제하고 필수 reason/at의 존재를 강제하지 않는다.

정확한 최소 재현: `D:/starwork/b20-r-ef38db7/tests/postgres/b20-r-independent.test.ts:324`. 원 fixture의 `object()/insert()/tx()`로 자기 새 reserved object를 만든 뒤 실행한다:

```sql
-- synthetic owner A와 새 object(예약 asset ...07d1)는 fixture에서 생성한다.
UPDATE dream.storage_objects
SET initial_closed=true, revision=1,
 closure_json='{"revision":1,"principalId":"00000000-0000-4000-8000-000000000001","authorizers":["00000000-0000-4000-8000-000000000001"],"operationId":null}'
WHERE id='019b9000-0000-7000-8000-0000000007d0';
SET CONSTRAINTS ALL IMMEDIATE; -- 실제 ACCEPT; reason과 at 누락
ROLLBACK;
```

기대는23514 등 제약 거부이며 실제로는 deferred 검사도 통과해 검수 marker로만 rollback했다. missing reason이면 `IF reason='cancel'`과 `ELSIF reason NOT IN (...)` 모두 SQL NULL이라 실행되지 않는다. initial operation도 없어 후속 completion 비교가 없다. 형식이 맞는 revision/authorizer만으로 불완전한 first closure를 수용한다.

**요구 수정:** selected closure evidence의 필수 reason(enum/string), at(number/integer), principal/authorizers, revision 등의 존재·형·NULL을 명시적으로 fail closed 검사한다. 전체 조건에 `IS NOT TRUE` 등을 적용한다. early cancel에서 operation을 발명하거나 current clock/worker 인증/full B19 causal minimum을 새 DDL 보장으로 확장하라는 요구가 아니다. first closure는 write-once이므로 잘못된 최초 evidence를 허용하는 것 자체가 문제다.

## 필수 F2 — cleanup at 누락과 boolean 문자열 통과 (P2, 2 cases)

위치: `storage_guard`의 observation 단조시각 검사(:329 부근), `storage_consistency_guard`의 tombstone/target/time 검사(:463 부근). JSON object만 CHECK하고 각 필수 필드의 JSON 형을 검사하지 않는다.

정확한 재현은 위 독립 fixture `:332`와 `:339`다. 원17 최종 fixture의 **synthetic B owner의 기존 tombstone claim** `019b9000-0000-7000-8000-00000000005a`를 transaction 안에서 갱신한다. 원 observation은 올바른 at/booleans/explicit null-identity digest를 갖고 있다.

```sql
-- case2: 올바른 target/booleans를 남기고 at만 누락
UPDATE dream.storage_cleanup_claims
SET observation_json=jsonb_build_object('absent',true,'writerQuiescent',true,
 'identityDigest',dream.storage_raw_hash('object-identity','null'))::text,
 revision=revision+1
WHERE id='019b9000-0000-7000-8000-00000000005a';
SET CONSTRAINTS ALL IMMEDIATE; -- ACCEPT; 이후 의도적 ROLLBACK
```

case3은 같은 갱신에서 `at=1893456000002`, `absent="yes"`, `writerQuiescent="yes"`를 **JSON 문자열**로 준다. 두 필드가 JSON boolean이 아닌데도 PostgreSQL text→boolean cast가 true로 해석하여 tombstone의 deferred 검사까지 통과했다. 정확한 JSON 생성은 fixture에 보존했다.

case2는 `NULL < old_at`, `NULL < claimed_at OR false`가 NULL이 되어 PL/pgSQL IF가 거부하지 않는다. case3은 JSON 형 검사 없이 cast가 올바른 boolean evidence를 대신한다. **요구 수정:** observation의 필수 at/identityDigest/absent/writerQuiescent의 존재·형·NULL을 먼저 검증하고, at>=claim/old observation 및 target binding을 전체적으로 fail closed 검사한다. boolean 문자열을 새 normalization 정책으로 암묵 수용하지 않는다. 실제 quiescence 탐지/외부 bytes/인증 구현을 요구하는 것은 아니다.

세 건은 trusted synthetic admin SQL로 selected constraint를 검증한 것이다. API에는 새 table write가 없으므로 end-user/API exploit, 실제 Storage 삭제 또는 새 ready 권한 우회를 입증했다고 주장하지 않는다.

## 확인된 원 보장과 독립 positive 대조

- published SQL1~3/manifest/history3을 보존했다. 원18표 columns/constraints/Auth owner FK/RLS/owner catalog와 role membership graph의 before/after가 같다. draft 뒤 v1 runner는 기대대로 `MIGRATION_STATE`를 거부하며 기대를 완화하지 않았다.
- 실제 middle-DDL 실패 뒤 draft tables/functions가 남지 않고 원 catalog/history와 v1 dry-run이 정상이다. atomic success 뒤 새12 FORCE-RLS/7 owner SELECT를 확인했다. 독립 catalog 실측: dream tables30/policies43/original guards18/new guards12/original Auth owner FKs18.
- 새12표 전부 API write/worker table 권한 없음, API SELECT7표, SECURITY DEFINER0. SQL 전문에 새 role/membership 부여 없음. 원 SET LOCAL ROLE 부정 대조도 통과했다. 실제 Auth resolver/future registrar 구현 수용은 아니다.
- 정상 R1→R2는 같은 object/asset에 receipt1:N을 append하고 old R1 raw text와 original tuple을 보존했다. cross-owner composite FK/source/asset/media/receipt issuer/time/lease/terminal groups/raw hash 위반과 registered-object orphan GC를 거부했다.
- 독립 outbox 대조에서 final identity NULL/cross-owner/wrong key를 거부하고, 정상 reconcile target 삽입 뒤 retarget UPDATE를 거부했다. future dispatcher live fence/current-clock 증명은 아니다.
- revocation semantic JSON prefix를 보존하며 공백 포함 raw array로 재serialize/append하는 정상 case를 허용하고 입력 raw text를 그대로 저장했다. 원 history shrink/change/false ready/failed event missing은 거부했다.
- creation V2는 비canonical 공백/key 순서 raw client/snapshot도 그 raw bytes digest와 결합하면 저장됐다. semantic-equivalent 다른 raw bytes로 옛 digest를 유지한 갱신 및 NULL settlement group은 거부됐다. SQL이 JS canonicalizer/정규화를 구현한다고 주장하지 않는다.
- canceled prior claim의 old worker만 바꾸면 거부되고, 정상 old claim을 가진 cancel은 deferred 검사까지 통과했다. explicit null-identity unbound tombstone/late cleanup pending도 원17에서 유지됐다.
- row contention55P03와 stale expected-revision predicate0행은 실측했지만 runtime ordered locks/CAS/executor 구현 증명은 아니다.

## 정확 SHA·명령·읽은 범위

LF UTF-8 SQL SHA256(이번 독립 계산):

| source | SHA256 |
|---|---|
| SQL1 | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` |
| SQL2 | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` |
| SQL3 | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` |
| B20 draft | `0385c666162f0c2dcb98c48e38f7cc4a6289c8f826b936d04ad8c3a434efdee8` |

```powershell
# 공유 repo에서 자기 디렉터리 생성 후
 git archive --format=tar --output=D:/starwork/b20-r-ef38db7/source.tar ef38db7965ad1794f00925251e5dcf019646b17f
 tar -xf D:/starwork/b20-r-ef38db7/source.tar -C D:/starwork/b20-r-ef38db7
 New-Item -ItemType Junction -Path D:/starwork/b20-r-ef38db7/node_modules -Target D:/starwork/dream-ai-studio/node_modules
 Copy-Item -LiteralPath D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql -Destination D:/starwork/b20-r-ef38db7/native/pgsql -Recurse
# 자기 archive cwd
 node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/b20-r-ef38db7/native/pgsql/bin
 node tests/postgres/run-b20-r-independent.mjs --bin D:/starwork/b20-r-ef38db7/native/pgsql/bin
 python review-integrity.py
# 같은 archive를 D:/starwork/b20-r-static-ef38db7에도 tar 전개/기존 deps junction; 이하 그 cwd
 node node_modules/next/dist/bin/next typegen
 node node_modules/typescript/bin/tsc --noEmit --incremental false
 node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
```

archive SHA256 `c3640b1332957fc8a33977540cdbd1a441a39d2eb5502fd1fe250f2b835f869b`, 원1000파일 대비 변경0. 원 fixture SHA256 `874aa7d57dae57cbcfeee572cf26190c6fad4b089574b19e773a57099c0da0a3`; extended file은 describe 종결까지 원 prefix를 유지한다. 독립 runner 차이는 실행 test path 하나이며 원 signature/target/PID/stop guard를 보존했다.

PG는 자기 native에 **물리 복사**했고 shared .tools는 변경하지 않았다. runner 4 exe 모두 Valid EnterpriseDB 서명/PG18.7이며 source/copy SHA256 일치를 `review-integrity.json`에 기록했다. 수용 B19 d9d438a의4 module도 R5 archive와 byte 동일하다.

읽은 범위: handoff123행/DDL537행/원test322행/runner84행의4 artifact 전문, 수용 B19 d9d438a/R5 범위, 자기 추가8 대조. 증거: `review-original17.log`, `review-independent.log`, `review-independent-before-catalog.log`, `review-integrity.json`, `review-cleanup-final.json`, 추가 test/runner와 각 cluster logs. 원 tsc/lint는 독립 harness가 없는 clean fixed copy에서 실행했다. main 자기 archive에서도 typegen만 한 번 실행했으며 shared.next는 변경하지 않았다.

## 소유 PID/port 종료·전달

| 자기 evidence suffix | PID / loopback port | 결과 |
|---|---|---|
| `b4b1986c-7507-4642-ba50-2f577264d995` |46172 /61342|원17 PASS|
| `d06a1f66-5729-4777-88e4-8925f38660fa` |63204 /57156|독립 중간25:22 PASS/3 FAIL|
| `918a18ff-7e21-4b3c-aa3c-513374be1f8f` |24552 /64454|독립 최종25:22 PASS/3 FAIL|

각 `tmp/b20-postgres-<suffix>/run.json`에 명시 target, `signatures.log/version.txt/listener.log`에 소유 확인, fast stop 뒤 `cleanup-safe.json`에 두 absence flags=true가 있다. **00:09:12에 세 PID 모두 Get-Process 부재, 세 port 모두 Get-NetTCPConnection listener 부재, postmaster.pid 부재를 재확인**하여 `review-cleanup-final.json`에 보존했다. 증거 cluster/물리 tools는 삭제하지 않았다.

Master의 명시 허용으로 Backend `term_c931d897-df7e-4d39-a3d0-9bc3a8fe88f0`에 최소재현3곳/명령/cleanup을 `msg_e95a75a143ba`로 handoff 전송했다. 송신 receipt는 있으나 terminal-only mailbox라 영구 전달이 아니라는 warning이 있어 Backend가 읽고 수용했다고 주장하지 않는다.

## 반환·미검증

**B20-R FAIL.** 최소 다음 작업은 selected JSON evidence의 필수 field/type/NULL을 fail closed로 보완하고 원17/새8 거부 기대를 유지해 별도 고정 SHA에서 재검수하는 것이다. 기대 skip/범위 완화/draft 발행으로 닫지 않는다.

full B19 causal prefix/runtime ordered locks/expectedRevision CAS/current clock/worker·owner 인증/owner-ledger adapter/provider no-overwrite/bytes/native/quiescence/운영 readiness는 보고된 future executor 경계이며 이번 FAIL 이유에 혼입하지 않는다. 미발행·manifest 미등록 draft로, 원SQL3→4 운영 migration/새role/registrar 권한/managed 적용은 미수용이다.

마지막 확인 **2026-11-18 00:09:13 KST**: fixed hash/원17 및 독립3FAIL/원 정적 검사/3cluster 실제 종료/shared git 확인. 공유 HEAD 관찰 `76c399a6c37938d656bc33d0fda12ec94e0e20f8`, Backend가 수정 중인 draft/test와 T122/T137는 보호하고 혼입·stage하지 않았다. 실제 managed DSN/실env/Storage/Auth/실worker/API/유료/설정/package/3013/shared.next/타WIP/공개SQL/배포는 무실행·무변경이다. 지정 wake 외 polling/턴 밖 자동점검/스케줄러 미설정, 고유 보고서만 선택 commit한다.