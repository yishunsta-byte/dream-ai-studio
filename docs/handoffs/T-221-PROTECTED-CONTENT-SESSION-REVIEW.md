# T221 보호 본문 세션 경계 독립 재검수

- **전체 FAIL: F221-1 입력 소실 P1, F221-2 탐색 메뉴 작업 수 잔류 P2.** Master가 중간 보고를 확인하고 이 우선순위로 T224를 별도 배정했다. 이번 검수에는 그 수정 WIP를 넣지 않았다.
- T216의 원래 세 경로(15초 guard/offline/session API만 차단)에서 **cloud 본문 숨김·inert/확정 뒤 DOM 제거는 PASS**다. 이 결과로 원 T216 FAIL을 소급 지우거나 이번 전체 FAIL을 PASS로 축소하지 않는다.
- 고정 **`371d5cc255e98eb5d2264554643f81c499ad8114`**, 작성자 보고 `ec91a55:docs/handoffs/T-220-PROTECTED-CONTENT-SESSION-FIX.md`, T216 원문·보존 harness를 읽었다. 제품 수정 없이 고유 보고서와 소유 격리 자료만 작성했다. 운영지침1.1 수신·숙지를 유지한다.

## F221-1 · P1: 같은 계정 확인 후 미저장 폼 입력이 사라짐

실제 StudioShell+verified account를 자기 환경에서 재현했다. 새 소유 SQLite에 제품 migrate/seed를 실행하고, 합성 A 로그인으로 실제 `/menus/shopping-shorts/new`의 **ProjectForm**을 열었다. 실제 계정·사용자 DB·제품 코드 모의 교체는 없다.

1. 제목에 `T221 UNSAVED PRIVATE DRAFT`, 목표에 `T221 unsaved goal text`를 실제 입력한다.
2. 이 탭을 offline으로 두고, 같은 local origin의 다른 탭에서 실제 BC `changed` 신호를 보낸다. 계정은 바꾸지 않는다.
3. 보호 본문은 hidden+inert가 되지만, 기존 input DOM은 **isConnected=false**, 새 hidden input의 value는 이미 빈 문자열이다.
4. online 복귀 후 실제 API가 **same**을 반환한다. 같은 document에서 폼이 복원되지만 제목·목표가 모두 `""`다. 저장·제출·새로고침을 하지 않았다.

별도로 **online 상태만으로 재현**했다. 두 번째 draft를 입력하고 다른 탭에서 `untrusted-test-signal`을 보낸다. 실제 서버의 same 응답 전달만 잠깐 보류했다가 해제해도, 같은 document에서 두 값이 비고 원 input은 연결 해제된 상태다. 단순 offline 실패나 계정 전환 때문에 의도적으로 초기화된 경우가 아니다.

증거: `10-local-draft-before-signal.json`~`16-local-untrusted-same-draft-lost.json`, `network-06-local-form.json`, `network-07-local-same-guard.json`. 전후 document marker 동일, 실제 입력값·원 DOM identity·same 응답을 함께 보존했다. 브라우저가 보낸 프로젝트 POST는 0, 종료 후 합성 SQLite 프로젝트 수는 원래 **1**, jobs는 **2**다.

`ProtectedContent`는 current 때 단일 `<div>{children}</div>`, 의심 때 `<Fragment><notice/><div hidden inert>{children}</div></Fragment>` 구조다. 실제 DOM 연결 해제와 폼 값 초기화는 이 전환에서 자식이 재마운트되는 구조와 일치한다. 숨긴 내용을 같은 계정 확인 뒤 복원하면서 입력을 보존한다는 T220 계약이 미충족이다. **의심/복원 동안 자식의 안정된 위치·identity·상태를 유지하되, confirmed 때는 실제 제거하는 보완이 필요**하다. 제품은 고치지 않았다.

## F221-2 · P2: 머리글은 숨겨도 탐색 메뉴 작업 수는 남음

같은 실제 StudioShell에 합성 queued1/failed1을 준비했다. 정상 머리글은 `진행 0 · 대기 1`, sidebar는 `작업 대기열 1 !1`을 표시했다.

- offline 신호로 main을 hidden+inert 처리하면 **머리글 작업 수는 숨지만 sidebar의 1·실패1은 그대로 보인다**.
- 실제 Tab이 `작업 대기열1!1` 링크에 도달한다.
- B로 첫 자동 재로드 후 다른 탭에서 A로 빠르게 로그인하여 confirmed guard를 만들면 **main DOM은 0인데도 같은 sidebar 수가 남는다**.
- 코드의 머리글은 `confirmed&&counts`로 가리지만, 공용 `links`의 queueNumbers/failedCount는 confirmed 조건이 없다. 같은 links를 desktop/sidebar와 mobile drawer가 사용한다. 실제 화면 재현은 **1280 desktop**이며 mobile drawer를 따로 실행했다고 주장하지 않는다.

