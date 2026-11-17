# T-238 정확한 SHA 배포 준비(ebe84ea)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_7c8c2afab787` · 상태: **준비 완료, push 대기(blocked: 자동 push 권한 거절 조건 유효)**
- 이번 작업은 **준비만** 했어요. push·운영 반영·재배포·환경변수·DB·Storage 변경은 하지 않았어요.

## 1. 후보와 원격
| 항목 | 값 |
|---|---|
| 배포 후보 | **`ebe84eae6611f5e11eedbe6e678c4a05506e0e7a`**(T229+목록 FIX+T235, T236 독립 PASS `2b84ece`) |
| 원격 `origin/master`(ls-remote, 이번 확인) | `8ffe3c75b5eaa908ee000f574cf688dd65125378` |
| fast-forward | `git merge-base --is-ancestor 8ffe3c7 ebe84ea` 성공 → force 필요 없음 |
| 포함 커밋 수 | 129(대부분 docs) |
| 제외 | HEAD의 그 뒤 커밋(T237 하네스 `f38d170`, B26 문서 등)은 이번 후보에 넣지 않아요. 하네스 커밋은 test-only라 별개예요 |

## 2. 제품 변경 범위(8ffe3c7 → ebe84ea)
- **화면**
  - `app/(cloud)/cloud/manage/page.tsx` + CSS: 새 개인 관리 화면(보기 전용)
  - `app/(cloud)/cloud/projects/(list)/page.tsx` + CSS: "개인 관리 보기" 링크
  - `components/auth/session-boundary.tsx`: 같은 계정 복귀 때 포커스 돌려주기
- **백엔드 새 파일(실행 경로 없음)**
  - `lib/db/postgres/{0004_storage_verification.sql, drafts/0004…, migration-manifest-v2, migration-runner-v2, migration-state-v2, upload-reservation-codec}.ts`
  - `lib/storage/uploads/{operation,receipt,schema,state}.ts`
  - `scripts/postgres/migrate-v2.ts`
  - 확인 결과
    - app·components·proxy 어디에서도 import하지 않아요(9개 이름 모두 0건).
    - 새 `process.env` 사용도 0건이에요.
- **변경 없음(diff 0)**
  - 인증: `lib/auth`, `proxy.ts`, `app/api`, `app/login`, `app/auth`
  - 세션 감시·메뉴: `use-session-watch`, `account-menu`
  - 데이터·서비스: `lib/cloud`, `lib/services`
  - 설정·빌드: `package.json`, `package-lock.json`, `next.config.ts`, `instrumentation.ts`, `config`, `render`
- 그래서 **새 환경변수·DB migration·Storage·backend opt-in 변경은 0이에요.**
- `/cloud/manage`는 기존 목록과 같은 `getRenderAuth` → `readCloudProjects` 읽기 경로를 써요.
- 서버 인증 동작은 소스상 이전과 같아요.

## 3. 격리 production build(정확한 SHA)
- 사본: `git archive ebe84ea` → `tmp/t238/app`, node_modules 복사
  - DATABASE_URL·VERCEL·DREAM_*·SUPABASE*·PG* 환경을 지운 채 빌드했어요.
  - 확인 뒤 사본을 지웠어요. 로그는 `tmp/t238-logs/`에 보존했어요(커밋 안 함).

