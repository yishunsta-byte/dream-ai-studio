# T-203 ZIP 기존 실패 13건 원인 조사

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 진단만 했어요(제품·시험 파일 수정 없음)
- 결론: **시험 시계 시한폭탄이에요. 제품 회귀도, fixture·경로·의존성 문제도 아니에요.**
  - 시험의 가짜 시계는 `2026-11-17T10:00:00Z`로 고정돼 있어요.
  - 실제 시계가 이 시각을 넘긴 순간부터(KST 11-17 19:00) 내보내기 작업이 대기열에서 꺼내지지 않아요.

## 실패 목록(명령: `npx vitest run tests/t162-audio-bundle.test.ts tests/t166-late-source-change.test.ts`)
- t166 6건: 정상 경로 확정, writeZip 직후 1바이트 변경, 검증 직후 원본 삭제, orphan ZIP 재시도, noreplace 보존, link 뒤 DB 확정 실패.
- t162 7건: v2 소리 묶음, 백업·복원 통과, 작성 단계 바이트 변경, 작성 중 변경, 저장 실패 재시도, 같은 소리 두 역할, 소리 없는 v2.
- 통과 1건: t162의 묶음 요청 거절 시험(작업 실행기를 거치지 않음).
- 실패 모양은 모두 같아요: 작업이 `queued`에 남아요(`expected 'queued' to be 'succeeded'`, `code: null`, `inZip` null 등).

## 원인
1. 시험 `runExport()`가 `exportService(handle).request(P, revision)` 뒤에 `runNextJob(handle, { now, sleep })`을 불러요. 이때 `now`는 가짜 시계 `time = Date.parse("2026-11-17T10:00:00Z")`예요.
2. 제품 `lib/services/exports.ts:136`의 request는 작업 행에 `nextRunAt: new Date().toISOString()`을 적어요. 가짜 시계가 아니라 **실제 시계**예요.
3. `lib/services/jobs.ts:53`의 claim은 `row.nextRunAt <= stamp()`일 때만 작업을 꺼내요. 여기서 `stamp()`는 가짜 `now` 기준이에요.
4. 실제 시각이 10:00Z보다 앞서면 `nextRunAt <= 10:00Z`라 통과해요. 시험을 처음 쓴 시각이 KST 08:45~09:03(= 10:00Z 이전)이라 그때는 통과했어요. 10:00Z를 지나면 claim이 null을 돌려주고 작업이 그대로 queued에 남아요.
- 다른 고정 시각 시험(backup·restore·render 등)은 요청 쪽도 주입한 `now`를 쓰거나 고정 시각이 과거라서 영향이 없어요. 전체 시험에서 실패한 건 이 2개 파일뿐이에요.

## 재현과 대조(격리 `%TEMP%\dream-t203`, 실행 시각 UTC 2026-11-17T10:14Z)
| 경우 | 기준 | 결과 |
|---|---|---|
| A 원본 그대로 | 2d44be0(T200 이전 HEAD) | **13 실패 / 1 통과** |
| B 가짜 시계 = 실제 + 1시간(사본에서만 시험 수정) | 2d44be0 | 14 통과 |
| C 가짜 시계 = 실제 − 1분(사본에서만) | 2d44be0 | 13 실패(방향까지 일치) |
| D 고정값 10:00Z 유지 + `vi.useFakeTimers({toFake:["Date"]})`·`setSystemTime(time-1000)`(사본에서만) | 2d44be0 | 14 통과 |
| E 원본 그대로 | 4838017(T-166 작성 커밋) | **13 실패**, 작성 당시 코드도 지금은 실패 → 이후 커밋 회귀 아님 |
| F E + D와 같은 시계 맞춤 | 4838017 | 14 통과 |
- T200 작업 중 격리 사본(HEAD + T200 변경)과 T200을 뺀 HEAD 사본에서도 같은 13건이 실패했어요(T-200 보고서).
- 사본은 삭제했어요. 원본 data·fixture·.tools 바이트, 공유 .next, 3013, 실제 DSN은 건드리지 않았어요.

## 구분
| 후보 | 판단 |
|---|---|
| fixture 누락 | 아님. s9 백업 복원·이관이 정상이고, 시계만 바꾸면 전부 통과 |
| 경로 | 아님. OS temp 경로 그대로 통과(B·D·F) |
| 의존성 | 아님. 같은 node_modules로 통과/실패가 시계로만 갈려요 |
| 실제 제품 회귀 | 아님. 운영에서는 request와 claim이 모두 실제 시계라 어긋나지 않아요 |
| **시간** | **원인.** 고정 가짜 시계 + 제품 request의 실제 시계가 섞였어요 |

## 수정안(배정 요청, 아직 고치지 않음)
- 최소 수정 파일: `tests/t162-audio-bundle.test.ts`, `tests/t166-late-source-change.test.ts`(시험만)
  - beforeEach: 고정 `time` 그대로 두고 `vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(time - 1000);`
  - afterEach: `vi.useRealTimers()`
  - 기대값·검증 강도는 그대로예요. setInterval 등 타이머는 가짜로 바꾸지 않아요(Date만).
- 다른 방법(제품 수정, 범위 큼): `exportService`에 `now` 주입을 추가해 request의 `nextRunAt`을 주입 시계로 적기. 운영 동작은 같지만 제품 코드라 Backend 담당 범위예요.
- 검증안: 두 파일 실행. 이어서 실제 시계를 고정 시각 앞뒤(B·C 방식)로 바꿔 둘 다 통과하는지 보고, 전체 시험·lint·type 확인.
