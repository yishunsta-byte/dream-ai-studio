# T308 공개 홈 hydration·프로덕션 빌드 점검

- 담당: Codex(Front) · 배정 Master `msg_64a01fdaddbe` · 기준 T306-F1-R(`f1f0a28`) 후속
- 대상: `f1f0a28` 고정 소스를 격리 사본으로 풀어 확인했어요. 공유 `.next`·3013·사용자 미리보기는 쓰지 않았어요.
- 버전: Next.js 16.4.6, React DOM 19.3.1, Node v26.13.0
- 바꾼 파일: 이 보고서 하나. 제품 코드·운영 DB·배포는 변경하지 않았어요.

## 방법

- 격리 사본에서 T306 방식대로 세 자리만 주입했어요(커밋 안 함): 인증, 관리자 저장소, 공개 리더.
- 데이터: T306 실행기(`tests/admin/t306-publication-e2e-native.ts`, 서버 모드)로 본인 소유 루프백 PG17 하나를 띄웠어요. 고정 해시 SQL과 합성 작품을 썼어요.
- 서버(같은 사본, 같은 DB, 한 번에 하나만 실행):
  - **production:** `npm run build` → `next start`(127.0.0.1:43308)
  - **dev:** `next dev --webpack`(127.0.0.1:43309). T306-F1-R과 같은 dev/webpack이에요. dev 산출물은 `.next/dev`에 따로 생겨서 production 빌드(`BUILD_ID`)는 그대로였어요.
- 브라우저: ego 작업 공간을 실행마다 새로 만들고 닫았어요(keep 없음).
  - 문서 시작 전에 기록 스크립트를 넣었어요(`Page.addScriptToEvaluateOnNewDocument`).
    - console.error/warn과 페이지 오류를 기록해요.
    - `#showcase-gated`·`#showcase-fallback`이 DOM에 들어오는 순간의 `hidden`을 기록해요(MutationObserver).
  - CDP `Runtime.consoleAPICalled`·`exceptionThrown`·`Log.entryAdded`도 함께 모았어요.
- 흐름(모든 실행 공통):
  1. 게시 전 홈
  2. 관리자 API로 준비 → 게시(합성 계정)
  3. 원본 HTML 확인 → 홈 진입 → 새로고침
  4. 관리자 화면으로 전체 이동 → 철회 → 브라우저 뒤로
  5. 새 홈

## 결과

| 항목 | production 1280 (`neon-alley`, A) | production 390 (`b-harbor`, B) | dev/webpack 1280 (`timed-coast`, A) | dev/webpack 390 (`drift-dune`, A) |
|---|---|---|---|---|
| 준비 → 게시 | prepared v1 → published v2 | 같음 | 같음 | 같음 |
| 원본 HTML: `<div id="showcase-gated" hidden="">`, 대체 안내, 가드 스크립트 | 있음 | 있음 | 있음 | 있음 |
| DOM 삽입 순간: 승인 영역 / 대체 안내 | hidden / 보임 | 같음 | 같음 | 같음 |
| 드러난 뒤: 승인 영역 / 대체 안내 / 작품 제목 | 보임 / hidden / 보임 | 같음 | 같음 | 같음 |
| 새로고침 뒤 | 같음 | 같음 | 같음 | 같음 |
| **hydration 경고** | **없음**(콘솔 error·warn 0, 예외 0) | **없음** | **있음**(진입·새로고침 매번 console.error 1건) | **있음** |
| 철회 | revoked v3 | 같음 | 같음 | 같음 |
| 뒤로가기(홈) | 작품 안 보임, 승인 영역 없음, 탐색 형태 `reload` | 같음 | 작품 안 보임, 탐색 형태 `back_forward` | 같음 |
| 새 홈 | 작품 없음(예시 상태) | 같음 | 같음 | 같음 |

dev에서는 이미지 LCP 안내 경고(`loading="eager"`)가 함께 나왔어요. production에는 없어요.

### dev 경고 원문 요지 (React 19.3.1 개발 빌드)

`A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up.` 차이는 두 군데뿐이에요.

```
<ShowcaseScriptFallback> <div id="showcase-fallback" ...>
-   hidden=""                 ← DOM(드러내기 스크립트가 붙임), 클라이언트 속성엔 없음
<ShowcaseGated> <div id="showcase-gated">
+   hidden={true}             ← 클라이언트 속성(서버 HTML과 같음)
-   hidden={null}             ← DOM(드러내기 스크립트가 지움)
```

