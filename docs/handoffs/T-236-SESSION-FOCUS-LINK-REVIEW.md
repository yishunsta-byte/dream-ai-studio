# T236 · 세션 포커스·목록 링크 독립 재검수 — PASS

고정 SHA `ebe84eae6611f5e11eedbe6e678c4a05506e0e7a`. 상위 T234/T235/T229-FIX, Master 배정 `msg_2d6227f4ff17`. B25-R 최종 반환 후 단일 활성 검수로 전환했다. 원 T234 `211aee9`, T235 보고 `abda07d`, 목록 FIX `e143d10`과 기존 실패 기대값을 읽었다.

**판정 PASS: 누적 후보의 F234-1/2 수정과 지정 공통 경계 회귀를 수락한다.** 목록 링크는1280/390 양폭44px이고, 실제 focused anchor→notice→같은 anchor 복귀가 비전경 양폭 각2회 및 전경390에서 통과했다. same DOM/time, input selection, multiple ProtectedContent, disabled/removed target, 외부 focus 미탈취, offline/retry/epoch/cleared/late-same도 아래 범위에서 확인했다. 원 T234 고정본의 FAIL은 변경하지 않는다.

제품 수정 없이 고유 보고서만 공유 저장소에 추가한다. 새 agent/window/worktree 없음. Tester가 Next production build/typegen/배포를 실행하지 않았다. Front는 서버만 지원했고 이 검수 동안 브라우저·로그인·DB fixture를 조작하지 않았다.

## 고정 소스와 main PC artifact

owned archive `D:/starwork/t236-source.zip`, 사본 `D:/starwork/t236-focus-ebe84ea`. tracked1,088개 blob은 실행 전후 fixed SHA와 모두 일치했다. 제품소스/테스트/기존 실패 보고서를 바꾸지 않았다.

| Front 소유 artifact | source base / BUILD_ID | 독립 확인 |
| --- | --- | --- |
| `tmp/t213-http-06b4ed3e-c2f7-4f64-b28a-8591ccd406aa` | `b9e7571449c08d57972a0fff1d30ddb807e560fd` / `O7PfEH269AjVgtStWwubf` | 역사적 baseline. 해당 commit의 제품302파일과 대조, 내용 차이0/line-ending-only268/overlay7 일치 |
| `tmp/t213-http-3be0e85b-9c7e-4eee-b54e-c0c217054939` | `ebe84ea…` / `PZuWlXhPbN7-Qw1bG3g4W` | 역사적 fixed. 제품302파일 대조, 내용 차이0/line-ending-only268/overlay7 일치 |
| **이번 native 관찰** `tmp/t213-http-34c03aad-f443-4809-b9b7-e2970dbd8f86` | `85108b60397ad6b5e2235710e30721ceba1bbc3e` / `noWccfF-On6i8n5k59z10` | fixed ebe84ea와 app/components/lib/public/proxy/config/package paths diff 없음. 실제 app302파일과 fixed 사본 내용 일치, source.json7 overlay 일치 |

세 artifact 모두 shared repo 아래 Front 제공 root다. CRLF/LF 차이가 있으므로 byte-identical이라고 주장하지 않는다. 비교 scripts와 `evidence/build-provenance.json`, `historical-build-provenance.json`에 실제 build/source/overlay를 보존했다. 이번 서비스는 app57134/PG57122/fakeAuth57133이고 synthetic only다. 원 baseline 전체 브라우저를 새로 실행하지는 않았으며 원 T234 실행 증거와 해당 baseline artifact 출처를 연결했다.

## 원 결함 재수락

### F234-1 ·44px

실제 `/cloud/projects`의 `a[href="/cloud/manage"]`는1280/390 모두 **110.78125×44px**, document overflow0이었다. 원18px 기대값을44로 낮추거나 대상 링크를 바꾸지 않았다.390 실제 viewport에서 native Tab4회 순서(logout→생성 안내→합성 단건→관리 링크)와 Enter 관리 이동도 통과했다. 원래 본문 뒤의 링크 위치는 반환 사유가 아니며 그대로다.

