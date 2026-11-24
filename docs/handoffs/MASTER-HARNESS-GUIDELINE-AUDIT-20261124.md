# Dream AI Studio 지침 정합성 점검

2026-11-24 · 작성 Codex Master · 작업 MASTER-HARNESS-GUIDELINE-AUDIT-20261124

## 판정

가장 먼저 정리할 규칙은 문서 우선순위, 완료 뒤 자율 착수의 범위, 배정과 상태의 공식 기록 위치다. 같은 보고를 여러 곳에 수동 입력하는 규칙과 기존 직접 전송 경로는 중복 배정 위험을 높인다. 작업 상태와 관리자 요청의 문서 용어도 실행기가 실제로 구분하는 상태와 일치시켜야 한다.

저장소 루트의 진입 지침 3개, 하네스 문서 5개, 역할 지침 5개, 마스터 개발 플랜, PLAN, TEAM, REVIEW, REMAINING_WORK의 적용 범위를 대조했다. 실행기·Orca 수신 도우미·격리 시험도 확인했다. 숨어 있는 상위 저장소 지침과 추가 하위 AGENTS.md는 이 작업공간의 검색 대상에서 발견되지 않았다. 오래된 작업 이력에 기록된 당시 판정은 보존한다.

## 비교

| 우선 | 유형 | 비교와 영향 | 개선 제안 |
| --- | --- | --- | --- |
| 즉시 | 기준 충돌 | PLAN 상단은 현재 운영·역할·배정을 마스터 개발 플랜으로 넘겼지만 바로 아래에서 자신이 대화보다 우선한다고 쓴다. CLAUDE는 PLAN을 최상위로 둔다. 새 지시 반영이 늦고 레거시 범위를 다시 활성화할 수 있다. [PLAN](../PLAN.md#L3) · [CLAUDE](../../CLAUDE.md#L9) | 적용 가능한 상위 지침·권한 → 주인님 최신 명시 지시 → 해당 작업의 최신 배정 → 마스터 플랜의 현재 범위로 판단한다. PLAN은 현행 지시와 양립하는 세부 계약 및 승인 이력의 참조로 연결한다. |
| 즉시 | 자율 착수 충돌 | Master 규칙은 READY 작업을 배정하라고 하고, Design과 Tester는 기존 배정이 비었을 때 알리고 착수한다. Backend 지침은 다음 배정을 요청하고 기다린다. 11월 24일 실제로 Front·Backend·Master가 모두 관리형 통합의 일부를 골랐다. 사후 범위를 나눴고 소스 중복 수정은 관측되지 않았지만, 구현까지 같은 방식이면 충돌 여지가 있다. [Master](../../harness/roles/MASTER.md#L22) · [Design](../team/CODEX_DESIGN.md#L21) · [Tester](../team/CODEX_TESTER.md#L16) · [Backend](../team/CODEX_BACKEND.md#L5) | 배정이 비면 같은 담당 분야의 독립 읽기·검수 준비는 작업 ID·기준·사본을 알리고 바로 시작한다. 제품 쓰기와 통합은 현재 배정이나 미리 승인된 카드의 단일 소유권을 확보한 뒤 시작한다. 선행 결과를 기다리는 동안 독립 작업을 계속한다. |
| 즉시 | 역할 충돌 | CLAUDE 상단은 Codex design을 현행으로 지정하지만 본문은 Claude design을 다시 플래너로 배정한다. Master 역할은 Architect/AGY를 직접 지정하고 팀 공통 지침은 Antigravity 미연결을 명시한다. TEAM 최신 절의 Claude(Tester)와 오래된 기술 역할 표시도 함께 보인다. [CLAUDE](../../CLAUDE.md#L17) · [공통 역할](../../AI_TEAM_RULES.md#L23) · [Master](../../harness/roles/MASTER.md#L14) · [TEAM](../TEAM.md#L33) | 역할명·실제 세션·접속 확인 시각은 TEAM 상단 현행 표 한 곳에서 조회한다. Architect/AGY는 필요한 기능의 역할명으로 두고 실제 활성 역할에 배정한다. 현재 설계·코딩·검수·통합 책임과 이전 역할 이력을 분리해서 읽을 수 있게 한다. |
| 즉시 | 기록 중복·작성권 충돌 | 구 공통 규칙은 TEAM을 공식 상태로 두고 PROGRESS·REVIEW·QUESTIONS를 단계마다 쓰게 한다. AGENTS는 마스터 플랜과 HTML을 먼저 동기화한다. 하네스 운영 문서는 Controller SQLite를 기준으로 둔다. 작업자에게 공유 PROGRESS/REVIEW 쓰기를 요구하는 조항은 고유 결과 파일 원칙과도 충돌한다. [공통 기록](../../AI_TEAM_RULES.md#L139) · [AGENTS](../../AGENTS.md#L19) · [CLAUDE](../../CLAUDE.md#L23) · [운영](../../harness/OPERATIONS.md#L16) | 작업 상태와 이벤트는 Controller, 목표·우선순위·상태 해설은 Master 플랜, 세션 주소는 TEAM, 원본 증거는 작업별 인계 하나로 고정한다. HTML과 상태 파일은 파생본으로 둔다. PROGRESS/REVIEW의 과거 기록은 유지하고 새 증거는 작업 단위 링크로 잇는다. |
| 즉시 | 전달 경로 중복 | Master 역할 문서는 신규 배정을 직접 assign으로 보내라고 하고 하네스 운영서는 Controller queue를 사용한다. 두 경로의 중복 방지 기록은 서로 다르다. 같은 일을 각각 넣는 경우 전체 시스템에서 한 번만 전송된다는 증거가 없다. [Master 체크포인트](../team/CODEX_MASTER.md#L20) · [운영](../../harness/OPERATIONS.md#L18) · [수신 도우미](../../scripts/master-harness.mjs#L96) | 신규 공식 배정은 queue 한 경로로 보낸다. 이미 전달된 작업은 기존 영수증으로 observe한다. 직접 전송은 범위 상담이나 긴급 중지 등 상태 알림에 쓰고, 실제 발송·수락·착수는 별도 상태로 남긴다. 미확정 발송은 영수증 확인 뒤 조치한다. |
| 즉시 | 진행·완료 충돌 | AGENTS는 검수 통과 전 다음 마일스톤 금지, PLAN 후속 지시와 CLAUDE는 자체 검수 뒤 연속 진행을 규정한다. PLAN v2.4의 P0~P1 범위와 과거 P2 금지도 현행 관리형 P2 의제와 섞여 있다. [AGENTS](../../AGENTS.md#L32) · [CLAUDE](../../CLAUDE.md#L23) · [PLAN](../PLAN.md#L668) · [REVIEW](../REVIEW.md#L37) | 의존하는 후속 마일스톤·통합·운영 반영에만 필요한 게이트를 적용한다. 다른 승인 작업은 계속한다. 자체 검수 완료는 REVIEW, 독립 통과는 VERIFIED, 최종 대상 통과 뒤 DONE으로 고정하고 해당 P1 승인의 실제 범위를 유지한다. |
| 높음 | 문서·런타임 상태 불일치 | 공통 규칙은 ready_review, 프로토콜은 REWORK·INTEGRATING·CANCELED, Controller는 REVIEW·FAILED·INTEGRATED·CANCELLED를 기록한다. 전송 전후와 서비스 전체 상태도 한 축에 섞여 읽힌다. Controller는 현재 BLOCKED가 하나라도 있으면 사람 대기 산정에 넣는다. [공통 상태](../../AI_TEAM_RULES.md#L135) · [프로토콜](../../harness/PROTOCOL.md#L3) · [실행기 상태](../../scripts/harness-controller.mjs#L17) · [서비스 상태](../../scripts/harness-controller.mjs#L326) | 실제 작업 상태, 전송 상태, 서비스 상태, 차단 사유를 각각 명시한다. 문서에는 실행기가 받아들이는 이름과 지원 범위를 적고, 차단 이유를 HUMAN·DEPENDENCY·ENVIRONMENT로 구조화한 뒤 사람 대기 집계를 연결한다. 과거 표기는 매핑을 남긴다. |
| 높음 | 격리 작업과 점유 기준 차이 | 공통 규칙은 격리 사본 작업을 허용한다. Controller는 경로가 같은 경우 작업공간이 달라도 보수적으로 직렬화한다. 기존 작업 등록 observe에는 자동 전송과 같은 점유 검사 단계가 없다. 운영 파일 충돌 예측과 독립 검수 사본의 쓰기 충돌을 구별할 필요가 있다. [공통 파일 규칙](../../AI_TEAM_RULES.md#L109) · [Runner](../../harness/RUNNER_REQUIREMENTS.md#L26) · [observe 처리](../../scripts/harness-controller.mjs#L249) · [점유 검사](../../scripts/harness-controller.mjs#L308) | 현행 직렬화를 문서화한다. 향후 작업공간·쓰기 경로의 실제 점유와 같은 파일을 장차 통합할 때의 병합 충돌을 구분한다. observe도 기존 배정·공유 파일·수신 세션을 대조하고 충돌이면 관측 사건만 기록해 Master가 조정한다. |
| 높음 | 요청·중지 상태 차이 | 프로토콜은 승인·거절·보류와 직접 조치 검증을 구분한다. 현재 구현은 OPEN·ANSWERED를 중심으로 기록하며, pause는 신규 전송을 멈추고 실행 중 작업의 중지는 Master가 실제 세션에서 확인한다. 답변 수신만으로 요청이 상태표에서 빠질 수 있다. [프로토콜](../../harness/PROTOCOL.md#L29) · [운영](../../harness/OPERATIONS.md#L13) · [요청 처리](../../scripts/harness-controller.mjs#L220) | 답변 수신과 허가 판정, 실제 조치 검증과 종료를 따로 기록한다. 거절·보류·로그인 대기가 같은 취급을 받지 않게 하고, 중지는 발송 중단·작업자 수신·실제 정지 확인을 별도로 표시한다. |
| 높음 | 점검 시각 의미 중복 | 터미널의 5분 실제 점검과 턴 밖 30분 알림은 양립한다. 다만 수신 도우미는 일반 메시지를 done 처리할 때도 lastInspection을 바꾼다. 단일 보고의 처리 시각을 전체 점검 시각으로 표시할 수 있다. [공통 점검](../../AI_TEAM_RULES.md#L55) · [Master 체크포인트](../team/CODEX_MASTER.md#L20) · [수신 도우미](../../scripts/master-harness.mjs#L67) | lastMessageHandledAt과 lastInspectionAt을 분리한다. 전체 점검을 실제로 완료한 사건에서만 후자를 바꾼다. 5분 점검 범위와 30분 알림의 전송·수신·완료를 각각 남기고 상시 폴링을 추가하지 않는다. |
| 보통 | 검수·화면 규칙의 과잉 적용 | CLAUDE의 build·lint·typecheck·test 및 고정 화면 폭, Design의 늘 3안 제출은 전체 마일스톤·신규 디자인 선택에 유용하다. 고정 원본 복원·작은 버그·문서 검토까지 적용하면 요청 범위를 넓힌다. 공통 검증은 영향별 시험을 허용하며 루프백 검수는 더 구체적 조건이 있다. [CLAUDE](../../CLAUDE.md#L23) · [Design](../team/CODEX_DESIGN.md#L14) · [공통 검증](../../AI_TEAM_RULES.md#L123) · [Runner 격리](../../harness/RUNNER_REQUIREMENTS.md#L66) | 신규 방향 선택·설계 변경의 3안 기준과 기존 화면 유지·원본 복원의 비교 QA를 구분한다. 인수 조건에 실제 필요한 폭과 검증 종류를 적고, 격리 미충족 시험에는 PASS 범위를 좁혀 기록한다. |
| 보통 | 반복 규칙과 추적 위치 | 주인님 호칭, 승인 반복 금지, 고유 인계, 범위 보호, 증거 보고는 여러 파일에 반복되지만 행동은 대체로 같다. 반면 CAPABILITIES라는 경로는 Master 지침에서만 지칭되며 실제 연결 목록은 OPERATIONS와 TEAM에 있다. [AGENTS](../../AGENTS.md#L13) · [공통](../../AI_TEAM_RULES.md#L12) · [Master](../../harness/roles/MASTER.md#L6) · [운영 연결](../../harness/OPERATIONS.md#L5) | 동일 문구는 AI_TEAM_RULES를 기준으로 링크한다. 실행기 실제 지원 현황은 OPERATIONS 연결 표와 TEAM을 가리킨다. 실행기 설계 목표·현재 지원·미연결을 구분해 새 파일을 중복 운영하지 않는다. |

## 적용 순서 제안

1. 문서 우선순위, 현재 역할, 다음 작업 자율 착수, 단일 배정 경로를 먼저 맞춘다. 수신 기록과 기승인 범위는 보존한다.
2. 기준 상태와 역할별 보고 방식이 가리키는 한 곳을 정한다. 통합·배포·운영 인증은 최신 고정 후보와 기존 권한 조건으로 별도 판단한다.
3. 구현 차이는 작은 후속 작업으로 나눈다. 신규 배정과 기존 보고가 동일하면 재전송이 없는지, 같은 파일 담당이 겹치면 한 명만 쓸 수 있는지, 독립 작업은 계속되는지, 미검증 관리자 조치가 완료로 사라지지 않는지, 단일 메시지 처리로 전체 점검 시각이 바뀌지 않는지를 인수 조건으로 삼는다.

## 확인한 실행 범위

- `node scripts/test-harness-controller.mjs` 종료 0. 임시 CONTROL_ROOT와 대역 전송에서 lease, pause/resume, 플랜 근거 확인, 중복 차단, 판정, 재시작, 후속 배정, 요청 묶음, 비밀 가림, 같은 터미널 직렬화를 확인했다.
- Windows 예약 두 건의 등록 상태는 Ready로 조회됐다. 실제 점검 시각은 Controller 생존 신호와 Orca 수신 후의 Master 판정 기록을 별도로 봤다.
- 제안 단계에서 운영 지침 파일과 실행기는 편집하지 않았다. 진행 현황에는 조사 완료와 제안 문서 위치를 연결했다.
