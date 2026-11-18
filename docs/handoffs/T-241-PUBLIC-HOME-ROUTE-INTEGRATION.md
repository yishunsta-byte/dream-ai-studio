# T-241 공개 메인 루트 "/" · 작업실 "/studio" 통합

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_7c3110fd3bd0`, 허용 확정 `msg_d51dcb42ce14` · 상태: **ready_review(작성자 자체 검증, Auth·공통 변경이라 독립 보안 검수 필요)**
- 기준: HEAD `9f2c471`(T240 컴포넌트) 위
- T240 컴포넌트·lib·자산은 **바꾸지 않았어요**. T240-FIX는 별도 커밋으로 진행해요.

## 1. 바꾼 것
| 파일 | 변경 |
|---|---|
| `app/(public)/page.tsx`(새) | `/` 공개 메인. `NeonShowcase`에 `SAMPLE_WORKS`와 `loginHref="/login?next=%2Fstudio"`만 넘겨요. import는 `next`, T240 컴포넌트, T240 lib 3개뿐이에요 |
| `app/(studio)/page.tsx` → `app/(studio)/studio/page.tsx` | 작업실 홈 본문을 **그대로 이동**(git rename, 내용 diff 0). `(studio)` 레이아웃·`legacyPageGate` 그대로예요 |
| `lib/auth/config.ts` | `PUBLIC_SHOWCASE_ASSETS`(고정 6개 정확 경로, frozen), `isAnonymousPublicPath`(정확히 `/`+6개), `isPublicPath`에 같은 7개 추가. prefix 허용 없음. `safeNextPath`·`loginPath`·`sameSiteRedirect`·origin 방어·fallback `/`는 **그대로**예요 |
| `proxy.ts` | 맨 앞에 `isAnonymousPublicPath`면 `NextResponse.next()`. 그 밖의 경로는 기존 순서(로그인 꺼짐 → 설정 확인 503 → 세션 갱신 → 공개 인증 경로 → 401/403) **그대로**예요 |
| `app/layout.tsx` | 메뉴 설정 검증(오류 시 설정 항목 목록 화면)을 뺐어요. 글꼴·`ToastProvider`·children만 남았어요. 머리글 판정이나 우회 로직은 없어요 |
| `components/studio-layout.tsx` | 위 메뉴 설정 검증을 `legacyPageGate` 다음, `checkStartup`·메뉴 사용 앞으로 옮겼어요. 오류 시 같은 안내(h1·문구·`issues` 목록)를 보여 주고 시작 점검·자식을 그리지 않아요. 정상이면 `structuredClone(state.config)`(기존 `getMenuConfig()`와 같은 값)을 써요 |
| `components/studio-shell.tsx` | 브랜드 링크·"작업실" 메뉴·제목 표 `"/"` → `"/studio"` |
| `components/cloud/project-list-readonly.tsx` | "작업실로 가기" href `/studio` |
| `app/not-found.tsx` | "작업실로 돌아가기" href `/studio`(문구 그대로) |
| `app/login/page.tsx`, `app/account/password/page.tsx` | 로그인 꺼짐일 때 `redirect("/studio")` |
| `app/api/auth/signup/route.ts` | 가입 메일 링크 기본 next `/studio` |
| `lib/auth/legacy-page-gate.tsx` | 세션 없음 → `loginPath({ next: "/studio" })` |

### 공개 분기를 따로 둔 근거(proxy)
- `/`와 이미지는 로그인 설정이 빠졌거나(503 조건) 익명이어도 보여야 해요.
- 기존 `isPublicPath` 확인은 설정 확인·세션 갱신 **뒤**에 있어요. 그래서 거기에만 넣으면 설정이 빠진 경우 503이 나요.
- 그래서 정확한 7개만 맨 앞에서 통과시켜요. 이 분기는 세션 갱신(`getUser`)과 쿠키 쓰기를 하지 않아요.
  - 공개 메인은 로그인 사용자 정보를 쓰지 않으므로 갱신이 필요 없어요.
- `/login`·`/auth/callback`·`/api/auth/*`의 세션 갱신, 보호 경로의 설정 없음 503·401·403·no-store는 코드상 바뀐 줄이 없어요.

### 루트 레이아웃 메뉴 검증 이동 영향
- **이전:** 메뉴 설정이 깨지면 **모든 화면**이 설정 항목 목록(내부 파일 경로 포함)을 보여 줬어요. 공개·로그인·클라우드 화면도 포함이었어요.
- **이후**
  - 작업실(`(studio)` 레이아웃 아래 전부): 같은 안내로 막혀요. 가드 뒤라 로그인 전에는 로그인으로 가요.
  - 공개 메인·로그인·비밀번호·클라우드 보기(`(cloud)`)·`(workspace)`는 이제 이 안내를 보여 주지 않아요.
  - `(workspace)/workspaces/[id]`는 `getMenuConfig()`에서 예외가 나서 Next 오류 화면이 돼요(운영에서는 상세 숨김). 이 부분은 이번에 브라우저로 확인하지 않았어요. 필요하면 별도 보완이 필요해요.
  - 클라우드 화면은 메뉴 설정을 쓰지 않아요.

## 2. 기존 시험 변경(초기 실패 → 근거 있는 기대 갱신)
- 변경 직후 전체 vitest에서 **23개가 실패**했어요. 모두 아래 이유였고, 기대를 낮춘 것은 없어요.

| 시험 | 실패 이유 | 바꾼 것 |
|---|---|---|
| t182 `isPublicPath` 부정 목록 | `/`가 공개가 됨 | 보호 예시를 `/studio`로. 공개 7개·비슷한 경로 부정은 t241에서 따로 확인 |
| t182 설정 없음 503, 허용 밖 403 | 예시 경로 `/`가 공개 | 예시를 `/studio`로(같은 503·forbidden 기대) |
| t182 가입 next | 기본값 변경 | `/studio` |
| t183, t200 레이아웃 모의 | 레이아웃이 `getMenuConfigState` 사용 | 모의에 같은 menus 호출을 거치는 `getMenuConfigState` 추가(호출 0 단언은 유지) |
| t200 가드 순서 | 찾는 문자열 변경 | `getMenuConfigState()`도 가드 뒤인지 확인 |
| t200 세션 없음 14건 | gate next 명시 | `/login?next=%2Fstudio` |
| t200 대조군 경로 | 파일 이동 | `(studio)/studio/page.tsx` |
| t207 로컬 안내 링크 | href 변경 | `["/studio"]` |

- 새 `tests/t241-public-home-route.test.ts` 11건(mock Auth, 실제 Supabase 사용자 아님)
  - 정확 7개만 공개, 비슷한 경로 15개는 공개 아님: `/showcase/`, `/showcase/t240/`, `other.png`, 끝 `/`, 대문자, `.map`, t241, fonts, api 등
  - 설정 빠짐: 공개 7개 통과, `/studio`·비공개 이미지 경로·API 503
  - 공개 경로는 `getUser` 0회·set-cookie 없음
  - 로그인 전: `/studio` → `/login?next=%2Fstudio`, API 401, 비슷한 이미지 경로·`/cloud/projects` 로그인 이동
  - 허용 밖 계정: `/studio` forbidden, API 403, `/` 통과
  - 로그인 꺼짐: 모두 통과
  - 공개 페이지: 예시·로그인 링크, 설정 문구 없음. import 3개 고정. 루트 레이아웃이 menus·services·db·auth를 가져오지 않음
  - **메뉴 설정 손상:** StudioLayout은 안내+경로를 보여 주고 시작 점검 0·자식 없음. 같은 상태에서 공개 페이지는 예시만 보여 줘요
  - 작업실 이동·링크·redirect 문자열

## 3. 검증(실제 출력)
- **본 작업 트리**
  - 전체 vitest: **Test Files 103 passed | 10 skipped (113), Tests 2055 passed | 319 skipped (2374)**
  - `eslint . --max-warnings 0` 0
- **공유 tsc**
  - 공유 `.next/types/validator.ts`와 `.next/dev/types/validator.ts`가 옛 `app/(studio)/page.js`를 가리켜서 TS2307·TS2344 각 2개가 나와요.
  - 둘 다 **stale 생성물** 오류예요. 공유 `.next`는 지우거나 다시 만들지 않았어요.
- **격리 clean 사본**(`tmp/t241/app`: `git archive HEAD` + 이번 변경 파일, `.next` 없음): `tsc --noEmit --incremental false` **exit 0**. 소스 자체 타입 오류는 없어요.
- **격리 next dev HTTP**(제 포트만, 3013·공유 .next 미사용, production build 없음)

| 상태 | 결과 |
|---|---|
| 운영 유사(`VERCEL=1`, supabase, 닿지 않는 가짜 Auth, 익명) | `/` 200, set-cookie 0. 이미지 6개 200 image/png. `/_next/image?url=…orchid.png` 200 |
| 〃 보호 경로 | `/studio` 307 → `/login?next=%2Fstudio`, `/studio?tab=x` → `next=%2Fstudio%3Ftab%3Dx`, `/cloud/projects`·`/jobs`·`/showcase/t240/other.png` 307 로그인, `/api/projects`·`/api/jobs` 401, 모두 no-store |
| 〃 기타 | `/showcase/t240/`는 308(끝 슬래시 정리) 뒤 보호. 위조 `x-forwarded-host`로 `/` 요청해도 200(공개 내용만). `/login?next=//evil.test`는 로그인 화면 200(next는 safeNextPath가 `/`로 바꿈, 기존 동작) |
| 설정 빠짐(`VERCEL=1`만) | `/`·이미지·`/_next/image` 200. `/studio`·`/api/projects`·`/showcase/t240/x.png` 503 no-store |
| 이 PC + 사본 `docs/spec/menus.json` 손상 | `/` 200 예시만("메뉴 설정"·menus.json 0건). `/studio` 200 "메뉴 설정을 확인" 안내. `/login`(→`/studio`) 설정 문구 0. 확인 뒤 사본 파일 원복(cmp 일치) |
| 이 PC 정상(합성 data root, 마이그레이션 10개) | `/` 200, `/studio` 200 작업실, `/jobs` 200, `/login` 307 → `/studio` |

- **ego lite(1280·390)**: `tmp/t241/result.json` PASS, 캡처 `tmp/t241/shots/`
  - `/`: h1 1, 제목 "DREAM SCREEN", 넘침 없음, 로그인 링크 2개 모두 `/login?next=%2Fstudio`, 작업실 메뉴 없음, 외부 요청·깨진 이미지 0
  - 헤더 로그인 링크를 Enter로 누르면(로그인 꺼짐) `/studio` 작업실로 가요. h1 "작업실", 브랜드 href `/studio`, `aria-current` `/studio`
  - `/jobs`에서 "작업실" 메뉴 Enter → `/studio`
- Tester 브라우저 해제 뒤에만 썼어요(`msg_3e0af9b6843f`). 서버는 모두 종료했고 포트가 닫힌 것을 확인했어요.

## 4. 남은 점·검수 요청 범위
- **실제 Supabase 계정으로는 실행하지 않았어요**(mock·가짜 주소). 실제 로그인 후 `/studio` 도착, 가입 메일 링크, 세션 갱신은 독립 검수가 필요해요.
- 로그인 화면에 next 없이 들어와 로그인하면 `safeNextPath` 기본값 `/`(공개 메인)로 가요. 기본값 정책은 바꾸지 않았어요. 공개 메인과 작업실 링크는 next를 명시해요.
- `(workspace)` 화면의 메뉴 설정 손상 동작(위 1장)은 브라우저로 확인하지 않았어요.
- 공유 `.next` validator stale은 다음 정상 dev·build 때 다시 생성될 것으로 보여요. 이번에는 바꾸지 않았어요.
- 운영 Vercel에서 이미지 캐시·`/_next/image` 동작은 배포 전 확인이 필요해요.

## 보호
- 허용 파일과 시험·이 보고만 선택 커밋했어요.
- T240 고정 파일, 백엔드·SQL·다른 WIP(`tests/b45-*`), T122·T137, tmp는 미변경·미stage예요.
- push·배포 없음. 새 창·agent·worktree 없음. 비밀값 없음.
