# B19-R3 Upload protocol 재검수 — FAIL

- 검수자 Codex / CX-REVIEW-01, B19-R/R2와 동일 담당. task `task_674207f78900`, dispatch `ctx_ec5afacc412d`.
- 고정 **00fe68a95c39e79fe8f31aeaf6b55cbd43892346**. 새 archive `D:/starwork/b19-r3-00fe68a`에서만 실행했다. 공유 checkout/제품 수정은 없다.
- 판정 **FAIL**: 원8 및 R2의4 거부 기대는 모두 해소됐다. 새 독립12 중 **10 PASS / 2 FAIL**이며, 동일 cancel 이벤트와 동일 canceled claim의 중복 보존 시각 binding이 빠졌다. 새 ready/IO 권한 우회를 발견했다는 주장은 아니다.
- 필수 잔존을 Master에 즉시 `msg_4180fa73bed1`로 보고했다. 지정 wake의 check 한 번으로 `msg_4ec7a10eb86f`의 수신/Backend FIX3 별도 배정을 확인했다. 새 수정본/B20 draft는 이 검수에 혼입하지 않았다. 원 R2 `ae671aec94f18daf3cbf40be558b1cb1d569dfbe` 보고서 diff0이다.

## 실행 결과와 중복 구분

| 집합 | 이번 독립 결과 | 수량의 의미 |
|---|---|---|
| 고정 focused | **47 PASS**, skip0, exit0, 23:07:47 KST | 원41 + 추가6. LF 정규화 기준 원41 prefix 보존을 확인했다. |
| 바이트 불변 원27 harness | **27 PASS**, skip0, exit0 | 기존 원8 필수 거부 기대와 정상 control을 그대로 실행했다. |
| 바이트 불변 R2 추가17 harness | **17 PASS**, skip0, exit0 | R2의4 필수 거부 기대도 변경 없이 실행했다. 위27과 함께23:07:48에 실행되어 CLI는44로 표시하나 별도 집합이며 합산 coverage로 쓰지 않는다. |
| 신규 R3 독립 harness | **12 중10 PASS / 2 FAIL**, skip0, exit1, 23:09:52 | 아래2 rejection 기대가 실패했다. expectation 수정/skip 없음. |
| 기존 bounded loop count | **1,536 = 660 수용 + 876 거부** | 동일64 seed×24 직렬단계 audit. 원 suite와 원27에 중복되며1,536 독립tests가 아니다. |
| 원 typegen / tsc / targeted ESLint | 모두 exit0, lint 경고0 | 자기 archive 원 tsconfig/config, 완화/exclude/overlay 없음. 새12 harness 추가 전 고정 source 검사이다. |

새47의 내부 matrix는 정상 transition으로 만든 **21 reachable snapshots**를 사용한다. 그 안의142 lifecycle/counter/pointer 및240 operation/status/claim/time 변조 시도는 모두 거부됐고,26 unchanged-status 대조도 통과했다.63 positive 검증은21 원상태+21 더 큰 aggregate counter+21 현재 verifier 목록 교체 대조다. 이 숫자들을47개 test에 더하거나382개 고유test/완전 탐색으로 표시하지 않는다. 신규12 역시 loop 내부 assertion을 별도 test 수로 부풀리지 않는다.

bounded loop는 고정6 action/now2~25의 직렬 proposal만 다루며 모든 history, reverify, ledger, 분산 CAS 또는 실 DB interleaving을 포괄하지 않는다. 이전 검수/작성자 실행 수량과 합산하지 않았다.

## 필수 잔존 R3-N1 — initial cancel 완료와 최초 closure 시각 불일치 (P2)

위치 `lib/storage/uploads/state.ts:22`~`:31`, `:79`~`:80`, cancel transition 및 helper `:318`. closure의 time은 reservedAt 이후인지와 일부 reason 관계를 확인하지만 initial canceled operation의 completedAt과 같은 이벤트인지 묶지 않는다. verification_failure는 completedAt==closure.at를 이미 검사한다.

```text
정상 prepared(): initial pending, claimedAt1, publication reservedAt1
transition(cancel, owner, now2)
  -> first closure(reason=cancel, at2), initial canceled.completedAt2
bad = structuredClone(result)
bad.closure.at = 9                 # 이 한 scalar만 변경
checkedModel(bad) -> ACCEPT
```

이 initial operation은 supersession으로 취소될 수 없다. initial complete는 최초 한 번이고 reverify는 registered 뒤에만 가능하며, 지원 cancel/cleanup는 pending initial을 닫는 동일 전이에서 closure와 completedAt을 함께 기록한다. 최초 closure가9인데 operation은2에 이미 canceled라는 조합은 이 지원 전이로 만들 수 없다. 이후 반복 cancel은 최초 closure를 보존하고 이미 terminal인 operation의 완료 시각도 다시 쓰지 않는다.

