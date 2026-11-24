# T-243-R 관리자 로그인 독립 보안 검수

2026-11-18 · Codex(Tester) · fixed **6d0ee14267c7d3446a9cf847e2c7b79709706a4c** · Master 배정 msg_be615cca6f3a.

**판정: PASS — 검증한 T243 인증·개인 범위·세션 보호에 한정.** 실제 Supabase 계정/운영 로그인·배포·관리자 역할 전체 구현 승인이 아니다. 36px 보기/약30px 찾기는 기존 공용 CSS 문제로 재현했으며 T244 별도 보완 범위다. 비밀번호 재설정 뒤 admin 복귀는 이 고정본에 없고 T245 별도 기능이다. 이 한계를 없었던 것으로 표현하지 않는다. 제품·원 테스트·설정 파일은 수정하지 않았고 이 신규 보고서만 변경한다.

## 고정 소스 경계

고정 git archive 사본 `tmp/t243r-review-6d0ee14/app` 및 기존 node_modules junction으로 검증했다. 사본에도 제품 의미를 바꾸는 patch를 하지 않았다. 종료 후 `source-check.mjs`가 커밋의13개 경로 전부 고정 LF와 일치함을 확인했다. 동시 Front T244/T245·Backend B47, 사용자 preview50963/Ego54·공유3013/.next는 조작하지 않았다.

- `/admin/login` 정확 경로만 기존 PUBLIC_PATHS에 추가된다. T241 익명 early-skip Set에는 추가되지 않아 config 확인·Supabase getUser/session refresh 뒤에만 통과한다. `/admin`, admin 하위·유사 prefix·API는 공개가 아니다. 기존 matcher static/font 예외나 일반 로그인 공개 경로와 구분한다.
- proxy의 판정 기준은 그대로이고 admin 경로의 거부 목적지만 관리자 로그인으로 바뀐다. `isAdminPath`는 `/admin` 또는 `/admin/` 시작만; `/adminx`는 일반 로그인으로 간다. `adminNextPath`는 기존 safeNextPath 검사를 먼저 거쳐 admin 하위만 허용하고 자기 로그인 경로는 제외한다. helpers/import가 실제로 존재하며 clean type/실서버에서 실행됐다.
- `/admin`은 proxy와 별개로 getRenderAuth→기존 resolveServerAuth의 서버 getUser/allowlist/UUID 확인을 거쳐야 렌더링된다. local은 설정 안내, denied는401/403/503에 맞는 관리자 로그인 이동, verified만 SessionBoundary/AccountMenu/ProtectedContent를 받는다. 인증 상태를 브라우저 저장소나 요청의 owner/email 값으로 승격하지 않는다.
- AdminHub는 확인된 자기 이메일과 `/cloud/manage`, `/cloud/projects`, `/account/password` 링크만 준다. 회원 관리·서비스 상태는 미연결 안내이며 타인 계정/실통계/DB 조회/삭제/실행 endpoint가 없다. 별도 admin-role·일반 회원 권한·allowlist 확대·계정 생성/비밀번호 고정·service-role 사용은 추가되지 않았다. 여기서 관리자라는 명칭은 기존 허용 계정의 개인 관리 입구다. 실제 전체 회원 관리자 권한을 구현한 것으로 해석하지 않는다.
- `loginOnly`는 공용 폼 기본 false를 유지하면서 관리자 화면의 signup 탭/tabpanel 관계만 제거한다. 기존 `/api/auth/login` 요청·검증은 그대로다. 원 T220 inventory에 admin을 추가하면서 동일 SessionBoundary/ProtectedContent 조건을 유지했으며 기존 보호 기대를 완화하지 않았다.

## 고정 사본 검사

`tests/t243-admin-login.test.ts`, `t182-auth`, `t213-cross-tab-session`, `t220-protected-content-session`, `t235-session-focus-restore`, `t241-public-home-route` — **112/112 PASS**, suite6개 PASS(새 T243 13건 포함). native PG 관련5개 process-local switch0. 고정 clean 전체 `tsc --noEmit --incremental false` exit0, admin/component/auth/proxy/관련 테스트 scoped eslint `--max-warnings 0` exit0. 공유 typegen/build/cache를 고치지 않았다.

