# T-186 로그인 요청 출처 검사·로그아웃 실패 정직 처리 (F184-1·F184-2)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 기준: `e60b1c0`(공용 API 인증 가드 d167550·B2 시험 포함)
- 상태: 자체 검수(독립 검수 아님). **커밋만, push·배포 안 함**(Master 재검사 후 공개).

## F184-1 외부 사이트 폼으로 세션 생성 → 차단
- `lib/auth/config.ts` `rejectCrossSite(request, { json })`
  - `Origin`이 반드시 있어야 하고, 허용 출처(`DREAM_SITE_URL`·`VERCEL_PROJECT_PRODUCTION_URL`·`VERCEL_URL`, Vercel이 아닐 때만 접속 Host의 루프백 `http://`)와 같아야 해요. `Sec-Fetch-Site`가 오면 `same-origin`만 받아요. 어긋나면 **403 `AUTH_ORIGIN_REJECTED`**.
  - JSON 요청은 `Content-Type`이 `application/json`(charset 등 매개변수 허용)이 아니면 **415 `UNSUPPORTED_MEDIA_TYPE`**.
  - 본문 읽기·Supabase 호출 **전에** 실행되므로 거절 응답에는 세션 쿠키가 없어요.
- 적용: `login`·`signup`·`reset`·`password`(JSON) · `logout`(본문 없음, 공용 `requireApiAuth` 다음 순서 유지).
- 메일 callback(`/auth/callback`, GET)은 그대로예요.
- 주의: 나중에 직접 도메인을 붙이면 `DREAM_SITE_URL`에 넣어야 그 주소에서 로그인돼요.

## F184-2 로그아웃 실패를 성공으로 처리 → 정직 처리
- `app/api/auth/logout/route.ts`: `signOut()` 오류를 확인해요. 실패하면 `signOut({ scope: "local" })`로 이 브라우저 세션을 지워요. auth-js는 local일 때 서버 요청 **전에** 세션을 지워요. 그리고 **502**를 돌려줘요.
  - `LOGOUT_PARTIAL` + `localCleared:true`: 이 브라우저 로그인은 지웠지만, 서버 폐기는 확인하지 못했어요.
  - `LOGOUT_FAILED` + `localCleared:false`: 예외 때문에 이 브라우저 로그인도 못 지웠어요.
- `lib/auth/logout-client.ts`(새): 응답을 `ended`(200·401), `partial`, `failed`(오류·네트워크 실패)로 나눠요.
- `new-password-form.tsx`: 비밀번호 변경 성공 뒤 로그아웃 결과를 확인해요.
  - `ended`: `/login?notice=password`로 가요.
  - `partial`: `/login?notice=password-partial`로 가요(다른 기기 확인 안내).
  - `failed`: **"비밀번호는 바뀌었지만 로그아웃하지 못했어요" + "로그아웃 다시 시도"**를 보여 주고, 자동으로 넘어가지 않아요.
- `account-menu.tsx`: 같은 규칙이에요. 실패하면 그 자리에 안내와 "로그아웃 다시 시도"를 보여 줘요.
- `app/login/page.tsx`: 안내 문구 `password-partial`·`logout-partial`을 추가했어요.

## 확인
| 확인 | 결과 |
|---|---|
| `t182-auth`+`api-auth`+`t183` | 149→**154/154**(새 시험: 외부 text/plain 폼 5곳 403·쿠키 없음·호출 0, 출처 없음/다른 출처/`null`/same-site/Vercel 루프백 거절, 비JSON 415, 정상 JSON·charset·Vercel 출처 통과, 로그아웃 성공/SDK 오류→PARTIAL/둘 다 오류→PARTIAL/예외→FAILED, 브라우저 결과 분류) |
| 전체 시험 | **882 통과·23 skip** |
| `tsc`, `eslint`(바꾼 파일) | exit 0 |
| 격리 운영 빌드(OS temp 안전 사본) + `verify-build` | exit 0, 서비스 키·로컬 데이터 추적 없음 |

### 실제 브라우저(ego lite, 390) + 가짜 인증 서버
- 검수자 하네스 방식이에요. 실제 SDK·SSR 쿠키·proxy를 쓰고, 인증 HTTP만 127.0.0.1:43184로 바꿨어요. 앱은 43185, 공격 페이지는 43186이에요. 계정은 `owner@example.com`, 비밀번호는 가짜만 썼어요.

| 시나리오 | 결과 |
|---|---|
| 원재현: 외부 출처 text/plain 폼을 실제로 클릭 | **403 AUTH_ORIGIN_REJECTED**, sb 쿠키 0, 인증 서버 token 호출 0, 이어서 `/account/password` → 로그인으로 이동 |
| 정상 로그인(폼) | `/account/password` 도착, 쿠키 생성 |
| Supabase logout 500(전역·local 모두) | 호출 순서 `global→local`, `/login?notice=password-partial` 안내, sb 쿠키 0, 보호 화면 → 로그인 |
| 앱 logout 요청 네트워크 차단 | 실패 안내와 **"로그아웃 다시 시도"**, 자동 이동 없음, 쿠키 유지(정직) |
| 차단 해제 후 다시 시도 | `/login?notice=password`, 쿠키 0, 보호 화면 → 로그인 |
| 대조군: 정상 logout 204 | `/login?notice=password`, 쿠키 0, 보호 화면 → 로그인 |

- 시험 서버 3개를 종료하고 포트가 비었는지 확인했어요. 안전 사본도 삭제했어요. 3013 운영본(51032)은 그대로예요.
- 실제 사용자 비밀번호·실제 메일·운영 DB·Supabase/Vercel 설정은 바꾸지 않았어요.

## 남은 것
- 1280 폭에서 실패 화면은 직접 보지 않았어요(390만 확인).
- 운영 Vercel에 반영하려면 Master 재검사 후 push가 필요해요.
