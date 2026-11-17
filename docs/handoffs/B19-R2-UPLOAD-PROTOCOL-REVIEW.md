# B19-R2 Upload protocol 재검수 — FAIL

- 검수자: Codex / CX-REVIEW-01, 동일 B19-R 검수자. task `task_6bec2ef194a4`, dispatch `ctx_1b95f78d25ea`.
- 고정 SHA **7bfd13926363eb23d1138c950577903bc76d2069**. 실행 사본 `D:/starwork/b19-r2-7bfd139`, 새 git archive이며 checkout은 하지 않았다.
- **원 B19-R의 8개 실패 기대는 모두 해소됐다. 그러나 새 17건 중 4개 내부 snapshot 모순 거부 기대가 실패하므로 전체 판정은 FAIL이다.** 원 FAIL `2716262909849d34ea338ad1d2fed03a08b06ebe`와 원 27 harness는 변경하지 않았다.
- 필수 잔존은 즉시 Master에 `msg_9167c7753f1a`로 보고했다. Master `msg_e1a1ef7a6c49`가 수신하여 Backend FIX2를 별도 배정했다. 이번 검수에는 새 수정본이나 B20 draft를 혼입하지 않았다.

## 독립 실행 수량과 중복

| 실행 집합 | 이번 결과 | 중복과 범위 |
|---|---|---|
| 고정본 현재 focused suite | **41 PASS**, 0 skip, exit0, 22:44:52 KST | 원32 + 신규9. 원32를 별도 수량으로 더하지 않는다. |
| 원 B19 파일의 32개 테스트 | **32 PASS**, 0 skip, exit0, 22:47:47 | 이전 고정 archive에서 원파일을 별도 이름으로 바이트 복사했다. 현재41의 원32 부분 보존도 확인했다. |
| 바이트 불변 원 독립 harness | **27 PASS**, 0 skip, exit0, 22:44:53 | 이전8 필수 실패 기대 포함. 27/41에는 동일 정상 trace 및 bounded loop 중복이 있으므로 합계 coverage를 제시하지 않는다. |
| 신규 R2 독립 harness | **17 중 13 PASS / 4 FAIL**, 0 skip, exit1, 최종22:49:12 | snapshot8 중4 PASS/4 FAIL, creation4 PASS, descriptor/copy/numeric5 PASS. 실패 기대를 완화하거나 skip하지 않았다. |
| bounded count audit | **1,536 시도 = 660 수용 + 876 거부** | 동일64 seed×24 직렬단계의 복제 계수. 원 suite의 한 테스트 내부 단계이며 별도1,536 tests나 신규 coverage가 아니다. |
| 고정 원 typegen / tsc / targeted lint | 각각 exit0, lint 경고0 | 자기 archive의 원 tsconfig, exclude/overlay 변경 없음. 아래 추가 harness 작성 전 검사했다. |

bounded loop는 고정6 action/now2~25의 직렬 proposal만 다룬다. reverify/creation/capability/조작 snapshot을 무작위로 포괄하지 않으며 모든 interleaving, 실 DB concurrency 또는 model checker의 완전 탐색이 아니다. 이전 검수나 작성자의 수치는 합산하지 않았다. 신규 harness의 누락 failed-event 대조를 같은 테스트 안에 추가하여 최종 재실행했으며 수량과 실패4건은 동일하다.

## 필수 잔존 N1 — cancellation·closed·완료 revision 관계 누락 (P2, 3개 실패)

위치: `lib/storage/uploads/state.ts:19`, `:28`, `:41`, `:206`, `:251`. `checkedModel`은 canceled의 완료 필드가 non-null인지만 요구한다. 실제 `cancel()`은 lease/worker/claim을 모두 비우고 현재 stateRevision을 기록하지만, 이를 역으로 검증하지 않는다. closed initial의 pending op도 남길 수 있다.

다음은 정상 transition으로 만든 상태의 부분 필드만 바꾼 재현이다. ID/authority/receipt/hash 전체를 새로 일관되게 위조한 예가 아니다.