근거: `evidence/native-fixed-links.json`, `list-fixed-1280.png`, `list-fixed-390.png`. 캡처를 열어 확인했다.

### F234-2 · 실제 focus 복귀

고정 컴포넌트는 숨기기 직전 본문 안의 실제 document.activeElement를 기억한다. 단지 onFocus 이벤트 기록에 의존하지 않는다. 복귀 조건은 연결된 같은 본문 대상이고, 다른 의미 있는 control이 현재 focus를 갖지 않는 경우다. disabled/removed로 native focus가 실패하면 scroll을 강제하지 않는다.

**실제 production 서비스/실제 server same 응답**으로 다음을 기록했다. session 요청을 test gate로 지연시킨 동안만 notice를 관찰하고 gate를 풀었다. 응답을 same이라고 위조해 이 복귀를 통과시킨 것이 아니다.

| 실제 viewport / 문서 focus | 횟수 | 결과 |
| --- | --- | --- |
| 1280×900, document.hasFocus=false | 2 | A(`/cloud/manage`)→notice→같은 A, 같은 body node/조회 ISO |
| 390×900, document.hasFocus=false | 2 | 동일 |
| 390×900, keyboard로 실제 document.hasFocus=true | 1 | 동일, 전경 조건도 별도 확인 |

각 단계에서 실제 innerWidth/innerHeight/hasFocus를 기록했다. 메서드 호출만으로 전경이나390이라고 가정하지 않았다. `exact-viewport-focus.json`이 최종 근거다. 이전 독립 반복도 같았지만 중복 coverage로 더하지 않는다. 원 T234의 BODY 결과는 이 후보에서 재현되지 않았다.

## 시험·관찰 수량

| 층 | 결과 / 정확한 범위 |
| --- | --- |
| 원 관련 Vitest | **91 PASS**, exit0: t235+t229+t207+t220+t213 |
| 저자 browser script 재실행 | **6개 group 기록 완료 후 retry 단계 ERR**. 전체 script PASS라고 세지 않음. 뒤 독립 검증으로 누락 동작을 보완 |
| 독립 native focus cycles | 위5회 + gated500/retry1회. 같은 body/time/target 복귀 |
| 독립 native 경합·단절·계정 관측 | rapid epoch1, offline/online1, 실제 B→A 변경 후 cleared1, late-same 차단1 |
| 고정 원컴포넌트의 별도 browser fixture | **8개 동작 사례 통과**, 아래 설명 |
| 실제 링크·키보드·scroll | 양폭 geometry2,390 Tab/Enter1,390×500 native scroll1 |
| 독립 HTTP | **7개 관측 통과**, Auth/owner/DTO 핵심 |
| TypeScript / targeted original ESLint | exit0 / exit0(warnings0) |

이들은 경로가 겹치는 observation group이며 신규 Vitest test 수나 고유 총 coverage로 합산하지 않는다. 원91 중 focus 관련5개는 정적 조건 고정이다. 작성자 전체1618/319skip과 작성자 자체 브라우저 결과를 독립 재실행 수량으로 올리지 않았다.

저자 script는 ROOT/TAG/output 경로와 기존 TaskSpace31/p1 재사용·finish 시점만 바꿨다. 같은 계정 양폭 각2회, keyboard/scroll record, 글자 선택, 외부 control focus 유지, target 제거의6개 group을 읽고 대조했다. retry에서 gate를 pass로 바꾼 직후 foreground 재확인이 먼저 same으로 복원해 버튼이 사라지는 시험 경합이 발생했다. 저자 script가 ERR을 JSON에 담고 exit0으로 끝나므로 종료코드만으로 PASS라고 하지 않았다. 독립 retry에서는 **버튼 동작이 일어날 때까지 gate를 유지**하고 실제 same 응답을 재개해 복귀를 확인했다. 마지막 cleared/late-same은 별도 실제 계정 변경 검증으로 보완했다.

