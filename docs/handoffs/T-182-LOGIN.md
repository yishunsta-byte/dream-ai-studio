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