**요구 수정:** initial canceled의 완료와 그것을 만든 first closure의 시각 관계를 강제한다. reason=cleanup에 의한 최초 closure도 동일 취소 이벤트라면 일치해야 한다. 기존 closure를 보존하는 반복 cancel/후속 cleanup, operation이 없는 조기 cancel, closure가 없는 registered reverify supersession은 정상 허용해야 한다. 임의의 query clock 상한을 snapshot에 추가하라는 요구가 아니다.

## 필수 잔존 R3-N2 — canceledClaim의 동일 fence publication 시간 범위 미검증 (P2)

위치 `state.ts:100`~`:108`. publication fence가 현재 initial.fence와 같을 때에는 현재 claimedAt/leaseUntil를 검사한다. cancel은 fence를 증가시키고 active slot을 비우므로 이 분기를 통과하지 않는다. canceled 상태에는 publication.fence≤canceledClaim.fence만 검사하여, **같은 보존 claim fence**의 lease 범위를 놓친다.

```text
complete initial now1, authorizationUntil90
claim fence1 now1, leaseUntil5
reservePublication fence1 now2
cancel now9                       # lease 만료 뒤 취소는 정상 허용
  -> canceled fence2, canceledClaim(fence1, claimedAt1, leaseUntil5)
  -> publication(fence1, reservedAt2), completedAt9, closure.at9
checkedModel(normal) -> ACCEPT
bad.publication.reservedAt = 6    # 이 한 scalar만 변경
checkedModel(bad) -> ACCEPT       # 같은 fence1인데 lease5 이후 예약
```

이는 현재9에 옛 lease가 살아 있어야 한다는 요구가 아니다. 원 publication 시각2는 당시 claim 범위[1,5)에 있고, 취소9와 옛 lease 만료는 함께 정상 보존돼야 한다. 그러나 시각6의 같은 fence publication은 `reservePublication`의 leased guard가 허용하지 않는다. renew는 lease를 줄이지 않고 reclaim은 fence를 증가시키므로, 보존된 동일 fence/lease5 사실과 양립하지 않는다.

**요구 수정:** publication fence==canceledClaim.fence이면 reservedAt이 그 historical claimedAt 이상/leaseUntil 미만인지 검사한다. publication이 더 오래된 fence이고 현재 보존 이력만으로 그 옛 claim 시간을 증명할 수 없는 경우까지 현재 claim 시간으로 대체해서 정상 reclaim history를 거부하면 안 된다. 새 과거 claim 전부 보관 정책이나 현재시간 freshness 정책을 발명하라는 요구가 아니다.

두 경우 모두 정상 snapshot의 한 필드 부분 손상이다. 권한자·전체 history를 일관되게 다시 위조한 예가 아니며, 실제 PG CAS나 provider 권한을 우회했다고 해석하지 않는다. 이미 canceled이므로 새 publication/finalize는 다른 live guard에서 거부될 수 있다. 이번 필수 결함은 strict internal-history consistency의 잔존이다.

## 확인된 수정과 정상 대조

- R2의 closed+pending, canceled live slot, 존재하지 않는 completedStateRevision, aggregate revision0/committed state1은 원17의 기대 그대로 거부됐다. 원27의 원8 기대도 유지됐다. closed↔closure, contiguous generation, active pending/terminal slot, derived revocation/state points의 검사가 확장됐다.
- canceledClaim은 원 worker/fence/time/policy/set를 보존하되 active worker/lease/claimedAt은 비운다. 신규 대조에서 claimedAt>completedAt, authorization 변경, policy digest 변경, historical issuer 변경, fence 불일치와 closure side-field/삭제는 INPUT이었다. past worker를 현재 allowlist에서 제거해도 정상 canceled history와 expired owner status 조회는 유효하며 claim은 복원되지 않았다.
- 정상 publication을 now4에 재예약한 snapshot 자체는 유효하다. 동일 snapshot에 stale context now3으로 IO instruction을 요청하면 거부하고 now4이면 허용했다. **snapshot 자체에 전역 model-now 상한이 있다는 가정은 하지 않았다.** N1/N2는 query clock과의 비교가 아니라 중복 보존된 동일 이벤트/claim 시각 관계다.
- cleanup observation.at<claimedAt, identity digest 변경, tombstone과 absent/quiescent 불일치, observation 제거는 INPUT이었다. 정상 observation4는 기록으로 허용하되 now3의 cleanup instruction은 거부했다. tombstone 뒤 late write observation은 cleanup_claimed로 돌아가면서 first closure를 유지하고 ready/receipt를 만들지 않았다.
- aggregate counter는 보수 하한이다. 정상 registered snapshot의 revision을 MAX_SAFE_INTEGER까지 높여도 admission이 유효했다. 다음 정책 전이의 counter overflow와 capability horizon overflow는 INPUT이었다. 정확한 과거 transition 수 등식을 upload aggregate에 요구하지 않는다.
- creation은 fully retained begin/terminal/retirement만 변화하므로 owner-ledger revision의 정확한 합계가 성립한다. 신규2-entry trace에서 begin2+terminal1+retirement1=revision4이며0/3/5/MAX_SAFE_INTEGER 부분 변조는 거부했다. retired ID는 historical replay에서도 부활하지 않는다. 이것을 미래 SQL 단일 request-row counter로 그대로 옮기는 수용은 아니다.
- 동일 operation의 createdAt 이전 claim과 matching claim 이전 publication은 거부됐다. nested canceledClaim getter는 읽기0/INPUT이며 caller의 historical verifier 배열을 나중에 바꿔도 detached/frozen 결과는 불변이다. Proxy sandbox/인증 경계는 이전 보고대로 미수용이다.

