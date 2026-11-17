# B19-R5 Upload protocol 재검수 — PASS (지정 pure protocol 범위)

- 검수자 Codex / CX-REVIEW-01, 원 B19-R부터 동일 담당. task `task_205b31379418`, dispatch `ctx_6ca7194b3257`.
- 고정 **d9d438a541d82664a6227f0545863da98692e10c**. 자기 새 archive `D:/starwork/b19-r5-d9d438a`에서 실행했다. 공유 checkout/제품 수정 없음.
- **원 R4의2 필수 잔존 해소 및 이번 지정 causal-prefix/reclaim-order 범위 PASS**, 필수 추가 수정 발견0. 원8+4+2+2 거부 기대를 바꾸지 않았다. 원 FAIL `f28e8e9a176db8a032517ef82aa582311b4a6c76` 보고서 diff0이며 과거 FAIL을 덮어쓰지 않는다.
- 이 판정은 pure model의 지정 내부 관계·bounded 실행 검수다. 모든 불가능 snapshot의 완전 배제/정확한 전체 이력 복원/실 DB·provider·운영 readiness 수용이 아니다.

## 이번 독립 실행과 중복

| 집합 | 결과 | 해석 |
|---|---|---|
| 현재 원 focused | **56 PASS**, skip0, exit0, 23:35:19 KST | 원52 + 추가4. 원52 LF-normalized prefix 보존 확인. |
| byte 불변 원27 | **27 PASS**, skip0 | 원8 rejection 기대 포함. |
| byte 불변 R2의17 | **17 PASS**, skip0 | 원R2의4 rejection 기대 포함. |
| byte 불변 R3의12 | **12 PASS**, skip0 | 원R3의2 rejection 기대 포함. |
| byte 불변 R4의9 | **9 PASS**, skip0 | 원R4의2 rejection 기대 포함. 네 suite는23:35:20 함께 실행해 CLI65 PASS/exit0. focused와 겹치므로65 추가 고유 coverage로 합산하지 않는다. |
| 신규 R5 독립 | **8 PASS**, skip0, exit0, 23:37:27 | 아래 정상/부분변조 대조8개 test. loop 내부 assertion 수를 별도test로 더하지 않는다. |
| 기존 bounded audit | **1,536 시도=660 수용+876 거부** | 동일64 seed×24 직렬 loop. 원 suite/원27의 중복이며1,536 독립test가 아니다. |
| 원 typegen / tsc / targeted lint | 모두 exit0, 경고0 | 자기 archive 원 tsconfig/config, 완화·overlay·exclude 없음. 신규8 작성 전 고정 source 검사. |

원21-state matrix와142/240 negative,26 unchanged-status/63 positive 대조는 현재56 내부 assertion이다. 이 수량이나 이전 검수/작성자 실행을 신규test 합계로 쓰지 않는다. 기존 seed loop는6 action/짧은 injected clock의 직렬 proposal이며 무한 상태공간/모든 interleaving/분산 CAS 증명이 아니다.

## R4-N1 해소 — retained causal prefix

`lib/storage/uploads/state.ts:140` 부근은 각 operation의 minimum을 predecessor completedRevision + reservation + claims + retained publication + terminal + 초기 preclosure issuance로 도출한다. pending은 current aggregate, terminal은 자기 completedRevision과 비교한다. initial success의 complete/claim/publication/finalize 네 필수 전이에서 최소4가 도출되어 원 `completedRevision=1` 조작이 INPUT으로 거부됐다. literal4 정책이나 새 필드는 없다.

같은 supersession 전이가 이전 reverify의 cancel과 다음 operation의 reservation을 함께 수행하므로 predecessor canceled이면 reservation 가산을0으로 둔다. canceled fence에는 cancel 증가1이 포함돼 claim 수는 fence−1이며, terminal event는 별도로 한 번이다. cleanup의 첫 GC가 initial을 취소한 경우에도 shared event를 이중 계산하지 않는다.

신규 독립 대조:

