# Dream AI Studio 상시 하네스 운영

공통 규칙은 [AGENTS.md](../AGENTS.md), 책임은 [Master 역할](roles/MASTER.md), 제품 상태는 [마스터 개발 플랜](../docs/MASTER_DEVELOPMENT_PLAN.md), 실제 역할과 터미널은 [팀 연락표](../docs/TEAM.md)에 있다. 정책·설계는 [Runner 요구사항](RUNNER_REQUIREMENTS.md), 시험 항목은 [시나리오](SCENARIO_ACCEPTANCE.md)를 사용한다.

## 연결과 저장 위치

| 항목 | 실제 경로와 상태 |
| --- | --- |
| CONTROL_ROOT | `D:/starwork/dream-ai-studio/tmp/master-harness`. Git에서 제외한다. 이 호스트만 중앙 기록을 쓴다. |
| 실행기 | `scripts/harness-controller.mjs`. SQLite의 단일 프로세스 잠금, 로컬 입력 감시, 5초 생존 신호, 승인된 다음 배정 전송, 파일 상태 투영을 제공한다. |
| 자동 시작 | Windows 작업 스케줄러의 `DreamAIStudio-Harness-Controller`. 현재 사용자의 로그인 세션에서 숨김 실행하고 재시작 정책과 5분 생존 재실행 트리거를 둔다. |
| Orca | 기존 run `run_a3e2ad32d55d`의 메시지와 wake를 사용한다. Orca 수신은 지정된 알림에서 `master-harness.mjs wake`, 이전 기록 복구는 `resume`을 실행한다. 로컬 Controller가 Orca 편지함을 주기적으로 소모하지 않는다. 기존 30분 점검 알림은 기존 대화로 온다. |
| 재개·중지 | Controller는 SQLite에서 재개한다. 관리자 pause 지시는 새 배정을 잠근다. 이미 전달된 작업은 Master가 각 세션에 알리고 수신과 실제 중지를 확인한다. 감독 Dispatch의 실제 중지에는 Orca `worker-stop`을 사용한다. |
| 지원 범위 | 현재 팀 연락표의 Orca 직접 연결 세션에 배정할 수 있다. 별도 AGY 실행기와 새 장비 연결은 미확인이다. 디자인·구조·보안 검수는 실제 연결된 역할 중 범위에 맞는 담당을 배정하며, 검수자는 구현 담당과 분리한다. |

작업·배정·검수·요청·전체 점검 시각은 `controller.sqlite`가 기준이다. 팀 연락표는 실제 역할과 주소를, 마스터 플랜은 목표·우선순위 및 판단 요약을 유지한다. `STATE.json`, `STATUS.md`, `HUMAN_REQUESTS.json`은 읽기용 최신 상태, `events.jsonl`과 `master.log`는 사건과 사람이 읽는 누적 기록이다. 기존 Orca 커서는 같은 CONTROL_ROOT의 run SQLite에 보존된다. 업무 결과 원문과 비용이 드는 작업은 각 역할의 보호된 위치에서 관리한다.

## 작업과 지시 접수

1. 직접 작업이나 Orca 보고를 검토한다. 마스터 플랜에 변경과 검수 근거, 작업 ID와 증거 ID를 넣고 `python scripts/sync-master-plan.py`로 HTML을 갱신한다.
2. `node scripts/harness-controller.mjs submit <JSON 파일>`로 구조화 이벤트를 넣는다. `status`로 실제 처리 상태를 읽는다. 같은 이벤트 ID는 한 번만 반영된다.
3. 신규 배정은 `queue`만 사용한다. 이미 전달된 배정과 팀 공통 기준에 따른 독립 착수는 `observe`와 기존 Orca 영수증으로 등록한다. 같은 유효 배정의 READY 또는 SEND_UNCERTAIN에 일치하는 영수증을 넣으면 새 전송 없이 대조한다. 현재 점유나 내용이 겹치면 Controller에 OBSERVATION_CONFLICT를 남기며 Master가 해당 세션과 정리한다. `assign`은 Controller의 전송 어댑터다. 실행·검수·통합은 `state`, 관리자 지시는 `command`를 사용한다. 진행 중 배정의 범위만 바뀌면 앞서 적용한 배정을 복사해 `amend`로 접수하고, 같은 시도와 더 높은 배정 버전 및 실제 변경 전송 영수증을 기록한다. `submit`의 성공은 접수를 뜻한다. SQLite와 상태에서 전송·검수 판정을 각각 확인한다.
4. 직접 연결 세션의 결과는 Orca `status` 및 고유 인계 파일로 제출한다. 해당 보고를 검토한 Master가 `state`로 기록한다. 구현 보고, 독립 검수, 최종 대상 검증, Master 완료 판정을 구분한다.