| 최소 조작과 기대 INPUT | 고정본 실제 결과 / 모순 |
|---|---|
| `prepared()` → `bad.closed=true` 한 필드 | `checkedModel` 수용. 닫힌 initial intent에 pending op/현재 worker lease/publication claim이 그대로 남는다. 지원 cancel/cleanup 경로는 해당 pending op를 반드시 canceled로 바꾼다. |
| `apply(prepared(), cancel, owner, 2)` → `operations[0].completedStateRevision=999` | 수용. aggregate `stateRevision=0`인데 취소 완료 기록은 존재하지 않는 미래 revision999를 참조한다. |
| 같은 정상 canceled 상태에 직전 pending op의 `workerId/leaseUntil/claimedAt/claimVerifiers` 네 필드만 복원 | 수용. status=canceled/fence2/완료 기록과 live claim metadata가 동시 존재한다. `cancel()`이 명시적으로 지우는 관계를 checker가 강제하지 않는다. |

**요구 수정:** canceled operation은 worker/lease/claimedAt=null, claimVerifiers=[]인 명시 행렬을 강제한다. terminal completedStateRevision은 aggregate에 실제 존재하는 revision 범위와 expected prior state 관계를 검증한다. initial closed/cleanup와 pending operation의 배타 관계를 검사한다. canceled 완료는 state revision을 새로 생성하지 않으므로 성공 receipt와 같은 `+1` 규칙을 일괄 적용하면 안 된다. 유효한 미완료 supersession/cleanup 및 historical canceled 결과는 유지해야 한다.

영향의 한계: 위 closed/canceled 조작에 대해 새 IO나 ready가 발급된 사실을 이번에 입증한 것은 아니다. 기존 live guard가 거부할 수 있어도 strict snapshot 관계 검사 자체의 필수 누락이며, snapshot 이력의 자가 모순을 수용한다는 판정이다.

## 필수 잔존 N2 — aggregate CAS revision과 committed state revision 관계 누락 (P2, 1개 실패)

위치: `state.ts:66`~`:80`은 receipt/revocation state points를 검증하지만 aggregate `revision`과의 관계가 없다. `:247`의 모든 지원 전이는 revision을 증가시키며, stateRevision이 증가하는 전이도 그 전이의 일부다. `admission:284`는 입력 context와 snapshot의 revision 동등성만 비교한다.

```text
normal registered() -> revision4, stateRevision1, R1 / succeeded initial retained
bad = structuredClone(normal)
bad.revision = 0                    # 단 하나의 scalar만 변경
admission(bad, {owner, now2, expectedRevision:0})
-> ACCEPTS R1 ready projection
```

reservation revision0 상태가 이미 receipt/stateRevision1을 commit했다는 상호 모순을 허용한다. 현재 모델의 지원 전이로 만들 수 없으며, 실제 DB의 stale CAS 우회가 입증됐다는 뜻은 아니다.

**요구 수정:** 최소한 aggregate revision이 stateRevision/retained completion revision보다 앞설 수 없음을 검증한다. full transition history를 보관하지 않으므로 정확한 과거 전이 횟수를 추정하는 과도한 등식은 요구하지 않는다. 허용 snapshot이 스스로 표현하는 이력과 CAS counter의 불가능한 하한 관계를 거부해야 한다.

## 원 8건 해소와 정상 정책·이력 대조

