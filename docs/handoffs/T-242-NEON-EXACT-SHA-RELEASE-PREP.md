# T-242 정확 후보 e36171c 빌드·배포 준비 확인

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_021694457635`
- 상태: **준비 확인 끝. 실제 전송은 하지 않았어요**(push·배포·대체 CLI/API 없음)
- 바꾼 파일: 이 보고서 1개뿐이에요. 제품 소스는 바꾸지 않았어요.

## 1. 후보 고정
- **후보 커밋:** `e36171c6f84bfdb2baebf69ddc4118fe8a3481be`
  - T240-FIX. 위로 T241 `313c16d`, T240 `9f2c471`가 포함돼요.
- **확인 당시 로컬 HEAD:** `555436c`(Tester T241-R 보고 커밋. 정정: 처음엔 Master 문서 커밋으로 잘못 적었어요. docs-only 판정은 같아요)
  - 후보 이후 HEAD까지의 차이는 docs뿐이에요. `git diff --stat e36171c HEAD -- . ':!docs'`가 비어 있었어요.
  - 작업 트리의 B46 WIP(`lib/db/postgres/migration-catalog-v3.ts`, `tests/postgres/schema5-catalog.test.ts`, `tests/b46-policy-dependency-native-owned.ts`)는 섞지 않았어요.
- **격리 사본:** `git archive e36171c`만 썼어요(`.next`·`.env*`·tmp 없음).
  - 파일 수는 1188개로, `git ls-tree -r` 1188개와 같아요.
  - archive sha256은 `e2a3ba6b6173edeac5982f68da99e2796b7d63c42d554738995169ba84e0d2a5`예요.
- **위치:**
  - 1차: 저장소 안 `tmp/t242/app`
  - 2차(최종 근거): 저장소 밖 세션 임시 폴더
  - 2차를 한 이유: 1차 빌드에서 상위 폴더 lockfile 때문에 Next가 작업 기준 폴더(workspace root)를 상위 폴더로 잡았다는 경고가 나왔어요. 경고 없는 깨끗한 근거를 남기려고 같은 커밋을 저장소 밖에서 다시 빌드했어요.
- `node_modules`는 메인 PC 것을 복사했어요. 새로 설치한 것은 없어요.

## 2. 소스·import·자산·비밀
- **공개 페이지 import:** `app/(public)/page.tsx`는 `next`, `@/components/public-showcase/neon-showcase`, `@/lib/public-showcase/works` 3개만 가져와요.
  - 컴포넌트와 lib는 react·next/image·next/link·works·자기 CSS만 가져와요.
  - `fetch`·`process.env`·`localStorage`는 없어요.
  - 위 내용은 관련 시험으로 확인했어요.
- **공개 자산:** `/` + `/showcase/t240/` 고정 6개(정확 경로)뿐이에요.
- **정적 청크:** `.next/static`에서 `pg-native`, `postgres-js`, `lib/db/postgres`, 서비스 역할 키 이름, `sb_secret_`이 들어 있는 파일은 0개였어요.
  - `scripts/verify-build.mjs`도 통과했어요: "운영 빌드 확인: 로컬 데이터·비밀 설정·영상 만들기 도구 추적 없음, 화면 파일에 서비스 키 없음".
- **비밀 검사**(정해진 패턴, 사본 전체)
  - 코드·설정 쪽 일치는 2곳이에요.
    - `tests/t182-auth.test.ts:401,403`: 유출 검사 시험이 일부러 넣은 가짜 `sb_secret_` 값이에요. 실제 키가 아니에요.
    - `lib/db/postgres/README.md`: 문서 속 Supabase 프로젝트 식별자예요. 비밀값이 아니고, 이미 공개 저장소에 있어요.
  - `tests/s4-fixture.test.ts`의 사용자 임시 폴더 이름 패턴 일치는 경로 거부 시험의 예시 문자열이에요.
  - docs 일치는 기존 보고서에 적힌 경로·식별자예요. 이번 범위에서 새로 생긴 것은 없어요.
  - 실제 키, 토큰, 개인 이메일 값은 출력하지 않았고, 새로 커밋한 것도 없어요.

## 3. 정확 사본 검증(실제 출력)
| 항목 | 결과 |
|---|---|
| `next typegen` + `tsc --noEmit --incremental false` | 오류 0 |
| `eslint . --max-warnings 0` | exit 0 |
| 관련 UI·Auth 시험(public-showcase, t241, t182, t183, t200, t207) | **Test Files 6 passed (6), Tests 221 passed (221)** |
| `npm run build`(Next.js 16.4.6 Turbopack, 저장소 밖) | **exit 0**, 경고 0, "Compiled successfully", verify-build 통과, BUILD_ID `taC2b5lVYVbH1lvVnIhiW` |
| 1차 `npm run build`(저장소 안 tmp) | exit 0. workspace root 추론 경고만 있었어요 |

- 빌드 env는 `DREAM_*`·`SUPABASE*`·`NEXT_PUBLIC_SUPABASE*`·`PG*`·`DATABASE_URL`·`VERCEL*`를 모두 비운 상태였어요. 비밀값은 쓰지 않았어요.
- 공유 `.next`(BUILD_ID 2026-11-17 11:45 그대로)와 3013은 쓰지 않았어요.

## 4. 소유 포트 `next start` 스모크(운영 빌드)
- 아래는 실제 Supabase 계정 로그인 없이 확인했어요. 닿지 않는 가짜 Auth 주소와 가짜 anon 값만 썼어요.

| 상태 | 결과 |
|---|---|
| 운영 유사 익명(`VERCEL=1`, supabase 모드, 가짜 Auth) | `/` 200, set-cookie 0, `private, no-cache, no-store`. 본문에 예시 작품과 `/login?next=%2Fstudio`가 있고 민감 문구(menus.json·docs/spec·DREAM_·서비스 키·경로·허용 이메일)는 0건이에요 |
| 〃 이미지 | 6개 모두 200 image/png, cookie 0. `/_next/image?url=…orchid.png` 200 image/png(`max-age=14400`) |
| 〃 보호 경로 | `/studio` 307 → `/login?next=%2Fstudio`. `/showcase/t240/other.png`·`/cloud/projects`·`/jobs` 307 로그인 이동. `/api/projects`·`/api/jobs` 401. 모두 no-store. `/login` 200 no-store |
| 〃 이미지 최적화 우회 시도 | 비공개 `other.png` 500, `/data/x.png` 500, `/api/projects` 401. 본문은 모두 "url parameter is valid but internal response is invalid" 57바이트예요. 외부 주소는 400 "not allowed". **비공개 내용은 전달되지 않아요** |
| 설정 누락(`VERCEL=1`만) | `/`·이미지·`/_next/image` 200. `/studio`·`/api/projects`·`/showcase/t240/x.png` 503 no-store. 응답에 설정 이름 노출 없음 |

- 서버는 모두 종료했고 포트가 닫힌 것을 확인했어요.

## 5. 원격·배포 상태(읽기만, 확인 시각 2026-11-18T02:56Z)
- **원격 master:** `8ffe3c75b5eaa908ee000f574cf688dd65125378`
  - "P7: 세션 재확인 때 본문 상태 보존·사이드바와 작업 수 차단 (T-224)"
  - 이 커밋은 `e36171c`의 조상이에요. 원격 master에서 후보까지 **fast-forward가 가능**하고, 차이는 326커밋이에요.
- **GitHub 커밋 상태**(`8ffe3c7`): Vercel 2개 프로젝트가 모두 success "Deployment has completed"예요.
  - `dream-ai-studio`: 배포 ID `3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV`, 2026-11-17T15:31:25Z
  - `dream-ai-studio-kzxq`: 배포 ID `FqNrw2VMGFLcBJzm9ETmsXwWfrmM`, 2026-11-17T15:32:23Z
  - 위 두 줄은 GitHub에 남은 과거 상태 기록이에요. 그 프로젝트가 지금 있는지, 운영 중인지 판정하는 근거가 아니에요.
  - GitHub deployments API는 0건이었어요.
- **확인하지 못한 것**
  - 이것이 지금 운영(production) 현재 배포인지, 운영 주소와 도메인, 배포 설정, env는 Vercel 화면이나 CLI 접근이 없어서 확인하지 못했어요. 추정하지 않을게요.
  - 저장소에 `.vercel` 폴더와 vercel CLI가 없어요.
  - 롤백은 Vercel의 이전 배포 되돌리기 기능에 기대지만, 이번에 확인하지 않았어요.
- 이전 후보 `ebe84ea` 준비는 이번 판단에 쓰지 않았어요.

## 6. 남은 실행 gate(실제 전송 전)
1. T240-R2 독립 PASS 고정 보고(Tester 진행 중. 메시지상 실측 PASS 보고 중)
2. Master의 release 수용
3. 전송 직전 `git ls-remote origin refs/heads/master`가 관측값 `8ffe3c75b5eaa908ee000f574cf688dd65125378`(Master 2026-11-18 11:59:10 확인)과 **정확히 같은지** 다시 확인. 다르면 다른 조상이어도 전송하지 않고 멈춰서 Master에게 보고해요(정정: 처음 적은 "또는 후보의 조상" 허용은 뺐어요)
4. push는 자동 거절("Destructive or Unwanted Actions")이 풀리지 않았어요. **주인님이 직접 실행**해야 해요.
   - 예: `! git push origin e36171c6f84bfdb2baebf69ddc4118fe8a3481be:refs/heads/master`(3번 확인 뒤). HEAD나 Backend `9612348`이 들어간 커밋은 올리지 않아요
5. 배포 뒤 운영 주소에서 다시 확인해야 할 것
   - 익명 `/`와 이미지 6개, `/studio`·API 차단, 이미지 캐시
   - **실제 Supabase 계정**으로 로그인한 뒤 `/studio` 도착
   - 가입 메일 링크

## 보호
- 이 보고 1경로만 커밋해요.
- 제품 소스, B46 WIP, T122·T137, tmp는 미변경·미stage예요.
- 새 창·agent·worktree 없음. 운영 프로세스·설정 변경 없음.
