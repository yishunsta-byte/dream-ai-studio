# API 인증 2차 인계

- task: `task_b90264ee0d1e` / dispatch: `ctx_4c6439525bb2` / 담당: 배정된 Codex worker
- 기준: coordinator 회신 `msg_f344f05e5fb4`의 **fde8897, API guard 구현**. 기존 backend-cloud d956078에 fde8897을 merge하여 T182 Auth 기반을 먼저 가져왔다.
- 상태: **ready_review / 자체 검증(독립 검수 아님)**. 실제 Supabase·운영3013·배포·실데이터는 접근/변경하지 않았다.

## 변경과 동작

`lib/auth/api.ts`에 `requireApiAuth(): Promise<Response|null>`를 추가했다. T182의 `authMode`/`authReady`/허용 이메일 설정과 cookie client를 재사용하되, Proxy 결과나 클라이언트 제공 user를 믿지 않고 Auth `getUser()`로 독립 확인한다. 개인 앱의 API 접속 확인이며 프로젝트별 owner/RLS 권한 검사를 구현한 것은 아니다.

| 상태 | API 응답 |
|---|---|
| 로컬 auth off | 기존 처리 진행, Auth client 생성 안 함 |
| Vercel 또는 명시적 supabase 모드, 설정 누락 | 503 `AUTH_UNAVAILABLE` |
| 사용자 없음/만료/인증 오류 | 401 `AUTH_REQUIRED` |
| 검증된 사용자지만 허용 이메일 아님 | 403 `AUTH_FORBIDDEN` |
| Auth 서비스 5xx·재시도 가능한 fetch 오류·예외 | 503 `AUTH_UNAVAILABLE` |
| 검증된 허용 사용자 | 기존 API 처리 진행 |

거절은 한글 `{error,code}`, `cache-control:no-store`이며 API를 로그인 화면으로 redirect하지 않는다. 오류 상세·토큰을 응답/로그로 내보내지 않는다. user와 error가 함께 반환되면 허용하지 않는다. 로컬 off 정책과 Vercel 강제 인증 정책은 T182 그대로다.

`app/api`의 **20개 보호 route 파일,26개 명시적 HTTP handler** 첫 문장에서 guard를 await하도록 했다. 본문/params/업로드 stream·파일/DB·시작 점검 전에 거절한다. render 파일의 GET와 HEAD, backup/restore, logout도 포함한다. 공개 메일 링크 요청 `/api/auth/login`은 T181/T182대로 제외했다. `/auth/callback`은 기존 공개 callback이며 변경하지 않았다. Next의 자동 OPTIONS/지원하지 않는 메서드 처리까지 새로 구현하지 않았다.

GET가 비동기가 된 데 맞춰 `tests/maintenance-routes.test.ts`의 기존2개 호출에 await만 추가했다. 기대값은 유지했다. 네 route 파일의 파일 선두 BOM이 import 추가로 줄 중간에 들어가 ESLint 오류가 났으므로 해당 BOM을 제거했다.

## 파일

- `lib/auth/api.ts` 신규
- `app/api/**/route.ts` 중 공개 auth/login을 제외한20파일
- `tests/api-auth.test.ts` 신규92시험
- `tests/maintenance-routes.test.ts` 기존 GET await2곳
- `tests/postgres/schema-rls.mjs`: 이전 작업의 SQL 검증 스크립트가 이번 전체 lint에서 console/URL 전역 선언 누락으로 걸려 `/* global console, URL */` 한 줄만 추가했다. SQL/검증 로직 변경 없음.
- 이 고유 보고서. 공용 TEAM/PROGRESS/REVIEW는 Master의 단일 작성 범위를 유지했다.

기존 미추적 계획 보고서는 이번 변경에 포함하지 않았다. dependency 파일·Proxy·로그인/callback·환경값·제품 서비스·SQLite/PG 스키마는 이번 guard 커밋에서 바꾸지 않았다.

## 실행·실제 결과