원인은 의도된 인라인 드러내기 스크립트(`SHOWCASE_REVEAL_JS`)예요. hydration 전에 두 영역의 `hidden`을 바꿔서 생겨요. 다른 속성이나 텍스트 차이는 없었어요.

### production에서 경고가 없는 이유와 확인 방법

- React 프로덕션 빌드는 hydration 때 속성 차이를 검사·기록하지 않아요. 고치지도 않아요("won't be patched up"은 dev에서도 같아요).
  - 그래서 드러낸 상태가 hydration 뒤에도 그대로 남았어요(제목 보임, 3초 뒤까지 유지).
  - 텍스트 불일치(#418 등) 같은 복구 가능한 오류도 나오지 않았어요.
- 기록기가 production에서도 작동하는지 따로 확인했어요. production 홈에서 시험 문구를 console.error·warn으로 한 번씩 찍었고, CDP에 둘 다 잡혔어요. 그러니 "0건"은 기록 실패가 아니에요.
- 개발용 React 스크립트는 production 페이지에 없었어요.

### 뒤로가기 차단

- **production:** 홈은 뒤로 가기 캐시(bfcache)로 복원돼요. 그때 가드(`pageshow persisted` → 숨김 → `location.reload()`)가 작동해서 탐색 형태가 `reload`였어요. 새로 받은 홈에는 철회된 작품이 없었어요.
- **dev:** 홈이 bfcache에 들어가지 않아(개발 서버 연결 탓으로 보여요) 일반 `back_forward`로 서버에서 다시 받았어요(`no-store`). 역시 작품이 안 보였어요.
- 즉 노출 차단은 두 모드 모두 지켜졌지만, 경로가 달라요. bfcache 가드 동작 자체는 production에서만 실측돼요.

## 판단 자료 (판정은 Master)

- 이 경고는 dev 전용이에요. 사용자 화면이나 공개·철회 동작에는 영향이 없었어요.
- 다만 dev 콘솔에 매번 error 1건이 남아서, 다른 실제 hydration 문제를 가릴 수 있어요.
- 제품 쪽에서 없애려면 선택지는 아래와 같아요(이번 범위 밖, 별도 배정·검수 필요).
  1. 두 `div`에 `suppressHydrationWarning`을 붙여요. 해당 요소의 속성 차이 경고만 꺼지고, 동작과 F2/F3 보호(HTML `hidden` 초기 숨김, 가드 뒤 드러내기)는 그대로예요.
  2. 드러내기를 hidden 토글 대신 다른 방식으로 바꿔요. 다만 F2-R(CSP 차단 시 숨김 유지) 조건을 다시 검수해야 해요.
- 1번이 변경 범위가 가장 작아요. 그래도 React가 이후 다시 렌더링할 때 `hidden`을 되돌리지 않는지(서버 컴포넌트 재요청·`router.refresh`)는 따로 확인해야 해요. 이번 측정에서는 hydration 뒤 재렌더링이 없었어요.

## 제약

- 합성 데이터와 루프백 PG17만 썼어요. 운영 DB, 실제 Supabase 세션, CDN, 실제 호스트의 bfcache 정책은 확인하지 않았어요.
- Turbopack dev는 돌리지 않았어요(검수에서 관측한 dev/webpack만 재현).
- 브라우저는 ego(Chromium) 하나예요. Safari·Firefox의 bfcache 동작은 다를 수 있어요.
- 같은 작품을 다시 게시하는 경우: 합성 증빙의 표지 키가 세대 1에 고정이라, 세대 4 재게시는 `source-unavailable`로 끝났어요. 그래서 실행마다 다른 작품을 썼어요(fixture 한계, 제품 동작 아님).

## 정리

- production(43308)·dev(43309) 서버와 루프백 PG17을 멈췄어요. 실행기의 "temporary cluster removed"를 확인했고, 두 포트에 대기 중인 연결도 0이에요.
- 격리 사본을 지웠고 원본 `node_modules`는 283개 그대로예요.
- ego 작업 공간 5개(본 실행 4, 기록기 확인 1)를 모두 닫았고, Tester에게 시작·끝을 알렸어요.
