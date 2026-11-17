# T234 · 클라우드 개인 관리 독립 검수 — FAIL

대상 고정 SHA는 `3b32ad0be22e9cfd3ac251e79818ae04214106ad`다. 상위 T229, Master 배정 `msg_376c2aebdad8`, 착수 `msg_143525a851eb`. T229 최종 보고, T230 `8507612`, T231 역사적 부분 검토, 최신 플랜/v1.4를 읽었다. 제품 b7a0a94 이후의 문서 차이 후보이며 T231의 6308791 판정을 현 후보로 옮기지 않았다.

**판정 FAIL: 필수 수정 2건.** 새 목록 관리 링크의 hit box 18px와 기존 공통 SessionBoundary의 same-account 포커스 복귀 누락을 실제 브라우저에서 재현했다. 관련86·추가 SSR13은 통과하지만 이 실행 결함을 덮지 않는다. Master가 각각 T229-FIX, T235로 분리 배정했다. 새 후보 ec1609e나 T235 수정 결과를 이 원 고정본 판정에 섞지 않았다.

## F234-1 · 새 목록 관리 링크가 양폭 18px

`app/(cloud)/cloud/projects/(list)/page.tsx`의 신규 `개인 관리 보기 →`는 plain Link이고 전용 최소 조작 크기가 없다. T230 신규 본문 조작 44px 요구에 미달한다.

합성 A → `/cloud/projects` → `a[href="/cloud/manage"]`의 native getBoundingClientRect 실측:

| viewport | width × height | computed |
| --- | --- | --- |
| 1280 | 102.78125 × **18px** | display:inline, min-height:0, line-height:24px, font-size:15px |
| 390 | 102.78125 × **18px** | 동일 |

정상 대조: 관리 본문 `내 프로젝트`, `다시 불러오기`, `내 프로젝트 보기 →`는 양폭 모두44px다. 목록 링크는 Tab4회로 도달하고 Enter 이동은 되므로 링크 부재가 아니라 클릭 영역 문제다. 소스/기하/캡처가 일치하고 단독 서비스 점유 뒤에도18px을 재확인했다. 목록 본문 뒤에 있는 **위치 자체는 반환 사유가 아니다**. 기존 공통 sm 버튼32px은 이 신규 링크 결함과 별개다.

근거: `evidence/list-link-hitbox.json`, `controlled-final-controls.json`, `list-link-controlled-390.png`. 최초 FAIL 전달 `msg_ccb9e6bfbd5e`, Master 필수수정 판정 `msg_69b7743a950a`.

## F234-2 · 공통 same-account 복원 뒤 포커스가 BODY로 빠짐

이는 T229 변경 파일 밖의 기존 `components/auth/session-boundary.tsx` 동작이다. 신규 화면이 유발한 회귀인지와 별개로 T230 V5/V9의 공통 포커스 복귀 계약을 충족하지 못했다. 본문 보안 차단과 DOM 보존은 통과했다.

최소 재현:

1. 단독 합성 A 세션의 관리 화면에서 다시 불러오기 anchor에 focus. 실제 activeElement=`A`, href=`/cloud/manage` 확인.
2. browser test gate로 `/api/auth/session` 요청만 지연시키고 BroadcastChannel 변경 신호를 보낸다. 본문 hidden/inert, activeElement는 session notice로 이동한다.
3. gate를 풀어 **실제 서버의 same 응답**을 받는다. 본문이 같은 node·같은 조회 시각으로 복원되지만 두 animation frame 뒤에도 activeElement=`BODY`, href=null이다.

p1에서 관찰하고 p2에서 독립 재현했다. 정상 no-hide 대조에서는 동일 링크의 focus가 두 frame 뒤에도 유지된다. shared Auth cookie 경합을 중지하고 A 재인증을 확인한 뒤의 관측이다. 원86의 focus 시험은 소스 정규식 검사여서 이 실제 누락을 검출하지 못한다. 구현 원인을 확정하지 않았고 임의 수정하지 않았다.