증거: `11-local-offline-nav-and-draft.json`, `12-local-form-blocked-keyboard.json`, `18-local-confirmed-nav-counts.json`, 직접 열어 확인한 `local-guard-nav.png`. 합성 local SQLite는 계정별 owner 저장소가 아니므로 이를 PostgreSQL owner 격리 우회로 해석하지 않는다. **확인되지 않은/변경 확정된 계정 화면의 작업 수를 숨긴다는 표시 경계가 일부 빠진 문제**다. static 메뉴 자체를 모두 폐쇄해야 한다고 주장하지 않으며, 계정/업무 데이터에서 온 부가 수치·동적 표시도 같은 경계로 처리하는 최소 보완이 필요하다.

## 통과한 실제 경계와 구분

ego-browser TaskSpace **6** 하나, cloud p1/p2와 추가 실제 local p3를 사용했다. 서로 다른 origin의 BC를 혼동하지 않도록 local 신호 시험 때 p2도 `127.0.0.1:43345`로 이동했다. 쿠키는 같은 loopback host를 공유하지만 cloud/local BC 전달 범위는 포트별 origin으로 구분했다.

| 검증 | 이번 결과 |
|---|---|
| T216 guard 경로 | 실제 빠른 B→A 전환 뒤 stale. old cloud 카드·링크를 포함한 data-protected-content **DOM0**, main은 새로 고침만. 실제 Tab에서 old 본문 접근 없음 |
| confirmed 이후 same | 원 epoch B로 callback 로그인하고 실제 신호를 보내 same 응답을 받아도 **같은 문서에서 DOM0 유지**. 수동 새로 고침 Enter 뒤 현재 계정 화면 |
| T216 offline390 경로 | B 상세에서 실제 offline→다른 탭 로그아웃. B 제목/정보는 innerText에 없음, hidden+inert block1(그 안의 기존 데이터는 DOM에 있음). hidden 제외와 DOM 제거를 구분 |
| hidden focus/키보드/조작 | 본문 링크 focus 시도 후 안내에 activeElement 유지. 실제 Tab7회 모두 보호 본문 밖. local 실제 폼도 hidden focus/Enter/Tab으로 제출되지 않고 프로젝트 POST0 |
| T216 session-only 차단390 | navigator online, session URL만 실제 Network 차단. 확인 불가 안내, old cloud body hidden+inert, visible main controls는 안내의 다시 확인뿐, 가로 넘침 없음 |
| 늦은 옛 same 경합 | B same 실제 응답 전달 보류→A 폼 로그인 신호→해제. 보류 문서 MutationObserver에서 **old B 이메일/보이는 B 본문 재등장0**. 이후 새 document A 목록 |
| 의심 상태의 same | cloud 새 프로젝트 준비 화면과 legacy 준비 화면은 같은 문서에서 가림→same 뒤 복원. local도 표시 자체는 복원되지만 폼 상태 보존은 F221-1 FAIL |
| 새 준비 화면 | `/cloud/projects/new` 실제 링크 이동. 준비 안내·목록 링크가 같은 경계 안에서 가려짐. 입력 폼 없음. 새 생성 POST/업무 쓰기 실행 없음 |
| legacy 준비 화면390 | offline 신호 때 “로그인 정상” 문구·내용 가림, hidden+inert. online same 복원, 실제 다른 탭 B 폼 로그인 후 새 문서 B. 390에서는 이메일 CSS가 숨기므로 aria logout 이름도 확인 |
| 정상·partial logout | 실제 버튼. 정상은 두 탭 로그인 이동, partial은 실행 탭 정확한 notice/다른 탭 로그인 이동. 새 `/api/projects`는 **401/no-store**. 원 runner의 logout-fail은 finally 제거 |
| 실제 native history | A 상세→다른 탭 B 로그인 후 B 기준 찾을 수 없음. 실제 뒤로/앞으로에서 old A 본문 없음. 목록의 실제 Link로 이동하면 B 카드만. 뒤로 직후 snapshot은 URL이 목록이어도 과도기 404였으므로 그 snapshot을 “목록 렌더 완료”로 집계하지 않음 |
| prefetch | 실제 제품 Link의 `next-router-prefetch:1`/`rsc:1` 요청 200 기록. fake popstate/focus/임의 RSC 응답으로 navigation을 대신하지 않음 |
| 감시 중복·타이머 | 실제 단일 BC 신호→지연한 same 요청은 프런트 session POST **1회**. 경계 안 AccountMenu의 자체 watch는 enabled=false. 새 boundary/hook에 타이머/poll 없음. **기존 StudioShell jobs poll 타이머는 존재**하며 이를 타이머0으로 숨기지 않음 |
| 사용처 inventory | AccountMenu 3곳(cloud layout/CloudPending/StudioShell) 경계 연결 검토. 새 무경계 사용처를 소유 사본에 넣으면 inventory **예상1 FAIL**, 제거 후14PASS. main 연결 검사가 sidebar 데이터까지 보장하지 못한 것이 F221-2 |

