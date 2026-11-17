# T216 탭 간 세션 수정 독립 재검수

- **전체 판정: FAIL — F216-1(P2), 계정 확인이 보류·실패하거나 변경이 확정된 상태에서 이전 owner의 보호 본문·링크가 계속 남는다.**
- 일반 온라인 흐름의 F209-1 이메일 표시 잔류 수정, auth-only 세션 API, 경합 방지, 좁은 화면 안내는 아래 범위에서 PASS다. 새 요청의 권한 우회나 DB owner 격리 실패는 관측하지 않았다.
- 고정 SHA: **`14e34250f2c8c874e2c4eb074dcd53d9406049ac`**. 별도 최신 작성자 보고 `T-213-CROSS-TAB-SESSION-FIX.md`와 정정 `35260fd`(신규24/관련417)를 읽었다. 보고서 커밋을 제품 기준에 섞지 않았다. 원 T209 보고와 보존 harness도 비교했다.
- Master 배정 T216. 제품 수정 없이 이 고유 보고서와 소유 격리 검증 자료만 작성했다. **운영지침 1.1 수신·숙지**: 공용 문서는 덮지 않고 실제 결과를 Orca로 반환한다. 턴 밖 감시나 mailbox polling을 설정하지 않았다.

## F216-1: 이메일 숨김만으로 보호 본문 경계를 닫지 못함

별도 시안이나 시험용 업무 링크를 추가하지 않았다. 이번에는 기준 코드에 있는 실제 cloud 목록·상세·Next Link와 합성 PostgreSQL 데이터를 사용했다.

| 실제 재현 | 계정 메뉴 | 기존 보호 본문 | 서버 경계 |
|---|---|---|---|
| B→A 자동 재로드 후 약 1.4초 안에 다른 탭의 폼으로 B 로그인, 15초 guard 발동 | 이메일 없음, 계정 변경·새로 고침 안내 | **A 프로젝트 목록 카드와 A 상세 링크가 남음** | session API는 `changed`, 다른 탭의 현재 B 비교는 `same` |
| B 상세 탭 offline 중 다른 탭에서 B 로그아웃 | 이메일 없음, offline 안내·다시 확인 | **B 제목·기본 정보·단계 상태와 목록 링크가 남음** | 다른 online 탭의 새 `/api/projects`는 **401 AUTH_REQUIRED** |
| B 목록 탭에서 session API만 네트워크 차단한 뒤 다른 탭 폼으로 A 로그인 | 이메일 없음, 확인 불가·다시 확인 | **B 목록 카드와 B 상세 링크가 남음** | 다른 탭의 현재 A 비교는 `same`; 차단된 탭의 navigator는 online |

첫 번째는 서버가 계정 변경을 **확정**한 상황이며, 단순히 정지 화면이 갱신되지 않은 경우보다 명확하다. `13-first-switch-A.json`의 guard 시각은 `1794915487751`, `14-second-switch-guard-A-body.json`의 관측 시각은 `1794915489159`(차이 **1408ms**). 같은 document/guard가 유지되고 실제 `changed` 응답 두 건을 받았지만 A 카드가 남았다. 이메일과 본문을 같은 owner의 화면으로 믿을 수 없는 상태다.

두 번째와 세 번째는 `16-offline390-B-detail-residue.json`, `21-unavailable390-B-body-after-A.json` 및 직접 열어 확인한 `offline390-B-detail.png`, `unavailable390-B-list.png`에 있다. 실제 Tab으로 이전 B 카드의 링크까지 접근할 수 있었다(`22-unavailable390-keyboard.json`). 안내 문구가 정직하다는 점과 보호 본문이 계속 노출·조작 가능한 점을 구분한다.

이미 내려받은 자료를 브라우저에서 회수할 수 있다는 주장은 하지 않는다. 이번 실패는 현재 세션이 달라졌거나 의심 상태인 화면에 이전 owner 본문을 정상 업무 화면처럼 계속 보여 주는 **표시·오인·프라이버시 경계 문제**다. 새 요청은 서버의 현재 세션으로 검사되며, 다른 owner 자료를 새로 반환한 증거는 없다.

**완료조건 판정: 미충족, 최소 보완 필요.** 감시 상태가 AccountMenu 내부에만 있으므로 이메일을 숨겨도 sibling `<main>{children}</main>`은 그대로다. 최소 보완은 신호를 받아 의심 상태에 들어갔거나 서버에서 `changed`를 확인한 동안, 보호 본문과 그 링크/조작도 함께 가리거나 차단하고 재확인·수동 새로 고침 안내를 제공하는 것이다. 정상 확인 뒤에만 해당 owner 본문을 다시 보여야 한다. 15초 무한 재로드 방지는 유지할 수 있다. 이번 검수에서 제품을 고치지 않았고, 이 한계를 PASS 조건으로 축소하지 않는다.

