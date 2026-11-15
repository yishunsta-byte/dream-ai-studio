# 검수 기록

작성: **검수 담당(Codex)** — PLAN v2.3부터. R-000~R-002는 역할 변경 전 플래너가 작성했다. 플래너는 기준 변경 알림만 남긴다. 형식: 검수 대상 / 재현 절차 / 기대·실제 / **필수 수정** · 권장 · 확인.

---

## R-000 · PLAN v2.1 8장 검토 (2026-11-15)

대상: 구현 담당이 추가한 `PLAN.md` v2.1 8장, `HANDOFF_CODEX.md`

**결과: 채택.** 8장의 정정 사항은 모두 타당하여 PLAN v2.2 본문에 통합했다(부록 형태 폐지).

| 8장 항목 | v2.2 반영 위치 |
|---|---|
| P0~P8 로드맵, M→P 대응, 현재 범위 P0~P1, P1 내보내기는 편집용 묶음 | 2.2, 13장 E-1, 18장 |
| 제품 tokens·prototype·menus.json 부재 | menus.json 작성 완료(6장, `docs/spec/menus.json`). tokens·prototype은 P0-1에서 플래너 작성 |
| menus.json 스키마 요건, 메뉴 수 대조, 프로젝트별 템플릿 스냅샷 | 6.1 M-1~M-5, 6.2 대조표 (16+2 확정) |
| app→services→repo, Node 런타임, 워커 분리·동시 1, 127.0.0.1, 시작 점검 | 3장, 3.1, 4장 |
| 의존성 버전 확인·고정, 스크립트, 시드 비파괴 | 3장, 3.2 |
| 게이트 서버 강제, 기획 버전+장면표 스냅샷 승인 | R6, 5.2 S2·S3 |
| content_revision, 검수 무효화, 내보내기 불변, 단일 선택 기준, 동시 선택 | 5.2 S4·S5, 5.3 |
| 스키마 추가·제약·트랜잭션·UTC·정수 금액+통화·Postgres 이전 검증 | 7장, 5.2 S7, 3장 |
| 큐 트랜잭션 집기·idempotency·입력 스냅샷·재시작 복구·취소 후 결과 | 9장 |
| 제공자 구조화/미디어 구분, submit/poll/cancel, 임시→검증→확정, 저장 실패 구분 | 8.1, 8.2 A-1·A-2 |
| mock 결정적 기본, 시나리오, 무작위 실패는 수동 QA | 8.3 |
| 파일 검증·경로 차단·정적 서빙 금지·링크 메타데이터만 | 10장 F-1~F-7 |
| 내보내기 재검증·manifest 내용·스트리밍·원자 확정 | 13장 E-2~E-5 |
| 백업 일관 스냅샷·인벤토리·놓친 백업·격리 복원·롤백 | 14장 |
| 검증 증거 6항목 | 19장 V1~V13으로 확장 |
| 외부 서비스 정보 미검증, 비용 정산 상태 | 8.4 마지막 문단, 15장 B-3·B-4, `dev-plan.html` 수정 |

**확인 요청 (구현 담당)**
- `HANDOFF_CODEX.md`는 계획·검수 담당을 "user-designated Codex"로 적었다. 이 프로젝트에서 사용자가 지정한 계획·디자인·검수 담당은 **플래너(현재 Claude 세션)**이다. 다른 Codex 세션이 검수에 참여하는지는 은영님 확인 후 PLAN 표지의 역할 칸에 반영한다. 그 전까지는 PLAN.md 표지 기준을 따른다.

**다음**: 구현 담당은 P0-2(프로젝트 생성)를 시작할 수 있다. P0-4·P0-5는 P0-1 디자인 산출물 이후.

---

## R-001 · P0-2 프로젝트 기본 설정 (2026-11-15)

대상: PROGRESS P0-2 항목의 파일 전체 (git 저장소 없음 → 커밋 기준 없음)

**재현한 것 (플래너 PC에서 직접 실행)**

| 확인 | 결과 |
|---|---|
| `npm run lint` | 통과 (경고 0) |
| `npm run typecheck` | 통과 |
| `npm test` | 1파일 3테스트 통과 |
| `npm run build` | 통과, `/`·not-found 정적 생성 |
| `npm audit` | 개발 의존성 중간 등급 7건 (Q-001), 운영 0건 |
| 스크립트 | 3.2의 dev·worker·dev:all·build·start·lint·typecheck·test·db:migrate·db:seed 모두 정의. 미구현 명령은 안내 후 종료 1 — 적절 |
| 바인딩 | dev·start 모두 `--hostname 127.0.0.1` — 적절 |
| 런타임 | 루트 레이아웃 `runtime = "nodejs"` — 적절 |
| 비밀 | `.gitignore`에 `.env*`(예시 제외)·data·storage·backups·tmp 포함 — 적절 |
| 버전 고정 | 직접 의존성 정확 버전 + `save-exact` + lockfile — 적절 |
| 폴더 | PLAN 4장 구조 준비됨 |

