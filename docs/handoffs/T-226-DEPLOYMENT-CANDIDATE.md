# T-226 배포 후보 준비 (실행 안 함)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **후보 준비 완료, 배포 보류(T-225 재검수 결과 대기)**
- **이번에 하지 않은 것**: push, 배포, Vercel 환경 변경, 원격 설정 변경. 실제 DB 이관과 새 Storage·API 쓰기 활성화도 하지 않았어요.
- 마지막 확인 시각: **2026-11-17T12:39:49Z (21:39:49 +0900)**

## 후보와 현재 운영
| 항목 | 값 |
|---|---|
| 배포 후보(정확한 SHA) | **`8ffe3c75b5eaa908ee000f574cf688dd65125378`** (T-224 제품 고정본) |
| 현재 운영 소스 | `44582839c1339b5a39620b0d0249681cde372450` (T-188) |
| 현재 운영 배포 | Vercel `E5kSuVaEr6Jkw9rLwoopFVA9aHh5`, Production, Current (T-189 기록) |
| 운영 주소 | `https://dream-ai-studio-orpin.vercel.app` |
| 원격 `origin/master`(읽기 확인) | `44582839…` = 운영과 같아요 |
| 관계 | 8ffe3c7은 4458283의 후손이에요(fast-forward 가능). 원격 master는 8ffe3c7의 조상이에요 |
| 커밋 수 / 변경 | 121 커밋, 281 파일(+12530/−112). docs/design 118, docs/handoffs 57, tests/postgres 14, 나머지는 앱 코드 |
| 배포 방식 | GitHub `master` push → Vercel Git 연동 자동 배포. 이 PC에는 Vercel CLI가 없어요(`which vercel` 없음, `.vercel` 연결 폴더 없음). 새로 설치하지 않았어요 |

- **주의**: 공유 저장소 HEAD는 이미 8ffe3c7보다 앞서 있어요(`79787f9`, B15-R 코드 `075eec8`와 문서 커밋 포함). **HEAD를 push하면 검증하지 않은 커밋이 같이 나가요.** 반드시 아래처럼 정확한 SHA를 지정해야 해요(T-189 재발 방지).

## 운영 대비 바뀌는 것
- package.json·lock·next.config·proxy·instrumentation: **변경 없음**
- 새 화면: `/cloud/projects`(목록), `/cloud/projects/[id]`(상세), `/cloud/projects/new`(준비 안내), `(cloud)/layout`
- 새 API: `POST /api/auth/session`(계정 일치 확인 전용, 업무 DB 미사용), `GET /api/projects/[id]`
- 바뀐 API: `GET /api/projects`, `/api/auth/logout`
- 바뀐 화면: 작업실 13개 page(legacy gate 연결), `account/password`
- 인증·화면 공통
  - `lib/auth/{render,resolve,legacy-gate,legacy-page-gate,session-sync}`
  - 탭 간 세션 확인(T-213), 보호 본문·사이드바 경계(T-220·T-224)
- Backend 추가 코드(웹에서 실행 안 됨, 아래 산출물 확인)
  - `lib/db/postgres/migration-*`, `provision-template`
  - `lib/repo|services/postgres/project-create*`, `asset-availability`
  - `lib/storage/supabase/*`
  - `scripts/postgres/*`

## 환경 키(이름만, 값 조회·출력 없음)
- 운영 대비 새로 참조하는 이름은 두 갈래예요.
  - `DREAM_PROJECT_READ_BACKEND`: 클라우드 읽기 opt-in이에요. **운영에는 넣지 않아요(그대로 둠).**
    - 없거나 `sqlite`이고 `VERCEL`이 있으면 `PROJECT_READ_UNAVAILABLE`로 닫혀요.
    - `postgres`일 때만 `DATABASE_URL`을 검증·사용해요.
  - `DREAM_PG_MIGRATION_*`(URL·CA·PROFILE·PROJECT_REF·SESSION_*·TARGET_HASH): `scripts/postgres/migrate.ts`만 써요. **Vercel에 넣지 않아요.**
- 기존 이름은 그대로 유지해요. `DREAM_AUTH_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DREAM_ALLOWED_EMAILS`, `DREAM_SITE_URL`(+`VERCEL_URL`·`VERCEL_PROJECT_PRODUCTION_URL` 자동)
- **결론: 이번 배포에 Vercel 환경 변경이 필요 없어요.**

## 예상 배포 동작
- 로그인 전: 기존과 같아요. 보호 화면은 307로 로그인 이동, API는 401, 외부 출처 로그인은 403이에요. 모두 no-store예요.
- 로그인 후 기존 작업실 주소(`/`, `/jobs` 등): 기존처럼 클라우드 **"준비 중"(CloudPending)** 화면이에요. 이 PC 저장소·SQLite를 열지 않아요(legacy gate).
- 로그인 후 `/cloud/projects`·상세: **"지금은 불러올 수 없어요"(unavailable) 안내**예요.
  - 읽기 backend가 꺼져 있어서 실제 DB에 연결하지 않아요.
  - `/cloud/projects/new`는 준비 안내만 보여요(폼·쓰기 없음).
  - 준비 화면에서 `/cloud/projects`로 가는 링크는 아직 없어요(별도 배정 전).
