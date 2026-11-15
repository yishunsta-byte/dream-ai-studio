# Dream AI Studio — 구현 담당 작업 규칙

이 저장소에서 코드를 쓰는 에이전트는 매 세션 시작 시 이 파일을 읽고 아래 순서를 따른다.

## 읽는 순서
1. `docs/PLAN.md` — 최상위 개발 기준 (v2.4). 다른 어떤 문서보다 우선
2. `docs/REVIEW.md` — 열려 있는 **필수 수정**부터 처리
3. `docs/spec/menus.json` — 분야 템플릿 (직접 수정 금지, 플래너 관리)
4. `docs/DESIGN.md`, `docs/design/` — 제품 디자인 (P0-1 이후 생성). `docs/dev-plan.html`·`plan.html`의 CSS는 제품 디자인이 아니다

## 역할
- 플래너 **Claude Code**: 기준 문서·menus.json·디자인 (`PLAN.md`, `DESIGN.md`, `docs/design/`, `docs/spec/`)
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
