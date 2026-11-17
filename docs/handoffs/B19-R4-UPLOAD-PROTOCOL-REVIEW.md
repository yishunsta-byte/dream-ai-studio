# B19-R4 Upload protocol 재검수 — FAIL

- 검수자 Codex / CX-REVIEW-01, 동일 B19-R 담당. task `task_375b52b426c1`, dispatch `ctx_1925701e3cd0`.
- 고정 **803bbabc0e7ebd313e83122f990d06d5eaeac358**. 자기 새 archive `D:/starwork/b19-r4-803bbab`에서만 실행했다. 제품 수정/공유 checkout 없음.
- **원8+R2의4+R3의2 거부 기대는 해소됐으나 신규9 중7 PASS / 2 FAIL이므로 전체 FAIL이다.** 원 R3 `ecfb2f05ec5857694059abb22d6ea46d978d117d`는 보존했고 해당 보고서 diff0이다.
- 필수 잔존을 즉시 `msg_d82672e744eb`로 Master에 보고했다. 지정 wake의 check 한 번에서 `msg_feda54b858b1`의 수신/Backend FIX4 별도 배정을 확인했다. 현 고정본만 최종 반환하며 새 FIX4/B20 draft를 섞지 않았다.

## 정확 수량·중복

| 실행 | 독립 결과 | 범위 |
|---|---|---|
| 현재 원 focused | **52 PASS**, 0 skip, exit0, 23:21:22 KST | 기존47 + 새5. 기존47 LF-normalized prefix 보존 확인. |
| byte 불변 원27 | **27 PASS**, 0 skip | 원8 기대 포함. |
| byte 불변 R2의17 | **17 PASS**, 0 skip | R2의4 기대 포함. |
| byte 불변 R3의12 | **12 PASS**, 0 skip | R3의2 기대 포함. 위 세 suite는23:21:23에 함께 실행, CLI56 PASS/exit0. 중복이 있어 고유 coverage 합계로 쓰지 않는다. |
| 신규 R4 독립 | **9 중7 PASS / 2 FAIL**, 0 skip, exit1, 23:23:30 | 아래2 INPUT 거부 기대가 실패. skip/기대 완화 없음. |
| 원 bounded audit | **1,536=660 수용+876 거부** | 동일64 seed×24 직렬시도. 반복 실행/원 suite와 원27 중복이며 독립1,536 tests가 아니다. |
| 원 typegen / tsc / lint | 각각 exit0, lint 경고0 | 원 tsconfig/설정 그대로, 자기 archive에서 신규9 추가 전 검사. |

유지된21-state matrix의142/240 negative,26 unchanged-status,63 positive 대조는52 내부 테스트의 assertion 수다. 새 고유test나 전체 상태공간/실 DB concurrency 증명으로 더하지 않는다. 원 bounded loop도 고정6 action/짧은 injected clock의 직렬 proposal로 한정된다. 이전 검수/작성자 결과와 수치를 합산하지 않았다.

## 필수 잔존 R4-N1 — terminal completedRevision의 보존 사건 하한 누락 (P2)

위치 `lib/storage/uploads/state.ts:65`~`:69`의 terminal counter 범위 및 `:147`~`:153` 부근 aggregate minimumRevision 검사. 전체 snapshot revision 하한은 검사하지만, 새 completedRevision은 stateRevision 이상/current aggregate 이하와 세대 간 순서만 검사한다. 이 값이 가리키는 **완료 시점까지 반드시 있었던 전이**의 보수 하한은 확인하지 않는다.

```text
normal registered() =
  complete initial    -> aggregate revision1
  claim               -> revision2
  reservePublication  -> revision3
  finalize            -> revision4, stateRevision1, completedRevision4
bad = structuredClone(normal)
bad.operations[0].completedRevision = 1   # 이 한 scalar만 변경
checkedModel(bad) -> ACCEPT
```

initial success/receipt/publication/claim은 그대로인데 완료가 revision1에 일어났다고 기록한다. 지원 API는 이 네 사건을 하나의 전이로 합치지 않고 각각 revision을 증가시킨다. 같은 state counter1이라는 이유로 aggregate completion counter1이 정당해지지 않는다.

**요구 수정:** retained operation의 완료에 필요한 causal prefix의 최소 전이 수를 completedRevision에도 보수적으로 적용한다. 이 예에서는 최소4가 도출된다. upload 전체 이력의 정확한 전이 수 등식이나 모든 완료를 오늘 aggregate revision과 같게 만들라는 요구가 아니다. policy/renew/추가 observation 등이 있었다면 큰 값은 유효하고, 완료 뒤 추가된 사건을 과거 완료의 최소 수에 무조건 포함하면 안 된다. 새 schema 전체 execution log/TTL/모델시각 정책은 요구하지 않는다.

이번 실행은 checkedModel의 counter 내부 모순 수용을 입증했다. 실 DB CAS나 새로운 ready/IO 권한 우회가 증명됐다는 판정은 아니다.