작성 전에 설치된 Next16.4.6의 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`와 cookies 함수 안내서를 읽었다. `npm.cmd ci`로 고정 의존성을 설치했으며 package/lock 변경은 없다. npm audit은 moderate7건을 보고했다. 의존성 갱신은 하지 않았다.

| 실행 | 실제 결과 |
|---|---|
| `npx.cmd vitest run tests/api-auth.test.ts tests/t182-auth.test.ts tests/maintenance-routes.test.ts` 최종 실행 | **3파일125 PASS**: 새92 + T182 26 + maintenance7 |
| `npm.cmd run lint` 최종 | PASS(exit0). 첫 실행 BOM4곳·module 변수 이름·이전 SQL 스크립트 전역 선언 오류 수정 후 통과 |
| `npm.cmd run typecheck` | PASS(exit0), Next typegen 포함 |
| `npm.cmd run build` | PASS(exit0), 실제 Next production build 및 verify-build: 로컬 데이터/도구/비밀설정 trace 없음, client 서비스키 없음 |
| `git diff --check` | PASS |
| `npm.cmd test` 전체 | **FAIL**:62파일 PASS·8 FAIL·3 skip,774 PASS·20 FAIL·64 skip(858). 아래 환경 제약을 유지하며 전체 PASS라고 표시하지 않음 |

전체 시험 실패는 ffmpeg ENOENT/도구 hash 대상 부재로 시작한 오디오·렌더·자막 시험들과, 실패한 audio fixture 준비 뒤 저장 행이 없어 발생한 `p2-5c-render-audio`의 후속 undefined 접근이다. 관련8파일은 `p2-4-render-units`, `p2-5b-dsp-fixes`, `p2-5b-audio-dsp`, `p2-5c-render-audio`, `p2-5c-restore-integrity`, `p2-5u2-audio-editor`, `measure-subtitle`, `t152-audio-join-draft`다. 이 작업본에는 FFmpeg 도구가 없으며 미디어 코드/시험 기대값/skip 조건을 바꾸거나 도구를 설치하지 않았다. 같은 조건의 별도 기준본 전체 시험은 재실행하지 않았으므로 단순히 모든 실패를 독립 확인된 baseline이라고 부르지 않는다.

새 시험은 Proxy를 호출하지 않고20 route의 모든 handler를 직접 호출하여401/403/설정 누락503/provider 예외503을 확인한다. malformed body reader와 params thenable을 읽지 않고 거절함을 확인한다. 허용 사용자/로컬 off의 jobs GET200·기존 DTO·서비스 호출도 직접 확인했다. Auth 서버와 Next cookies client는 대역이며 실제 네트워크/Supabase 계정 검증이 아니다.

## 검수 요청·남은 것

Master께서는 fde8897 기반의 guard 변경만 선별 통합하고 전체 시험 미통과를 기록해 주세요. 실제 도구가 있는 격리 환경에서 전체 회귀를 재실행하고, 실제 Supabase 세션·쿠키 갱신/만료·로그아웃과 production HTTP API 거절을 독립 검수해야 합니다. UI를 변경하지 않아 이번에1280/390 브라우저 검증을 반복하지 않았습니다.

이번 작업은 인증의2차 방어만 추가한다. DB owner 전달/RLS 연결·서비스별 권한·CSRF 정책 확대·로그인 메일 수신·세션 만료 초안 보존·클라우드 이전/운영 배포는 후속 범위다. 원래 요청에 없는 승인/원본보호 규칙·로그인 정책을 변경하지 않았다.

**복사용 전달 메시지:** Master께 API 인증2차를 반환합니다. 지정 fde8897 기반으로 공개 로그인 요청을 제외한20 API 파일26 handler에 본문·params·파일·DB 이전의 독립 getUser/허용 계정 guard를 추가했고 관련125시험·lint·typecheck·production build/verify-build를 통과했습니다. 전체 회귀는 FFmpeg 부재와 후속 fixture 실패로774 PASS/20 FAIL/64 skip이며 실제 Supabase·운영 DB·배포는 변경하지 않았습니다. guard 변경 선별 통합 후 실제 도구와 세션이 있는 환경의 독립 검수를 배정해 주세요.
