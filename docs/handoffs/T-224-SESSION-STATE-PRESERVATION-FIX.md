# T-224 세션 재확인 때 입력 보존·사이드바 차단 (F221-1·F221-2)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **ready_review**(자체 검증, 원 Tester 독립 재검수 대상) · 로컬 커밋만
- 고정 SHA: **`8ffe3c75b5eaa908ee000f574cf688dd65125378`** (부모 `745882e`, 이 보고서 커밋은 별도예요)
- 원 결함: T-221 최종 FAIL(`2a0f5e97` 보고). F221-1(P1) 입력 소실, F221-2(P2) 사이드바 작업 수·링크 잔류.
- 범위 밖: 서버 판정·API·DB·package는 그대로예요. 이미 브라우저 메모리에 있는 자료를 지운다고 주장하지 않아요.
- **T-223 보고 표현 정정**: "be0e304에 T-220 소스 미혼입"은 틀린 표현이에요. be0e304는 이미 커밋된 371d5cc(T-220)를 포함해요. 뜻한 바는 "**커밋되지 않은 다른 작업(B15 WIP 등)을 섞지 않음**"이었어요.

## 원인
- F221-1: T-220의 `ProtectedContent`가 확인됨이면 `<div>{children}</div>`, 의심이면 `<>안내 + <div hidden inert>{children}</div></>`로 **다른 구조**를 돌려줬어요. 그래서 React가 본문을 새로 만들었고, 입력 칸이 새 요소로 바뀌어 값이 비었어요.
- F221-2: StudioShell의 사이드바(`aside`)·서랍은 경계 밖에 있었어요. 작업 수 갱신도 확인 상태와 상관없이 돌았어요.

## 바뀐 것(4개 파일)
- `components/auth/session-boundary.tsx`
  - 본문은 확인됨·의심 모두 **같은 자리의 같은 div**예요. 의심이면 `hidden`+`inert`만 켜요. 안내는 그 앞의 별도 자리에 더해요.
  - 본문을 지우는 것은 확정(cleared)일 때뿐이에요.
  - 포커스: 가릴 때 본문 안(또는 이미 잃은) 포커스를 안내로 옮겨요. 같은 계정으로 확인되면, 옮겼던 경우에만 본문 안 마지막 포커스 요소로 돌려줘요. 사용자가 그 사이 다른 곳(예: 로그아웃)으로 옮겼으면 빼앗지 않아요. 입력 칸의 선택 위치는 요소에 그대로 남아요.
  - context에 `epoch`를 더했어요.
- `components/auth/use-session-watch.ts`
  - 다른 탭 신호마다 `epoch`를 1씩 올려요.
  - `retry`를 `useCallback`으로 고정했어요.
  - 3초 제한, again 재확인, 15초 `reloadOnce`, 확정 뒤 same 미복원, 타이머 없음은 그대로예요.
- `components/studio-shell.tsx`
  - 의심·확정 동안 사이드바 `aside`에 `inert`와 `visibility:hidden`을 걸어요(폭은 유지).
  - 메뉴 버튼은 `disabled`로 잠그고, 열린 서랍은 닫아요.
  - 머리글 제목·상위 경로는 "작업실"로 일반화해요(이전 화면 제목이 남지 않게).
  - 작업 수
    - 확인됨일 때만 `/api/jobs`를 받아요. 의심·확정이 되면 진행 중 응답과 다음 갱신을 버려요(`disposed`).
    - 받은 값에 그때의 epoch를 붙이고, **확인됨 + 같은 epoch일 때만** 보여 줘요. 신호 이전 값은 확인 뒤에도 다시 보이지 않고 새로 받아요.
- `tests/t220-protected-content-session.test.ts`: 상태별 구조 단언을 갱신하고 T-224 블록 4건을 더했어요.

## 시험(CLI 출력)
- `tests/t220-protected-content-session.test.ts` → **`Tests 18 passed (18)`**
  - 확인됨/의심 본문이 같은 div·같은 자리라 hidden·inert를 빼면 마크업이 같아요. 상태별 감싸개 분기가 없는 것도 확인해요.
  - 그 밖에 포커스 복구 조건, epoch 증가, 셸(사이드바·메뉴 버튼·서랍·작업 수 epoch·갱신 중지·제목)을 확인해요.
- 관련 9 files → **`Tests 427 passed (427)`**
- 작업 트리 기준 `tsc --noEmit`, `eslint .` 모두 exit 0이에요(B15 WIP가 작업 트리에 있었지만 형식·린트 오류는 없었어요).
- 전체 suite는 Master 지시대로 반복하지 않았어요.

