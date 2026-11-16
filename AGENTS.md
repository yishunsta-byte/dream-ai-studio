> 최신 사용자 역할 지정 · 2026-11-17: Codex Master(CX-MASTER-01)가 모든 작업의 총괄 지휘자다. 작업 분해·배정·우선순위·충돌 조정·결과 회수·통합·테스트·독립 검수·최종 보고를 책임진다. 새 디자인·UI 담당은 Codex design(CX-DESIGN-01, 사용자 표기 Codex desine)이다. Claude design(CC-DESIGN-01)의 이전 전담 지정은 과거 기록이며 새 작업에 적용하지 않는다. 기존 담당은 T121로 인계하고 새 담당은 T122로 수신·범위 확인한다. 제품 파일 수정은 Master가 정한 작업별 단일 담당·허용 범위를 따른다. 사용자만 최종 의사결정권자이며 이미 승인된 일반 업무는 반복 승인 없이 진행한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 자동운영 팀 지침 · 2026-11-16

`AI_TEAM_RULES.md`와 `docs/team/`의 역할 지침, `docs/TEAM.md`의 최신 배정을 먼저 읽는다. Codex Master(CX-MASTER-01)가 총괄·통합·테스트한다. Claude Code는 코딩, Claude design은 디자인, CC-DATA-01은 데이터 전담이다. 공용 배정/상태는 Master가 갱신하고 작업자는 배정된 고유 파일로 결과를 반환한다. 기존 코드·사용자 변경을 보호한다. P1 독립검수 F-016-1/2와 V13잔여 검증을 우선하며 사용자 흐름/디자인 확인 게이트는 유지한다.

## 협업·인수인계 필수 지침 (사용자 지정, 2026-11-15)

- 최신 사용자 지시(2026-11-15): 단계마다 확인을 묻거나 인계 대기만 하며 멈추지 말고, 구현·검증·검수 기록 후 다음 단계로 계속 진행한다. 사용자의 결정이 실제로 필요한 사항만 질문한다. 현재 담당이 구현과 검수를 함께 수행하면 자체 검수임을 명시하고 별도 담당 검수로 표현하지 않는다.

- 세션 시작 시 CLAUDE.md, docs/PLAN.md, docs/REVIEW.md 및 최신 docs/handoffs/ 문서를 확인한다. 사용자의 지시를 우선한다.
- 구현 담당은 마일스톤마다 docs/PROGRESS.md 갱신과 함께 `docs/handoffs/<단계ID>.md`를 작성한다.
- 인수인계에는 기준 버전, 작업 범위, 변경 파일, 실행 명령, 실제 검증 결과, 미구현·알려진 문제, 검수 요청, 다음 단계 진입 조건을 담는다.
- 문서 끝에 플래너에게 그대로 복사해 전달할 메시지를 작성하고 최종 응답에도 제시한다. 파일 링크만 제공하고 끝내지 않는다.
- 상대 담당자가 REVIEW.md에 남긴 필수 수정은 수정 위치와 재검증 결과로 회신한다. 검수 통과 전 다음 마일스톤으로 진행하지 않는다.
- 문서 작성·메시지 초안·실제 전송·수신 확인을 구분한다. 직접 전송할 수 없으면 복사용 메시지를 제공하고 전송했다고 주장하지 않는다.
- 기준·디자인·템플릿을 변경할 필요가 있으면 QUESTIONS.md에 기록하고 관련 부분을 조율한다. 독립적으로 가능한 작업은 계속한다.

## 팀 협업 (은영님 지시, 2026-11-15)

Claude design(플래너·디자인)과 Codex는 한 팀이다. 플래너·디자인 담당을 부를 때는 "Claude design"이라고 쓴다(은영님 최종 지정 2026-11-16 — "Claude Code"·"Claude(design)" 아님). 위험하거나 은영님 결정이 필요한 일이 아니면, 상대가 할 일은 `docs/TEAM.md`에 보고서로 남기고 Orca로 바로 요청한다(`orca orchestration send --to <상대 터미널> ...`). 상대 요청이 오면 그에 맞춰 진행하고 같은 항목에 회신한다. 터미널 번호와 절차는 `docs/TEAM.md`.
