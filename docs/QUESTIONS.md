# 질문·결정 기록

## Q-004 · 작업 대기열 경로 충돌 정리 (2026-11-15)

PLAN 4장은 /jobs, DESIGN 6장은 /queue로 경로가 다르다. 상위 기준 PLAN의 /jobs를 실제 화면과 내비게이션에 사용하고 /queue는 /jobs로 이동시키는 호환 경로로 둔다. 기능이나 단계 변경 없이 두 문서의 링크가 모두 열리도록 처리했다. 기준 문서는 플래너 관리이므로 직접 변경하지 않는다.

**플래너 답변 (2026-11-15): 수용·닫힘.** 경로는 PLAN의 `/jobs`로 확정하고 `/queue`→`/jobs` 이동은 유지한다. DESIGN v1.2 6장 표에 반영했다.

## Q-003 · 작은 글자 대비 보완 (2026-11-15)

P0-4 자체 검수에서 토큰 값을 WCAG 상대휘도식으로 계산했다. 흰색 글자/--accent는 3.28:1, 흰색/--phase-0은 4.37:1로 DESIGN 7장의 본문 4.5:1에 못 미친다. 기준 토큰 파일은 수정하지 않았다. 접근성 우선으로 주 버튼은 기존 --accent-hover(4.87:1), P0 칩은 기존 --c-navy-500을 사용한다. hover/press는 --accent-press. 다른 단계 칩은 4.5 이상을 확인했다. 플래너가 다음 디자인 기준 정리 때 해당 역할값을 반영할 수 있도록 남기는 비차단 항목이다.

**플래너 답변 (2026-11-15): 지적이 맞음 — 플래너 토큰 결함. 닫힘(후속 1건).** tokens.css v1.1에서 `--accent`=민트 700(흰 글자 4.87:1), `--accent-hover`=민트 800, `--accent-press`=민트 900(신설), 글자 없는 강조용 `--accent-bar`=민트 600(신설), `--phase-0`=남색 500(6.08:1)으로 고쳤다. **구현 후속**: 임시로 쓴 `var(--accent-hover)`(주 버튼 `.primary`, `.action-link`, 셸 `.mark`)를 `var(--accent)`로, `primitives.tsx`의 phase 0 특례를 `var(--phase-0)`으로 되돌린다. 그대로 두면 토큰 변경으로 한 단계 진해진다. 진행 막대처럼 글자 없는 곳은 `--accent-bar`를 써도 된다.

## Q-002 · 접근성 린트 호환성 (2026-11-15)

P0-4 확인: npm 레지스트리의 eslint-plugin-jsx-a11y 6.10.2 peerDependencies는 ESLint 9까지이며 현재 ESLint 10을 지원하지 않는다. 강제 설치나 ESLint 하향 없이, 시맨틱 HTML·타입으로 필수 라벨 강제·실제 브라우저 키보드/폼/포커스 검증을 적용한다. 기존 ESLint/Next/Hooks 규칙 유지. 추후 ESLint 10 지원 버전에서 재검토. 이는 DESIGN 7장의 지원 불가 시 기록 지침에 따른 비차단 추적 사항이다.

**플래너 답변 (2026-11-15): 수용·닫힘.** 강제 설치·ESLint 하향 금지. 대체 검증(시맨틱 HTML, 라벨 필수 타입, 실제 브라우저 키보드·포커스 확인)을 유지하고, ESLint 10 지원판이 나오면 추가한다. P1 종료 때 한 번 재확인.

구현 담당이 기준과 다르게 해야 할 이유가 생기면 여기에 적고 그 부분만 멈춘다. 플래너가 답하고, 필요하면 PLAN.md를 고친다.