## 실제 Next + 실제 SDK + 모의 Supabase HTTP

독립 Next dev **50972**, 로컬 모의 Auth **50971**, 사본 `.next`와 소유 runtime root만 사용했다. VERCEL1/auth=supabase에 synthetic key/email/JWT를 사용하며 모의 서버는 user/token/logout/recover만 응답한다. **실계정·실메일·실비밀번호 조회/변경은 없었다.** 모의 recover 요청은 로컬 로그만 남고 메일을 보내지 않는다. 테스트 토큰은 실제 서명 검증 증거가 아니다.

`http-security.mjs`/`http-security.json`의 **33검사 PASS**:

| 경계 | 독립 관측 |
| --- | --- |
| 공개 루트 | `/`200, 관리자 링크 존재, 만료 합성 cookie를 보내도 Auth 요청 증가0·set-cookie0 |
| 관리자 로그인 | `/admin/login`200/no-store/noindex,nofollow/signup0. 만료 합성 cookie는 SDK refresh+getUser를 거쳐 Set-Cookie 발생. 익명 pre-auth skip이 아님 |
| 보호·경로 변형 | admin/쿼리/하위·login/x·대문자·adminx·인코딩 admin/slash/dot segment·API/files/studio15종은 익명307/308/401 등, private200 우회 없음. 개별 status/location JSON 보존 |
| 허용 owner | `/admin`200/no-store/noindex, 자기 이메일·ProtectedContent·미연결 표시·폼0. Auth getUser는 proxy+서버로2회 |
| 허용 밖 | `/admin`307 `/admin/login?error=forbidden`, no-store |
| 서버 재확인 | 모의 첫 getUser만 owner, 이후 forbidden으로 전환 → proxy 통과 후 서버가 다시 거부(2호출), owner 이메일·개인 관리 링크는 응답에 렌더되지 않음 |
| 비밀번호 오류 | 허용 이메일+틀린 비밀번호와 미허용 이메일 모두400/동일 INVALID_CREDENTIALS 본문·쿠키0. 계정 존재/allowlist 값·토큰은 오류 본문에 없음. 모든 Supabase 오류의 동일성까지 보증하는 것은 아님 |
| origin/next | 타 origin 로그인403 AUTH_ORIGIN_REJECTED, 위조 forwarded host로 외부 redirect 없음. 외부 URL/프로토콜상대/다른 앱 경로/자기 로그인/encoded 변형 next8건에서 로그인 화면만 렌더. 실제 unsafe-next 성공 로그인도 아래서 /admin 도착 확인 |

인증 설정 누락 모드 `http-missing.json` **7검사 PASS**: root200, admin/login/admin/하위/API/일반 login503/no-store/owner·폼0, Auth 요청 증가0. 로그인 꺼짐 모드 `http-local.json` **7검사 PASS**: admin/login/admin200/noindex/no-store/설정 안내만/폼0·계정0, Auth 요청 증가0. 로컬 `/api/projects`503은 소유 빈 runtime backend 상태이며 업무 성공을 주장하지 않는다.

## 실제 브라우저 세션·폼

Front의 ego 미점유 회신 msg_21622b8e3c5f 뒤 새 **space62**, **http://localhost:50972**에서 실행했다. 127.0.0.1 기존 sb 쿠키 영향을 피하기 위한 별도 host이며 사용자 탭/쿠키를 삭제하거나 재claim하지 않았다. 각 로그인은 로컬 모의 계정만 사용했고 앱의 정상 로그아웃으로 끝냈다. localhost의 쿠키도 임의 CDP 삭제하지 않았다.

`round-08-final-session.mjs`/`browser-final-session.json` 실제 결과:

- 모의 계정 로그인 → `/admin`, h1관리 화면/자기 계정/본문 표시.
- 허용 밖 계정으로 서버 판정 전환 후 합성 cross-tab StorageEvent 신호 → 기존 계정 표시·ProtectedContent 노드가 제거되고 `/login?error=forbidden`으로 전체 이동.
- 다시 모의 로그인 후 실제 로그아웃 버튼 → SDK/local mock logout/API200 → `/login`, 이전 계정 표시/ProtectedContent0.
- 로그아웃 뒤 `/admin` 재요청 → `/admin/login?next=%2Fadmin` 거부 이동.