## 실제 확인(운영 build, 합성 PG TLS + fake Auth)
- 검증기 `tests/t213-cross-tab-session-http.mjs`(수정 없음) run `tmp/t213-http-87f440b3-…`, base **8ffe3c7**, **14 HTTP 관측 PASS**, exit 0
- **로컬 작업실**: 같은 build를 로컬 모드로 하나 더 띄웠어요.
  - 설정: `DREAM_AUTH_MODE=supabase`, 같은 fake Auth, 합성 SQLite(migrate+seed, 프로젝트 제목 표식, 대기·실패 작업 각 1)
  - T-221 검수 방식과 같아요. 실제 폼 로그인을 썼어요.
- 브라우저: ego lite, 두 탭(p1·p2). 결과 JSON은 `tmp/t224-shots/local-result.json`이에요.

### F221-1 입력 보존(`/menus/shopping-shorts/new`, ProjectForm)
- 준비: 제목 칸과 목표 칸에 실제 키보드로 입력하고 선택 위치를 만든 뒤, 그 DOM 노드를 기억해 뒀어요.

| 경로 | 1280 | 390 |
|---|---|---|
| 비신뢰 신호(`untrusted-test-signal`+`changed`), same 응답 3초 지연 → 의심 → same | 의심 중 본문 hidden, 포커스 안내. same 뒤 **같은 노드·값("T224 title"/"goal ABCDEFGH")·선택 [10,13] 유지**. 같은 문서(표식 유지) | 같음 |
| offline 중 신호 → 실제 online 복귀 → same | 의심 중 값·노드 유지(hidden). 복귀 뒤 **같은 노드·값·선택 [3,7]·포커스 원래 textarea** | 같음 |
| 의심 중 사용자가 Tab으로 로그아웃에 포커스 | same 뒤 포커스를 빼앗지 않음(로그아웃 유지), 값·노드 유지 | 같음 |

### F221-2 사이드바·서랍·작업 수
| 상태 | 결과 |
|---|---|
| 확인됨(기준) | 1280 사이드바 링크 25개, 작업 수 "1"·"!1", 머리글 "진행 0 · 대기 1" |
| 의심(checking·offline) | 사이드바 `visibility:hidden`+inert, 보이는 링크 0, 작업 수 0, 머리글 작업 수 0, 메뉴 버튼 disabled. 1280·390 Tab: 본문으로 건너뛰기 → 로그아웃(offline이면 다시 확인 포함)만 |
| 390 서랍 | 열린 상태에서 신호 → 서랍 닫힘, 메뉴 버튼 disabled |
| same 복원 | 사이드바·메뉴 복원. 작업 수는 새 epoch로 다시 받은 뒤 표시. 1280 offline 복귀 직후 관측 시점에는 아직 0(예전 값을 되살리지 않음). 390은 다시 받은 값 표시 |
| 15초 guard(1280): A→B 재로드 뒤 다른 탭 A 로그인 | stale 안내, **본문 DOM 없음**, 사이드바 숨김+inert, 작업 수 0. Tab: 새로 고침·건너뛰기·로그아웃만 |

- 스크린샷: `tmp/t224-shots/local-suspect-{1280,390}.png`, `local-offline-390.png`, `local-guard-1280.png`
  - `local-suspect-1280.png`는 직접 열어 봤어요. 사이드바 자리만 비어 있고, 안내와 로그아웃만 보여요.

### 클라우드 회귀(T-220 경로, 같은 run)
- guard 1280: 이전 A 카드·링크 DOM 0, 새로 고침만 → 새로 고침 → B.
- offline 390 상세: hidden+inert, 다시 확인만, 넘침 0 → online → 로그인 이동.
- session 차단 390·1280: 보이는 링크 0, 다시 확인만.
- 해제 뒤에는 이번에도 15초 안 재로드 기록 때문에 stale 안내(본문 제거)였어요. T-220과 같은 안전한 쪽이에요.
- 스크린샷: `tmp/t224-shots/cloud-*.png`

## 남은 점·미확인
- 본문으로 건너뛰기 링크(같은 화면 안 이동)는 의심 중에도 남아요. 계정 데이터는 아니에요.
- 1280 offline 복귀 직후 작업 수는 새로 받기 전이라 잠시 비어 있어요(의도한 동작).
- 모든 경합·unmount를 증명한 것은 아니에요. T-220 경로3 첫 실행의 문서 이동 원인은 계속 미확인이에요.

## 정리
- 로컬 서버(43445)와 검증기를 끝냈어요. 포트 58784·58778·58783·43445 listener 0, PG `postmaster.pid` 없음.
- `app/`, `local-runtime/` 사본을 지웠어요. ego 공간 9·11은 finish로 닫았어요.
- 3013, 공유 .next, 실제 Auth/DB, managed, 배포, B15 WIP는 건드리지 않았어요.
