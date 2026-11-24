# T255-F2 초기 스크립트 실패 때 공개 철회 보완

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_0bd1931b2b88` · 수락 `msg_7b8ac620cf6d`
- 근거: `docs/handoffs/T255-F1-R-HOME-BACK-NAVIGATION-REVIEW.md`. 앱 스크립트가 실패한 홈은 React 효과가 실행되지 않아요. 그래서 bfcache 복원 가드가 없고, 철회 카드가 새 조회 없이 보였어요.
- 상태: **ready_review** (Tester 독립 재검수 요청)
- 코드 커밋: `4b4c350`(6경로). 이 보고는 별도 커밋이에요.

## 방향
Master가 우선 검토하라고 한 방향을 그대로 택했어요. 승인 작품은 **복원 가드가 설치된 문서에서만** 보여요.

1. 가드를 React 효과(`useEffect`)에서 **문서 안 인라인 스크립트**로 옮겼어요. 이 스크립트는 HTML을 읽는 도중 바로 실행돼요. 앱 스크립트(`_next/static/*.js`)가 실패하거나 늦거나 실행되지 않아도 상관없어요.
2. 승인 목록(`published`) 문서는 **승인 작품 영역을 기본으로 숨겨요**. `<style id="showcase-gate">[data-showcase-gated]{display:none}</style>`를 써요.
3. 인라인 스크립트는 아래 순서로 동작해요.
   - `pagehide`(persisted) 때 숨김, `pageshow`(persisted) 때 숨긴 채 `location.reload()`하는 가드를 **먼저** 설치해요.
   - 그다음에만 같은 시트의 규칙을 CSSOM으로 바꿔요. 승인 작품을 보이게 하고 대체 안내를 숨겨요.
   - 설치 중 예외가 나면 공개하지 않아요(시험으로 고정).
4. 요소 속성과 글자는 바꾸지 않아요. 그래서 React 수화(hydration)와 어긋나지 않아요. 실제로 콘솔 오류와 경고는 0이었어요.
5. 가드가 없는 문서(스크립트 꺼짐, 인라인 실행 실패)에서는 승인 작품 대신 **대체 안내**가 보여요. 문구는 "공개 작품을 보여 드릴 수 없어요 / 스크립트를 켠 뒤 새로고침해 주세요"예요. 브랜드 홈 링크, 크리에이터 로그인 2개, 관리자 로그인 링크도 함께 보여요.
6. 예시, 빈 목록, 장애 상태도 같은 인라인 가드를 둬요. 다만 숨길 승인 작품이 없어서 화면은 그대로예요. 대체 안내는 승인 목록에서만 그려요.

## 바꾼 것(6경로)
| 경로 | 내용 |
|---|---|
| `components/public-showcase/showcase-guard.tsx`(신규, 서버 컴포넌트) | `SHOWCASE_GATE_ID`·`SHOWCASE_GATE_CSS`·`SHOWCASE_GUARD_JS`, `ShowcaseGuard`(style+script), `ShowcaseScriptFallback`(안내+탐색, 승인 작품·이미지 없음) |
| `app/(public)/page.tsx` | 모든 상태에 `<ShowcaseGuard />`를 둬요. `published`이면 가드 → 대체 안내 → `<div data-showcase-gated>` 안의 `NeonShowcase` 순서로 그려요. |
| `components/public-showcase/neon-showcase.tsx` | F1의 `useEffect` 가드를 지우고 위치 안내 주석을 남겼어요. |
| `tests/public-showcase/home-navigation.test.ts` | F1 시험 3번을 "컴포넌트에 가드 없음"으로 바꿨어요. F2 시험 3건을 새로 넣었어요. |
| `tests/t241-public-home-route.test.ts`, `tests/public-showcase/showcase-feed.test.ts` | 공개 홈 import 허용 목록에 `showcase-guard`를 1개 추가했어요. 다른 기대값은 그대로예요. |

- F2 시험 3건
  1. 가드 스크립트를 가짜 문서에서 실제로 실행해요.
     - 리스너 2개가 설치되고, 규칙이 승인 숨김에서 대체 안내 숨김으로 바뀌는지 봐요.
     - 리스너 설치가 규칙 변경보다 먼저인지 봐요.
     - `persisted:false`는 무시하고, `pagehide`는 숨기고, `pageshow`는 숨긴 채 reload 1번 하는지 봐요.
  2. 시트가 없으면 예외로 멈춰 공개하지 않는지 봐요.
  3. 마크업 순서(style → script → 대체 안내)를 봐요. 대체 안내에는 `<img>`·작품명·커버 주소가 없고 링크 3종이 있는지, 페이지가 이 구조를 쓰는지도 봐요.
- 관련 회귀는 9파일 **106 passed (106)**이에요(F1 103 → F2 +3).
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 변경 6경로의 eslint는 0(exit 0)이에요.

## 격리 브라우저 검증
- **환경**
  - 저장소 밖 사본 `git archive 4b4c350`, `node_modules`는 물리 복사했어요.
  - 사본에서만 호출 계수 합성 공급원을 주입했어요.
  - 빌드 exit 0, 경고 0
  - 127.0.0.1:43257(`t255f2.localhost`)
  - ego lite taskSpace 72를 썼어요. Tester `term_6cae471a…`에 시작과 종료를 통지했어요.
  - 차단과 지연은 내 탭의 CDP 설정으로만 했어요: `Network.setBlockedURLs`, `Emulation.setScriptExecutionDisabled`, `Fetch.enable` 보류, 캐시 끔.
- **측정 방법**
  - 상태 이동 직후 1.5초 동안 약 25ms 간격으로 읽었어요.
  - 철회한 작품명이 렌더된 글자(`innerText`, `display:none` 제외)에 있으면서 문서가 숨김 상태가 아닌 횟수를 셌어요.

| 시나리오 | 결과 |
|---|---|
| N. 정상: 홈(2건, 수화 완료) → 관리자 로그인 → 철회 → 뒤로 | `back_forward` 새 문서였어요(이 실행은 bfcache를 쓰지 않음). 공급원 +1, 남은 1건. 철회 카드 보임 **0/47**. 처음 열 때 콘솔 오류·경고 0 |
| **G1. F1-R 재현 조건**: 앱 스크립트 차단 홈 → 관리자 로그인 → 차단 해제 → 철회 → 뒤로 | 차단 상태에서 수화되지 않았지만(`hydrated:false`) 가드는 설치됐어요. 승인 작품 2건이 보였어요. 뒤로 가기 때 `pageshow.persisted:true`였고, 그 순간 `visibility:hidden` → reload, 공급원 +1, 남은 1건. 보임 **0/49** (F1에서는 2/2 보임, 새 조회 0이었어요) |
| G2. 스크립트 완전 끔 홈 | 승인 영역 `display:none`, 대체 안내만 보였어요. 접근성 트리에는 브랜드·크리에이터 로그인 2·관리자 로그인·안내 제목과 문단만 있고 **작품명은 0**이었어요. |
| G2'. 이어서 관리자 로그인 → 스크립트 켬 → 철회 → 뒤로 | 스크립트 없던 문서가 그대로 복원됐어요(새 조회 0). 승인 영역은 숨김, 대체 안내만 보였고, 보임 **0/49**예요. 새로고침하면 정상 화면이 나와요(한계 2). |
| G3. 앱 스크립트 보류(지연 지속, 캐시 끔): 홈 표시 | `readyState: interactive`, 수화 전(`react:false`)인데도 가드 설치 → 승인 작품이 보였어요. 대체 안내는 숨김이었어요. |
| G3'. 보류 중 관리자 로그인 링크 클릭 → 보류 해제 → 철회 → 뒤로 | `persisted:true`, 숨김 → reload, 공급원 +1, 남은 1건. 보임 **0/48** |
| R1. 크리에이터 로그인 왕복 | bfcache 복원 → reload, +1, 1건, 보임 0/48 |
| R2. 관리자 로그인 화면 2초 대기 | 사전 요청 0(공급원 0, `_rsc` 0)이었어요. 홈 링크는 문서 이동(`navigate`) +1이에요. 뒤로 → 철회 → 앞으로: bfcache → reload, +1, 1건, 보임 0/49 |
| R3. 새로고침 | +1 |
| 인증 이동 | `/studio` → `/login?next=%2Fstudio`, `/admin` → `/admin/login?next=%2Fadmin`, `/cloud/projects` → `/login?next=%2Fcloud%2Fprojects`(모두 307), `/api/projects` 401, `/login`·`/admin/login` 200 |
| HTTP | 홈 HTML 200 `private, no-cache, no-store, max-age=0, must-revalidate`, RSC `_rsc` 307 → 200 `text/x-component`, 같은 `no-store` |

- **미디어 선로드:** 정상 문서와 앱 스크립트 차단·지연 문서에서는 인라인 가드가 먼저 영역을 공개해요. 그래서 이미지 요청은 기존과 같아요. 대표 이미지만 eager이고 `<link rel=preload>`는 0이에요. **스크립트 완전 끔** 문서에서는 숨긴 승인 영역의 커버 2개도 요청됐어요. Chromium은 스크립트가 꺼지면 lazy 로드를 끄기 때문이에요. 화면과 접근성 트리에는 나오지 않고, 커버 경로 자체가 활성 세대가 아니면 404예요(T254).
- **정상 진입 성능:** 추가 요청은 0이에요. 인라인 style과 script를 합쳐 약 0.4KB예요(홈 HTML 15,281바이트). 가드는 정상 문서에서 HTML 파싱 중 즉시 공개하므로 승인 작품이 늦게 보이지 않아요. 수화와 콘솔도 정상이에요. 숫자로 잰 시간 비교는 하지 않았어요.
- **정리**
  - ego `finish({keep:[]})`를 했어요.
  - 사본 서버는 내 백그라운드 작업만 멈췄어요. 포트 43257은 닫혔어요.
  - 내부 연결 3개를 끊고 사본을 지웠어요. 원본 `node_modules`는 283항목 그대로예요.

## 남은 한계
1. 확인한 브라우저는 Windows ego lite Chromium 하나예요. Firefox·Safari·모바일은 확인하지 않았어요.
2. 스크립트 완전 끔으로 열린 문서가 bfcache로 복원되면 스크립트를 다시 켜도 그 문서는 대체 안내를 유지해요. 가드가 없어 다시 읽지 않아요. 철회 카드는 숨김 상태라 보이지 않아요. 새로고침하면 정상 화면이에요.
3. 숨긴 승인 영역의 DOM에는 작품명이 남아 있어요. 화면과 접근성 트리에는 없지만, 소스 보기나 리더 모드 같은 비표준 표시는 확인하지 않았어요. 스크립트 완전 끔 문서는 커버도 요청해요(위 미디어 항목).
4. 스크립트는 켜져 있는데 인라인 스크립트만 막는 환경(엄격한 CSP 확장 등)에서는 승인 영역과 대체 안내가 모두 숨어요. 남는 것은 빈 화면이고, 안전한 쪽이에요. 현재 앱에는 CSP가 없어요. 나중에 CSP를 넣으면 이 스크립트에 nonce나 해시가 필요해요.
5. 앱 안에서 렌더 오류로 React가 홈 영역을 클라이언트에서 다시 그리면 원래 숨김 규칙이 다시 적용될 수 있어요. 이 경우 승인 영역이 숨겨지는 쪽으로 실패해요. 실제로는 수화 오류 0이라 관측하지 못했어요.
6. 문구 정리(F255-R2)와 시간 상한(F255-R3)은 범위 밖이에요. 실제 공급원·운영·배포는 하지 않았어요. 운영은 명시 예시 모드예요.

## 범위
- 공개 홈 노출·탐색 3파일과 관련 시험 3파일만 바꿨어요.
- 공유 문서 2개, 보존 대상, 검수 보고(T254-R·T255-R·T255-F1-R)는 그대로 두었어요.
- 공유 `.next`·3013·50963·Ego54/55·검수 공간은 쓰지 않았어요.