- claimed/unclaimed 두 분기에서 reverify를 연속 supersede한 뒤 다음 claim/finalize를 수행했다. 마지막 completion은 직전 canceled completion+2이며 모두 허용됐다. 이를+1로 바꾸면 INPUT이다. old R1 status는 남고 current receipt는 새 성공 결과다.
- initial 미claim/claim+publication 두 상태에서 만료 후 직접 GC를 수행했다. first closure/initial completion/cleanup claimedRevision은 같은 한 전이이며 별도 cancel+GC로 중복 계산하지 않았다.
- 초기 issue 예약+dispatch 뒤 publication 없는 실패는 completedRevision5다. 실패 뒤 reconciliation을 추가해도 그 완료/closure는5로 남고, 이후 GC의 claimedRevision은7이다. 완료와 closure만4로 낮추는 부분변조는 거부됐다.
- 성공6 뒤 reconciliation, policy advance, manual revocation을 추가해도 old success completion은6으로 유효했다. old terminal receipt는 owner status로 유지됐다. post-completion 사실을 과거 completion minimum에 섞지 않았다.
- operation 없는 issue+dispatch→early cancel3→reconciliation4→GC5→관측 두 번/후속 policy 변경에서도 first closure3/GC claim5가 보존됐다. GC claim4 또는 closure2의 변조는 거부됐다.

issue reservation/dispatch는 supported lifecycle guard상 initial closure/registration 뒤에 새로 생길 수 없으므로 initial prefix에 포함할 수 있다. 반면 reconciliation은 failure/success 뒤에도 허용되어 과거 completion minimum에서 제외한다. GC는 모든 horizon을 먼저 알아야 하므로 GC prefix에는 retained reconciliation을 포함한다. observation은 GC 뒤 사건이라 그 claim minimum에 포함하지 않는다.

이것은 **지정 retained prefix의 보수 하한**이다. 전체 execution log가 없고 renew/policy/replaced publication 등을 정확히 복원하지 않는다. 신규 실제 two-claim/replaced-publication/renew trace의 aggregate는7이었고, 고정 모델은 retained-prefix projection의 completion5를 허용/4를 거부했다. 이 허용을 원 실행의 정확한 과거 counter가5였다는 증거나 모든 accepted projection의 exact reachability 증명으로 제시하지 않는다. 큰 counter는 허용되며 MAX_SAFE_INTEGER의 unchanged snapshot도 유효하고 다음 overflowing mutation은 INPUT이다. creation의 fully retained ledger exact counter와 upload lower bound를 혼동하지 않는다.

## R4-N2 해소 — old lease와 newer claim 순서

`state.ts:115` 부근은 publication보다 newer fence인 current claim 또는 canceledClaim이 있으면 old publication leaseUntil≤newer claimedAt을 요구한다. reclaim은 expiry 뒤에만 가능하고 renew는 lease를 줄이지 않는다는 기존 API guard에서 도출되는 필요조건이다. old worker를 오늘 worker로 바꾸거나 전체 claim log를 추가하지 않는다.

신규 대조에서 old worker fence1 publication2/lease5, 다른 worker의 fence2 claim6을 정상 허용했다. live 및 cancel21 두 상태에서 old leaseUntil=7만 변경하면 INPUT, equality6은 허용됐다. 오늘 verifier 목록이 옛 issuer를 포함하지 않아도 historical claim은 유지됐다. 같은 fence의 renew5→8/claimedAt1은 다른 관계로 처리해 old publication window5를 허용하고 cancel9도 정상이다. stale publication은 새 IO를 발급하지 않는다. 이전 byte 원9의 새 re-reservation/권한·getter·closure 회귀도 그대로 통과했다.

따라서 임의의 snapshot-wide now 상한/새 TTL/정확 전체 count 없이 원R4 두 결함이 닫힌다. 현재시간과 역사적 claim window, historical terminal read와 새 authority 발급의 구분도 유지됐다.

## 명령·hash·실제로 읽은 범위

```powershell
# 공유 repo에서 자기 새 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b19-r5-d9d438a/source.tar d9d438a541d82664a6227f0545863da98692e10c
tar -xf D:/starwork/b19-r5-d9d438a/source.tar -C D:/starwork/b19-r5-d9d438a
New-Item -ItemType Junction -Path D:/starwork/b19-r5-d9d438a/node_modules -Target D:/starwork/dream-ai-studio/node_modules
Copy-Item D:/starwork/b19-r-91c6dfc/tests/b19-r-independent.test.ts D:/starwork/b19-r5-d9d438a/tests/b19-r-independent.test.ts
Copy-Item D:/starwork/b19-r2-7bfd139/tests/b19-r2-additional.test.ts D:/starwork/b19-r5-d9d438a/tests/b19-r2-additional.test.ts
Copy-Item D:/starwork/b19-r3-00fe68a/tests/b19-r3-additional.test.ts D:/starwork/b19-r5-d9d438a/tests/b19-r3-additional.test.ts
Copy-Item D:/starwork/b19-r4-803bbab/tests/b19-r4-additional.test.ts D:/starwork/b19-r5-d9d438a/tests/b19-r4-additional.test.ts
# 이하 자기 archive cwd / 자기 원 vitest alias/config
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts tests/b19-r3-additional.test.ts tests/b19-r4-additional.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run tests/b19-r5-additional.test.ts
python review-integrity.py
```

