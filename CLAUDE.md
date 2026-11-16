> 최신 사용자 역할 지정 · 2026-11-17: Codex Master(CX-MASTER-01)가 모든 작업의 총괄 지휘자다. 작업 분해·배정·우선순위·충돌 조정·결과 회수·통합·테스트·독립 검수·최종 보고를 책임진다. 새 디자인·UI 담당은 Codex design(CX-DESIGN-01, 사용자 표기 Codex desine)이다. Claude design(CC-DESIGN-01)의 이전 전담 지정은 과거 기록이며 새 작업에 적용하지 않는다. 기존 담당은 T121로 인계하고 새 담당은 T122로 수신·범위 확인한다. 제품 파일 수정은 Master가 정한 작업별 단일 담당·허용 범위를 따른다. 사용자만 최종 의사결정권자이며 이미 승인된 일반 업무는 반복 승인 없이 진행한다.

# Dream AI Studio — 구현 담당 작업 규칙

이 저장소에서 코드를 쓰는 에이전트는 매 세션 시작 시 이 파일을 읽고 아래 순서를 따른다.

공통 운영은 `AI_TEAM_RULES.md`, 담당별 업무는 `docs/team/CLAUDE_ROLES.md`, 실제 세션/배정은 `docs/TEAM.md`를 먼저 확인한다. Codex Master가 배정·통합·테스트하며 Claude Code(코딩), Claude design(디자인), CC-DATA-01(데이터)을 구분한다. 기존 제품 기준·원본 보호·사용자 승인 게이트를 유지한다. 공용 배정과 상태는 Master가 관리하고 담당자는 자기 작업의 고유 보고서에 회신한다.

## 읽는 순서
1. `docs/PLAN.md` — 최상위 개발 기준 (v2.4). 다른 어떤 문서보다 우선
2. `docs/REVIEW.md` — 열려 있는 **필수 수정**부터 처리
3. `docs/spec/menus.json` — 분야 템플릿 (직접 수정 금지, 플래너 관리)
4. `docs/DESIGN.md`, `docs/design/` — 제품 디자인 (P0-1 이후 생성). `docs/dev-plan.html`·`plan.html`의 CSS는 제품 디자인이 아니다

## 역할
- 플래너 **Claude design**: 기준 문서·menus.json·디자인 (`PLAN.md`, `DESIGN.md`, `docs/design/`, `docs/spec/`)
- 검수 담당(Codex): 검수·테스트 (`REVIEW.md`). 필수 수정은 여기서 나온다
- 구현 담당(당신): 코드, `PROGRESS.md`, `QUESTIONS.md`
- 최종 결정: 은영님

## 작업 방식
- PLAN.md 18장의 **다음 마일스톤 하나만** 진행한다. 현재 범위는 P0~P1.
- 기준과 다르게 해야 하면 `docs/QUESTIONS.md`에 적고 그 부분만 멈춘다. PLAN.md·menus.json을 직접 고치지 않는다.
- 끝나면 `docs/PROGRESS.md`에 마일스톤 ID / 바꾼 파일 / 실행 방법 / 실제 검증 결과 / 남은 문제를 적는다.
- **연속 진행 방식(은영님 직접 지시, PLAN 20.1)**: REVIEW에 "자체 검수(독립 검수 아님)"을 기록한 뒤 다음 마일스톤으로 이어 간다. R1~R10에 걸리는 것만 멈추고 질문한다.
- 완료의 정의(PLAN 20.2): build · lint · typecheck · test 통과, 새 규칙에 테스트, 완료 기준 직접 실행, R1~R10 위반 없음, 화면은 1280·390px 확인.

## 절대 규칙 (PLAN 1.1 요약)
원본 덮어쓰기 금지 · 수정은 새 버전 · 실패와 샘플을 완료로 표시 금지 · 승인 게이트는 서버 서비스에서 강제 · 분야별 화면 복제 금지 · 확인 안 된 내용 생성 금지 · API 키는 `.env.local`만 · 실제 개인정보 금지 · 127.0.0.1 바인딩.

## 커밋
마일스톤 단위, 메시지 `P1-4: 자료 보관함 업로드·미리보기` 형식.
