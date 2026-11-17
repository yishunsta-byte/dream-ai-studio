# T-222 내보내기 화면 시험 2건 실패 진단

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **진단 완료(코드 수정 없음)**
- 기준 SHA: 현재 `ec91a55`(제품 고정 `371d5cc` + 보고서). 대조용 T-220 직전 부모는 `661cfe1`이에요.
- 마지막 확인 시각: **2026-11-17T12:12:25Z (21:12:25 +0900)**
- 결론: **시계 의존 실패예요. T-220 회귀가 아니에요.**
  - 시험은 날짜를 "2026-11-17 12:00 UTC"로 박아 둔 가짜 시계를 써요.
  - 제품 내보내기 요청은 실제 시계로 시각을 적어요.
  - 실제 시각이 그 고정 시각을 넘자(오늘 21:00 KST 이후) 두 시계가 어긋나 실패해요.
  - 같은 문제를 T-204(`1c36974`)가 t162·t166에서는 고쳤지만, t164에는 적용되지 않았어요.

## 실패 정보
- 파일: `tests/t164-export-ui.test.ts` (마지막 변경 `3dadf45`, 2026-11-17 09:07 +0900)
- 실패한 시험 이름
  1. `T164 actual fake-DB preview to export UI > actual missing source blocks both create and failed-row recreate with a useful reason`
     - 기대: 화면에 "저장할 때와 달라요"
     - 실제: 화면에 해당 문구가 없고, 방금 요청한 내보내기 행이 `대기 중 · 2026. 11. 17. 오후 9:06:16`으로 남아 있었어요.
  2. `… > actual stored ZIP history remains distinct from current preview and existence is not fresh integrity`
     - 기대: `{status:"succeeded", available:true}`
     - 실제: `expected { …(16) } to match object { Object (status, available) }` (같은 이유로 작업이 실행되지 않음)
- 명령
  - 전체: `npx vitest run` → `Tests 2 failed | 1352 passed | 84 skipped (1438)`
  - 단독: `npx vitest run tests/t164-export-ui.test.ts` → `Tests 2 failed | 5 passed (7)`
  - 단독 실행에서도 실패하므로 **실행 순서 문제는 아니에요.**
- 환경: Windows, node v26.13.0, vitest 5.1.0. 진단 시점 실제 UTC는 12:10~12:12였어요.

## 원인(코드 근거)
- `lib/services/exports.ts:136` `request`: 새 작업의 `nextRunAt`을 `new Date().toISOString()`, 즉 **실제 시계**로 적어요.
- `lib/services/jobs.ts:53` `claim`: `row.nextRunAt <= stamp()`일 때만 작업을 가져가요. 이 `stamp()`는 **주입한 now**를 써요.
- 시험(t164 24행) 쪽 흐름
  1. `time = Date.parse("2026-11-17T12:00:00Z")`
  2. `runNextJob(handle, { now: () => time, … })`
  3. 실제 시각이 12:00Z를 넘으면 `nextRunAt`(실제 12:06Z 등)이 가짜 now(12:00Z)보다 늦어요.
  4. 그래서 작업이 "아직 실행할 때가 아님"으로 남고, 실행기가 `false`를 반환해요. 두 시험 모두 작업 결과(실패 행·성공 행)가 없어 실패해요.
- 같은 파일의 나머지 5건은 작업 실행에 의존하지 않아 통과해요.

## 대조(격리 사본, 증거)
- 사본 위치: `tmp/t222/{371d5cc,661cfe1}`(`git archive`, node_modules는 상위 경로 해석). 확인 뒤 지웠어요.
- 시계 조정
  - 프로세스 안 `Date`만 `T222_NOW`로 옮기는 진단용 shim을 `NODE_OPTIONS=--import`로 넣었어요(`--pool=forks`).
  - OS 시계, 제품 코드, 시험 기대값, fixture는 바꾸지 않았어요.
  - 시험 안의 고정 `time`은 문자열 `Date.parse`라 shim의 영향을 받지 않아요.

| 사본 | 실제 시각(12:11Z) | 11:00Z로 조정 | 12:30Z로 조정 |
|---|---|---|---|
| 371d5cc(T-220 고정) | `2 failed \| 5 passed (7)` | **`7 passed (7)`** | `2 failed \| 5 passed (7)` |
| 661cfe1(T-220 이전 부모) | `2 failed \| 5 passed (7)` | **`7 passed (7)`** | `2 failed \| 5 passed (7)` |

- T-220 전후 결과가 같고, 시각 경계(12:00Z)만으로 통과·실패가 갈려요.
- T-220이 바꾼 10개 파일(`git diff --stat 661cfe1 371d5cc`)은 세션·화면 경계 파일이에요. t164 import 경로(`ExportsPanel`·서비스·DB·백업)와 겹치지 않아요. 다만 비회귀 판단은 이 import 근거가 아니라 **위 대조 결과**에 둬요.
- 확인한 원인 후보
  - 순서: 단독 실행에서도 실패하므로 아니에요.
  - fixture(S9): 11:00Z로 옮기면 7건 모두 통과하므로 아니에요.
  - 새 메뉴 link(T-219): `ExportsPanel`과 관계없고, 661cfe1에서도 같으므로 아니에요.
  - 기존 export 계약: 바뀌지 않았어요. 시계 축만 어긋났어요.

## 같은 유형 점검
- `tests/t162-audio-bundle.test.ts`, `tests/t166-late-source-change.test.ts`(고정 10:00Z)는 T-204에서 이미 고쳐져 있어요. 371d5cc 사본에서 `backup-service.test.ts`와 함께 `Tests 35 passed (35)`였어요.
  - T-204 방식: `vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(time-1000);`
  - Date만 가짜로 두고 타이머는 실제 그대로 둬요. 그러면 제품의 `new Date()`가 고정 시각 1초 전이 되어 claim 조건을 만족해요.
- t164만 이 처리가 빠져 있어요.

## 최소 수정안(제안만, 적용하지 않음)
- **시험만 고쳐요**(`tests/t164-export-ui.test.ts`). 기대값·fixture는 그대로 둬요.
  - `beforeEach`의 `time=…` 다음에 `vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(time-1000);`을 넣어요.
  - `afterEach`에 `vi.useRealTimers();`를 넣어요.
- 제품 쪽 대안: `exportService`에 now를 주입해 claim과 같은 시계를 쓰게 하는 방법도 있어요. 다만 export 계약·서비스 범위가 바뀌므로 이번 최소안은 시험 쪽이 맞다고 봐요. 결정은 Master에게 맡겨요.
- 검증 범위
  - t164 단독을 실제 시각, 12:00Z 이전, 12:00Z 이후 세 경우로 돌려 모두 `7 passed (7)`인지 봐요.
  - t162·t166·backup-service 회귀를 함께 봐요.
  - 전체 suite는 한 번만 돌려요.

## 범위·보호
- 제품, 시험 기대값, fixture, OS 시계 변경은 없어요. 3013, 공유 .next, 실제 DB, managed, 배포, B15는 건드리지 않았어요.
- T-220 경로3 첫 실행의 문서 이동 원인은 이번 작업 범위가 아니에요. 계속 **미확인**으로 둬요.
