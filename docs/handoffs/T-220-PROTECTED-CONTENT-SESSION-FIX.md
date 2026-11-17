# T-220 계정 확인 전·변경 뒤 보호 본문 차단 (F216-1 보완)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **ready_review**(자체 검증, 독립 재검수 필요) · 로컬 커밋만, push·배포 없음
- 고정 SHA: **`371d5cc255e98eb5d2264554643f81c499ad8114`** (이 보고서 커밋은 별도예요)
- 대상: T-216 F216-1(P2). 이메일만 숨기고 sibling `<main>` 본문(이전 owner 카드·링크)은 그대로 남던 문제예요.
- 범위 밖: 이 수정은 **화면 표시·조작 경계**만 다뤄요. 인증 우회를 고친 것이 아니고(새 요청은 원래도 서버가 판정), 이미 브라우저 메모리에 내려온 자료를 지운다고 주장하지 않아요.

## 바뀐 것
- **새 공통 경계** `components/auth/session-boundary.tsx`
  - `SessionBoundary({account})`: 감시 훅을 **한 번만** 돌리고 context로 나눠 줘요. account가 없으면(이 PC 로그인 꺼짐 등) 감시 없이 그대로 통과해요.
  - `ProtectedContent`: 보호 본문을 감싸요. 상태별 동작은 아래와 같아요.

    | 상태 | 본문 | 조작 가능한 것 |
    |---|---|---|
    | 확인됨(current) | 그대로 | 전부 |
    | 의심(checking·offline·unavailable, 확정 전) | `hidden`+`inert`로 표시·포커스·클릭·제출 차단(같은 계정 확인 뒤 같은 문서에서 복원) | 안내, 다시 확인(offline·unavailable), 로그아웃 |
    | 확정(cleared: 바뀜·로그인 없음·허용 밖, 15초 제한 포함) | **아예 그리지 않음**(DOM에서 제거) | 새로 고침(stale)·자동 재로드·로그인 이동, 로그아웃 |
  - 본문 안에 있던 포커스는 안내 영역(`tabIndex=-1`, `role=status`)으로 옮겨요. opacity·aria-hidden만 쓰는 방식은 쓰지 않았어요.
- `components/auth/use-session-watch.ts`
  - `cleared` 상태를 더했어요. 서버가 바뀜·로그인 없음·허용 밖을 확정하면 켜지고, 그 문서에서는 **이후 "같음" 답이 와도 이전 본문을 되살리지 않고** "새로 고침" 안내로 둬요.
  - `enabled` 인자를 더했어요. 공통 경계 안의 AccountMenu가 중복 감시하지 않게 해요.
  - 기존 3초 제한, running/again 재확인, 15초 `reloadOnce`, 타이머·poll 없음은 그대로예요.
- `components/auth/account-menu.tsx`: 경계 안이면 경계 상태를 같이 쓰고(본문과 같은 판정), 경계 밖이면 기존 자체 감시를 해요. 로그아웃 중에는 경계 감시를 멈춰요(`setPaused`).
- 연결
  - `app/(cloud)/layout.tsx`: `SessionBoundary`로 헤더·본문을 감싸고 `<main>` 안에 `ProtectedContent`를 넣었어요.
  - `components/studio-layout.tsx` + `components/studio-shell.tsx`: 같은 방식이에요. 머리글의 작업 수(진행·대기)도 확인 전에는 숨겨요.
  - `components/auth/cloud-pending.tsx`(legacy 준비 화면): "로그인은 정상적으로 됐어요" 문구와 안내를 `ProtectedContent`로 감쌌어요. 계정 메뉴는 밖에 둬요.
- AccountMenu 사용처 inventory: `(cloud)/layout`, `cloud-pending`, `studio-shell` **3곳뿐이고 3곳 모두 경계 연결**이에요. 시험이 이 목록을 고정해요(새 사용처가 생기면 실패).
- 바꾸지 않은 것: resolver, proxy, session API·계약, Backend, DB, SQL, package.

## 시험(CLI 출력)
- 새 `tests/t220-protected-content-session.test.ts` → **`Tests 14 passed (14)`**
  - 상태별 화면: 경계 밖 통과, current, 의심 3종(hidden·inert·안내에 본문·링크·폼 없음), 확정 4종(본문 미렌더·다시 확인 없음·stale만 새로 고침), account 없음/있음
  - 정적 inventory: 연결 3곳, AccountMenu 중복 감시 없음, 확정 뒤 same 미복원, 타이머·opacity·aria-hidden 없음
- `tests/t213-cross-tab-session.test.ts`: AccountMenu 단언 한 줄을 새 호출 형태(`useSessionWatch(email, busy, !boundary)`)로 고쳤어요.
- 관련 9 files(t220·t213·t183·t207·t200·api-auth·t198·t182 + studio 셸 시험) → **`Tests 423 passed (423)`**
- 전체 `vitest run` → `Tests 2 failed | 1352 passed | 84 skipped (1438)`
  - 실패 2건은 `tests/t164-export-ui.test.ts`(ExportsPanel·내보내기 서비스)예요. 이 작업 파일을 직접·간접으로 import하지 않아요. **이 작업과 관련 없는 기존 실패**로 따로 적어요(원인은 조사하지 않았어요).
