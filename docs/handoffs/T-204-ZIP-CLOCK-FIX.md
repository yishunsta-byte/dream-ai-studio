# T-204 ZIP 시험 시계 일치 수정

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-203 진단 수용 후) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음

## 바뀐 것(시험 2파일만)
- `tests/t162-audio-bundle.test.ts`, `tests/t166-late-source-change.test.ts`
  - beforeEach: 고정 `time = Date.parse("2026-11-17T10:00:00Z")` 바로 뒤에 `vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(time-1000);`
    - 제품 request의 `new Date()`(nextRunAt)와 claim의 주입 `now`가 같은 시간축에 놓여요.
    - Date만 가짜예요. setInterval·setTimeout은 실제 그대로예요.
  - afterEach: **첫 줄**에 `vi.useRealTimers()`. 시험이 실패하거나 뒤 정리 코드가 던져도 먼저 실제 시계로 돌아가요.
- 바꾸지 않은 것: 제품 코드, 기대값, fixture, 검증 강도.

## 확인
| 확인 | 결과 |
|---|---|
| 두 파일(작업 폴더) | **14/14** |
| 격리 사본(기준 HEAD **c067d03** + 수정 2파일), 실제 시계 그대로 | 14/14 |
| 같은 사본에서 프로세스 시계를 하루 전·하루 뒤·1년 뒤로 옮김(`--require` 시계 이동, OS 시계 불변) | 세 경우 모두 **14/14** |
| 대조: 원본 시험 + 하루 뒤 | **13 실패 / 1 통과**(T-203 원인 재현, 시계 이동이 실제로 먹는다는 근거) |
| 대조: 원본 시험 + 하루 전 | 첫 실행 1 실패 / 13 통과, 다시 2번 실행하면 둘 다 14/14 → 일시적 실패. 원본은 10:00Z 전에는 통과한다는 T-203 결론과 일치 |
| 격리 전체 시험 | **82 파일 통과·6 skip / 1177 통과·0 실패·53 skip**, exit 0 |
| 격리 `tsc --noEmit` / `eslint .` | exit 0 / exit 0 |
- 그 뒤 HEAD는 31be66b가 됐어요(T201 검수 기록 문서만). 작업 폴더에서 두 파일을 다시 돌려 14/14였어요.
- 사본은 삭제했어요. Backend B5 진행 파일, 공유 .next, 3013은 건드리지 않았어요.
