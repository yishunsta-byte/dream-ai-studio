# T199 · T198 legacy API gate 독립 검수

- 기준: `acfbd0b`, T198-LEGACY-API-GATE 보고서 전문, 실제 gate/api/logout/원본 test. B4-I-R 수용과는 별개 검수다.
- 판정: **bounded PASS — 고정본의 기존 API gate 범위**. 신규 제품 결함은 발견하지 않았다. 제품 파일·Front RSC WIP·공용 대장은 수정하지 않았고 이 고유 보고서만 반환한다.
- 새 Postgres 프로젝트 GET 두 경로는 이 커밋에 없다. B4-G 공개 GET/legacy 통합·RSC/page loader 차단·전체 클라우드 안전/배포는 수용하지 않는다.

## 범위와 수치 정정

TypeScript AST와 실제 HTTP 경로로 열거한 고정본은 **업무19파일25개 명시 method + auth-only logout1개 = 기존 보호20파일26개 method**다. 공개 auth/login·signup·reset 및 password special은 별도 범위다. 프로젝트 list/get의 새 GET은0개이며, 기존 renders/timeline의 중첩 GET을 새 조회 GET으로 세지 않았다.

**R199-D1(증거 범위 정정):** T198 보고서의 새73개는 Backend WIP를 포함한 작업 폴더 자체 수치다. 이 고정 커밋의 원본 `t198-legacy-gate.test.ts`를 JSON reporter로 독립 실행한 실제 값은 **70/70 PASS**다. 없는 새 GET이나 WIP 테스트를 포함해73개 통과라고 반환하지 않는다. 작성자에게 고정본/작업폴더 수치 구분 유지를 요청하며, 이 차이를 제품 gate 실패로 처리하지 않는다.

## 고정 소스·검사

`git archive acfbd0b`를 `C:/Users/Administrator/AppData/Local/Temp/t199-gate-review-88e2b21267964f2da84c8c0df173a7a5/app`에 풀었다. 커밋의 변경5파일은 EOL 규칙 적용 Git blob이 target과 **5/5 일치**했다. node_modules는 이전 검수의 물리 사본을 다시 복사했으며 설치·package 변경은 없다.

사용자 DB/실 DSN/managed DB·SQL 발행·3013/shared `.next`·계정/비밀번호·배포·공용 대장을 사용/변경하지 않았다. build/typegen은 사본에서만 실행했다. 시험 Auth는 로컬 가짜 SDK provider이며 실제 메일·외부 Supabase 계정은 없다.

| 검사 | 이번 독립 결과 |
|---|---|
| 원본 T198 단독 JSON reporter | **70 PASS / 0 FAIL** |
| T198 + api-auth/t182/t191/t183/t197/maintenance | **7파일252 PASS**, 1.68초, exit0(T198 반복 포함) |
| 전체 ESLint `--max-warnings 0` | exit0 |
| 사본 `next typegen` + `tsc --noEmit --incremental false` | exit0 |
| 확인용 route 없는 고정본의 `next build` + verify-build | exit0 |
| 실제 `next start` + fake Auth HTTP harness | exit0, **119개 응답 관찰**, 아래100개 업무 차단 포함 |

새 단위70은 세 설정(vercel/postgres/unknown)에서 모든 기존 업무 handler를 직접 호출한다. getUser1회·본문 reader5종(json/text/formData/arrayBuffer/blob)·params thenable 미접근·SQLite constructor0·startup0 및 오류 키/no-store/redirect 없음을 확인했다. 위252와70은 서로 반복되므로 합산하지 않는다. 전체1060/925 suite는 반복하지 않았다.

## 실제 Next의 데이터 미접근 negative control

같은 깨끗한 빌드를 소유 127.0.0.1:43901에서 설정별로 순차 기동했고 fake Auth는 :43902를 사용했다. server-only preload(고유 root에만 둠)로 better-sqlite3 constructor와 **설정한 가짜 runtime root 아래의** sync/promise 파일 접근·stream 생성을 추적하고, 도달하면 marker를 기록한 뒤 예외를 던지게 했다. 제품 소스/빌드 파일은 계측을 위해 수정하지 않았다.

| 실행 설정 | 업무25 method × 설정 | 결과 |
|---|---|---|
| VERCEL=1, backend 미설정 | 25 | 전부503 LEGACY_DATA_UNAVAILABLE |
| 로컬 auth=supabase, backend=postgres, 가짜 미사용 DSN | 25 | 동일 |
| 로컬 auth=supabase, backend=unknown | 25 | 동일 |
| 로컬 auth=supabase, backend=postgres, DSN 없음 | 25 | 동일 |

**100개 모두** no-store·Location 없음·getUser HTTP2회(proxy1+handler1)·추적 데이터 접근0이었다. HEAD는 HTTP 규칙상 body가 비어 있으므로 status/header로 확인했고 JSON code는 원본 직접 handler 시험으로 보완했다. POST/PATCH에는 고의로 깨진 JSON을 보냈으나 parsing 오류로 진행하지 않았다. 가짜 runtime 폴더도 생성되지 않았다.

