# T193 Auth resolver 독립검수 — 지정 범위 PASS

- 검수자: Codex(Tester), T191 구현 비참여 독립검수.
- 날짜: 2026-11-17 KST.
- 기준: `be59435ca6c7479ee99d08170584e277d3dae314` 고정. 배정 `msg_244531a1585c`.
- T191 원보고서 전체와 B4-PROJECT-READ-CONTRACT의 인증 결과/캐시 계약, 변경 resolve/render/api/server 및 실제 호출자를 읽었다.
- **판정: 공통 인증 결과·API adapter·RSC 요청 단위 중복 제거의 지정 로컬 범위 PASS. 신규 필수 수정 없음.** Backend 읽기/SQL/RLS·전체 제품·운영 배포 수용을 의미하지 않는다.
- T190 원본 FAIL은 먼저 `4279897`로 보고·전송했다. 이후 Design/Backend WIP를 이 고정본에 섞지 않았다.

## 격리·기준 무결성

새 사본 `D:/starwork/t193-auth-be59435`에 `git -c core.autocrlf=false archive be59435`을 풀었다. node_modules와 ffmpeg/probe는 이전 검수의 물리 사본에서 물리 복사했으며 설치 명령·공유 node_modules 변경은 없다. Node v26.13.0 / npm11.20.0 / Next16.4.6 / Vitest5.1.0이다.

종료 후 tracked **738개가 Git blob과 전부 바이트 일치, 차이0**(`evidence/baseline-integrity.json`). 공유 저장소의 제품/auth/backend/DB/공용 문서는 수정하지 않았으며 본 고유 보고서만 작성했다.

먼저 **확인용 route가 없는 깨끗한 고정본**으로 test/lint/type/build를 실행했다. 그 뒤 격리 사본에만 아래 확인용 page/route를 추가하고 별도 운영 빌드를 만들었다. 두 빌드의 결과를 구분한다.

- `app/t193-probe/page.tsx`: Promise.all로 동일 getRenderAuth 2회+currentAccountEmail 1회. auth DTO·두 결과의 객체 동일성·이메일을 pre에 표시한다.
- `app/api/t193-probe/[id]/route.ts`: resolveServerAuth **1회** 후 denied 응답, 그 뒤에만 params/POST JSON을 읽는다. requireApiAuth와 중복 호출하지 않는다.
- 이 확인용 endpoint는 제품 커밋/배포에 포함되지 않는다. 이후 전체 API inventory 시험에 임시 route를 섞지 않았다.

실제 SDK·SSR 쿠키·Next proxy·RSC·handler를 사용하고 인증 HTTP만 가상 서버로 대체했다. 신규 fake DB migration10/샘플 seed만 만들었다. 실제 사용자 DB를 읽거나 복사하지 않았다.

- 43254 fakeAuth, 43255 실제 운영 Next(auth supabase), 43258 같은 빌드의 별도 auth-off Next.
- 합성 A: UUID `11111111-1111-4111-8111-111111111111` / owner@example.com.
- 합성 B: UUID `22222222-2222-4222-8222-222222222222` / second@example.com.
- 실제 계정·실제 비밀번호 변경·메일·운영 Supabase·외부 DB 접근은 없다. harness에서 DATABASE_URL을 제거했다.
- 근거: 격리본 `tmp/t193/` 실행기, `evidence/` 로그/JSON/가상 provider event. 쿠키/토큰 원문은 보고서에 싣지 않는다.

## 결과 계약과 거부 경계: PASS

기존 T191 20개 시험을 직접 실행했다. verified DTO는 kind/userId/email만 반환하고 UUID 소문자 정규화, 허용 이메일·UUID 검증 순서를 유지했다.

| 조건 | 직접 실행 근거/결과 |
|---|---|
| auth off | `{kind:local}`, unit과 실제 auth-off Next의 page/handler 모두 provider 호출0 |
| 설정/클라이언트 없음 | denied503 AUTH_UNAVAILABLE, getUser 호출0(unit) |
| 정상 허용 사용자 | verified UUID/email, getUser 메서드1회(unit), 실제 SDK/Next 정상 경로 통과 |
| user 없음·만료/위조 오류 | 401 AUTH_REQUIRED(unit), 실제 로그아웃 뒤 API401 |
| user와 error가 함께 반환 | user를 사용하지 않고 401 또는 provider5xx면503(unit) |
| 이메일 없음/허용 밖 | 403 AUTH_FORBIDDEN(unit); proxy 통과 뒤 실제 handler의 outside 응답도403 |
| 허용 사용자 id 없음/잘못된 UUID | 503 AUTH_UNAVAILABLE(unit+실제 SDK HTTP 반환 후 handler) |
| provider5xx/retryable 오류/unknown throw | 503(unit), proxy 정상 통과 후 provider500의 실제 handler도503 |