- 원6 upload 모순(실패 후 revoked만 해제, issuer/claim 불일치, lease/authorization 뒤 receipt 발행, publication 누락, 과도한 lease, registered+closed)은 모두 원 기대 그대로 INPUT 거부했다. pending+receipt 모순의 기존 긍정 대조도 유지됐다.
- 새 `claimedAt/claimVerifiers/completedAt/completedStateRevision`은 receipt issuer/time, 당시 claim authority, source/media/finalize payload와 결합된다. 현재 allowlist와 과거 claim 권한을 혼동하지 않는다. 독립 대조에서 current verifiers를 stranger로 바꿔도 old R1 admission은 유효했고, 옛 worker의 새 claim은 거부되며 stranger의 R2 claim/finalize는 성공했다. old worker의 historical claim set만 변경하면 INPUT이다.
- R2의 completedAt만 변경, completedStateRevision 중복, workerId만 변경은 각각 INPUT이다. duplicate state point/누락 revocation/failed reverify event 제거도 거부됐다. successful R2 뒤에 retained revocation event와 R1은 남고 current=R2다. old R1 terminal replay가 R2를 복원·변경하거나 publication instruction을 새로 발급하지 않는다.
- 원27 안의 initial failure5종, reverify failure5종, cancel 대조를 그대로 통과했다. failure/cancel은 새 receipt를 만들지 않는다. expired terminal replay와 incomplete expired authority 거부는 분리된다.
- retained state points는 revision으로 순서를 검사한다. 이번 추가 대조는 중복/구멍/누락을 확인한 것이며 모든 가능한 이력 조합의 완전 증명은 아니다. N1/N2에서 그 이력과 cancellation/aggregate counter의 남은 연결 누락을 별도 보고한다.

## fingerprint V2·terminal/retiredFrom·입력 경계

- 원snapshot 손상에 대한 원 F2 기대가 해소됐다. V2는 `creation-client` digest와 **원 저장 snapshot**의 `creation-snapshot` digest를 `creation-request-v2`로 합성하며 version2를 명시한다. pending/terminal에서는 실제 snapshot을 다시 hash하고 retired는 retained digest/composite를 검증한다. 원본 design의 원snapshot·영구 비재사용ID 의미를 보존하는 미배포 pure-format 확장이며, 기존 배포 ledger나 SQL migration 호환성을 수용한 것은 아니다.
- 신규 creation4 tests에서 pending/terminal/retired의 clientDigest/snapshotDigest/composite 각 부분 변조를 거부했다. pending retirement의 `from=terminal`/조기 retirement와 terminal retirement의 `from=pending` 모순도 거부했다. success/failed/canceled terminal proof와 원 registrar history를 보존하여 retire/replay가 성립했다. 현재 registrar 변경은 새 reader/settle 권한에 적용되지만 옛 proof 검증을 현재 목록으로 다시 해석하지 않는다.
- 오늘 snapshot/config/policy 및 expiry 변경 뒤 동일 client retry는 원 snapshot/fingerprint/result/retired ID를 유지한다. 다른 client payload/result는 conflict이며 현재 schema만 통과한 새 요청으로 옛 ID가 부활하지 않는다. unkeyed digest는 content binding이지 인증·암호화·privacy erasure가 아니다.
- 원 F3 ordinary getter 읽기0/INPUT 기대는 해소됐다. 공통 parse는 descriptor preflight 후 Zod를 실행하며 foreign exception을 INPUT으로 정제한다. 신규 nested operation getter도 읽기0이고 throwing ownKeys Proxy trap은 실제2회 실행되었지만 오류 detail은 노출되지 않았다. **Proxy trap 자체의 실행 방지나 JS sandbox를 주장하지 않는다.**
- alias로 같은 객체를 menu/config에 주어도 결과는 detached/frozen이다. 이후 caller alias의 배열을 바꿔도 stored snapshot/digest는 불변이고 caller 객체는 freeze되지 않았다. array accessor/추가 속성, excessive nodes/depth, counter increment overflow, capability horizon overflow도 INPUT이다. 기존 -0 JSON 의미/Unicode exact string/문자열과 숫자/array 순서 정책은 원27을 그대로 통과했다.

## 정확 명령·무결성·실제로 읽은 범위

```powershell
# 공유 repo에서 자기 새 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b19-r2-7bfd139/source.tar 7bfd13926363eb23d1138c950577903bc76d2069
tar -xf D:/starwork/b19-r2-7bfd139/source.tar -C D:/starwork/b19-r2-7bfd139
New-Item -ItemType Junction -Path D:/starwork/b19-r2-7bfd139/node_modules -Target D:/starwork/dream-ai-studio/node_modules
Copy-Item D:/starwork/b19-r-91c6dfc/tests/b19-r-independent.test.ts D:/starwork/b19-r2-7bfd139/tests/b19-r-independent.test.ts
# 이하 자기 archive cwd, alias는 이 사본의 원 vitest config
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r-independent.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
Copy-Item D:/starwork/b19-r-91c6dfc/tests/storage-upload-protocol.test.ts tests/b19-r-original32.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r-original32.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r2-additional.test.ts
python review-integrity.py
```

