# T180 A1 · 자동 갱신 복구 수정

- 담당: Codex design / CX-DESIGN-01
- 배정: Master `msg_3584d12e1ded` A1 수정, `msg_e36e40f3b30b` 보고서 읽기, `msg_acfa1ad5e69f` 원지적 **polling복구**.
- 기준: `5b6f5fe` (A1 구현 `f38fb10` 포함), 2026-11-17 Asia/Seoul.
- 상태: ready_review · 구현자 자체 검증, 독립 검수 아님.

## 원인과 실제 재현

기존 A1은 자동 갱신과 위치 저장·복원 요청이 하나의 `error` state를 공유했다. 성공한 polling에서 특정 오류 문구만 지우는 처리를 넣었지만, 실패한 polling이 `setError(...)`로 **다른 작업의 실패를 덮는 문제**는 남았다. 수동 상태 새로고침도 `act()`의 공통 초기화 때문에 복원 실패와 안내를 지웠다. 수동 읽기 실패는 polling 전용 오류 문구와 달라 이후 자동 갱신 성공으로 해소되지 않았다.

실제 기존 `f38fb10`의 SettingsPanel을 가짜 응답으로 번들해 재현했다.

1. 위치 저장 PATCH 실패 → `위치 저장 실패 예시` alert 확인.
2. 다음 자동 GET 실패 → alert가 `백업 상태를 새로 읽지 못했어요…`로 바뀜.
3. 위치 저장 실패 내용이 사라짐(`mutationErrorLost: true`).

읽기 요청의 순서를 판별하지 않는 구조도 확인했다. 진행 중인 이전 polling보다 수동 읽기가 먼저 완료됐을 때, 늦은 polling의 결과/오류가 새 상태를 덮을 수 있었다. 2초 간격보다 응답이 느리면 같은 polling이 겹쳐 요청될 수도 있었다.

최초에는 앞 보고서의 nullable 추론 제한을 수정 대상으로 짚었으나, Master가 원지적을 polling복구로 특정해 바로 범위를 정정했다. 서비스 파일·nullable 타입·시험 단언은 변경하지 않았다. 앞 보고서에 있는 독립 번들의 `process` 누락과 검증 문구 “대기 중/대기” 차이는 검증 환경 문제이며 이번 제품 결함의 원인과 구분한다.

## 수정

제품 수정은 `components/settings-panel.tsx` 한 파일이다.

- 읽기 실패는 `readError`, 위치 저장·검사·복원 실패는 기존 `error`로 분리하고 각각의 안내를 표시한다. 읽기 경고에 복원 재시도 안내를 잘못 붙이지 않는다.
- 수동·자동 읽기 성공은 **읽기 오류만** 지운다. 저장·복원 실패와 보유 ticket은 유지한다. 수동 새로고침은 작업 메시지와 만료 검사 안내도 초기화하지 않는다.
- 두 읽기 경로가 같은 요청 순번을 사용한다. 가장 최근에 시작한 읽기의 응답만 snapshot과 readError를 갱신한다. 늦은 이전 성공·실패는 무시한다.
- 자동 읽기 하나가 진행 중이면 다음 polling tick에서는 추가 GET을 보내지 않는다. 사용자 수동 새로고침은 계속 가능하다.
- 실패 시 마지막 자료·관찰 시각·입력 초안 유지, 성공 시 자료와 시각을 함께 갱신하는 A1 계약은 보존한다. 백업 등록 성공 뒤 상태 읽기만 실패하면 등록 안내와 읽기 경고를 각각 유지한다.

## 검증

| 항목 | 결과 |
|---|---|
| 기존 버전 재현 | 위치 저장 오류가 polling 오류로 덮이는 현상 직접 확인 |
| 수정 버전 격리 브라우저 | **16개 확인 통과** |
| 저장 오류 + 읽기 오류 공존 | 1280/390에서 확인 |
| 자동 복구/수동 새로고침 | 읽기 오류만 해소, 저장 오류·초안 유지 |
| 수동 읽기 실패 → 자동 성공 | 읽기 오류 해소 |
| 지연된 이전 성공·실패 | 최신 상태·관찰 시각 보존 |
| 응답 대기 중 다음 polling | 추가 GET 없음(2초 주기 이상의 관찰 구간) |
| 복원 실패 + 읽기 실패 → 복구 | 복원 실패·동일 ticket·다시 확인 버튼 유지 |
| 수동 새로고침 후 복원 실패 | 실패·동일 ticket 유지 |
| 반응형 | 1280/390 가로 넘침0, 캡처 직접 확인 |
| 관련 자동 시험 | 기존 A1 7개 포함 **7파일·59개 통과** |
| 전체 lint / TypeScript / 공백 | 모두 exit0 |

[이전 재현 및 수정 후 확인 JSON](T-180-A1-POLLING-RECOVERY-AUDIT.json).

시험 명령: `node node_modules/vitest/vitest.mjs run tests/t180-a1-settings-data.test.ts tests/maintenance-routes.test.ts tests/startup.test.ts tests/startup-storage.test.ts tests/t177-button-reason.test.ts tests/backup-origin.test.ts tests/restore.test.ts`. 타입 검사 `node node_modules/typescript/bin/tsc --noEmit --incremental false`, lint `node node_modules/eslint/bin/eslint.js . --max-warnings 0`, `git diff --check`.

비동기 복구 검증은 Ego Browser TaskSpace4에서 실제 Panel·공통 UI를 esbuild로 묶고, fetch만 가짜 성공·실패·지연 응답으로 대체했다. `tmp/t180-a1/poll-build.mjs old`는 기존 f38fb10 소스를 별도 번들로 읽고, 기본 인수는 수정 소스를 사용했다. `poll-round-02.mjs`는 기존 실패 재현, `poll-round-03.mjs`는 수정 후16개 확인이다. 캡처 `tmp/t180-a1/poll-fixed-1280.png`, `poll-fixed-390.png`. 임시 번들·검증 도구는 커밋하지 않는다. 브라우저 공간과 검증 서버3184는 종료했다.

자동 시험59개는 기존 회귀이며 새 비동기16개는 별도 브라우저 검증이다. 이를 새 Vitest16개라고 합산하지 않는다. 실제 API/DB·실제 백업/복원·운영3013·공유 `.next`·production build·배포·실제 휴대폰/스크린리더는 실행하지 않았다. A2/A3나 전체 A1 독립 수용을 주장하지 않는다. 다른 세션의 새 배포 커밋과 기존 미추적 Master plan/T122/T137 문서를 보존했다.

복사용 전달 메시지: A1 원지적 polling복구를 수정했습니다. 기존 f38fb10에서 저장 오류가 다음 polling 실패에 덮이는 현상을 직접 재현했습니다. readError/작업오류 분리, 읽기 복구 시 해당 오류만 해소, 수동 새로고침 때 복원 실패·ticket 유지, 요청순번으로 이전 응답 무시, polling 중복 방지를 Panel 한 파일에 적용했습니다. 관련59 시험·전체lint·tsc·격리브라우저16 확인 통과. 서비스/DB/API/3013/공유.next/배포 변경 없음. 고유 보고서와 감사 JSON으로 반환합니다.
