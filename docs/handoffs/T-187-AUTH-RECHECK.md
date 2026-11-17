# T187 T186 인증 수정 집중 독립 재검수

- 담당: Codex(Tester), 구현 비참여 독립검수.
- 날짜: 2026-11-17 KST, 약 18:00~18:12.
- **판정: 지정된 로컬 인증 수정 범위 PASS. F184-1·F184-2 재현 조건 해소. 새 필수 수정 없음.**
- 기준: `dec2be18755d3db1f264e9d81ca2e9b92ece8620` 고정. 배정 `msg_50f4af06df81`.
- T186 원보고서 `docs/handoffs/T-186-AUTH-ORIGIN-LOGOUT.md` 전체를 읽고 코드·설치 SDK·기존 실패와 대조했다.
- T185의 `a278e80` 원본 FAIL은 별도 보고서로 보존했다. Main의 후속 커밋·package WIP·UI 수정은 본 판정과 혼합하지 않았다.

## 격리와 기준 무결성

`D:/starwork/t187-auth-dec2be1`을 새로 만들어 `git -c core.autocrlf=false archive dec2be1`을 풀었다. T185의 물리 node_modules를 다시 물리 복사했으며 공유 node_modules에 설치나 변경을 하지 않았다. Node v26.13.0 / npm 11.20.0 / Next 16.4.6 / Vitest 5.1.0이다.

종료 후 `tmp/t187/verify-baseline.mjs`로 기준의 tracked **717개 파일 모두 Git blob과 바이트 일치, 차이 0**을 확인했다(`evidence/baseline-integrity.json`). 테스트용 코드와 로그는 격리본 tmp/evidence에만 추가했다. 공유 제품 파일·공용 문서는 수정하지 않았고 본 고유 보고서만 반환한다.

실제 Supabase SDK·SSR 쿠키·proxy·운영 Next·React 화면을 사용하고 인증 HTTP만 가상 서버로 대체했다. 신규 fake-runtime에 migration 10개와 합성 seed를 생성했다. 실제 계정·비밀번호 변경·메일 발송·운영 DB·운영 인증 서버 접근은 없다.

- 가상 인증 43214 / 실제 Next 운영 실행기 43215 / 공격 페이지 43216, 모두 loopback.
- 계정은 합성 `owner@example.com` / `outsider@example.com`만 사용했다.
- 실행기: 격리본 `tmp/t187/harness.mjs`, `api-check.mjs`, `origin-order.test.ts`, browser-01~08.
- 원시 근거: 격리본 `evidence/`의 JSON·로그·PNG·가상 provider event 기록. 토큰 원문은 이 보고서에 싣지 않는다.

## F184-1 원재현 및 경계: PASS

실제 브라우저에서 `http://localhost:43216`의 원래 text/plain 폼 버튼을 클릭해 다른 사이트인 `http://127.0.0.1:43215/api/auth/login`으로 제출했다. 본문은 JSON 모양의 허용 이메일·합성 비밀번호였다.

결과(`browser-01.json`): `AUTH_ORIGIN_REJECTED` 응답, **sb 쿠키 0 / 가상 인증 token 호출 전후 0→0**, 이어 `/account/password` 접근은 `/login?next=%2Faccount%2Fpassword`로 차단됐다. 세션 쿠키를 주입하지 않았다. 실제 HTTP 매트릭스에서도 해당 출처/형식 거부가 403임을 확인했다.

`api-check.mjs`의 실제 Next 요청·단언은 모두 통과했다(`api-results.json`, 79개 관찰/보조 이벤트 레코드).

| 경계 | 실행 결과 |
|---|---|
| login/signup/reset/password/logout 5곳 × Origin 없음·외부·null·Sec-Fetch-Site same-site/cross-site/none | **30건 403 AUTH_ORIGIN_REJECTED**, no-store, 새 Set-Cookie 0, 인증 변경 provider 호출 증가 0 |
| JSON 4곳 × text/plain·form-urlencoded·multipart·빈 Content-Type | **16건 415 UNSUPPORTED_MEDIA_TYPE**, no-store, provider 변경 호출 증가 0 |
| 동일 출처 JSON + charset, Content-Type 대소문자 | 200 정상 로그인 |
| 동일 출처 JSON의 깨진 본문 4곳 | 400, 출처 오류/형식 오류와 분리 |
| 실제 동일 출처 login/signup/reset/password | 각 200, 가상 SDK 정상 호출 |

본문 선행 거부는 격리본의 독립 추가 시험 **15건 PASS**로 확인했다(`independent-order.log`). 실제 route handler를 import하고, request.json spy가 호출되지 않으며 createSupabaseServer/변경 메서드도 0인지 확인했다. logout에서는 API 인증을 통과한 상황만 분리하기 위해 requireApiAuth를 null 반환 대역으로 두었다. 실제 proxy/guard 결합 동작은 아래 HTTP 시험으로 따로 검증했다.

