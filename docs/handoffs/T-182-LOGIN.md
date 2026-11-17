# T-182 로그인(V1): 이메일 로그인 링크 + 접속 보호

- 담당: Codex(Front)(터미널 term_a0a6f98c) · 지시: CX-MASTER-01 msg_b2fb3ee0dfc1 "작업진행"(V1 배정 요청 msg_f456b04a77e1에 대한 답)
- 기준: T-179 계획 V1, T-181 연결 약속 3장·8장 1번
- 주인님 결정: 로그인 방식은 **이메일 로그인 링크**, 허용 계정은 **주인님 Gmail 1개**(주소 값은 저장소에 두지 않음)
- 상태: 자체 검수(독립 검수 아님). Vercel 배포는 아직 안 했어요.

## 바꾼 파일
| 파일 | 내용 |
|---|---|
| `lib/auth/config.ts` (새) | 로그인 모드 판단, 허용 이메일, 공개 경로, 돌아갈 주소 검사, 접속 주소 계산 |
| `proxy.ts` (새) | Next 16 접속 보호. 세션 갱신, 로그인 전 화면→`/login?next=`, API→401, 허용 밖→403, 설정 빠짐→503 |
| `lib/auth/server.ts` (새) | 서버 컴포넌트·라우트용 Supabase 연결(쿠키 세션, 비밀키 없음), 현재 계정 이메일 |
| `app/api/auth/login/route.ts` (새) | 로그인 링크 요청. 허용 밖 주소에도 같은 안내(메일은 안 보냄), `shouldCreateUser:false` |
| `app/auth/callback/route.ts` (새) | 메일 링크 확인(code 또는 token_hash) → 세션, 허용 밖이면 바로 로그아웃 |
| `app/api/auth/logout/route.ts` (새) | 로그아웃 |
| `app/login/page.tsx`, `components/auth/*` (새) | 로그인 화면, 보낸 뒤 안내, 오류 안내, 상단 바 계정·로그아웃 |
| `components/studio-shell.tsx`, `studio-layout.tsx` | 상단 바에 계정 이메일·로그아웃(로그인 모드일 때만) |
| `scripts/verify-build.mjs`, `verify-build.d.mts` | 화면 파일(`.next/static`)에 서비스 키가 들어가면 빌드 실패 |
| `.env.example` | 로그인 관련 변수 **이름만** 추가 |
| `package.json`, `package-lock.json` | `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.0 (정확한 버전 고정) |
| `tests/t182-auth.test.ts` (새) | 15개 시험 |

## 동작 규칙
- **이 PC 실행(127.0.0.1)은 기본으로 로그인을 쓰지 않아요.** `DREAM_AUTH_MODE=supabase`일 때만 켜져요. 그래서 지금 3013 운영본과 개발 서버는 그대로예요.
- **Vercel에서는 설정과 상관없이 항상 로그인 모드**예요(`VERCEL` 환경변수). 설정이 빠지면 열리지 않고 503으로 막혀요.
- 로그인 없이 열리는 곳: `/login`, `/auth/callback`, `/api/auth/login`, 정적 파일(`_next/static`, `fonts/`)뿐이에요.
- 돌아갈 주소(`next`)는 같은 사이트 경로만 허용해요(`//`, 외부 주소, `/login` 거절).
- 링크 확인 뒤 주소는 브라우저가 실제로 접속한 Host를 따라요. 시험에서 라우트의 `request.url`이 `localhost`로 바뀌어 쿠키가 맞지 않는 문제를 찾아 고쳤어요.

## Supabase 설정(대시보드, 주인님 계정)
- 프로젝트 `dream-ai-studio`(서울 ap-northeast-2), 사용자 1명(허용 Gmail) 미리 등록
- **새 가입 허용: 끔**(저장 후 다시 읽어 확인)
- Site URL `http://127.0.0.1:43182`, Redirect URL `http://127.0.0.1:43182/auth/callback**` — **시험용이에요. Vercel 주소가 생기면 바꿔야 해요.**
- 키·DB 비밀번호·허용 이메일은 이 PC `.env.local`에만 있어요(gitignore 확인). 커밋 전 비밀값 검사 0건.

## 확인
| 확인 | 결과 |
|---|---|
| `t182-auth` | 15/15 통과(모드 판단·허용 목록·돌아갈 주소·접속 주소·proxy 7가지·빌드 키 검사 3가지) |
| 전체 시험 | 69파일 통과·3 skip, 731 통과·23 skip(로고 색 CSS 수정 전 실행, 그 뒤 바뀐 것은 CSS 한 줄) |
| 처음 전체 시험 | 기존 빌드 검사 시험 3개 실패 → 가짜 빌드에 `.next/static`이 없으면 넘어가게 고친 뒤 통과 |
| `tsc --noEmit`, `eslint`(바꾼 파일) | 둘 다 exit 0 |
| 운영 빌드 + `verify-build` | OS 임시 안전 사본에서 둘 다 exit 0. 빌드 목록에 `Proxy (Middleware)`, `/login`, `/auth/callback`, `/api/auth/*` |
| 실제 서버(사본, 43182, 로그인 모드, 실제 Supabase) | `/`·`/settings`·`/jobs` → 307 `/login?next=…`, `/login` 200, `/api/jobs` 401 `AUTH_REQUIRED` |
| ego lite 1280·390 | 로그인 전 `/projects/new` → 로그인 화면(넘침 0/0). 빈 칸 → 입력칸 오류·포커스. 허용 밖 주소 → 같은 안내. 로그인 링크 → `/settings`로 돌아옴, 로그아웃 버튼 보임(넘침 0/-15), API 200. 로그아웃 → `/login`, API 401. 쓴 링크 다시 쓰기 → "만료됐거나 이미 사용됐어요" |
| 화면 캡처 직접 확인 | 로그인 390, 로그인 후 390·1280. 로고 글자색이 다른 규칙에 덮인 것을 찾아 고친 뒤 흰색 확인 |