근거: `evidence/focus-restoration-observation.json`, `controlled-final-controls.json`, `tmp/t234/browser-17.mjs`. 첫 재현의 같은 node/시각 증거는 `session-suspect-same.json`이다. Master 전달 `msg_682a5579d8d0`, T235 필수수정 배정 `msg_71c4cdbd2377`, Front 직접 재현 전달 `msg_72ade3917694`.

## 고정 소스와 production artifact 출처

Tester 사본 `D:/starwork/t234-manage-3b32ad0`, archive `D:/starwork/t234-source.zip`. LF 보존 archive 후 deps/PG 도구를 물리 복사했다. tracked1,030개 blob은 전후 고정 SHA와 모두 일치했다. 추가 test/helpers/증거는 사본 안에만 두었다.

**Tester는 production build/typegen/배포를 실행하지 않았다.** Front/main PC가 제공한 artifact로만 실제 화면을 검수했다.

- 기존 고정3b32ad0 build: shared repo `tmp/t213-http-84d981f2-138e-40ef-bc30-9b78f1d57436`, BUILD_ID `u2XABgzAP2Y30h7eDvE0P` (종료된 과거 자체 검사 근거).
- 실제 독립 관찰 서비스: `tmp/t213-http-c0d2d1ce-51ba-437c-a192-e46febd94622`, base `3c6c5eee78f5ea94c6b0c105524216a4f7c2328b`, BUILD_ID `jCnXpAs-wt9bY2U-Cj3X_`, localhost app59665 / TLS PG59660 / fake Auth59664.
- `git diff`로 app/components/lib/proxy.ts/next.config.ts/package*.json/public의 두 SHA 차이가 없음을 확인했다. 실제 build app의 제품300파일도 고정 사본과 대조했다. **내용 차이0, 266파일은 CRLF/LF만 다름**이다. byte-identical이라고 주장하지 않는다. 하네스 source.json의7개 overlay SHA도 실제 파일과 일치하며 removed는 없다.
- `evidence/build-provenance.json`에 전체 대조와 provenance를 보존했다. build.log/source.json/run.json/.next/BUILD_ID는 Front 소유 root에 남아 있다. 현재 working tree WIP나 수정 후보를 테스트 입력으로 삼지 않았다.

## 실행 결과와 독립성

| 검증 | 실제 결과 | 해석 |
| --- | --- | --- |
| t229+t207+t220+t213 원 관련 시험 | **86 PASS**, exit0 | 고정 사본에서 직접 실행 |
| 별도 T234 SSR 시험 | **13 PASS**, exit0 | 별도 기대/assertion, 관련 원본 helpers 재사용 |
| TypeScript noEmit | exit0 | production build 없음 |
| target ESLint | exit0, warnings0 | manage/list page 및 관련 원본 test |
| 독립 Node HTTP | **7개 관측 통과** | cookie jar 분리, 실제 Next/fake Auth/TLS PG |
| 실제 ego-browser | 아래 양폭·회복·세션 및 **2개 결함** | unit 수에 합산하지 않음 |

저자 전체1600/317skip·production build·자체 HTTP14는 저자 근거다. 전체1600을 독립 재실행하지 않았다. 독립86/13과 브라우저 관찰을 그 숫자에 합치지 않는다. Front 하네스의 최종 HTTP14 결과는 server 종료 근거로 읽었으며 독립7과 구분한다.

추가 SSR13은 같은 배열의5종 상태 합계·private DTO 제거, 지연 읽기 완료 뒤 조회 시각/KST, 자료오류400/404/500의 숫자·시각 미표시, adapter Auth401/403/503의 기존 redirect, normal→error→empty 재호출의 stale 값 미사용, 관리 subtree를 실제 common boundary의 checking/offline/unavailable로 감쌌을 때 hidden/inert, cleared 때 DOM 삭제를 포함한다. local/초기 Auth 우선·list0/SQLite0·verified read1은 원 관련 시험에서 직접 통과했다. invalid project date가 전체 화면을 깨지 않는 원 시험도 통과했다.