실제 HTTP에서 proxy는 A를 허용하고 다음 getUser가 bad-id/no-id/outside를 돌려주도록 했다. POST 본문은 고의로 깨진 JSON이었다. handler는 각각503/503/403으로 거절했고 JSON 파싱 오류로 진행하지 않았다. 응답은 `{error,code}` 두 키만, no-store·리다이렉트 없음이었다(`runtime-results.json`).

product API body/params 선행 거부는 기존 api-auth의 실제 route import·json/params spy 시험을 포함한 회귀157건으로 확인했다. 임시 helper의 정상 POST에는 B의 owner_id와 x-owner-id를 보냈지만 A 세션의 verified UUID가 반환됐다. 요청 owner_id/header를 인증 사용자로 삼지 않았다.

user+error 동시 반환과 알 수 없는 throw는 SDK 대역을 사용한 단위 분기 근거다. 실제 HTTP 응답만으로 SDK가 user+error를 동시에 반환하거나 임의 예외를 내도록 만들었다고 주장하지 않는다. 실제 provider500의 SDK 경로는 별도 검증했다.

## RSC cache 문서·코드 대조

설치된 Next16.4.6 `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1181`을 읽었다. React cache는 RSC render pass 안에서만 중복 제거하며 Route Handler/Server Action은 그 범위가 아니라는 설명이다. 설치된 React server 구현도 dispatcher가 없으면 원래 함수를 실행하고, 있으면 해당 dispatcher의 cache root를 사용하는 것을 확인했다.

제품의 render.ts는 `cache(resolveServerAuth)`를 **한 번 만들어 동일 export 함수**를 공유한다. currentAccountEmail도 이 함수를 사용한다. api.ts는 React cache에 기대지 않고 resolver를1회 직접 호출한다. resolve.ts는 결과를 모듈 Map/Promise/영속 cache에 보관하지 않는다. server.ts는 SDK 생성만 맡고, StudioLayout/새 비밀번호 page가 render.ts를 import하도록 바뀌었다. 읽은 코드와 위 문서의 적용 범위가 맞는다.

이를 코드 설명에만 기대지 않고 아래 실제 RSC 실행으로 확인했다.

## 실제 SDK/Next: render·handler·요청 간 격리

`runtime-check.mjs`의 모든 단언이 통과했다(`runtime-check.log`). runtime-results.json의 상위 관찰 레코드는20개이며, 그 안에 동시 요청 응답40개가 별도로 들어 있다. 이를 단위시험 개수에 합산하지 않는다.

| 실제 요청 | 결과 |
|---|---|
| RSC A→B→A 순서의 별도 HTTP | 각 verified UUID/email 정확, same=true, currentAccountEmail도 동일 계정. 매 HTTP마다 `/user`2회 |
| 단일 RSC 안 getRenderAuth2+currentAccountEmail1 | 결과 객체 동일, 총 `/user`2회 = proxy1 + RSC1. 내부3회 사용이1회로 중복 제거 |
| A/B 각각 handler GET | verified UUID 정확, `/user`2회 = proxy1 + handler1, 응답 no-store |
| auth-off 별도 Next page/handler | local, page same=true/email=null, 가상 provider event 증가0 |
| **A/B 섞인 RSC 20개 동시** | A10/B10 각각 자기 UUID·이메일, 모두200/same=true, A provider20/B20 = 요청마다2회 |
| **A/B 섞인 handler 20개 동시** | A10/B10 각각 자기 UUID·이메일, 모두200, A provider20/B20 |
| A 로그아웃 후 A/B | A 쿠키0/API401, B는 자기 verified UUID/email로 로그인 유지 |
| B global logout500→local204 | 502 LOGOUT_PARTIAL/localCleared=true, 쿠키0, 보호 API401 |

같은 A의 새 HTTP에서도 다시2회 호출됐고, A/B를 동시에 보내도 결과가 섞이지 않았다. 요청 간 인증 snapshot이 재사용됐다는 증거는 없으며 이 시험 범위에서 요청별 재검증을 확인했다. provider HTTP 재시도가 가능한 오류 상황까지 항상2회라고 일반화하지 않는다. 정상 SDK 조회의 수치다.

`actual-callers.json`/`callers.log`: 임시 helper 외에 실제 제품 `/account/password`, `/settings`, `/api/jobs`도 **A/B 각각6개 요청 모두200·getUser HTTP2회**를 확인했다. 두 RSC 화면에는 자기 이메일만 있고 다른 계정 이메일은 없었다. 실제 api/jobs는 원래 DTO로 응답했다. 이 검증은 Auth 결과 격리이며 기존 로컬 프로젝트/DB의 사용자별 데이터 분리를 검증한 것은 아니다.

ego-browser에서도 실제 로그인 폼으로 A→확인용 RSC 화면에 진입하여 verified UUID·same=true·email을 확인하고, 정상 logout200 뒤 보호 API401을 확인했다(`browser.json`, TaskSpace30). 기존 사용자 탭/실제 계정을 사용하지 않았다.

## T186 회귀·비밀 경계