`round-09-form-final.mjs`/`browser-form-final.json`:390×844·1280×900 모두 h1관리자 로그인/signup0/password1/noindex/넘침0. `next=//evil.test`에서 실제 성공 로그인해도 **http://localhost:50972/admin**에 도착, 외부로 가지 않았다. 두 폭의 보기36px/찾기30.390625px는 그대로 재현했으며 T244 해결 완료라고 주장하지 않는다. 일반 로그인은 기존 signup 탭을 유지했다.

일부 선행 브라우저 검사는 미완료로 보존했다. 첫 generic-alert 조회는 notice 전환 순간 null이어서 종료했고, 다음 관측에서 실제 일반 오류 alert를 확인했다. 공급자 unavailable을 보내면 기존 proxy가 user없음으로401을 반환하여 세션 경계가 본문을 제거하고 `/login?next=%2Fadmin`으로 이동했다; 이를503 불확실 상태로 기다린 선행 검사의 기대가 맞지 않았다. 또 CDP network-offline/합성 신호로 hidden+inert를 기다린 선행 라운드는 타임아웃했고, 다음 관측에서 online/current였다. **이 라운드를 offline UI PASS나 제품 결함으로 확정하지 않는다.** 실제 uncertainty hidden/inert/복원 조건은 기존 T220/T235 unit 근거와 소스에 한정하며, 이번 브라우저에서 완료한 것은 계정거부·로그아웃 뒤 제거/재접근 차단이다. 새 완결된 라운드와 선행 실패/미완료를 혼합해 전부 통과라고 세지 않았다.

직접 시각 확인한 `shots/login-final-390.png`, `hub-1280.png`는 실제 모의 로그인/관리 화면이며 별도 무인증 허브 preview가 아니다. 추가 error390/hub390 캡처도 보존했다. 스크린리더·모든 contrast·실계정 세션·운영 장애 시간을 검증한 것은 아니다.

## 복구·관리자 복귀 한계

현재 공용 reset은 이메일만 POST하고 callback next는 **/account/password**로 고정한다. 실제 로컬 mock `/auth/v1/recover` 수신 redirect_to도 이를 확인했다(`synthetic-reset-request.json`). NewPasswordForm 성공 후 로그아웃 ended/partial은 각각 `/login?notice=password`/`password-partial`로 가며 admin 목적지가 전달되지 않는다. AccountMenu 로그아웃/세션 변경도 기존 일반 `/login` 목적지를 쓴다. 따라서 이 고정본에 **reset→admin/login→admin 문맥 보존이 있다고 표현하지 않는다**. 새 보안 권한 우회는 아니며 기능 보완 필요를 Master에게 전달했고 msg_7594dabbd397에서 **T245 별도 배정**으로 접수됐다. 실제 비밀번호 변경·회복 메일을 실행하지 않았고, partial/failed는 기존 unit/소스 범위이며 새 실서비스 재현을 주장하지 않는다.

## 정리·반환

space62 `finish({keep:[]})` 완료 및 Front에 해제 msg_aaa75058fa9c 전송. 모든 own Next/모의 서버 세션을 종료했고 OS에서 **mock67384, 최초 Next68476, 최종 Next46832 부재;50971·50972 listener 부재** 확인했다. 원13경로 사본 고정 일치, T244/T245/B47 및 무관 T122/T137 보고서 보존. 서버/env 설정은 실행 process-local 합성 값만 사용했다. 실제 운영 계정/메일/서비스 설정 변경, build/deploy, 공유서버 조작은 없었다.

Master 복사 반환: T243-R fixed6d0ee14 **PASS(검증된보안범위한정)**·새13포함112tests/type/scopedlint0·HTTP33+missing7+local7PASS·실SDK syntheticlogin admin도착/서버2차재판정·forbidden교체/로그아웃본문제거·unsafeNext admin제한. 실Supabase/운영·offline불확실브라우저PASS미주장,known36/30px는T244·resetadmin복귀는현재없고T245별도. ownego/서버정리·고정보고1파일선택commit.