## 통과한 브라우저 범위

실제 ego-browser TaskSpace **2** 하나, p1/p2 두 탭이다. fake event/가짜 popstate 없이 브라우저 입력, 실제 Next Link, 실제 history entry 이동을 사용했다.

| 항목 | 독립 관측 |
|---|---|
| A 목록→상세, 뒤로→목록, 앞으로→상세 | 실제 링크와 trusted popstate, 동일 document 유지. 실제 사전 RSC 요청 `next-router-prefetch:1`/`rsc:1`이 클릭 전에 200 완료 |
| 다른 탭 실제 A 로그아웃 | A 상세 탭 전체 이동→`/login?next=…`, 이전 계정·본문 없음 |
| 다른 탭 B 폼 로그인 | A 상세 탭 새 document→B 표시, A 주소는 프로젝트를 찾을 수 없는 화면. 같은 cloud layout의 실제 목록 링크→B 카드만 표시 |
| 15초 guard | 짧은 두 번째 변경에서 재로드를 멈추고 이메일 숨김·안내. 키보드 Enter로 새로 고침→B 목록·안내 해소. 본문 잔류는 F216-1 |
| 알림 없는 callback 변경 + 실제 focus | callback만으로는 이전 A 화면 유지·신호 0. CDP Page.bringToFront로 실제 탭 전환 후 trusted focus, 서버 재검증·새 document B. 가짜 focus 이벤트 없음 |
| offline/online | 실제 네트워크 offline 중 신호를 받으면 이메일 숨김·offline 안내. online 복귀 때 새 확인→로그인 이동, 이전 본문 제거. offline 동안 본문 잔류는 FAIL |
| 확인 불가 | session URL만 실제 Network 차단, navigator online. 성공으로 처리하지 않고 이메일 숨김·다시 확인 안내. 본문 잔류는 FAIL |
| 늦은 옛 same 응답 경합 | 실제 서버의 B `same` 응답을 관측용 fetch 위임기에서 보류→다른 탭 A 폼 로그인·실제 신호 도착→옛 응답 전달. 옛 B 이메일은 부활하지 않고 재확인 후 전체 재로드 A |
| 경합 후 잔류 안내 | 실제 DOM MutationObserver 기록에서 보류 중 옛 이메일 span 없음. 새 document는 A 카드·계정, 확인 중/확인 불가 안내가 남지 않음 |
| 신호를 권한 근거로 신뢰하지 않음 | 실제 BC에 시험 문자열 8개를 보낸 대조: 계정 부여 대신 서버 확인 2회로 합쳐짐, 모두 same, 같은 document 유지. 제품 고정 메시지와 시험 신호는 구분 |
| partial logout | 원 runner의 소유 `logout-fail` 파일로 실제 provider 500. 실행 탭은 정확한 partial 안내, 다른 탭도 로그인 이동·새 API401. flag는 finally 제거 |
| B에서 native back/forward 및 옛 A history 재방문 | B 화면만, 옛 A 상세 entry는 B 기준 찾을 수 없는 화면. 이전 A 카드 부활 없음 |
| 기존 legacy CloudPending A→B | 실제 제품 root에서 자동 전체 재로드→B. 원 F209 일반 온라인 재현은 해소 |
| 390px 안내·키보드 | offline 안내 rect x16/y48/w343/h39.1875, header 안에 표시, 가로 넘침 없음. unavailable도 보임. Tab: 다시 확인→로그아웃→기존 카드 링크, Shift+Tab 역이동. 수동 갱신 Enter 동작 |

화면에 심은 document 표식, native 이벤트, 실제 요청 URL/header/status, BC/storage 수신값을 수동 발생 없이 기록했다. 경합 시험에서만 실제 same 응답의 **전달 시점**을 지연했다. 응답 내용이나 인증 결과를 만들어 바꾸지 않았다. 제품 신호는 BC `"changed"`, storage `<시각>-<난수>`뿐이며 이메일·UUID·토큰 없음. 시험 주입 문자열 `untrusted-test-signal`은 별도로 식별했다.

`use-session-watch.ts`/`session-sync.ts`를 직접 읽었다. 새 auth factory·module 전역 사용자 snapshot을 도입하지 않았고, 기존 resolver/server/proxy를 수정하지 않았다. 감시는 signal/focus/online/visibility/pageshow 이벤트 기반이며 제품 코드의 interval/timeout/poll 타이머는 없다. 3초 제한과 running/again 재확인, 15초 reloadOnce를 검토했다. 짧은 경합·신호 burst에서 옛 same 복구/무한 재로드는 관측하지 않았으며 모든 가능한 unmount·장기 정지 경합을 증명한 것으로 확대하지 않는다.