| ID | 날짜 | 질문 (관련 PLAN 절) | 제안 | 답변 | 상태 |
|---|---|---|---|---|---|
| Q-001 | 2026-11-15 | P0-2 의존성 검수: typescript-eslint 8.72.2 하위 minimatch에 전체 npm audit 중간 등급 7건이 남음. 운영 의존성은 0건. 일반 audit fix로 해결되지 않음 | 현재 공식 호환 버전을 고정하고 강제 major override는 피함. 플래너가 개발 도구 잔여 항목 검토 후 업데이트 추적 여부 결정. lint/build/typecheck/test 통과 | **제안대로 수용.** 근거: 운영 의존성 0건, 해당 경로는 개발 중 린트 도구에서만 실행되고 외부 입력을 받지 않음. `npm audit fix --force`·override 금지. **추적 규칙**: 매 마일스톤 PROGRESS에 `npm audit --omit=dev` 결과(0이어야 함)와 전체 audit 건수를 적는다. 운영 의존성에 1건이라도 생기거나 개발 도구 건이 high 이상이 되면 그 마일스톤에서 해결. typescript-eslint가 TS 6.1+ 지원 판을 내면 함께 올린다 (플래너 2026-11-15) | 닫힘 |

## DEC-VERCEL-02 / 중복 Vercel 프로젝트 Git 연결 / waiting_human
- 확인 시각: 2026-11-18 00:37:50 +09:00 (Asia/Seoul). 근거: docs/handoffs/T-228-VERCEL-DEPLOYMENT-IDENTITY.md (38819e7).
- 결정할 사항: dream-ai-studio-kzxq에 연결된 yishunsta-byte/dream-ai-studio Git 연결만 해제할지, 현재 연결을 유지할지.
- 확인된 사실: 동일 master push로 두 프로젝트 모두 Production 배포. 주운영 orpin은3QDyZWKqj Ready/Current/8ffe3c7. kzxq는FqNrw2VMG Ready/Current/동일SHA이며 공개HTTPS는로그인설정 미완료503/no-store. env 목록/생성목적은 확인하지 않았다.
- 추천안: kzxq 프로젝트·기존배포를 보존하고 Git 연결만 해제하여 이후 중복 자동배포를 중지. 주운영 dream-ai-studio/orpin의 연결·도메인·환경은 변경하지 않음. 기존 kzxq 공개배포가 삭제되거나 비공개로 바뀌는 작업은 아님.
- 다른안: 용도확인 전 기존연결 유지. 현재503이라는 관측만으로 미래권한/설정이 안전하다고 판단하지 않음.
- 사용자 결정이 필요한 이유: 다른 용도가 있을 수 있는 운영 프로젝트의 연결 설정 변경이며 해당 범위는 아직 지정되지 않았다. 실제 변경 전 exact 프로젝트·연결 상태 재확인 필요. 프로젝트삭제/2FA/계정·env변경은 이번결정 범위에 포함하지 않는다.
- 상태: 사용자에게 async 선택 요청 등록, 응답 전 미실행. 답변 전 Backend B22 독립 로컬 구현 계속.
### DEC-VERCEL-02 후속 종결 (2026-11-18 01:03:27 +09:00)
Front f8e8fc2/msg_4b1d8a249538에 따르면 사용자가 Front 대화에서 kzxq 삭제를 직접 승인했고 실행 완료. 연결만해제/유지의 이전 질문은 superseded. Master는 해당승인대화 직접열람이 아니라 보고수신으로구분; 결과는 actualHTTPS kzxq404 DEPLOYMENT_NOT_FOUND/mainlogin200/api401 재확인. 추가삭제·설정변경 미실행, 사용자에게동일질문반복하지 않음.

### Vercel 2FA 사용자 보류 기록 (2026-11-18 01:30:59 +09:00)
Front msg_dea5d67c6f6c에 따르면 사용자가 '나중에 할께 패스'로 보류. 현범위에서는 설정하지 않고 같은질문을반복하지 않는다. 사용자후속지시전대기이며 Backend B23/기존운영을중단시키는선행조건으로사용하지 않는다.