- 다른 탭 로그인·로그아웃: 계정 표시·본문·사이드바를 가리고 서버에 다시 확인해요(T-213/T-220/T-224, T-225 재검수 중).

## 격리 검증(정확한 SHA, 공유 .next·3013 미사용)
- 사본: `git archive 8ffe3c7` → `tmp/t226/app`, node_modules는 실제 복사했어요.
  - DREAM_·SUPABASE·DATABASE_URL·PG·VERCEL 환경을 지운 상태로 build했어요.
  - 확인 뒤 사본을 지웠어요.

| 확인 | 결과 |
|---|---|
| `next build` | exit 0 |
| `scripts/verify-build.mjs` | exit 0 ("로컬 데이터·비밀 설정·영상 만들기 도구 추적 없음, 화면 파일에 서비스 키 없음") |
| `tsc --noEmit`, `eslint . --max-warnings 0` | exit 0, 0 |
| 관련 시험 9 files(t207·t213·t220·t200·t198·t183·api-auth·t182·project-get-routes) | `Tests 434 passed (434)` |
| 브라우저 정적 파일(`.next/static`) 검색 | `DREAM_PG_MIGRATION`, `DATABASE_URL`, `sb_secret`, `service_role`, `migration-runner`, `provision-template`, `postgres://`, `node_modules/pg`, `DREAM_PROJECT_READ_BACKEND` **모두 0건** |
| 서버 함수의 `pg` 패키지 추적 | 클라우드 목록·상세 page, `/api/projects`, `/api/projects/[id]`만이에요(읽기 opt-in 경로, 기본 꺼짐) |
| 새 Backend 코드 | migration·provision·project-create·scripts/postgres는 서버 추적에 0건이에요 |
| `lib/storage/supabase/*.ts` | 여러 서버 함수 추적에 **원본 파일**로 딸려 들어가요(로컬 `storage` 폴더 경로 추적에 같이 잡힌 것으로 보여요). 다만 컴파일된 서버 코드에서 그 함수 이름(`createPrivateObjectReader` 등 5개)은 **0건**이라 실행되지 않아요. 비밀값 없는 공개 저장소 코드예요. P3 관찰로 남겨요 |

- 운영 비슷한 설정으로 실행
  - 설정: `VERCEL=1`, `DREAM_AUTH_MODE=supabase`, 닿지 않는 가짜 Auth 주소, `DATABASE_URL` 없음, 없는 DATA_ROOT
  - 로그인 전 결과
    - `/login` 200
    - `/`, `/cloud/projects`, `/cloud/projects/new`, 상세, `/account/password`, `/jobs` → 307 `/login?next=…`
    - `/api/projects`, 상세, `/api/jobs`, `/api/backups`, `POST /api/auth/session` → 401 AUTH_REQUIRED
    - 외부 출처 login → 403
    - 모두 no-store
  - DATA_ROOT 폴더는 **만들어지지 않았어요**(로컬 저장소 접근 없음).
  - 로그인 후 동작은 실행해 보지 않았어요. 근거는 t207·t200 시험(`VERCEL=1` 경로)과 T-224 실제 검증기 결과예요.

## 최종 실행 명령(검토용, Master 승인·T-225 PASS 뒤에만)
```bash
# 1) 사전 확인: 셋이 기대값이 아니면 멈춘다
git fetch origin
git rev-parse --verify 8ffe3c75b5eaa908ee000f574cf688dd65125378^{commit}
git ls-remote origin refs/heads/master        # 기대: 44582839c1339b5a39620b0d0249681cde372450
git merge-base --is-ancestor 44582839c1339b5a39620b0d0249681cde372450 8ffe3c75b5eaa908ee000f574cf688dd65125378 && echo ff-ok
# 2) 정확한 SHA만 push(HEAD 금지, force 금지)
git push origin 8ffe3c75b5eaa908ee000f574cf688dd65125378:refs/heads/master
# 3) 확인
git ls-remote origin refs/heads/master        # 기대: 8ffe3c75…
```
- Vercel 대시보드에서 새 Production 배포가 소스 `8ffe3c7`, Ready, Current인지 확인해요(읽기만).
- 운영 주소에 읽기 전용 HTTPS 확인을 해요. 위 "로그인 전" 표와 같아야 하고, 계정·메일·비밀번호·DB 변경은 없어요.

## 되돌리기 절차
- Vercel 대시보드 → 프로젝트 → Deployments → `E5kSuVaEr6Jkw9rLwoopFVA9aHh5`(소스 4458283) → **Instant Rollback / Promote to Production**
  - 코드 push 없이 이전 배포로 즉시 되돌려요.
- Git 이력은 force push·revert하지 않아요. 다음 수정은 새 커밋으로 해요.
- 되돌린 뒤에도 운영 주소에서 로그인 전 표를 다시 확인해요.

## 보류 조건
- T-225(원 Tester) 재검수가 FAIL이면 이 후보를 보류하고 수정이 먼저예요.
- 배포 시점에 원격 master가 4458283이 아니면 멈추고 보고해요.

## 보호
- 3013, 공유 .next, 실제 DB·Auth, managed, Vercel env, B15 WIP는 건드리지 않았어요. 비밀값은 조회·출력하지 않았어요.