## 신규 세션 API·저장소 경계

- 기준 관련 **8 files / 417 PASS**(그중 t213 **24**, 포함 관계). 독립 `tests/t216-session-boundary.test.ts` **12 PASS**: 401/403/503 각각 잘못된 JSON·cross-site·text/plain보다 auth 거절이 먼저, request.json 미호출, getUser 1회. 인증 후 origin/media 거절도 body 미읽기, invalid UUID도 fail closed 확인.
- 실제 고정 Next build에서 **10 HTTP 관측**: anonymous401, same200, changed200, cross-site403, text/plain415, malformed JSON400, invalid account400, **proxy 통과 후 handler403/401/503**. 전부 no-store. same/changed 응답은 state 하나뿐이며 이메일·id·access/refresh token 없음. 정상·변경은 provider HTTP 2회(proxy1+handler1). anonymous는 SDK 세션이 없어 provider HTTP0이며 resolver 호출1 검증과 혼동하지 않는다.
- 이 HTTP 보완 서버는 같은 고정 build+별도 합성 fakeAuth를 쓰며 실제 DSN을 주지 않았다. private runtime fs/SQLite/pg Pool·Client constructor trap을 설치했다. runtime에서는 **private/SQLite/PG trap 0**, 허용 정적 메뉴 read2. 대조 process에서는 네 trap이 모두 실제 발동했다. 모든 syscall·네트워크 접근을 감사한 결과로 확대하지 않는다.
- 원 합성 TLS PostgreSQL 서버에도 session API **20개 동시 요청**을 독립 실행했다. same10/changed10, provider HTTP40, 응답 no-store. 호출 전후 `pg_stat_activity`의 업무 role pid/query_start/state_change가 정확히 동일했다. auth-only 요청이 업무 SQL을 실행하지 않은 관측이다. admin 연결도 CA 검증/rejectUnauthorized 유지·authorized true·TLS1.3 확인.
- 원 API inventory에 session이 보호 목록으로 포함됨을 검토했다. 소유 사본에 미검토 무가드 route를 추가한 negative control은 **예상 5 FAIL**, 파일 제거 뒤 `api-auth` **113 PASS**. 추가 113개를 417과 별개 신규 합계로 세지 않는다. route 파일은 공유 저장소에 쓰지 않았다.

## 고정 사본·원 검증기·증거

소유 root: `D:/starwork/t216-browser-14e3425`. 새 `git archive`와 물리 node_modules/PG/OpenSSL 복사만 사용했다. 자체 .git은 고정 SHA를 archive하는 원 runner를 위해 object alternate/ref/index만 만들었으며, shared checkout이나 제품 파일 checkout을 하지 않았다.

- 기준 추적 파일 **933/933 Git blob 일치**, 시작·종료 확인. 원 runner가 만든 실제 app도 **933/933 일치**(`runtime-source-identity.json`). 원 runner의 7개 overlay는 고정 기준과 동일했고 제품 시험용 nav는 추가하지 않았다.
- **원본 `tests/t213-cross-tab-session-http.mjs`를 수정 없이 실행**했다. 최종 run `tmp/t213-http-ed9e2a06-8ba4-4fa2-b927-61d4ba207a3b`: production build/type 검사 통과, 합성 TLS PG와 실제 SDK fakeAuth의 **14 HTTP 관측 PASS**, hold에서 실제 브라우저 검수 후 stop 파일로 해제, local 대조 포함 최종 exit0. 별도 `scripts/verify-build.mjs`도 통과.
- PG는 새 소유 cluster만 썼다. 서명 검증 로그 Valid EnterpriseDB. runtime API role과 admin 모두 TLS1.3/TLS_AES_256_GCM_SHA384 기록. 실제 Auth/managed DB/사용자 DB/메일 연결 없음.
- `tmp/t216/analyze.mjs`의 **24개 관측 사실 assertion PASS**. 실패 현상이 기록됐는지도 검사하므로 이를 “제품 기능24개 전부 PASS”로 표현하지 않는다.
- 별도 eslint/full suite는 재실행하지 않았다. 작성자 lint/type 및 전체 과거 suite를 독립 재실행 결과로 가져오지 않는다. 이번 build 내 TypeScript, 관련417, 독립12와 실제 실행 범위만 주장한다.

주요 명령(모두 소유 root 또는 그 runner app):