배정 예시

```json
{
  "id": "example-queue-1",
  "kind": "queue",
  "task": "TASK-ID",
  "attempt": "attempt-1",
  "assignment": 1,
  "planRevision": "plan-20261122",
  "marker": "unique-plan-evidence-id",
  "role": "등록된 구현 담당",
  "recipient": "term_실제_터미널_ID",
  "workspace": "D:/existing-verified-worktree",
  "allowedPaths": ["components/example.tsx"],
  "baseCommit": "실제 40자리 커밋 SHA",
  "dependencies": [],
  "acceptance": ["실행 가능한 합격 기준"],
  "reviewer": "등록된 독립 검수자",
  "reportPath": "docs/handoffs/TASK-ID.md",
  "summary": "승인된 수정 범위와 다음 행동"
}
```

`state`는 `id, task, attempt, assignment, marker, actor, state, check, summary, evidence`를 쓴다. READY 다음은 전송 영수증이 있는 QUEUED다. 역할이 수락하면 RUNNING, 구현을 제출하면 REVIEW, 지정된 검수자 PASS로 VERIFIED, 통합 대상 PASS로 INTEGRATED, Master 판정으로 DONE이다. 전송이 미확정이면 Orca의 실제 영수증을 확인하기 전 같은 시도를 재전송하지 않는다. 기준이 바뀐 작업에는 높은 배정 버전과 새 시도를 쓴다.

`command`는 `id`(CMD-YYYYMMDD-NNN), `action`(record/pause/resume), `source, summary, impact, marker`를 쓴다. 중지는 사건에 먼저 적용하며 후속 플랜에 반영한다. 재개와 일반 기록은 플랜·HTML의 근거가 필요하다. 관리자 지시는 실제 사용자 채널에서 받은 내용을 Master가 등록한다. 로컬 입력 폴더는 이 Windows 계정의 신뢰 범위다. 같은 계정의 프로젝트 작성자에게 시스템 수준의 접근 통제를 제공하지 않는다.

`request`는 `id, request, task, marker, category, summary, scope, prepared, recommendation, procedure, verification, resume`으로 접수한다. `category`는 DECISION, AUTHORIZATION, MANUAL_ACTION 중 하나다. 같은 요청 ID는 한 번만 열린다. 실제 관리자 답변을 CMD로 먼저 기록하고, `answer`에 `id, request, marker, command, summary, evidence`를 넣는다. 답변 상태는 REPORTED가 기본이다. 증거가 맞으면 VERIFIED, 명시 거절은 REJECTED, 보류는 DEFERRED로 처리한다. REPORTED와 DEFERRED는 요청 목록에 남는다. 증거 확인 후 해당 작업만 별도로 재개한다. 이전 ANSWERED 이력은 보존한다.

전체 점검이 끝나면 `inspection` 사건에 `id, kind, marker, completedAt, summary, evidence`를 제출한다. `completedAt`은 실제 완료 시각의 ISO 문자열이다. `status.lastInspection`은 이 사건으로만 갱신한다. `resume.lastMessageHandledAt`은 마지막 Orca 보고 판정 시각이다.

## 상태 확인과 복구

- `node scripts/harness-controller.mjs status`로 상태, PID, 생존 신호, 관리자 CMD, 다음 행동을 확인한다. 정기 점검에서는 `node scripts/master-harness.mjs resume`의 대조 증거도 확인한다.
- 운영 명령 없이 시험하려면 `node scripts/test-harness-controller.mjs`를 실행한다. 임시 CONTROL_ROOT와 대역 전송에서 중지·재개, 중복·충돌 영수증, 직접 전송 차단, 플랜 확인, 독립 검수, 실제 점검 시각, 요청 확인, 재시작과 의존 작업 호출을 확인한다.
- 사용자가 등록된 작업 전체를 멈추면 Master가 지시를 기록하고 영향받는 세션을 실제 채널에서 안전 지점에 멈춘다. Windows 프로세스 자체를 내려도 다음 예약 트리거에서 재시작하므로 실행기 자체 종료가 필요한 경우 Windows 예약을 먼저 비활성화한다.
- PC 전원·절전, Windows 로그인과 Orca 세션 상태에 따라 작업 전송이 제한된다. 오류는 상태 파일과 사건 로그에 남기고 Master가 버전·영수증을 대조한다.
