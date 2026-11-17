# T-175 렌더 진행 칸 "시도 0" 표시 수정 (T126 C3)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_8d37243f58f8 · 기준 HEAD `3321c70`
- 바꾼 파일
  - `components/render-panel/copy.ts`: `attemptLine` 추가
  - `components/render-panel/render-panel.tsx`: 진행 칸 한 줄과 import
  - 새 `tests/t175-attempt-line.test.ts`
  - 이 보고서
- 바꾸지 않은 것: 서버 재시도 규칙, `jobs.attempts`, API·DTO, DB, 다른 화면
- 상태: 자체 검수

## 원인
- 진행 칸이 `시도 {Math.max(render.attempt,1)}/{max}`로 표시했어요.
- 서버의 `attempt`는 **이미 시작한 시도 수**예요. 그래서 아직 한 번도 시작하지 않은 대기(0)가 "시도 1/3"으로 보였어요(T126 C3에서 실제 재현).
- 다시 기다리는 렌더도 문제였어요. 알약은 "다시 시작해요 · 2/3번째"인데, 줄은 "시도 1/3"이라 번호가 서로 달랐어요.

## 수정 (`attemptLine`)

| 서버 상태 | 전 | 후 |
|---|---|---|
| 대기, attempt 0 | 시도 1/3 | **아직 시작 전 · 최대 3번 시도** |
| 대기, attempt 1 (다시 기다림) | 시도 1/3 | **다음 시도 2/3**(알약과 같은 번호) |
| 만드는 중, attempt n | 시도 n/3 | 시도 n/3(그대로) |

실패 결과 줄 `n/3번 시도`와 오류 문구의 시도 횟수는 바꾸지 않았어요.

## 확인
- 새 시험 3개
  - attempt 0 대기: 화면에 "시도 n/3"가 없음. 처리기가 꺼진 대기도 포함
  - 다시 기다림: 알약과 같은 번호
  - 만드는 중: 번호 그대로
- 수정 전 코드로 대조 실행: 새 시험 3개 모두 실패했어요. 다만 **새 함수가 없어서 난 실패**라 행동 대조로 세지 않아요. 수정 전 화면의 "시도 1/3"은 T126이 실제 화면에서 재현한 증거로 대신해요.
- 관련 시험 통과: `t175-attempt-line`, `p2-4-render-panel`, `t147-render-audio-ui`, `p2-4-render-t120-jobs` (4파일 28개)
- `eslint components/render-panel tests/t175-attempt-line.test.ts --max-warnings 0` exit 0
- `tsc --noEmit --incremental false` exit 0
- **브라우저로 1280/390을 다시 렌더해 보지는 않았어요.** 같은 `muted` 문단 안의 짧은 문구 교체예요(가장 긴 문구는 "아직 시작 전 · 최대 3번 시도"). 전체 시험은 다시 돌리지 않았어요.