대조군인 **이 PC 기본 auth off/default SQLite**에서는 `/api/jobs`가 기존 startup 경로에 진입하여 계측된 mkdirSync3/statfsSync1이 발생했다. 계측기가 무조건0을 내는 것이 아님을 확인했다. 실제 데이터 접근은 trap으로 중단돼 기존 시작점검503이며 LEGACY 코드가 아니다. 이는 local 업무 성공/실제 DB 쓰기 완료가 아니라 **기존 서비스 진입 유지** 증거다. local logout은200이었다.

파일0은 이 preload가 추적한 runtime/SQLite 경계와 단위 startup spy의 범위다. Next 자신의 bundle/config 읽기를 모두0이라고 주장하거나, 존재하지 않는 실제 데이터에 대한 파일 hash 검사를 했다고 주장하지 않는다.

## 인증 우선순위·logout 정대조

실제 SDK·SSR 쿠키·Next proxy/handler를 사용하되 Auth 네트워크만 fake 서버로 대체했다. proxy의 첫 getUser는 허용하고 handler의 다음 응답을 바꾸어, 깨진 JSON POST에도 **만료401 AUTH_REQUIRED / 외부 이메일403 AUTH_FORBIDDEN / provider503 AUTH_UNAVAILABLE**가 legacy503보다 먼저 반환됨을 확인했다. 이 세 응답은 getUser HTTP2회·데이터 접근0이다. 쿠키 없는 API도401이었다.

- authenticated cross-origin logout →403 AUTH_ORIGIN_REJECTED, signOut 호출 증가0. 비로그인 cross-origin logout →401(인증 우선).
- 같은 origin의 cloud logout →200, 세션 쿠키가 응답에서 지워지고 그 뒤 API401. auth-only가 legacy gate에 막히지 않음.
- 가짜 global logout500→local204 →502 LOGOUT_PARTIAL/localCleared=true, 쿠키 제거·그 뒤 API401. global 성공이나 다른 기기 종료를 거짓으로 보고하지 않음.
- 공개 login의 cross-origin text/plain →403, 같은 origin text/plain →415 UNSUPPORTED_MEDIA_TYPE. T186 Origin/JSON 경계가 유지됨. logout 자체는 기존대로 JSON 본문을 요구하지 않는 auth-only POST다.

공개 auth3·password special의 제품 코드와 정책은 이 legacy 변경에서 수정되지 않았다. 위 login 표본과 관련 회귀를 전체 인증 UI 행렬·실제 Supabase logout revocation·메일·비밀번호 변경 검증으로 확대하지 않는다.

## 코드 결론과 미검증

`requireApiAuth`는 resolver1회 뒤 denied를 즉시 반환하고, default legacy-data에서만 순수 availability 규칙을 확인한다. 이 PC default/sqlite 외에는 Vercel 여부·postgres·unknown을 모두 닫는다. scope auth-only는 logout의 고정 서버 호출만 추가됐고 request 입력으로 scope를 고르는 경로는 없다. 알려지지 않은 backend나 DSN 없음이 SQLite fallback으로 이어지지 않는다.

고정본의 새 GET이 없으므로 **현재 기존20/26 보호면만 수용**한다. B4-G 새 GET 통합·명시 inventory 변경·Auth 중복 호출·owner/404·B4-I request adapter와의 실제 연결은 후속 검수다. Front의 RSC legacy 차단은 별도 task이며 이 보고서로 완료 처리하지 않는다. managed·실 DSN·실 Vercel 환경·실데이터·배포·실폰도 미검증이다. VERCEL=1은 로컬 Next 프로세스의 설정 대조이지 실제 Vercel 배포가 아니다.

## 정리·잔존·증거

소유 Next PID는 Vercel29244 / postgres42956 / unknown14528 / no-DSN38980 / local77596이다. 각 프로세스 kill 후 exit를 기다렸고 fake Auth server도 close 완료했다. 후속43901/43902 listener 없음·고유 root의 node 프로세스 없음이다. 사용자3013은 전후 PID51032 동일이다. 브라우저는 열지 않았다.

root의 related.log/t198-summary.json/build.log/lint.log/type.log/source-identity.json/route-matrix.json/runtime-check.log/runtime-results.json, 설정별 server 로그·local-default-data-events.jsonl, runtime-check.mjs/negative-preload.cjs에 증거를 남겼다. cloud 모드 데이터 이벤트 파일은 접근0이라 생성되지 않았고 local만4개 marker다. 보고서 이외에는 커밋하지 않는다. 기존 untracked T157 보고서도 보존했다.

고유 OS-temp app 경계를 확인하는 PowerShell 재귀 삭제 요청은 자동 승인 검토가 실행 전에 **`blocked by policy`로 거절**했다. 우회하지 않았다. 물리 의존성·앱/빌드·합성 쿠키/로그를 포함해 **34,827파일 / 940,910,526바이트**가 잔존한다. 실제 비밀/사용자 DB는 복사하지 않았다.

## Master 전달문

T199 acfbd0b는 기존 API gate 범위 bounded PASS입니다. 고정본 신규70(작업폴더73과 구분)·관련252·lint/type/build와 실제HTTP100개 업무 차단/인증우선/logout 및 runtime 접근0/로컬정대조를 확인했습니다. 새GET/RSC/B4-G/managed는 후속이며 소유 서버는 종료했고 자동 승인 검토의 삭제 거절로 약941 MB 사본이 잔존합니다.