logout의 실제 경로는 공용 requireApiAuth가 먼저 검증하므로 getUser 인증 조회가 발생할 수 있다. ‘provider 호출 0’은 **signIn/signUp/reset/update/signOut 등 상태 변경 호출 0**이라는 뜻이며 proxy의 세션 조회까지 0이라고 주장하지 않는다.

Vercel 출처·루프백 거부는 기존 관련 단위시험에서 확인했다. 실제 Vercel 배포/도메인을 시험한 것은 아니다.

## F184-2 실패·대조·재시도: PASS

| 시나리오 | 직접 관찰한 결과 |
|---|---|
| 정상 SDK logout 204 | 200 no-store, 쿠키 제거, 보호 API401 |
| SDK global500 → local204 | **502 LOGOUT_PARTIAL/localCleared=true**, 실제 SDK 호출 순서 global→local, 쿠키 제거·보호 API401 |
| SDK global500 → local500 | **502 PARTIAL**, SDK가 local 요청 전에 로컬 세션을 지워 쿠키 제거·보호 API401 |
| 새 비밀번호 성공 + global500/local204 | `/login?notice=password-partial`, 비밀번호 변경 성공·로컬 종료·다른 기기 미확인 안내, 쿠키0/API401 |
| 새 비밀번호 성공 + global500/local500 | 같은 partial 안내, 쿠키0/API401 |
| 앱 logout fetch 네트워크 실패 주입 | **자동 성공 이동 없음**, `/account/password` 유지, ‘비밀번호는 바뀌었지만 로그아웃하지 못했어요’와 재시도, 쿠키1/API200으로 잔존 세션을 숨기지 않음 |
| 위 네트워크 차단 해제 후 키보드 Enter 재시도 | `/login?notice=password`, 쿠키0/API401, 전후 password update 증가 **1회**로 재시도 중 비밀번호 재변경 없음 |
| 새 비밀번호 정상 제출 대조군 | `/login?notice=password`, 쿠키0/API401 |
| AccountMenu 네트워크 실패/재시도 | settings에 머물며 오류·재시도 표시; 복구 후 키보드 Enter로 `/login`, 보호 API401 |
| AccountMenu global500/local204 | `/login?notice=logout-partial`, 로컬 종료와 서버 폐기 미확인 안내, 쿠키0/API401 |

실제 SDK/Next의 HTTP 상태·scope는 `api-results.json`과 `fake-events.jsonl`, 실제 화면은 `browser-02.json`~`browser-07.json`에 보존했다. 설치된 auth-js `_signOut`과 SSR SIGNED_OUT 저장 처리도 읽어 local HTTP500과 로컬 저장 예외의 의미를 구분했다.

**로컬 종료 자체의 예외 검증은 주입 근거다.** 실제 logout handler에 SDK global/local 두 메서드가 throw하는 대역을 넣어 502 `LOGOUT_FAILED/localCleared=false`를 독립 시험했다. 실제 브라우저에는 그 응답 모양만 주입해 자동 이동 없이 명확한 안내·재시도를 확인했고, 주입 해제 후 실제 SDK 정상 logout으로 보호 API401을 확인했다(`browser-05.json`). 운영 Next의 쿠키 저장소를 실제로 고장 내거나 live SDK 저장 예외를 발생시킨 것으로 주장하지 않는다. 앱 네트워크 실패도 해당 fetch 하나를 Promise rejection으로 주입한 시험이며 실제 회선 장애가 아니다.

## 세션·허용 목록·API별 guard·redirect 회귀: PASS

- 실제 owner 로그인은 SSR 쿠키를 만들고 보호 API 접근을 허용했다. 무세션 password 변경은 reset 요청 뒤에도 401이다.
- 허용 밖 login은 INVALID_CREDENTIALS, signup/reset은 열거 방지 안내를 주면서 provider 변경 호출 증가 0이다. 허용 밖 recovery callback도 forbidden 로그인으로 이동했다.
- **proxy 통과 뒤에도 API guard가 동작하는 실제 시험:** 가상 getUser 응답을 첫 조회 owner, 다음 조회 outsider로 설정한 후 `/api/jobs`를 요청했다. provider 이벤트에 owner→outsider 두 조회를 확인했고 최종 **403 AUTH_FORBIDDEN/no-store**를 받았다. proxy의 허용 결과만으로 API가 서비스를 실행하지 않는다(`proxy-guard-user-sequence`).
- 기존 api-auth 시험은 전체 API inventory·각 route의 익명/허용 밖/provider 장애/설정 누락을 direct handler로 검증하며 통과했다. product guard를 제거하거나 검증을 약화하지 않았다.
- callback의 외부 URL·//·탭 포함 next는 상대 `/`, 정상 next는 `/settings?x=1`. forwarded host로 외부 이동이 생기지 않았다. 만료 recovery는 link 오류이며 callback 응답은 no-store다.
- 신규 origin/media 거부, 공용 guard 거부, logout 정상/부분, callback 응답의 no-store를 확인했다. 정상 login/signup/reset/password POST에는 명시적 Cache-Control이 없으며 이는 해당 기존 응답 생성 방식이 유지된 관찰이다. 이들까지 일괄 no-store라고 주장하거나 실제 프록시 캐시 동작을 검증했다고 하지 않는다.