## 필수 잔존 R4-N2 — older publication claim과 newer reclaim의 lease 순서 누락 (P2)

위치 `state.ts:109`~`:120` 부근 publication.claim 검증과 claim transition의 `now >= old leaseUntil` guard. publication claim 자체의 reservedAt/window는 검사하고 같은 fence라면 현 claim/canceledClaim과 대조하지만, **더 오래된 fence**에는 새 claim과의 시간 순서가 없다.

```text
complete initial now1, authorizationUntil90
claim worker, fence1 now1, leaseUntil5
reservePublication now2 -> p.claim(fence1, worker, leaseUntil5)
current verifiers를 stranger로 정상 교체
reclaim stranger, fence2 now6, leaseUntil20
  -> old p.claim 보존, current claim fence2/claimedAt6
checkedModel(normal) -> ACCEPT
bad.publication.claim.leaseUntil = 7     # 이 한 scalar만 변경
checkedModel(bad) -> ACCEPT
```

publication 자체는 시각2에 자신의 변조된 window[1,7) 안에 있지만, 다음 fence의 claim6은 그 lease가 끝나기 전에 일어났다는 모순이 남는다. renew는 lease를 늘리기만 하고 reclaim은 직전 lease 종료 뒤에만 가능하므로, 이후 fence에 도달했다면 보존된 옛 publication claim의 lease도 그 newer claimedAt까지는 끝나 있어야 한다. 중간 fence가 생략돼도 같은 보수 순서가 성립한다.

**요구 수정:** 보존된 newer current claim 또는 canceledClaim의 fence가 publication보다 크면 old publication claim의 leaseUntil이 그 newer claimedAt을 넘지 않도록 검사한다. 기존 동일-fence renew의 `old lease <= later lease`, 서로 다른 worker, 과거 allowlist, lease 만료 뒤 cancel, old reservation 보존을 유지해야 한다. 옛 worker를 오늘 worker와 같게 강제하거나 모든 claim 전체 로그를 새로 요구하는 해결은 부적절하다.

이것은 두 보존 claim의 사건 순서이며 임의의 snapshot-wide now 상한/새 TTL이 아니다. 이미 stale fence인 publication의 IO projection은 다른 guard로 거부됐다. 이번 결함을 provider/새 권한 우회로 과장하지 않는다.

## 원14 해소·정상 counter/claim/closure 대조

- 원27/17/12는 바이트와 assertion 모두 그대로 통과했다. 원14 실패가 다시 남았다고 주장하지 않는다. FIX3의 initial closure.at/completedAt, closure.revision/completedRevision, immutable owner/singleton authorizers 및 failure/first-GC binding은 원52와 독립 대조에서 정상이다.
- 신규 대조에서 초기 취소의 at/revision/principal/authorizer/completedRevision 각각만 바꾸면 INPUT이다. early cancel은 operation을 발명하지 않고, repeat cancel은 최초 closure를 보존했다. 직접 GC가 initial을 취소하면 completion revision==cleanup claimedRevision이며, earlier failure 뒤 GC는 옛 closure/operation을 보존하고 더 큰 cleanup revision을 갖는다.
- 현재/취소 claim과 같은 fence인 publication은 worker/claimedAt/fence/authorization/lease의 부분 손상을 거부했다. contemporaneous claim이 당시 window를 기록하므로 R3의 lease5 뒤 reservedAt6 변조도 원12에서 거부된다.
- 정상 lease5/publication2 후 renew3→lease8은 옛 publication window5를 유지한다. cancel9도 정상이다. renewal 뒤 새 publication6은 window8을 새로 기록하고, cancel9 뒤 historical result 조회는 유효하다. 현재9에 과거 lease가 유효해야 한다는 조건은 추가하지 않았다.
- different worker의 reclaim6은 옛 worker/fence1 publication을 역사로 보존하지만 matching IO instruction은 거부한다. 새 worker가 fence2로 re-reservation7하면 새 claim/window20을 기록하고 IO projection이 허용됐다. cancel21 뒤에도 그 과거 window는 보존된다. N2는 이 정상 이력을 없애라는 요구가 아니다.
- completedRevision>current revision은 INPUT이다. 별도 정상 snapshot의 aggregate revision을100 높이고 오늘 verifier 목록을 바꿔도 admission과 owner의 historical status 조회는 옛 issuer를 유지했다. confirmed terminal replay는 expiry/CAS 전에 같은 결과를 반환한다. N1은 더 큰 counter를 금지하는 정확한 전체 이력 count 요구가 아니다.
- GC claim 뒤 finalize는 거부됐고 unknown durable knowledge는 cleanup instruction을 발급하지 않았다. 원 suites의 tombstone/no-ready/late-write/receipt1:N·revocation·policy·retired creation ID·fingerprint V2·getter/foreign INPUT 경계도 회귀 통과했다.
- publication.claim의 ordinary getter는 읽기0/INPUT이다. caller의 historical verifier 배열을 변경해도 detached/frozen 결과가 변하지 않았다. Proxy trap 자체의 실행을 막는 sandbox라는 주장은 없다.