- `tsc --noEmit`, `eslint .` 모두 exit 0이에요.

## 실제 두 탭 확인(합성 TLS PG + fake Auth, 운영 build)
- 검증기 `tests/t213-cross-tab-session-http.mjs`(수정 없음) run `tmp/t213-http-7a485aae-…`, base **371d5cc**
  - **14 HTTP 관측 PASS**, hold 뒤 stop으로 exit 0
- 브라우저: ego lite TaskSpace 5, 실제 탭 p1·p2, 실제 폼 로그인·로그아웃 버튼, CDP 네트워크 차단·오프라인
- 판정 기준: `innerText`(hidden 제외), 보이는 프로젝트 링크 수, `inert` 블록 수, main 안 보이는 조작 요소, 실제 Tab 이동

| T-216 경로 / 추가 | 결과 |
|---|---|
| **경로1 15초 제한**(1280): B→A 자동 재로드 직후 다른 탭 B 로그인 | 이전 A 이메일·**A 카드·A 상세 링크 DOM 0**, 안내 "다른 창에서 로그인 계정이 바뀌었어요" + 새로 고침만. Tab: 새로 고침→로그아웃. 새로 고침 Enter → B 목록 |
| **경로2 offline**(390): B 상세 탭 offline 중 다른 탭 B 로그아웃 | B 제목·정보 보이지 않음(`hidden`+`inert` 1), main에서 조작 가능한 것은 다시 확인뿐, 가로 넘침 0. online 뒤 다시 확인 → `/login?next=…상세` |
| **경로3 확인 불가**(390·1280): session API만 차단(navigator online) + 다른 탭 A 로그인 | B 카드 보이지 않음(DOM 링크 1은 inert 안), 보이는 링크 0, Tab은 다시 확인·로그아웃만 |
| 경로3 해제 뒤 | 다시 확인 → `changed` → 전체 재로드 → A 목록(페이지 안 기록: session ERR×3 → 200 changed → pagehide → reload A) |
| **늦은 옛 same 경합**: B 탭의 실제 `same` 응답 전달만 6초 보류 → 그 사이 A 로그인 신호 | 기록: B본문 → (same 도착·보류) → 신호로 안내+inert → changed → 안내(본문 제거) → 재로드 A. 보류된 same 전달 뒤 **B 본문 재등장 0** |
| **알 수 없는 신호**(시험 문자열 `untrusted-test-signal`×4 + `changed`) | 안내+inert → 서버 same → 같은 문서(표식 유지)에서 A 본문 복원. 신호를 권한 근거로 쓰지 않음 |
| **부분 로그아웃**(검증기 `logout-fail`로 provider 500) | 실행 탭 `/login?notice=logout-partial`, 다른 탭은 안내+inert → 안내만 → `/login?next=%2Fcloud%2Fprojects`. 파일은 finally로 지움 |
| **legacy 준비 화면 `/`**(390) | 알 수 없는 신호: "로그인 정상" 문구 가림→same 뒤 복원(같은 문서). offline 중 신호: 가림+inert, 넘침 0, 다시 확인 → 복원. 실제 B 로그인 → 자동 전체 재로드 |
| 정상 흐름 | 1280·390 모두 신호 없을 때 안내·inert 없음, 기존 카드·링크 그대로 |

- 참고: 경로3의 첫 실행에서는 해제 뒤 자동 재로드 대신 "새로 고침" 안내가 떴어요. 같은 탭에서 15초 안에 재로드 기록이 이미 있어 `reloadOnce`가 막은 경우예요. 이때도 본문은 DOM에서 제거된 상태였어요(안전한 쪽). 16초 간격을 둔 재실행에서는 위 표처럼 자동 재로드됐어요. 첫 실행 중 한 번의 문서 이동 원인은 끝까지 밝히지 못해 따로 적어요.
- 화면 확인: `tmp/t220-shots/g1-guard-1280.png`, `g2-offline-390.png`(직접 열어 확인: 안내·다시 확인만, 본문 없음), `g3-unavailable-{390,1280}.png`, `g7-legacy-offline-390.png`
- legacy 화면 offline 상태에서는 "다시 확인" 버튼이 두 개예요(본문 안내 + 계정 메뉴). 동작은 같아요. 정리할지는 디자인 판단에 맡겨요.
- 확인하지 못한 것
  - 로컬 모드에서 로그인 계정이 있는 작업실(StudioShell + account) 실제 브라우저. 이번 검증기는 클라우드 모드라 단위·inventory 시험으로만 확인했어요.
  - 모든 unmount·장기 정지 경합을 증명한 것은 아니에요.

## 정리
- 검증기 stop으로 exit 0이에요. 포트 64240·64236·64239 listener 0, PG `server stopped`, `postmaster.pid` 없음.
- `app/` 복사본은 지웠어요. ego 공간 5는 finish로 닫았어요.
- 3013, 공유 .next, B13, 실제 DB·Auth, 배포는 건드리지 않았어요.