| 확인 | 결과 |
|---|---|
| `npm run build`(`next build && verify-build`) | exit 0. "로컬 데이터·비밀 설정·영상 만들기 도구 추적 없음, 화면 파일에 서비스 키 없음". BUILD_ID `-NocckHgLr20Boki3AC_W`, `/cloud/manage` ƒ |
| `tsc --noEmit` / `eslint . --max-warnings 0` | 0 / 0 |
| 관련 회귀 11 files(t229·t235·t207·t213·t220·t200·t198·t183·api-auth·t182·project-get-routes) | `Tests 449 passed (449)` |
| 사본 전체 vitest | 20 failed. **모두 ffmpeg 없음**(`spawnSync ffmpeg ENOENT`, `.tools` 미포함 사본). 제품 무관 |
| 본 저장소 전체 vitest(제품 코드 = ebe84ea와 diff 0) | `Test Files 96 passed \| 10 skipped (106)`, `Tests 1618 passed \| 319 skipped (1937)` |
| 브라우저 정적 파일 금지어 | DREAM_PG_MIGRATION, DATABASE_URL, sb_secret, service_role, migration-runner, upload-reservation-codec, migrate-v2, postgres://, node_modules/pg, DREAM_PROJECT_READ_BACKEND, storage/uploads **모두 0건** |
| 서버 추적의 `pg` | 목록·상세·**관리** page, `/api/projects`, `/api/projects/[id]`(읽기 opt-in 경로, 기본 꺼짐) |
| 서버 추적의 새 백엔드 | migration-v2·codec·0004·scripts/postgres **0건** |
| `lib/storage/uploads/*.ts` | 서버 추적에 **원본 파일**로 딸려 들어가요(T-226의 `lib/storage/supabase` 사례와 같은 경로 추적). 컴파일된 서버 코드에 이 모듈의 export 56개 중 고유 이름은 0건(일반 단어 counter·id·parse·transition만 일치) |

- 빌드 경고: 사본이 저장소 안에 있어서 "lockfile 여러 개, workspace root 추정" 경고가 나왔어요. T-226과 같은 조건이에요. Vercel 빌드에는 해당하지 않아요.

### 운영 비슷한 설정으로 실행(로그인 전)
- 설정
  - 인증: `VERCEL=1`, `DREAM_AUTH_MODE=supabase`
  - 가짜 값: Auth 주소는 닿지 않는 `127.0.0.1:9`, anon 값, 허용 메일 `a@example.invalid`
  - 끈 것: `DATABASE_URL` 없음, 없는 DATA_ROOT
- 결과
  - `/login` 200
  - `/`, `/cloud/projects`, **`/cloud/manage`**, `/cloud/projects/new`, 상세, `/account/password`, `/jobs` → 307, 예: `/login?next=%2Fcloud%2Fmanage`
  - `/api/projects`, 상세, `/api/jobs`, `/api/backups`, `POST /api/auth/session` → 401
  - 외부 출처 `POST /api/auth/login` → 403
  - 모두 no-store
  - DATA_ROOT 폴더는 만들어지지 않았어요.
- 참고: 허용 메일이 비어 있으면 모든 경로가 503 `AUTH_UNAVAILABLE`로 닫혀요(첫 실행에서 확인). 막힌 상태로 끝나는 방식이에요.
- 로그인 후 동작은 T229·T235 작성자 검증과 T236 독립 검수 근거를 써요.
- 두 서버 모두 종료했고 포트가 닫힌 것을 확인했어요.

## 4. 공개 저장소 노출 검사(배포 범위 diff)
- 비밀 검사 패턴 일치는 4줄이에요.
  - `docs/design/t232-public-showcase/assets/ASSETS.md`: 로컬 사용자 경로 3줄
  - `docs/handoffs/B17-STORAGE-LIMITS-WORKER-READINESS.md`: Supabase 프로젝트 ref 1줄
- **키·토큰(`eyJ…`, `sb_secret_…`)은 0건이에요.**
- 같은 종류는 현재 공개본 `8ffe3c7`에도 이미 있어요. 예: 프로젝트 ref는 TEAM.md·B5·B6·B10·B11, 로컬 경로는 t194 ASSETS.md·B3·B4.
- 그래서 새 종류의 노출은 아니에요. 다만 지울지는 **Master 판단**으로 남겨요. 저는 바꾸지 않았어요.

## 5. push 방법(자동 실행 안 함)
- 이전 T-227에서 제 세션의 push는 Claude Code 자동 권한 판정에 **실행 전 거절**됐어요. 그 조건이 그대로라 이번에는 재시도하지 않았어요. 우회도 하지 않았어요.
- 수동 push 문구(주인님이 프롬프트에서 직접 실행):
  ```
  ! git push origin ebe84eae6611f5e11eedbe6e678c4a05506e0e7a:refs/heads/master
  ```
  - 기대 출력: `8ffe3c7..ebe84ea  ebe84eae… -> master`
  - force가 아니에요.
  - **정정(Master `msg_6ab5ec81657a`):** 일반 fast-forward push는 원격이 8ffe3c7이 아니어도 ebe84ea의 다른 조상이면 성공해요. 그래서 **실행 직전에** `git ls-remote origin refs/heads/master`가 정확히 `8ffe3c75b5eaa908ee000f574cf688dd65125378`인지 대조하고, 다르면 push하지 말고 멈춰서 Master에 알려요.

