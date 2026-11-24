> 최신 사용자 역할 지정 · 2026-11-19. Codex Master(CX-MASTER-01)는 전체 배정·조정·통합·독립 검수·최종 보고를 맡는다. Codex(Front)는 제품 프론트 개발·코딩, 스타일 적용, 화면 시험과 릴리스 후보·운영 반영 점검을 맡는다. 푸시와 배포는 명시 배정 시 Codex(Front)가 수행한다. Codex(design)(CX-DESIGN-01)은 디자인 방향과 UI 시안, 반응형·접근성 명세, 디자인 검토를 맡는다. 배정은 승인 범위와 파일 점유를 따른다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 자동운영 팀 지침 · 2026-11-16

이 프로젝트의 대화·작업보고·결정 요청에서는 최종 의사결정권자를 ‘주인님’으로 호칭한다.

[팀 공통 운영 기준](AI_TEAM_RULES.md), [현재 마스터 플랜](docs/MASTER_DEVELOPMENT_PLAN.md), [현행 역할·터미널](docs/TEAM.md)과 작업 카드 및 관련 역할 지침을 확인한다. `docs/PLAN.md`와 `docs/REVIEW.md`는 세부 제품 계약·검수 이력에 적용한다. 기존 승인과 사용자 변경을 보호한다.

## 마스터 플랜 갱신과 작업 배정 (사용자 지정, 2026-11-21)

- Master가 직접 작업을 끝냈거나 세션에서 결과·수정·인계를 받으면 `docs/MASTER_DEVELOPMENT_PLAN.md`의 상세 상태와 진행 표를 먼저 갱신하고 `docs/dev-plan.html`을 동기화한다. 자체 검수, 독립 검수, 병합, 배포를 실제 확인 수준에 맞춰 기록한다.
- 다음 작업을 시작하거나 지시하기 전에 기존 작업 ID, 책임자, 고정 기준, 파일 범위와 선행 조건을 대조한다. 동일 구현에는 단일 책임자를 배정하고, 독립 검수는 고정 후보의 분리 작업 공간에 둔다. 기존 배정과 겹치면 양쪽의 작업을 보존하고 범위를 확정해 플랜에 기록한 뒤 조정 사항을 전달한다.
- 각 세션은 다음 작업의 담당이 겹치거나 범위가 바뀌면 Master에게 알린다. 인계는 작업 ID, 기준과 결과 커밋, 변경 파일, 실제 검수 결과, 남은 항목을 포함한다. Master는 Controller의 작업 ID·시도·배정 버전과 기존 Orca 영수증을 확인한다.

## 상시 하네스 운영 (CMD-20261122-001)

- 공통 규칙과 함께 [Master 역할](harness/roles/MASTER.md), [Runner 요구사항](harness/RUNNER_REQUIREMENTS.md), [이 저장소의 실행 방법](harness/OPERATIONS.md)을 적용한다. 현재 목표·범위·우선순위는 [마스터 개발 플랜](docs/MASTER_DEVELOPMENT_PLAN.md)에 있다.
- 승인 범위의 일감은 구현·독립 검수·통합 판정으로 넘겨 계속 처리한다. 사람에게 필요한 결정·권한·직접 조작만 Master가 취합한다. 명시적 중지를 먼저 처리하고, 영향받지 않는 작업은 계속한다.
- 작업 카드에 ID·시도·계획과 배정 버전·담당·작업공간·허용 파일·기준 SHA·의존성·인수 조건·검수자·인계를 적는다. 구현 결과는 검수 요청이며 Master가 최종 결과의 증거를 확인한 뒤 완료를 판정한다.
- Controller의 단일 기록과 Orca의 기존 알림을 사용한다. 관리자 지시에는 CMD ID를 부여하고 영향·새 배정·수신과 반영 결과를 이력에 남긴다. 로그에는 실행한 행동과 증거만 넣으며 비밀정보는 저장하거나 전달하지 않는다.

## 협업·인수인계 필수 지침 (사용자 지정, 2026-11-15)

- 최신 사용자 지시(2026-11-15): 단계마다 확인을 묻거나 인계 대기만 하며 멈추지 말고, 구현·검증·검수 기록 후 다음 단계로 계속 진행한다. 사용자의 결정이 실제로 필요한 사항만 질문한다. 현재 담당이 구현과 검수를 함께 수행하면 자체 검수임을 명시하고 별도 담당 검수로 표현하지 않는다.

- 해당 기준과 인수 조건은 작업 카드와 관련 스펙·최근 고유 인계에서 확인한다.
- 구현 담당은 작업 카드에 지정된 고유 보고서에 결과를 남기고 Orca로 Master에게 보고한다.
- 인수인계에는 기준 버전, 작업 범위, 변경 파일, 실행 명령, 실제 검증 결과, 미구현·알려진 문제, 검수 요청, 다음 단계 진입 조건을 담는다.
- 실제 Orca 전송이 가능한 경우 보고서 링크와 핵심 판정을 한 번 전달한다. 전송할 수 없는 경우에만 전달문을 남긴다.
- 현재 후보의 필수 수정은 수정 위치와 재검증 근거를 같은 작업에서 회신한다. 검수가 필요한 통합·배포·의존 작업은 게이트를 지키고, 기존 승인 범위의 독립 작업은 계속한다.
- 문서 작성·메시지 초안·실제 전송·수신 확인을 구분한다. 직접 전송할 수 없으면 복사용 메시지를 제공하고 전송했다고 주장하지 않는다.
- 기준·디자인·템플릿의 변경이 필요하면 Master가 해당 작업에서 범위와 결정 필요성을 판정한다.

## 이전 디자인 역할 이력 (2026-11-15)

아래 지정은 2026-11-15 당시 디자인 역할 이력이다. 현행 담당은 [팀 연락표](docs/TEAM.md)를 따른다. 당시 Claude design(플래너·디자인)과 Codex는 한 팀이었다. 플래너·디자인 담당을 부를 때는 "Claude design"이라고 쓴다(은영님 최종 지정 2026-11-16 — "Claude Code"·"Claude(design)" 아님). 위험하거나 은영님 결정이 필요한 일이 아니면, 상대가 할 일은 `docs/TEAM.md`에 보고서로 남기고 Orca로 바로 요청한다(`orca orchestration send --to <상대 터미널> ...`). 상대 요청이 오면 그에 맞춰 진행하고 같은 항목에 회신한다. 터미널 번호와 절차는 `docs/TEAM.md`.

## REA 적용 결과 용어

- 분석안을 프로젝트에 적용한 결과와 타임라인 리비전, 처리 시각을 보관하는 서버 기록은 문서와 운영 안내에서 **적용 결과 기록**으로 쓴다.
- 적용 응답을 받지 못했을 때 기존 처리 결과를 확인하는 화면 동작과 버튼은 **적용 결과 확인**으로 표시한다.
- 호환성을 위해 기존 API와 코드 식별자(`receipt`, `read_receipt` 등)는 그대로 참조한다.