## 1280·390 및 키보드

partial 안내·새 비밀번호 네트워크 실패·localCleared=false 응답·AccountMenu 네트워크 실패의 **4상태 × 1280/390 = 8개** viewport 조합을 실제 innerWidth로 확인했다. 각 조합의 문서 가로 넘침 0, PNG 직접 열람 완료. 안내 문구·재시도 버튼이 읽히고 조작 가능하다.

빈 로그인의 이메일 focus/aria-invalid 2개, 키보드 로그인, 정상 비밀번호 제출, 두 실패 상태의 로그아웃 재시도, AccountMenu 실패 후 재시도를 실제 Enter로 수행했다. 스크린리더·물리 모바일 키보드는 미검증이다.

경미한 관찰 **U187-1/P3**: 모바일 AccountMenu 오류 배너는 `position:absolute; top:100%`라 settings 본문 제목 위에 겹쳐 표시된다(`account-failed-390.png`, `components/auth/login.module.css` 마지막 규칙). 안내와 재시도 버튼은 읽히고 동작하며 기능 차단은 없다. 추후 배너가 차지하는 본문 공간을 확보하는 것을 권한다. 인증 두 필수 수정의 차단 사유로 보지 않는다. T185의 대기수+제목 축소 문제는 이 고정본에서 별도 수정/수용했다고 주장하지 않는다.

## 실제 실행 검사와 숫자 차이

| 실행 | 결과 |
|---|---|
| `npm.cmd test -- tests/t182-auth.test.ts tests/api-auth.test.ts tests/t183-cloud-pending.test.ts` | **exit0, 3파일/150 PASS**, related154.log |
| `node node_modules/vitest/vitest.mjs run --config tmp/t187/vitest.config.mjs` | **exit0, 독립 추가15 PASS**, 본문/provider 선행 거부 및 local throw 분기 |
| `node tmp/t187/api-check.mjs` | exit0, 실제 HTTP 79개 관찰/이벤트 레코드와 단언 통과, api-check.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| `npm.cmd run build` | exit0, 실제 운영 빌드+verify-build 통과, build.log |
| `node tmp/t187/verify-baseline.mjs` | 717개 기준 tracked blob 전부 일치 |

T186 보고서/배정에는 관련154가 적혔지만 **고정 dec2be1에서 실제 150**이었다. 4건 차이의 작성자 실행 시점/파일 상태 원인은 이 검수에서 확정하지 않았다. Master로 `msg_3d4b887d6f2f`를 실제 전송했다. 로그 이름 related154.log는 기대 범위 이름이며 결과는 150이다. 작성자의 전체882/23skip은 이 검수에서 재실행하거나 독립 수치로 계승하지 않았다. T185 전체767/23skip 역시 다른 baseline의 결과다.

lint/type/build는 추가 tmp 주입시험을 만들기 전 고정 제품에서 수행했다. 추가 시험 뒤 tracked blob 무결성을 재확인했으며 제품 수정이 없어 같은 검사를 반복하지 않았다.

## 한계·정리·인계

이번 PASS는 고정 로컬 인증 수정 범위다. 실제 메일 수신·Supabase 운영 설정·외부 기기 토큰 폐기·운영 HTTPS/도메인·실사용자 비밀번호·실제 배포는 검증하지 않았다. fake DB에서 SDK/Next/React 경로를 실행한 것이며 운영 인증 정상이나 전체 제품 수용을 의미하지 않는다.

ego TaskSpace23을 finish로 종료했다. 자기 harness PID74896/Next PID78636 종료와 43214/43215/43216 listener 부재를 확인했다. 공유 3013은 PID51032로 유지됐고 공유 .next를 대상으로 명령을 실행하지 않았다. 새 격리본·archive·증거는 삭제하지 않고 보존했다. 이번 검수에서 자동 승인 거절은 없었으며 거절 우회·도구 설치·공유 node_modules 변경·push·배포는 없다.

Master 복사용: T187 dec2be1 고정 독립 재검수 PASS입니다. F184-1 원외부 폼에서 쿠키0/token0·보호화면 차단, 5route 출처403/JSON4route 형식415 선행 거부, F184-2 SDK global500→local 정상/500의 PARTIAL·쿠키0/API401, 앱 네트워크/로컬 종료 예외 응답의 정직 안내·이동 없음·재시도, 비밀번호 재변경 없음, API별 guard 및 상대redirect를 확인했습니다. 관련 실제150+독립15/lint/type/build PASS, HTTP79관찰, 실패4상태×1280/390·키보드 확인. 154와 실제150 차이와 local throw 주입 한계는 보고서에 구분했습니다. U187-1 모바일 오류 배너 제목 겹침 P3 권고만 남습니다. 운영계정/메일/DB/3013 변경 없이 자기 서버·브라우저 종료, 증거 보존. 로컬 수용/공개 결정은 Master가 별도 수행해 주세요.