### push 뒤 확인(별도 배정 시)
1. `git ls-remote origin refs/heads/master` = `ebe84ea…`
2. Vercel `dream-ai-studio` 새 배포: Source `master ebe84ea`, Ready, Production Current
   - 두 번째 프로젝트 `dream-ai-studio-kzxq`는 사용자 직접 승인으로 삭제됐고 Master가 404를 확인했어요(`f8e8fc2` 이후). "같은 push로 재배포될 수 있다"던 T-228 내용은 과거 정보라 폐기해요.
3. 공개 주소(`dream-ai-studio-orpin.vercel.app`), 로그인 없이
   - `/login` 200
   - `/`, `/cloud/projects`, `/cloud/manage` 307 → `/login?next=…`
   - `/api/projects`, `/api/jobs` 401
4. 로그인 후 확인(관리 화면·포커스)은 Tester/Master가 정한 범위로 해요.

## 6. 되돌리기
- 직전 운영 배포는 **`3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV`**(Source `master 8ffe3c7`, T-227/T-228)예요.
- 문제가 생기면 Vercel에서 이 배포를 Promote(Instant Rollback)해요.
  - **정정:** 기존 일반 배포·복구 승인 범위 안의 되돌리기라서 매번 새 사용자 승인이 필요한 것은 아니에요. 새 영향이나 권한이 생기는지만 확인해요.
  - 자동 도구 권한 판정(제 세션의 실행 거절)은 별도 문제예요. 막히면 우회하지 않고 사용자 직접 실행으로 넘겨요.
- git 되돌리기(force push)는 쓰지 않아요.
- "Deployment Retention" 설정 때문에 오래된 배포가 지워질 수 있어요. 되돌리기 전에 그 배포가 남아 있는지 먼저 확인해요.

### 되돌리기 대상 읽기 확인(2026-11-18, 기존 로그인 ego, 읽기 전용)
- 방법: 주인님 브라우저에 이미 로그인된 Vercel 화면을 읽기만 했어요. 설정 변경·Promote·재배포는 하지 않았고, 환경변수 화면은 열지 않았어요.
- 배포 상세 `3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV`
  - Status **Ready, Latest**
  - Environment **Production, Current**
  - Source `master 8ffe3c7`
  - 도메인 `dream-ai-studio-orpin.vercel.app` 외
- 운영 배포 목록: 8ffe3c7(Ready) → 4458283(Ready) → a278e80 → … → ac374c0이 모두 Ready로 남아 있어요.
  - 목록 아래 문구: "Deployment Retention is enabled for this project — some deployments will be deleted after a set time period."
- Settings › Security의 Recently Deleted Deployments
  - "No recently deleted deployments were found."
  - "Most deployments can be restored within 30 days of their initial deletion."
- **미확인으로 남은 것**
  - 보존 기간의 실제 값: 읽은 화면에 숫자가 보이지 않았어요. 다른 설정 화면은 더 열지 않았어요.
  - Promote·Instant Rollback 메뉴가 실제로 활성인지: 메뉴를 열거나 누르지 않았어요.
  - Hobby 요금제의 되돌리기 범위 제한: 공식 문서 기준 확인이 필요해요. 이번에 따로 검증하지 않았어요.
  - 따라서 "지금 3QDy로 실제 되돌리기가 된다"는 직접 확인하지 않았어요. 확인된 것은 **배포가 남아 있고 Ready이며 삭제 기록이 없다**는 것까지예요.
- DB·Storage·env 변경이 없어서 되돌릴 데이터 변경도 없어요.

## 보호
- 3013·공유 .next·실계정·실DB·운영 미접촉이에요.
- 새 창·agent·worktree 없음, 비밀값 출력 없음이에요.