## 명령·무결성·읽은 범위

```powershell
# 공유 repo에서 자기 새 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b19-r4-803bbab/source.tar 803bbabc0e7ebd313e83122f990d06d5eaeac358
tar -xf D:/starwork/b19-r4-803bbab/source.tar -C D:/starwork/b19-r4-803bbab
New-Item -ItemType Junction -Path D:/starwork/b19-r4-803bbab/node_modules -Target D:/starwork/dream-ai-studio/node_modules
Copy-Item D:/starwork/b19-r-91c6dfc/tests/b19-r-independent.test.ts D:/starwork/b19-r4-803bbab/tests/b19-r-independent.test.ts
Copy-Item D:/starwork/b19-r2-7bfd139/tests/b19-r2-additional.test.ts D:/starwork/b19-r4-803bbab/tests/b19-r2-additional.test.ts
Copy-Item D:/starwork/b19-r3-00fe68a/tests/b19-r3-additional.test.ts D:/starwork/b19-r4-803bbab/tests/b19-r3-additional.test.ts
# 이하 자기 archive cwd, 자기 원 vitest alias/config
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts tests/b19-r3-additional.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run tests/b19-r4-additional.test.ts
python review-integrity.py
```

원본/복사본 동일 SHA256:

- 원27: `a414f57d14924f2c8601f9c46bd312a20276b532aa9b1642a5805a782b45e3da`.
- 원17: `616705768232776b4bc0c775278babad6ac5a3e809db3ff6882ef063f594ee0e`.
- 원12: `1db112a43f387c47d06f5de092865d2f3d585595505df4b1785b9fba3eaf61f3`.

archive SHA256 `bf848f7534cef911d5df2fb8bd8a1d39352cead0a4a1e8d10c5bfc1497091c2b`; 원993파일 대비 변경0 (`review-integrity.json`). receipt.ts/operation.ts는 R3 archive와 byte 동일하다. 신규9 harness의 assertion을 실행 전에 작성 중 교정한 부분은 자기 helper의 오타였으며, 실행 실패 기대를 약화한 것이 아니다. 신규 harness를 원 lint/tsc까지 통과시켰다고 주장하지 않는다.

증거는 자기 root의 `review-current52.log`, `review-prior-harnesses.log`, `review-additional.log`, `review-bounded-counts.json`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json`, `tests/b19-r4-additional.test.ts`에 보존했다. 읽은 범위는 FIX3 전문/원R3와 이전 byte harness들, 고정 schema/state 전문과 새52의5 appended tests/기존47 prefix, 변경 없는 operation/receipt의 이전 전문 및 byte 대조다. B16 수용 설계의 lease/fence/terminal/closure 원칙과 현재 실제 transition의 생성 규칙으로 근거를 한정했다. B20는 파일명 checkpoint만 보호했고 내용을 검수하지 않았다.

## 반환·소유 정리·미검증

**B19-R4 FAIL**: 원14 해소, 신규2 잔존이다. 최소 다음 작업은 retained causal prefix의 completedRevision 하한과 older claim lease→newer reclaim 순서 보강이며, Backend FIX4 별도 고정 SHA에서 같은 거부 기대를 재검수해야 한다. full execution log/새 운영 TTL/global-now 정책을 설계하는 작업으로 확대하지 않는다.

injected authoritative snapshot/principal/clock/confirmed knowledge/quiescence를 인증하는 sandbox는 아니다. coherent whole-authority forgery, 실 DB linearization/CAS/atomic commit/role/RLS, 실제 byte/native/Storage/provider readiness는 미검증·미수용이다. 내부 모순 검증과 인증은 구별하며 pure proposal 반환은 COMMIT이 아니다.

단기 Node/Vitest/typegen/tsc/lint는 모두 반환·종료했다. 상주 worker/service/PG/HTTP listener/native/scratch를 기동하지 않아 종료할 신규 소유 PID/port는 없다. 증거 archive/log를 보존했다. 실제 SQL/PG/IO/provider/Auth/worker/API/유료/계정/설정/package/3013/shared.next/타 WIP/운영배포는 무실행·무변경이고 자기 .next typegen만 생성했다.

마지막 확인 **2026-11-17 23:26:39 KST**: fixed 결과·993파일 무결성·원27/17/12 hash·원R3 diff0·shared git를 확인했다. 공유 HEAD 관찰 `9c8ab7e09b92bc4773a98bbedfda9413cdebdf3a`; 실행 기준으로 쓰지 않았다. T122/T137와 B20 draft/runner/schema test는 수정·stage하지 않았다.23:24:55 지정 wake 한 번에서 Master의 수신/FIX4 별도 배정만 확인했다. 턴 밖 자동 점검/스케줄러 미설정, polling 없음. 고유 보고서만 선택 commit한다.