- 로그인 링크 시험은 **메일을 보내지 않고** 관리자 기능으로 만든 1회용 링크를 썼어요. 실제 메일 수신·클릭은 주인님 확인이 필요해요.
- 3013 운영본(PID 51032)은 건드리지 않았고 계속 떠 있어요. 사본·시험 서버는 지웠어요.

## 남은 것
1. **API 각각의 2차 확인**: 지금은 proxy 한 곳에서 막아요. T-181 약속대로 API마다 한 번 더 확인하는 일은 백엔드 DB 이전과 함께 해야 해요.
2. 실제 메일 수신 확인(주인님), Supabase 기본 메일 문구를 한글로 바꾸기.
3. Vercel 주소가 정해지면 Site URL·Redirect URL 교체, Vercel 환경변수 등록.
4. 세션 만료 때 작성 중 내용 유지는 아직 없어요. 화면들이 API 401 한글 안내를 그대로 보여 주는 수준이에요.

## 독립 검수 FAIL 반영 (검수 21d98fa `T-182-LOGIN-REVIEW.md`, Master msg_7faa4fc1b31b)

| 항목 | 원인 | 수정 |
|---|---|---|
| F182-1 제어문자 next | 접두사만 보고, URL 해석이 탭·LF·CR을 지우며 `/<탭>/evil.test`가 `//evil.test`가 됨 | `safeNextPath`: 제어문자(U+0000~001F, 007F)·역슬래시가 있으면 먼저 `/`. 그다음 URL로 해석해 같은 사이트·`//` 아님·`/login`·`/auth/` 아님을 다시 확인하고 해석 결과를 돌려줌 |
| F182-2 forwarded host | `requestOrigin`이 `x-forwarded-host`를 무조건 믿음 | 함수 삭제. **link callback의 이동은 모두 같은 사이트 상대 경로**(`Location: /…`)로 바꿔 머리글을 쓰지 않음. 메일 링크 주소는 `callbackOrigin`: 정해 둔 목록(`DREAM_SITE_URL`, Vercel이 주는 `VERCEL_PROJECT_PRODUCTION_URL`·`VERCEL_URL`)과 Host가 맞을 때만, 이 PC 실행이면 127.0.0.1·localhost만 허용, 그 밖은 목록 첫 주소 또는 400 `AUTH_ORIGIN_UNTRUSTED`. `x-forwarded-*`는 읽지 않음 |
| O182-1 JSON null | 객체 확인 없이 `body.email` 읽음 | null·배열·문자열·숫자는 400 `BAD_REQUEST` |
| 추가 | callback `type`을 아무 값이나 받음 | 알려진 메일 확인 종류만 허용, 나머지는 `/login?error=link` |

- proxy 화면 보호의 이동: 처음에 상대 경로로 바꿨더니 **Next proxy가 절대 주소만 받아 500**이 났어요(실제 서버에서 발견, 단위 시험은 통과했던 경우). `request.nextUrl`에 경로만 바꿔 붙이는 방식으로 고쳤고, 실제 서버에서 Next가 같은 사이트 이동을 상대 경로로 내보내는 것을 확인했어요.

### 수정 확인
| 확인 | 결과 |
|---|---|
| `t182-auth` | 26/26 통과(새 11개: 제어문자 7가지·퍼센트 3가지·정상 경로 유지·로그인 주소·사이트 주소 목록 8가지·callback 4묶음·링크 요청 4묶음) |
| 전체 시험 | 743 통과·23 skip |
| `tsc`, `eslint`(바꾼 파일) | 둘 다 exit 0. 정규식 안 제어문자 규칙 때문에 글자 하나씩 검사로 바꿈 |
| 운영 빌드 + `verify-build`(OS 임시 사본) | 둘 다 exit 0 |
| 검수 요청 그대로(실제 서버 43182) | `GET /auth/callback` + `x-forwarded-host: evil.test` → 307 `/login?error=link`. `/settings` + `x-forwarded-host`·`host: evil.test` → 307 `/login?next=%2Fsettings%3Fa%3D1`(상대 경로). JSON `null` → 400 |
| 실제 Supabase 1회용 링크 + `next`=탭·LF·CR + `x-forwarded-host: evil.test` | 셋 다 307 `Location: /`, 세션 쿠키 생김, 그 쿠키로 API 200. 정상 `next=/projects/new?x=1` → 그대로 |
| ego lite 390·1280 | 로그인 전 `/library` → `/login?next=%2Flibrary`(넘침 0/0), 링크 → `/jobs`·로그아웃 버튼·API 200, 로그아웃 → `/login`·API 401 |

- 3013(PID 51032)은 그대로예요. 사본·시험 서버는 지웠고 43182 리슨 없음.
- 남은 것은 위 "남은 것" 1~4와 같아요. **API별 2차 확인은 여전히 없어요.** 재검수 부탁드려요.