## 추가 동작 상세와 fixture 구분

- **gated500→retry:** unavailable 동안 hidden/inert·notice 유지, 재시도 후 실제 same으로 원 anchor/body/time 복원. test response500은 provider 서버 실제 장애의 재현이 아니다.
- **빠른 연속 epoch:** 첫 요청이 pending일 때 신호를 추가했다. 오래된 실제 same을 받아도 최신 확인 전에는 hidden/inert가 유지됐고, 다음 실제 same 뒤에만 복귀했다.
- **offline/online:** page-scoped network offline에서 navigator.onLine=false와 hidden/inert, 복구 뒤 actual same/원 focus/node/time 유지.
- **실제 account change/cleared:** 다른 본인 test tab에서 fake Auth B 로그인→A 재로그인을15초 안에 수행했다. 새 B 문서 다음 제한 stale에서 기존 protected body/h1/time/private links가 모두0이다. 그 뒤 synthetic late-same response를 줘도 body/h1/time은0이다. late response는 UI race 제어이며 서버 권한 확인이 아니다. 본인 synthetic tab의 단일 reload timestamp key만 제어했고 profile cookie/global storage/cache를 지우지 않았다.

관리 화면 자체는 입력을 만들지 않으므로 input selection·native disabled·여러 ProtectedContent는 **별도 소유 browser fixture**에서 확인했다. fixed `components/auth/session-boundary.tsx`를 그대로 import해 실제 React/DOM/useLayoutEffect로 두 ProtectedContent를 렌더했다. 기존 설치 esbuild로 test fixture JS/CSS만 만들었으며 **Next production build/배포 산출물이 아니다**. component source는 고치거나 mock하지 않았다. Context 상태만 제어하므로 이 fixture는 Auth 판정/useSessionWatch 네트워크의 증거로 쓰지 않는다. 빌드 입력18개와 원 module 경로는 component-fixture-metafile.json에 있다.

8개 actual browser 사례:

1. 입력 값·2~7 backward selection·input node와 두 body node가 같은 채 focus 복원.
2. 두 번째 ProtectedContent의 target focus가 첫 번째로 빼앗기지 않음.
3. 숨김 중 outside 의미 있는 button으로 옮긴 focus를 복귀 때 빼앗지 않음.
4. React가 target을 제거한 경우 강제 focus/오류 없음.
5. **native button을 disabled로 바꾼 경우** 실패한 focus를 성공처럼 scroll하지 않고 오류 없음.
6. 화면 밖 bottom target의 focus/가시 위치 복원.
7. checking→offline→checking 연속 provider epoch 뒤 원 input focus 유지.
8. cleared 때 두 protected body 모두 DOM 제거, 후속 epoch에서 부활 없음.

모든 fixture 사례에서 수집한 browser error0이었다. fixture는 이후 test page navigation으로 제거됐고 별도 listener/server를 만들지 않았다. 원 서비스의 Auth·권한·API를 수정하지 않았다.

## viewport·scroll 측정 구분

첫 고수준 키보드 probe에서는 에뮬레이션을 지정했어도 실제 viewport가1409×1242로 바뀐 구간이 있어390×500 결과로 사용하지 않았다. 정확한 viewport를 매 단계 기록하고 CDP/native key 경로로 다시 측정했다.

최종 native390×500: 대상 top562.328125/bottom606.328125, scrollY260 → 숨김 중 scrollY0 → 복귀 후 **같은 대상 focus, 같은 DOM/time**, top456.328125/bottom500.328125, scrollY366이었다. native integer scroll quantization 때문에0.328125px가 남는 raw 값을 보존했다. 이 가시 위치 검증에는1 device pixel(여기서 DPR1) 허용오차를 적용했다. 원 결함의 **focus A 복귀와44px 요구는 정확히 유지**했고 그 기대값을 완화한 것이 아니다. fixture의 bottom-target도 같은 목적의 viewport 복귀를 통과했다.

