# T-191 서버 인증 공통 판별(resolveServerAuth) — Backend 연결용 검증 사용자

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 기준 계약: `docs/handoffs/B4-PROJECT-READ-CONTRACT.md` 2장
- 상태: 자체 검수(독립 검수 아님) · **로컬 커밋만, push 안 함**(Master·Tester 확인 전)

## Backend에 넘기는 결과(DTO)
```ts
// import { resolveServerAuth, type ServerAuthResult } from "@/lib/auth/resolve";
type ServerAuthResult =
  | { kind: "local" }                                   // DREAM_AUTH_MODE 꺼짐(이 PC)
  | { kind: "verified"; userId: string; email: string } // userId: Supabase user.id, UUID 형식 검증·소문자
  | { kind: "denied"; status: 401 | 403 | 503; code: "AUTH_REQUIRED" | "AUTH_FORBIDDEN" | "AUTH_UNAVAILABLE" };
```
- **라우트 핸들러**는 `const auth = await resolveServerAuth()`를 한 번만 불러요.
  - `denied`면 `return authDeniedResponse(auth)`예요(`@/lib/auth/api`: `{error,code}`, no-store, 리다이렉트 없음).
  - `verified`면 `auth.userId`를 actor에 넘겨요.
  - 같은 핸들러에서 `requireApiAuth`와 함께 부르지 않아요. service·repo·transaction에서 인증을 다시 조회하지 않아요.
- **서버 컴포넌트**는 `getRenderAuth`(`@/lib/auth/render`, `cache(resolveServerAuth)`로 한 번 만든 함수)만 써요. layout 계정 표시(`currentAccountEmail`)도 같은 함수를 써서, 한 번 화면을 그릴 때 getUser는 1번만 불려요.
- 이메일을 UUID로 바꾸거나, 요청의 owner_id·헤더·쿠키 원문을 믿지 않아요.

## 판별 순서(기존 가드와 같음)
1. `authMode()==="off"` → `local`(인증 서버 호출 없음)
2. `authReady()` 아님 → 503 AUTH_UNAVAILABLE
3. `createSupabaseServer()` 없음 → 503
4. `getUser()` **1회**
5. `error`가 있으면 user가 같이 와도 거절해요. 5xx·`AuthRetryableFetchError`는 503, 나머지는 401이에요.
6. user 없음 → 401
7. 이메일이 없거나 허용 목록 밖 → 403 AUTH_FORBIDDEN
8. 허용된 계정인데 id가 없거나 UUID가 아님 → 503 AUTH_UNAVAILABLE(인증 응답 계약 깨짐)
9. 예외 → 503
- 결과는 모듈 전역에 저장하지 않아요. React cache는 화면 그리기 한 번 안에서만 효과가 있어요. 근거는 설치된 Next 16.4.6 문서 `01-app/02-guides/authentication.md`의 "React's cache deduplicates within a React render pass. … Route Handlers are not part of a render pass"예요. 그래서 라우트는 결과를 직접 전달해요. unstable_cache·영속 캐시는 쓰지 않았어요.

## 바뀐 파일
- `lib/auth/resolve.ts`(새): `resolveServerAuth`, `ServerAuthResult`
- `lib/auth/api.ts`: `requireApiAuth`를 호환 adapter로 바꿨어요(Response|null, 기존 20개 보호 라우트는 그대로). `authDeniedResponse`를 추가했어요.
- `lib/auth/render.ts`(새): `getRenderAuth`(React cache), `currentAccountEmail`(verified만 이메일)
- `lib/auth/server.ts`: `currentAccountEmail`을 render.ts로 옮겼어요(getUser 경로를 하나로 모으려고).
- `components/studio-layout.tsx`, `app/account/password/page.tsx`: import 경로만 바꿨어요.
- 시험: `tests/t191-auth-resolver.test.ts`(새 20건). `api-auth`·`t182` 시험의 가짜 user id를 UUID로 바꿨어요(새 규칙상 "synthetic"은 503). `t183`은 mock 경로만 바꿨어요.
- T186 로그인·가입·재설정·비밀번호·로그아웃의 Origin/JSON/로그아웃 처리는 바꾸지 않았어요. proxy의 1차 getUser도 그대로예요.
- DB 연결, 업무 API 연결, SQLite·Postgres, `lib/db`, 패키지는 바꾸지 않았어요.

## 확인
| 확인 | 결과 |
|---|---|
| `t191` 새 시험 | 20/20(순서·코드·getUser 1회·요청 간 재판별·adapter no-store/리다이렉트 없음/본문 키·화면 이메일) |
| 인증 회귀(t182·api-auth·t183·maintenance-routes) | 157/157 |
| 전체 시험 | **925 통과 · 36 skip**(skip 증가분은 opt-in Postgres 시험) |
| `tsc`, `eslint`(바꾼 파일) | exit 0 |
| 격리 운영 빌드 + `verify-build` | exit 0(확인용 페이지 없는 깨끗한 빌드) |

### 실제 서버(격리 사본 `next start`) + 가짜 인증 서버(계정 2개)
- 사본에만 확인용 페이지 `/t191-probe`를 넣고 따로 빌드했어요(커밋 안 함). 이 페이지는 `getRenderAuth()` 2번과 `currentAccountEmail()`을 불러요.

| 확인 | 결과 |
|---|---|
| A 계정 확인용 화면 | verified{userId 1111…, owner@}, 두 결과 같은 객체(`same:true`). 인증 서버 `/user` 호출 **2번 = proxy 1 + 화면 1**(화면 안 3번 호출이 1번으로 합쳐짐) |
| B 계정 | verified{2222…, second@}, 호출 2번 |
| `/account/password`(layout 없음 화면) | 200, 호출 2번 |
| A `/api/jobs` | 인증 통과 후 서비스가 503 "시작 점검"(사본에 저장 폴더 없음). 호출 2번 = proxy 1 + 핸들러 1 |
| A·B 동시 섞인 요청 20개 | A 응답 10/10 owner·second 0, B 응답 10/10 second·owner 0, 호출 owner 20·second 20 → **요청 간 누출 없음** |
| 회귀 | 로그인 없는 화면 307, 로그인 없는 API 401, 외부 출처 로그인 403, A 로그아웃 200 → A API 401, B는 그대로 로그인 |
- 시험 서버(43194·43195)를 종료하고 포트가 비었는지 확인했어요. 사본도 삭제했어요. 3013 운영본은 그대로예요.
- 실제 사용자 비밀번호·메일·운영 설정·DB는 바꾸지 않았어요.

## 남은 것
- Backend 읽기 API·page loader는 아직 이 결과를 쓰지 않아요(B4 연결은 Backend 작업).
- 운영 배포는 Master·Tester 확인 뒤예요.