독립 HTTP7은 anonymous manage307와 정확한 manage next, verified manage200와 proxy+render Auth2회 및 private owner 미노출, A/B 목록 상호 격리2개, A의 B 단건404, outside callback의 forbidden redirect/세션 미생성, 안전한 API list DTO다. raw input/서버 secret/API password가 없음을 검사했다. 실제 SSR provider503·local manage의 별도 HTTP 서버 관측은 수행하지 않았으며 해당 분기는 unit과 기존 하네스 근거 범위다. 이를 실제 HTTP PASS로 확대하지 않는다.

## 실제 화면·세션 관찰

- 정상 1280/390: h1 1개, 이번 목록1개, 분포0/0/0/0/1 합계1. 미연결3, 쓰기 form/input/button0, 중요한 안내15px. 전체 document 가로 넘침 없음(0 또는 scrollbar 여유 -15). 실제 총수·worker 현재 실행·Storage 성공을 주장하지 않는다.
- 빈 목록 성공: owned A fixture의 archived_at만 제어해 실제 결과0을 만들었다. 양폭에서0·성공 조회 시각·이번 목록에 없음, 분포 없음. PC 보관/옮김 단정 없음.
- 데이터 오류: 같은 owned project의 template snapshot을 `{}`로 만들어 실제 read validation을 실패시켰다. 양폭에서 재조회 안내만, 숫자/분포/time 없음. fixture 복원 후 본문 링크 클릭으로 새 문서·새 ISO 조회 시각·목록1 회복. 같은 URL cache를 성공처럼 표시하지 않았다.
- 키보드: 정상 관리에서 logout→내 프로젝트→다시 불러오기→목록 링크, Shift+Tab 역순과 Enter의 새 문서 재조회. 목록은 logout→새 프로젝트 안내→합성 A 단건→관리 링크, Enter 이동. focus ring solid를 확인했다. 세션 복귀 focus는 F234-2로 별도 실패다.
- 의심: 실제 session POST를 지연시킨 상태에서 본문 hidden/inert, 본문 링크의 focus 진입 차단, h1/숫자/링크가 접근성 snapshot에서 숨음. 서버 same 뒤 **같은 DOM node/조회 시각** 복원은 통과했다.
- unavailable은 브라우저 test response503, offline은 page-scoped CDP network offline으로 제어했다. 둘 다 hidden/inert·정직한 안내, 실제 server same 재확인 뒤 같은 node/시각 복원. provider 서버 자체503의 재현은 아니다.
- 실제 다른 tab에서 B 로그인→A 재로그인을15초 안에 수행했다. 첫 변경은 새 B 문서, 재로드 제한의 다음 변경은 stale로 기존 본문 DOM 삭제. 1280/390에서 protected container/h1/time/private main links 모두0이다. 390 반복 시 본인 test tab의 단일 reload timestamp key를 초기화해 첫 재로드를 허용했다. 전역 저장소나 cookie를 지우지 않았다.
- cleared 뒤 browser test의 늦은 same 응답을 공급해도 이전 본문/h1/time이 복원되지 않았다. 이 응답은 UI race fixture이며 서버 권한 확인으로 쓰지 않는다. 제한시간 뒤 별도 변경 신호에 따른 **새 문서 수신**은 이전 DOM 부활과 구분했다(옛 test globals 없음/새 reload timestamp 확인).

근거 파일은 owned `evidence/`의 manage-normal.json/png, manage-empty-controlled.json/png, manage-error-controlled.json/png, recovery-keyboard.json, session-suspect-same.json, session-unavailable-offline.json, session-account-change-late.json, controlled-final-controls.json, cleared-390-final.json/png다. 최종390 cleared 증거는 `session-cleared-390-final.png`이고, 그 전 `session-cleared-390.png`는 이미 새 문서를 받은 중간 상태라 cleared 증거로 사용하지 않는다. 실제 캡처를 열어 정상/오류/삭제 화면을 확인했다.

## fixture·도구 오류와 경합 구분