- 실제 HTTP의 cross-site text/plain 로그인은403이며 token provider 호출 증가0.
- 동일 출처라도 text/plain은415. 정상 JSON 로그인은 실제 브라우저에서 통과했다.
- 정상 A logout200·A401/B유지, B 전역500→local204 PARTIAL의 의미/쿠키 제거를 확인했다. local 실패·네트워크 안내의 전체 UI 행렬을 여기서 재실행한 것으로 세지 않는다. 관련 T186 분기는 auth157에 포함돼 통과했다.
- 깨끗한 빌드와 확인용 probe 빌드 모두 verify-build를 그대로 통과했다. 물리 native 도구/로컬 데이터/비밀 설정 trace 검증을 끄지 않았다.
- 실제 secret 대신 프로세스 환경에 서버 전용 합성 sentinel을 넣었다. client-audit.json: `.next/static` **30파일**에서 해당 sentinel과 resolveServerAuth/createSupabaseServer 표식 hit0, 기존 clientSecretLeaks 검사 대상 **29파일**도 통과했다. 서버 전용 코드의 client import는 server-only 경계와 빌드로도 확인했다. 실제 운영 비밀값을 읽지 않았고 모든 가능한 비밀 형식을 검사했다는 주장은 아니다.

## 실행 검사·최초 환경 오염 구분

| 명령 | 실제 결과 |
|---|---|
| `npm.cmd test -- tests/t191-auth-resolver.test.ts` | exit0, **20 PASS**, resolver20.log |
| 최초 인증4파일 시험 | exit1, 151PASS/6FAIL. 검수용 DREAM_AUTH_MODE=supabase를 전역 전달해 maintenance의 로컬 off 가정을 위반, auth157.log |
| 인증 관련 환경 제거 후 `npm.cmd test -- tests/t182-auth.test.ts tests/api-auth.test.ts tests/t183-cloud-pending.test.ts tests/maintenance-routes.test.ts` | **exit0, 157 PASS**, auth157-clean-env.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| 확인용 route 없는 `npm.cmd run build` | exit0, clean-build.log |
| 사본 전용 page/route 추가 후 `npm.cmd run build` | exit0, probe-build.log; 제품 빌드와 구분 |
| `node tmp/t193/runtime-check.mjs` | exit0, 위 실제 RSC/handler/동시/거부/T186 단언 통과 |
| `node tmp/t193/callers.mjs` | exit0, 실제 호출자6개 관찰 통과 |
| `node tmp/t193/client-audit.mjs` | exit0, 합성 비밀·서버 표식 hit0 |
| tracked blob 무결성 검사 | 738개 일치/차이0 |

최초6건 실패를 숨기지 않으며 제품 결함으로 세지 않는다. 테스트/단언을 고치거나 스킵을 추가하지 않고 실행 환경만 분리했다. **작성자 전체925/36skip은 재실행하지 않았고 독립 수치에 합산하지 않았다.** 이 검수의 자동시험은20+157이다.

## 한계·정리·반환

운영 Supabase/실제 메일/실사용자 비밀번호·계정·배포, Backend actor/repo 연결·SQL/RLS·Postgres opt-in·다른 사용자의 실제 데이터 격리는 이번 범위 밖이다. UUID 검증은 계약의 형식 검사이며 실제 사용자 존재는 가상 SDK provider가 제공했다. 전체 인증 시스템/전체 앱 수용을 이 PASS 하나로 대신하지 않는다.

자기 harnessPID36184, auth NextPID6716, local NextPID48028과43254/43255/43258 listener 종료를 확인했다. ego TaskSpace30 finish. 공유3013은 PID51032 유지, 공유 .next 대상 명령·설치·push/deploy·사용자 DB 변경 없음. 격리 사본·archive·확인용 routes·증거는 보존했다. 임시 확인용 route가 포함된 마지막 빌드는 검수용이며 배포 artifact가 아니다. 자동 승인 거절은 없었고 거절 우회/삭제 재시도는 없다.

Master 복사용: T193 be59435 고정 독립검수 PASS입니다. resolver20+auth157/lint/type/깨끗한build 및 별도 probe build 통과. 실제 SDK/Next에서 RSC 내부3사용→1조회, proxy와 합계2조회, handler1조회, A/B각20동시 RSC 및 handler의 UUID/email 분리·HTTP간재조회·A logout401/B유지·T186origin/JSON/PARTIAL을 확인했습니다. 실제settings/password/apiJobs A/B6요청도 각각2조회·계정표시정확. user+error/unknownthrow는 단위대역, UUID/no-id/outside/500은 실제handler경로도 검증했습니다. client30파일 합성비밀/서버표식hit0. 최초전역auth환경으로maintenance6FAIL은 clean환경157PASS와 분리기록. 작성자925합산없음. 신규필수수정없으며 Backend/RLS/운영수용은 별도입니다. 자기서버·브라우저종료/738trackedblob일치/3013보호/증거보존, 고유보고서 선택commit으로 반환합니다.