원27 SHA256(이전/복사본 동일) **a414f57d14924f2c8601f9c46bd312a20276b532aa9b1642a5805a782b45e3da**. 원32 SHA256 **19907a45898880c62b9af1c54ca9815ce286ef527d4ffc09f8877dc094d21e6b**. 현재41 파일은 원32 bytes prefix를 그대로 보존한다. archive SHA256 **b7a5ee36812451aefebbbe2a8801575ece628390c6e3a11e837985d021126081**; archive 원989개 파일 대비 변경0 (`review-integrity.json`). 자기 harness/log/count/script만 추가했다. type/lint는 추가17 harness의 정적 검사라고 주장하지 않는다.

증거: 사본 root의 `review-current41.log`, `review-original32.log`, `review-original27.log`, `review-additional.log`, `review-bounded-counts.json`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json`; 신규 harness `tests/b19-r2-additional.test.ts`. 실패4 기대와 fixture를 보존했다.

실제 읽은 범위는 고정4 modules, 현재 focused41/원32 및 원27 harness 전문, B19-FIX/B19 원 handoff, 원 FAIL와 이번 diff다. B16 원204행/FIX37행/R2 보고서는 이전 동일 검수에서 전문을 읽었으며 이번에는 주요 normative sections와 나머지 범위를 재대조했다. B16/FIX의 수용9302419 대비 이번 고정SHA diff0도 확인했다. AI_TEAM_RULES v1.1/Orca 설치 orchestration 지침을 읽었다. B20 draft 내용·실행·SQL 검증은 범위 밖이며 파일명 checkpoint만 보호했다.

## 반환·소유 정리·미검증

판정 **B19-R2 FAIL**: 원8 해소를 인정하되 새4를 완료로 바꾸지 않는다. 최소 다음 작업은 위 snapshot 관계 보강과 같은 거부 기대 재검수다. Backend FIX2는 별도 SHA로 받아야 하며 이번 테스트에 섞지 않는다. SQL/provider 실행으로 범위를 확대하거나 기대값을 낮추지 않는다.

명시 principal/clock/authority/confirmed durable knowledge/quiescence는 **injected trusted facts**다. 일관된 전체 권한자 snapshot 조작의 인증·sandbox, 실 DB atomic CAS/동시성·role/RLS, byte/native 검증·Storage/provider 운영 readiness는 전혀 수용하지 않는다. 순수 proposal 반환은 COMMIT이 아니다. B16 durable IO 이전 barrier/GC/key비재사용/unknown horizon의 기존 trace는 원 suite에서 유지됐으나 실제 IO가 아니다.

짧은 Node/Vitest/typegen/tsc/lint 명령은 모두 종료했다. 상주 worker/service/native/PG/HTTP listener와 scratch를 기동하지 않았으므로 종료할 신규 소유 PID/port는 없다. 사본과 로그는 증거로 보존했다. 실 env/Auth/DSN/PG/SQL/provider/worker/계정/유료/package/3013/shared.next/타 WIP/배포는 무실행·무변경이다. 자기 사본의 .next typegen만 수행했다.

마지막 확인 **2026-11-17 22:51:43 KST**: fixed source/결과·hash·989파일 무결성, 원FAIL 보존, B16 diff0, shared git 상태를 확인했다. 공유 HEAD 관찰 `8c9915b641d3d870f8796dc284fb719b8cfb043e`; shared source를 실행 기준으로 사용하지 않았다. T122/T137, `lib/db/postgres/drafts/`, B20 runner/schema test는 다른 작업으로 수정·stage하지 않았다. Master의 수신/별도 FIX2 배정은 지정 wake의 check 한 번으로만 확인했다. 턴 밖 자동 점검·스케줄러는 미설정이며 polling하지 않았다. 고유 보고서만 선택 commit한다.