deps 물리 복사 중 최초 test 명령은 MODULE_NOT_FOUND로 미실행이었다. 복사 완료 후 원86을 실행해 통과했다. 추가 SSR 최초12/1은 한국어 날짜가 `오전 9:05`인데 검토 기대가 `09:05`였던 formatting 오류다. 실제 ISO 완료 시각 기대값은 유지하고 locale 표현만 고쳐13 PASS를 얻었다. HTTP helper는 outside callback이 이미 forbidden으로 세션을 만들지 않았는데 뒤 manage도 forbidden이라 가정했다. callback forbidden + 이후 anonymous manage next로 기대를 고쳤다. 제품 결함으로 세지 않는다.

Front가 사전 fixture 제어 중 PG를 stop/start하고 archived_at을 조작한 사실을 `msg_67623db0618f`로 알렸다. native postgres.log의 실제 재기동은02:39:54–55 KST였고 run.json의 PG PID66612는 뒤68312로 바뀌었다. 별도 인계 후02:48 controlled empty/error/복구를 재실행했다. PG outage를 제품 오류로 판정하지 않았다.

Front의 FIX용 별도127.0.0.1 서비스 ego 로그인(17:47–17:48Z)과 원 서비스가 같은 cookie 이름을 공유해 기존 session이401로 바뀐 경합도 있었다. 다른 port/TaskSpace를 cookie isolation으로 가정하지 않았다. Front가 `msg_8061f37491e4`로 동시 로그인·중단을 확인했고 이후 브라우저 시간을 직렬화했다. 본인 합성 A를 원 서비스에서 재인증하고 actual same/owner를 확인한 뒤 세션 핵심을 재검증했다. 해당 redirect/context-gone round는 제품 결함 근거로 쓰지 않는다. unavailable 재시도 버튼이 focus 재검증으로 이미 사라진 도구 round도 재관찰 후 정상 복원 경로로 다시 검증했다. 사용자 cookie/global storage/cache 삭제는 없었다.

## 재현 명령·종료·반환

```text
node node_modules/vitest/vitest.mjs run tests/t229-cloud-management.test.ts tests/t207-cloud-read-ui.test.ts tests/t220-protected-content-session.test.ts tests/t213-cross-tab-session.test.ts
node node_modules/vitest/vitest.mjs run tests/t234-independent.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js "app/(cloud)/cloud/manage/page.tsx" "app/(cloud)/cloud/projects/(list)/page.tsx" tests/t229-cloud-management.test.ts tests/t207-cloud-read-ui.test.ts --max-warnings 0
node tmp/t234/http-final.mjs
node tmp/t234/provenance.mjs
node tmp/t234/verify-baseline.mjs
ego-browser nodejs -e "await import('file:///D:/starwork/t234-manage-3b32ad0/tmp/t234/browser-17.mjs')"
```

browser script들은 역사적 TaskSpace23/p1/p2에 대한 재현 절차다. space는 종료했으므로 다음 검수는 새 과제의 space에서 같은 순서를 적용해야 한다. ego-browser guide v2.2.1과 clearing-state 범위를 읽고 사용했다. 스크립트·출력·추가 test는 owned `tmp/t234/`, 로그는 evidence/에 보존했다.

합성 A의 archived_at/template snapshot을 원복 확인하고 browser23을 finish keep[]로 종료했다. Front와 종료를 조정해 지정 harness stop 파일만 생성했다(`msg_83e144c531a7`). 02:58:07 KST 재확인: app PID66992, 초기 PG66612/실제 PG68312 모두 없음; app59665/PG59660/fakeAuth59664 listener 없음; postmaster.pid 없음, pg_ctl stop.log 정상, 하네스 최종 http-results.json 존재. 사용자3013 PID51032 유지. `evidence/cleanup.json`에 보존했다. 공유 `.next`, 실 env/Auth계정/managed/SSL/Storage/API/배포/SQL 제품 소스는 조작하지 않았다.

공유 쓰기는 이 고유 보고서만 선택 commit한다. 원 F234-1은 T229-FIX, 공통 F234-2는 T235로 Master가 별도 담당·범위를 배정했고 수정본 독립 검수는 새 fixed 입력에서 수행한다. 후속 B25-R은 T234 최종 반환 뒤의 별도 활성 작업이며 이 검수와 병렬 실행하지 않았다.