이 검수는 사용자 표시·포커스·실제 입력 조작 경계다. JS가 이미 받은 자료를 메모리에서 지운다는 보장이나 스크립트 자체의 임의 submit/fetch 권한 통제를 주장하지 않는다. 서버는 계속 요청마다 별도로 인증한다.

## late same timeout과 문서 이동의 원인 구분

`browser-08`은 실제 same 보류·새 신호·해제를 마친 뒤 waitForFunction에서 timeout이 났다. **이를 제품 FAIL이나 미실행으로 단정하지 않았다.** 같은 TaskSpace를 그대로 읽은 `22-cloud-race-observed.json`에서는 이미 새 document A였고 정상 목록을 표시했다. 이전 문서의 beforeunload 기록에 held same 시각 `1794917969381`, 해제 `1794917969910`, old body/email visible false가 남았으며 새 문서의 실제 prefetch는 `1794917970115`부터 완료됐다. 즉 10초 제품 대기 실패가 아니라 대기 helper가 문서 전환을 놓친 관측 오류와 일치한다. helper 내부 원인을 확정한 것은 아니다.

작성자가 기록한 **원인 미확정 1회 문서 이동은 그 run의 원인을 재현·입증하지 못했으므로 그대로 미확정**이다. 이번 late-same 뒤 문서 이동은 현재 계정 A로의 예상 갱신과 일치한다. 이를 작성자의 과거 미확정 사건까지 소급 해결한 것으로 보고하지 않는다. 모든 unmount/장기 정지 race가 검증됐다고 확대하지 않는다.

## 고정 환경·실행·증거

소유 root **`D:/starwork/t221-boundary-371d5cc`**, 새 archive `D:/starwork/t221-source.zip`. root와 원 runner가 만든 실제 app 모두 **추적953개 Git blob 차이0**. 물리 node_modules·서명된 PG18.7·OpenSSL을 이전 소유 사본에서 복사했다. shared checkout/설치/공유 .next를 쓰지 않았다. 원 runner를 고정 HEAD로 실행하기 위한 자체 git object alternate/ref/index만 만들었다.

- 원본 `tests/t213-cross-tab-session-http.mjs` **수정 없이 실행**. `tmp/t213-http-a704912e-7a7d-496e-8650-1e29ec28cad4`, fixed371d5cc, overlay7도 같은 기준. 합성 새 TLS PG+실 SDK fakeAuth, production build/TypeScript 검사, **14 HTTP 관측 PASS**, hold 뒤 stop/local 대조/finally까지 exit0. TLS1.3 증거 `tls.json` 보존.
- 관련 **9 files / 423 PASS**(t22014 포함). inventory 제거 후14 재실행은 중복이고 새 합계로 더하지 않는다. 제품 변경7파일의 eslint와 `scripts/verify-build.mjs`도 exit0. 전체 eslint/별도 root tsc/full suite를 독립 실행한 것으로 표현하지 않는다.
- `tmp/t221/analyze.mjs`: 보존 관측의 **20개 사실 assertion 통과**, 두 실패 재현 사실도 검사한다. 제품20개 PASS라는 뜻이 아니다.
- local: `DREAM_DATA_ROOT=<owned>/local-runtime`, 제품 `scripts/db.ts migrate/seed`, 합성 프로젝트1과 synthetic queued/failed jobs2. runtime은 sqlite, `DREAM_AUTH_MODE=supabase`, **fakeAuth만 연결**. 실제 DB·계정 없음. healthy startup→실제 StudioLayout→SessionBoundary→StudioShell→ProjectForm을 통과했다. 단독 모의 셸/테스트 시안이 아니다. local 저장소의 owner 분리·worker 실행/실 CRUD 검수를 새로 수용한 것은 아니다.