원본/복사본 byte 동일 SHA256:

- 원27 `a414f57d14924f2c8601f9c46bd312a20276b532aa9b1642a5805a782b45e3da`.
- 원17 `616705768232776b4bc0c775278babad6ac5a3e809db3ff6882ef063f594ee0e`.
- 원12 `1db112a43f387c47d06f5de092865d2f3d585595505df4b1785b9fba3eaf61f3`.
- 원9 `8d1d4f829fa30b833a00c9c2403a0353cd31c03ca20895d3fc3f0c24588dc345`.

archive SHA256 `0c88c1b9d9b50cc292c6a364e0605a5e8a70d84550b71222d8e04134f2afbf6e`; archive 원995파일 대비 변경0. schema/receipt/operation은 R4 archive와 byte 동일하다. 새8 harness/script/log만 독립 자료로 추가했고 기존 tests/expectation을 수정하지 않았다. 새 harness까지 원 tsc/lint로 검사했다고 주장하지 않는다.

증거: 자기 root의 `review-current56.log`, `review-prior-harnesses.log`, `review-additional.log`, `review-bounded-counts.json`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json`, `tests/b19-r5-additional.test.ts`.

읽은 범위: FIX4 전문/원R4 보고, 고정 state 변경 전체 diff와 causal/claim/closure 주변 문맥, 고정56의 새4 test 전문과 원52 prefix, byte 불변 원27/17/12/9 및 이전에 전문 검토한 unchanged schema/receipt/operation 대조다. 기존 수용 B16/FIX와 각 이전 검수의 계약을 유지했고, 새 schema/SQL/provider 정책을 발명하지 않았다. B20 draft/SQL 내용과 Backend의 PG 결과는 검수에 포함하지 않았다.

## 반환·미검증·소유 정리

**B19-R5 지정 pure protocol PASS.** 기존16 거부 기대와 이번8 독립 test 범위에서 필수 잔존 발견0이다. Master가 별도 범위를 정하기 전 SQL4/B20 schema/executor/provider/runtime을 수용하거나 실행하는 판정이 아니다. 후속 persistence mapping은 이 lower-bound 의미, shared supersession/GC, terminal-first/history 및 lease ordering을 그대로 보존하는 별도 검수가 필요하다.

injected authoritative snapshot/principal/clock/confirmed knowledge/quiescence를 인증하는 sandbox가 아니다. coherent whole-authority forgery, 모든 exact reachable history, 실 DB atomic CAS/lock/global uniqueness/권한/RLS, 실제 bytes/native/Storage/provider/quiescence/운영 readiness는 미검증·미수용이다. returning proposal은 COMMIT이 아니다. bounded PASS를 전체 제품·무한 상태공간 보장으로 확대하지 않는다.

짧은 Node/Vitest/typegen/tsc/lint 명령은 모두 종료했다(마지막 static session도 exit0 확인). 상주 PG/HTTP/worker/service/native/scratch를 기동하지 않아 종료할 신규 소유 PID/port는 없다. 증거 archive/log는 보존했다. 실제 SQL/PG/IO/provider/실env/Auth/API/worker/유료/계정/설정/package/3013/shared.next/타 WIP/운영배포는 무실행·무변경이며 자기 .next typegen만 생성했다.

마지막 확인 **2026-11-17 23:40:03 KST**: fixed 결과·995파일 무결성·원harness hash·원R4 diff0·shared git 상태를 확인했다. 공유 HEAD 관찰 `99bf2d31602b96766325216cf734919b48869202`; 실행 기준으로 쓰지 않았다. T122/T137, B20 draft/runner/schema test를 수정·stage하지 않았다. 턴 밖 자동 점검/스케줄러 미설정, mailbox polling 없음. 고유 보고서만 선택 commit한다.
