# T-235 같은 계정 복귀 때 포커스 돌려주기(F234-2)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_c4d4da8546f2` · 상태: **ready_review**
- 결함 근거: Tester T234 `msg_72ade3917694`
  - 재현 자료: `D:/starwork/t234-manage-3b32ad0/tmp/t234/browser-17.mjs`, `evidence/focus-restoration-observation.json`
  - 링크에 포커스 → 세션 신호로 가림 → 같은 계정 응답 → 본문 DOM은 같지만 포커스가 BODY로 빠짐
- **새 고정 후보 `ebe84eae6611f5e11eedbe6e678c4a05506e0e7a`**
  - 이 커밋 안의 제품 변경은 `components/auth/session-boundary.tsx` 한 파일이에요.
  - 앞서 낸 T229-FIX(`ec1609e`, 목록 링크 44px)와 그 이전 커밋을 포함해요.
  - 누적 후보 범위: T229(6308791, b7a0a94) + T229-FIX(ec1609e) + T235(ebe84ea)

## 1. 원인(실제 브라우저로 확인)
- 돌려줄 대상(`lastFocus`)을 본문 div의 React `onFocus`(focus 이벤트)로만 기억했어요.
- 창이 포커스를 갖지 않은 문서(`document.hasFocus()=false`, 예: 뒤에 있는 탭이나 자동화 창)에서는 `element.focus()`를 해도 focus 이벤트가 오지 않아요. 그래서 대상이 비어 있었어요.
- 그 결과 가릴 때는 안내로 옮겨졌지만, 복귀 때는 돌려줄 대상이 없어서 BODY로 남았어요.
- 기준 재현(수정 전 제품 코드 = ec1609e, 서비스 base `b9e7571`, BUILD_ID `O7PfEH269AjVgtStWwubf`)
  - `HTMLElement.prototype.focus` 호출을 기록해 보니, 복귀 뒤 `focus()` 호출이 0번이었어요.
  - 창 포커스가 없을 때(hasFocus=false): 1280·390 모두 두 번 연속 `A → notice → BODY`
  - 창 포커스가 있을 때(키보드 Tab, hasFocus=true): 기존 코드도 링크로 돌아왔어요. 원인이 이벤트 누락이라는 것과 맞아요.
  - 기록: `tmp/t235-baseline.json`

## 2. 수정(허용 범위: ProtectedContent의 포커스 보존·복귀 로직만)
- **가릴 때:** 본문 안에 실제로 포커스된 요소(`document.activeElement`)를 바로 `lastFocus`로 기억한 뒤 안내로 옮겨요. `onFocus` 기록은 그대로 둬요.
- **복귀할 때:** 기존 조건을 그대로 써요.
  - 대상이 연결돼 있고 본문 안에 있으며, 지금 포커스가 BODY일 때만 돌려줘요.
  - 다른 컨트롤로 옮겼으면 빼앗지 않아요.
- **추가된 것:** 돌려준 포커스가 화면 밖이면 `scrollIntoView({block:"nearest"})`로 보이는 곳까지만 옮겨요. 가린 동안 문서가 짧아져 스크롤이 위로 올라가는 경우 때문이에요.
- **바꾸지 않은 것:** use-session-watch, Auth, 문구, CSS, layout, 계정 판정
- **시험 파일**
  - `tests/t235-session-focus-restore.test.ts`: 5건. 코드 순서·조건 고정이고, 이것만으로 PASS로 판정하지 않아요.
  - `tests/t235-focus-browser.ego.js`: test-only 브라우저 하네스. ego lite로 실행해요.

## 3. 검증(실제 출력)
- **시험**
  - t235 + t220 + t213 + t229 + t207: 91 passed
  - `tsc --noEmit` 0, `eslint` 0
  - 전체 vitest: **Test Files 96 passed | 10 skipped (106), Tests 1618 passed | 319 skipped (1937)**
- **수정본 격리 production 서비스(제 소유)**
  - 서비스: `tmp/t213-http-3be0e85b-9c7e-4eee-b54e-c0c217054939`, base.txt=`ebe84ea…`, BUILD_ID `PZuWlXhPbN7-Qw1bG3g4W`
  - 하네스 종료 출력: `observations passed: 14`
  - 기준 서비스(`06b4ed3e…`)도 14 passed로 종료했어요.
  - 결과: `tmp/t235-fixed.json`

| 상황 | 기준(수정 전) | 수정 후 |
|---|---|---|
| 같은 계정 복귀 2번, 1280 (hasFocus=false) | A → notice → **BODY** → notice → **BODY** | A → notice → **A** → notice → **A** |
| 같은 계정 복귀 2번, 390 (hasFocus=false) | 위와 같음(BODY) | A → notice → A → notice → A |
| 같은 본문 DOM(노드 동일) | 유지 | 유지 |
| 키보드 Tab 도달 + 스크롤 260 (390×500) | 링크로 복귀, scrollY 0(화면 밖) | 링크로 복귀, scrollY 366(링크가 보임) |
| 글자 선택(포커스 컨트롤 없음) | 선택 유지, BODY | 선택 유지, BODY(빼앗지 않음) |
| 가린 동안 헤더 로그아웃으로 옮김 | 로그아웃 유지 | **로그아웃 유지**(빼앗지 않음) |
| 가린 동안 대상 링크 삭제 | BODY, 오류 없음 | BODY, 오류 없음 |
| 확인 실패(500) → "다시 확인" → same | (기준은 스크립트 단계에서 멈춰 미측정) | 안내 "로그인 상태를 확인하지 못했어요" 동안 본문 hidden+inert → 다시 확인 → **A로 복귀** |
| 계정 변경 확정(재로드 제한 → stale) → 늦은 same | (미측정) | 본문 DOM **제거**, 늦은 same 뒤에도 제거·안내 유지(되살리지 않음) |
| 44px 링크 회귀 | — | 목록 "개인 관리 보기" 44, 관리 "내 프로젝트"·"다시 불러오기" 44(1280·390), 넘침 0 / 1280 관리 -15 |

## 4. 한계
- 이 저장소에는 DOM 시험 환경(jsdom 등)이 없고 패키지 추가는 범위 밖이에요. 그래서 동작 근거는 ego lite 실제 브라우저 결과예요. vitest 쪽은 코드 조건 고정만 해요.
- "확인 실패 → 다시 확인"은 화면에 "다시 확인" 버튼이 2개 있어요(헤더 계정 메뉴와 본문 안내). 스크립트는 첫 번째(헤더)를 눌렀고, 둘 다 같은 공통 retry를 써요.
- 대상이 disabled가 된 경우는 실제 화면에 해당 요소가 없어서 만들지 않았어요. 코드는 `focus()` 뒤 `activeElement===target`일 때만 스크롤해요.
- 여러 ProtectedContent가 겹치는 화면은 현재 없어요(사용처: (cloud) layout, cloud-pending, studio-shell 각 1개).
- 독립 재검수는 Tester 몫이에요. push·배포는 하지 않았어요.

## 보호
- 새 창·agent·worktree 없음. 3013·공유 .next·실계정·운영 미접촉.
- Tester 브라우저 점유가 풀린 뒤(`msg_c77beeef9372`)에만 ego를 썼어요. 제 서비스 2개는 모두 stop 파일로 종료했어요.
- 비밀값 출력 없음.