## 명령·원본 hash·실제 읽은 범위

```powershell
# 공유 repo에서 자기 새 디렉터리 생성 후
git archive --format=tar --output=D:/starwork/b19-r3-00fe68a/source.tar 00fe68a95c39e79fe8f31aeaf6b55cbd43892346
tar -xf D:/starwork/b19-r3-00fe68a/source.tar -C D:/starwork/b19-r3-00fe68a
New-Item -ItemType Junction -Path D:/starwork/b19-r3-00fe68a/node_modules -Target D:/starwork/dream-ai-studio/node_modules
Copy-Item D:/starwork/b19-r-91c6dfc/tests/b19-r-independent.test.ts D:/starwork/b19-r3-00fe68a/tests/b19-r-independent.test.ts
Copy-Item D:/starwork/b19-r2-7bfd139/tests/b19-r2-additional.test.ts D:/starwork/b19-r3-00fe68a/tests/b19-r2-additional.test.ts
# 이하 자기 archive cwd / 자기 원 vitest alias
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/vitest/vitest.mjs run tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run tests/b19-r3-additional.test.ts
python review-integrity.py
```

- 원27/복사본 SHA256 동일: `a414f57d14924f2c8601f9c46bd312a20276b532aa9b1642a5805a782b45e3da`.
- 원17/복사본 SHA256 동일: `616705768232776b4bc0c775278babad6ac5a3e809db3ff6882ef063f594ee0e`.
- archive SHA256 `2c0c03f3fe85481996b58c6afc18885e6317db875b0ce0056d988be6b7817be5`; 원991파일 대비 변경0. receipt.ts도 R2와 byte 동일하다.
- 증거는 자기 root의 `review-current47.log`, `review-prior-harnesses.log`, `review-additional.log`, `review-bounded-counts.json`, `review-typegen.log`, `review-tsc.log`, `review-lint.log`, `review-integrity.json` 및 `tests/b19-r3-additional.test.ts`이다. 신규12의 정적 검사가 아니라 fixed source의 원 tsc/lint 통과로 기록한다.

실제 읽은 범위: B19-FIX2 전문, ae671aec 원R2 보고/원27/원17, 고정4 module 전문과 현재47의 새6/21-state matrix 및 원41 prefix 대조. 기존 B16/FIX/R2 설계의 terminal-first/current state·독립 lease/fence·pre-publication reservation·permanent closure 원칙과 대조했다. 원 설계와 필드 확장 의미를 유지하며 이번 두 결함은 현재 supported transition의 생성 규칙 자체로 재현된다. 전체 제품/SQL/B20 draft/provider/실 env는 읽거나 실행할 필요가 없어 제외했다.

## 반환·소유 정리·미검증

**B19-R3 FAIL**로 반환한다. 원8/R2의4 해소와 신규2 잔존을 구별한다. 최소 다음 작업은 동일 first-cancel 및 동일 canceled-claim publication의 시간 binding 보강이며, 별도 고정 SHA로 같은 기대를 재검수해야 한다. 현재/새 Backend 수정과 B20 draft는 섞지 않는다.

injected authoritative snapshot/principal/clock/history/confirmed knowledge/quiescence를 인증하는 sandbox가 아니다. coherently fabricated whole-authority history, 실 DB locking/CAS/atomic commit/global uniqueness, actual bytes/native/provider/RLS/운영 readiness는 미검증·미수용이다. 역사적으로 모순 없는 record의 조회와 새 live authority 발급은 구별한다. pure proposal은 durable COMMIT이 아니다.

단기 Node/Vitest/typegen/tsc/lint는 모두 반환·종료했다. 소유 상주 process/service/PG/HTTP listener/native worker/scratch를 기동하지 않았으므로 종료할 신규 PID/port는 없다. 증거 archive/log는 보존했다. 실 IO/SQL/provider/Auth/API/worker/계정/유료/설정/package/3013/shared.next/타 WIP/배포는 무실행·무변경이며 자기 .next typegen만 생성했다.

마지막 확인 **2026-11-17 23:13:25 KST**: fixed 검증 결과/991파일 무결성/원hash/원R2 diff0/shared git를 확인했다. 공유 HEAD 관찰 `23b5584430d3e423c95f2f5d0c06baadfc559e5c`; 실행 기준은 위 fixed archive다. T122/T137, B20 draft/runner/schema test를 수정·stage하지 않았다. 23:11:37의 지정 wake 한 번에서 Master의 수신/FIX3 별도 배정만 확인했다. 턴 밖 자동 점검/스케줄러 미설정, polling 없음. 고유 보고서만 선택 commit한다.