## 핵심 회귀·한계

독립 HTTP7은 anonymous manage307/정확한 next, verified manage200 및 proxy+render Auth2회/private owner 미노출, A/B 목록 상호 격리2개, A의 B 단건404, outside callback forbidden/세션 미생성, safe API list DTO다. 실제 owner scope를 확인했고 server secret/raw input/API password가 없었다. Auth 초기 거절 시 read0/SQLite0, local, unavailable 등의 원91 회귀도 통과했다. 실제 SSR provider503나 실제 managed 계정을 새로 만들지는 않았다.

브라우저 fake Auth/owned PG/Node26 Windows synthetic 범위다. OS/스크린리더/실휴대폰/실제 사용자·managed·Storage·운영 개통의 수락이 아니다. 다른 탭·port가 cookie를 격리한다는 가정은 하지 않았다. Front의 서버-only 인계 이후 이 작업만 ego를 사용했고 이전 T234의 교차-service cookie 경합을 재현 근거로 섞지 않았다.

## 재현·증거·정리

owned copy cwd:

```text
node node_modules/vitest/vitest.mjs run tests/t235-session-focus-restore.test.ts tests/t229-cloud-management.test.ts tests/t207-cloud-read-ui.test.ts tests/t220-protected-content-session.test.ts tests/t213-cross-tab-session.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js components/auth/session-boundary.tsx "app/(cloud)/cloud/projects/(list)/page.tsx" tests/t235-session-focus-restore.test.ts --max-warnings 0
node tmp/t236/provenance.mjs
node tmp/t236/historical-provenance.mjs
node tmp/t236/audit-observations.mjs
node tmp/t236/verify-baseline.mjs
node tmp/t236/http-final.mjs
node tmp/t236/compile-component-fixture.mjs
ego-browser nodejs -e "await import('file:///D:/starwork/t236-focus-ebe84ea/tmp/t236/browser-10-exact-viewports.mjs')"
```

browser scripts는 종료된 TaskSpace31의 역사적 단계다. 다음 재현은 새 과제 space/제공 service를 쓰며 source 기대값은 유지해야 한다. guide v2.2.1의 한 goal/한 space·마지막 finish·scoped storage 원칙을 적용했다. 원 script/추가 scripts는 owned tmp/t236에만 두었다.

owned evidence: related91.log, static-checks.json/type.log/lint.log, baseline-integrity.json, build-provenance.json/log, historical-build-provenance.json, author-browser-t236-adapted.json, author-browser-run.log, independent-native-core.json/log, exact-viewport-focus.json, component-native-results.json, component-native-run.log, component-fixture-metafile.json, native-epoch-offline-cleared.json, stable-native-scroll.json, native-fixed-links.json/png, independent-http.json, observation-audit.json, cleanup.json. 초기 잘못된 viewport/strict subpixel probe 기록도 남겼으며 최종 근거와 구분했다.

browser31 finish keep[] 후 Front와 조정해 허용된 root34c03aad의 stop 파일만 생성했다(`msg_bc1560f6f9bf`). Front 종료 확인 `msg_94ad8ee43cb7`은 harness exit0/3ports 종료다. **03:31:16 KST 독립 재확인:** app70464/PG40720 없음, app57134/PG57122/Auth57133 listener 없음, postmaster.pid 없음, pg_ctl stop 정상, 최종 http-results.json 존재. 사용자3013 PID51032 유지. shared.next/실 env/계정/운영/배포/타 WIP를 건드리지 않았다.

03:30 Master 상태 요청에 실제 관측·차단 없음·최종 보고 단계 `msg_7ea28f60c99f`로 회신했다. 이 고유 보고서만 선택 commit하고 fixed SHA/수량/한계/build 출처/정리/commit을 실제 Orca로 반환한다. 공용 TEAM/상태 기록은 Master 담당이다.