주요 명령:

```powershell
node tmp/t221/verify-baseline.mjs
node tmp/t221/prepare-local.mjs
node tests/t213-cross-tab-session-http.mjs --bin D:/starwork/t221-boundary-371d5cc/.tools/pgsql/bin --openssl D:/starwork/t221-boundary-371d5cc/.tools/openssl/openssl.exe --hold
node tmp/t221/run-related.mjs
node tmp/t221/prepare-browser.mjs
node tmp/t221/local-server.mjs
ego-browser nodejs -e "await import('file:///D:/starwork/t221-boundary-371d5cc/tmp/t221/browser-01.mjs')"
# 같은 TaskSpace6에서 번호별 browser-02…12 실행, 대기 오류는 관측 후 별도 복구 script로 이어 실행
node tmp/t221/inventory-negative.mjs
node tmp/t221/analyze.mjs
node tmp/t221/verify-runtime.mjs
# 원 runner app에서 verify-build + 변경 제품7파일 eslint
```

근거: root `evidence/`의 번호별 JSON(visible text와 raw protected DOM·hidden/inert·controls·실제 input 값·document identity·focus·request·signal), `network-*.json`, PNG, `related.log`, inventory negative/restored logs, `analysis.json`, baseline/runtime source identity, local migrate/seed logs·pids와 원 run의 build/http-results/tls/fake-events/run/next-stop/stop logs. 모든 재현·관측 script는 `tmp/t221/`에 보존했다.

초기 `browser-02`에서 hidden selector를 기본 visible 대기로 기다리는 잘못으로 timeout이 났다. 이어 관측 때는 세션이 이미 로그인 화면으로 이동해 있어 offline 단계를 성공으로 채택하지 않았다. **hidden DOM 존재 predicate를 사용한 새 실제 offline 흐름을 같은 TaskSpace에서 재실행**한 `browser-04`/`06`/`07`을 증거로 썼다. 반복 실패 조건을 그대로 두고 PASS로 치환하지 않았다. 이 대기 오류와 위 late-same helper 오류를 제품 결함 두 건과 구분한다.

## 미검증·정리·반환

- 작성자 전체 suite **1352 PASS / 84 skip / t164 2FAIL**은 작성자 보고이며 이번에는 재실행하지 않았다. Master가 Front T223에 원인 진단·시계 시험 수정을 따로 배정한 것으로 수신했다. 원인/기존 실패 여부를 독립 확인한 것으로 주장하지 않고, 그 후속 수정도 fixed371에 섞지 않는다.
- 자연 JWT 만료/refresh 회전·실제 frozen/hidden 탭·BFCache persisted=true 복원·다른 브라우저/기기·실 Auth/managed/배포는 미검증. 이번 native history는 실행했지만 BFCache 복원 관측은 없고 탭들은 visible이었다.
- 합성 세션 로그아웃 뒤 TaskSpace6를 마지막 별도 script `finish({keep:[]})`로 닫았다. 소유 local harness **57340**, Next **69688** shutdown/exit0. 원 runner parent **64924**, cloud Next **15564**, local 대조 Next **78908**, PG **73840** 종료. `server stopped`, `postmaster.pid` 없음 확인.
- 마지막 실제 확인 **2026-11-17 21:25:37 +09:00 (Asia/Seoul)**: 소유 **52863/52855/52862/43344/43345 listener0**, 소유 root 명령줄 node0, PG pid file 없음. 사용자 **3013 PID51032 유지**. source953/관측20 검증과 local 프로젝트1/jobs2도 보존했다.
- 공유 제품/공용 상태 문서·T224/Backend 등 타 WIP·실 저장소·OS 시계·배포는 수정하지 않았다. 소유 사본과 증거는 보존한다. 고유 보고서만 선택 커밋하며 push 없음.

Master 반환 요지: fixed371의 cloud F216 세 경로와 confirmed same 미복원·late same·사용자 폼 조작 차단은 통과했지만, **동일 계정 복원 시 실제 입력 소실 P1과 sidebar 작업 수 표시/Tab 잔류 P2로 T221 전체 FAIL**입니다. 실제 StudioShell+verified synthetic account까지 재현했고, 후속 T224 고정 SHA에서 이 두 원 재현을 다시 검수해야 합니다. 기존 T216 기록·full suite2FAIL·자연exp/BFCache/hidden 미검증은 유지합니다.