```powershell
node tests/t213-cross-tab-session-http.mjs --bin D:/starwork/t216-browser-14e3425/.tools/pgsql/bin --openssl D:/starwork/t216-browser-14e3425/.tools/openssl/openssl.exe --hold
node tmp/t216/run-related.mjs
node node_modules/vitest/vitest.mjs run tests/t216-session-boundary.test.ts
node tmp/t216/inventory-negative.mjs
ego-browser nodejs -e "await import('file:///D:/starwork/t216-browser-14e3425/tmp/t216/browser-01.mjs')"
# 같은 TaskSpace2의 browser-02…08, 실패한 관측 복구는 browser-03으로 이어 실행
node tmp/t216/api-setup.mjs
node tmp/t216/api-harness.mjs
node tmp/t216/api-check.mjs
node tmp/t216/api-private-control.mjs
node tmp/t216/pg-session-check.mjs
node tmp/t216/analyze.mjs
node tmp/t216/verify-runtime.mjs
node tmp/t216/verify-baseline.mjs
```

증거는 root `evidence/`의 번호별 상태 JSON·network JSON·두 PNG·`related.log`·`independent-api.log`·inventory negative/restored logs·`api-http-results.json`·`api-fake-events.jsonl`·`api-io-events.jsonl`·`api-negative-control.jsonl`·`session-pg-isolation.json`·`analysis.json`·source identity와 원 run의 `build.log`, `http-results.json`, `tls.json`, `fake-events.jsonl`, `run.json`, `next-stop.log`, `stop.log`에 보존했다. 재현/감시/분석 도구는 `tmp/t216/`다.

초기 도구 오류는 제품 실패로 세지 않았다. PG bin만 복사한 첫 원 runner는 postgres.bki 누락으로 initdb 단계에서 종료했다. share/lib를 보완한 뒤 **새 cluster/run**으로 전체 재실행했다(초기 run `1e4f5c3a-…`도 보존). 자체 .git alternate의 CRLF 경로 오류는 LF로 고치고 fixed SHA를 확인했다. p2 about:blank에서 감시용 crypto.randomUUID가 없어 첫 브라우저 script가 멈췄고, about:blank에서는 평가하지 않도록 고친 뒤 같은 TaskSpace/p2에서 이어 실행했다. API 보완 감시 로그의 첫 ENOENT는 빈 append 생성 후 요청을 실행했다. 이 오류들은 제품 코드를 바꾸지 않은 관측 환경 수정이다.

## 미검증·정리·반환

- **자연 JWT exp·refresh 회전, 실제 hidden/frozen 탭, 실제 BFCache 복원은 미검증**. 이번 브라우저는 계속 visible을 보고했고 native BFCacheNotUsed1건이었다. pageshow persisted=true를 가짜 발생시켜 PASS라고 하지 않았다. 다른 브라우저/프로필·기기·실 Supabase·managed DB·배포도 대상 밖이다.
- 브라우저 TaskSpace2는 합성 세션 로그아웃 뒤 별도 마지막 script에서 finish(keep[]) 했다. 원 runner parent **79136**, cloud Next **66664**, local 대조 Next **14108**, PG **68084**는 종료됐다. 원 `next-stop.log`와 PG `server stopped`/postmaster.pid 없음 확인.
- 보완 API harness **72028**, Next **72128**도 shutdown 후 exit0. 소유 포트 **64816/64807/64815/43334/43335 listener 없음**, 소유 root를 명령줄에 가진 node process 없음. 사용자 **3013 PID51032 유지**. 소유 사본·증거는 보존한다.
- 마지막 실제 정리 확인: **2026-11-17 20:47:43 +09:00 (Asia/Seoul)**, 소유 프로세스/포트 없음·postmaster.pid 없음·3013 유지. 관측24 assertions·root933 hash 확인은 20:44:32였다. 공용 상태 문서는 Master가 갱신하도록 고유 보고서와 실제 Orca 반환으로 전달한다.
- 공유 `.next`, 다른 담당의 B10/new POST WIP·기존 미추적 문서·실 환경/OS 시계/배포 설정은 수정하지 않았다. 제품 수정·push 없음.

Master 반환 요지: 고정14e3425에서 일반 F209 흐름과 세션 API는 독립 통과했지만, **15초 guard/오프라인/확인 불가 때 이전 owner 본문·링크가 계속 남아 T216 전체는 FAIL**입니다. 새 요청 권한 차단 PASS는 유지합니다. 보호 본문에도 계정 확인 경계를 적용하는 최소 보완 후 같은 실제 두 탭 시나리오 재검수가 필요합니다.