**판정: 통과** (아래 필수 수정 1건은 P0-3 시작 전에 처리)

**필수 수정**
- [ ] **F-001 git 저장소 없음.** PLAN 20.4는 마일스톤 단위 커밋을 요구한다. `git init` → 현재 상태를 `P0-2: 프로젝트 기본 설정`으로 첫 커밋. `tmp/`, `*.tsbuildinfo`가 제외되는지 `git status`로 확인 후 커밋. 원격 저장소 연결·푸시는 하지 않는다(은영님 결정 전).

**권장**
- `README.md`에 PowerShell에서는 `npm.cmd`를 쓰는 이유 한 줄 유지(이미 PROGRESS에 있음 — README에도 있으면 됨).
- Next가 만든 `AGENTS.md`는 그대로 커밋해도 된다(재생성되는 파일). 내용(로컬 Next 문서 우선 참고)은 따를 것.

**확인 (답변)**
- Q-001 → QUESTIONS.md에 답변.
- `dev:all`이 워커 미구현으로 함께 종료되는 것은 P1-6 전까지 허용. P1-6 완료 기준에 `dev:all` 정상 동작을 포함한다.

**다음**: F-001 처리 후 P0-3(menus.json 로더) 진행 가능. P0-4·P0-5는 P0-1 디자인 산출물(`docs/DESIGN.md`, `docs/design/tokens.css`, `docs/design/prototype.html`) 이후 — 플래너가 지금 작성 중.

---

## R-002 · P0-1 디자인 산출물 완료 (2026-11-15, 플래너)

**만든 것**
- `docs/DESIGN.md` v1 — 원칙 D1~D8, 토큰 표, 앱 셸·반응형, 컴포넌트 명세(Button~ReviewItem), 패턴(게이트·작업 상태·실패 문장·장면 카드·샘플 표시·검수 무효화·확인 패널), 화면→경로 표, 접근성, 문구·용어표, 하지 말 것, **10장 P0-4·P0-5 완료 기준**
- `docs/design/tokens.css` v1 — 값의 유일한 출처
- `docs/design/prototype.html` — 6화면 시안(`#dashboard #menu #new #scenes #review #components`). 보라 점선 상자(`.anno`)와 위쪽 "시안" 띠는 설명용이며 제품에 옮기지 않는다. 열람: https://claude.ai/artifact/JQZB34seWCmC43HZitfztt (로컬 파일은 같은 폴더의 tokens.css를 읽음)

**플래너 확인 (ego-browser)**
- 1280·390 모두 6화면 `scrollWidth = innerWidth` (가로 스크롤 없음)
- 390 서랍: 열기 `aria-expanded=true`, 바깥 누르면 닫힘
- 확인 패널: 열면 취소 버튼 포커스, Esc로 닫히고 연 버튼으로 포커스 복귀
- 확인 중 시안 결함 3건 발견·수정: `[hidden]`이 `display:grid`에 덮여 패널이 늘 떠 있던 문제, 메뉴 닫기 버튼이 PC에서 격자 칸을 차지하던 문제, 휴대폰 버전 비교 버튼 글자 잘림. **구현 시 같은 실수 주의** — `hidden` 속성을 쓰는 요소에 display를 주면 `[hidden]{display:none}`을 함께 둔다

**구현 담당 순서**
1. F-001 첫 커밋 (작성자 정보는 은영님 답변 대기 — 플래너가 전달함)
2. P0-3 menus.json 로더 → PROGRESS 기록 → 검수
3. P0-4 공통 부품 → P0-5 앱 셸. 완료 기준은 DESIGN.md 10장. 경로를 바꾸거나 시안과 다르게 해야 하면 QUESTIONS.md

---

## 알림 · 역할 변경 (2026-11-15, 플래너)

은영님 지정: **검수·테스트는 검수 담당(Codex)**, 플래너는 플랜·디자인만. PLAN v2.3 20.1·20.3, CLAUDE.md 반영.
- 다음 검수(F-001 커밋, P0-3, P0-4·P0-5)부터 R-003 번호로 검수 담당이 작성한다.
- P0-4·P0-5 디자인 대조 기준: `docs/DESIGN.md` 10장 + 시안 https://claude.ai/artifact/JQZB34seWCmC43HZitfztt (로컬: `docs/design/prototype.html`)
- 기준·디자인이 틀렸으면 "플래너 확인 필요" + QUESTIONS.md (PLAN 20.1 7번).
