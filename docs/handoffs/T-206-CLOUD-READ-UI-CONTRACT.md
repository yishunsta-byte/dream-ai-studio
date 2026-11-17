# T-206 클라우드 프로젝트 읽기 화면 연결 명세(구현 전)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **ready_review(명세만, 코드 변경 없음)**
- 기준: `MASTER_DEVELOPMENT_PLAN.md` 4장 **C2 프로젝트 읽기**("비동기 loader/오류·로딩 | 프로젝트 조회 service와 API만 Postgres 연결 | 인증 UUID 전달·owner scope·타인 데이터 차단, 기존 DTO 유지")
- 읽은 근거
  - `B4-G-PROJECT-GET-API.md`, `B4-I-PROJECT-READ-REQUEST.md`
  - `lib/services/postgres/{project-read-request,project-reads,project-read-backend,project-read-errors}.ts`
  - `lib/repo/postgres/projects.ts`
  - T-198 `lib/auth/legacy-gate.ts`, T-200 `lib/auth/legacy-page-gate.tsx`
- 하지 않는 것
  - 새 디자인 확정·적용(3시안 사용자 선택 전): 기존 primitives·login.module.css만 써요.
  - legacy gate 해제, 실제 DB 연결, push/deploy.
  - C3 이후 쓰기·단계·파일·작업 화면.

## 1. 범위(최소)
| 경로 | 내용 |
|---|---|
| `/cloud/projects` | 내 프로젝트 목록(읽기 전용) |
| `/cloud/projects/[id]` | 단건 개요(읽기 전용): 제목·분야·화면비·길이·수정 시각·단계 상태 |
- 버튼·링크는 목록↔상세와 로그아웃만 둬요.
- 기존 legacy 화면(`/projects/[id]/[stage]`, `/render`, `/menus/*/new`, `/settings` 등)으로 가는 링크는 **넣지 않아요**. 클라우드에서는 어차피 T-200 준비 화면이지만, 눌렀을 때 쓰기가 되는 것처럼 보이지 않게 하려는 거예요.

## 2. owner와 인증
- owner는 **서버가 검증한 UUID만** 써요. `getRenderAuth()` → verified.userId → adapter의 `actorFromVerifiedUserId` → Postgres `owner_id=$1`(repo가 `tx.actorId` 사용).
- URL·query·header·쿠키 값으로 owner를 정하는 입력은 만들지 않아요. B4-G HTTP 시험에서 `owner_id`·`x-owner-id`를 넣어도 무시되는 것을 이미 확인했어요.
- 화면에 넘기는 값은 표시할 필드만 골라 만든 새 객체예요. `project` 원본 행·`inputs`·`snapshot` 전체를 client component props로 넘기지 않아요.

## 3. RSC 직접 호출 vs HTTP GET → **RSC 직접 호출(같은 adapter)**
| 기준 | RSC가 adapter 직접 | RSC가 자기 `/api/projects` fetch |
|---|---|---|
| 인증 횟수 | `createProjectReadRequest({ resolveAuth: getRenderAuth })`면 레이아웃·페이지·adapter가 React cache 공유 → 화면당 getUser **1번**(+proxy 1) | 화면 1 + API proxy 1 + API handler 1 → **3번 이상** |
| 쿠키·주소 | 필요 없음 | 절대 주소·쿠키 전달 필요, Vercel 보호 주소에서 자기 호출이 실패할 수 있음 |
| 캐시 | adapter가 no-store 설명만 돌려주고 페이지는 동적 | fetch 캐시 옵션 관리 필요 |
| 계약 | GET과 **같은 adapter·DTO·오류 코드**를 그대로 써요 | 같음 |
- 결론: RSC는 adapter를 직접 써요. GET API는 그대로 두고, 나중에 화면 새로고침(클라이언트)에 써요.
- `resolveAuth` 주입은 adapter가 이미 `overrides`로 허용해요(`project-read-request.ts:37`). Backend 파일은 바꾸지 않아요.

## 4. 판정 순서와 화면 상태
페이지 helper `lib/cloud/project-read-page.ts`(새, server-only)가 정해요.
1. `getRenderAuth()`
   - denied 401 → `/login?next=/cloud/projects…`
   - denied 403 → `/login?error=forbidden`
   - denied 503 → `/login?error=unavailable`
   - 여기까지는 T-200 gate와 같은 의미예요.
2. local(이 PC, 로그인 꺼짐)이면 **"이 PC에서는 기존 작업실을 써요"** 안내와 `/` 링크만 보여 줘요. adapter를 부르지 않아요. adapter는 local을 503으로 막기 때문이에요.
3. verified면 `createProjectReadRequest({ resolveAuth: getRenderAuth })`의 list/get을 불러요. get은 `async () => (await params).id`로 넘겨서 인증 뒤에만 params를 읽어요.

| adapter 결과 | 목록 화면 | 상세 화면 |
|---|---|---|
| 200 목록 비어 있음 | EmptyState "아직 클라우드에 옮긴 프로젝트가 없어요" + 내 PC 작업실 안내 | — |
| 200 | 카드 목록(제목·분야·상태·다음 단계·수정 시각), 상세 링크 | 개요 + 단계 상태 표 |
| 400 INVALID_INPUT | — | `notFound()`(404와 같은 화면, 주소 형식으로 존재 여부를 알 수 없게) |
| 404 NOT_FOUND(없음·남의 것·보관) | — | `notFound()` → `(cloud)/cloud/projects/[id]/not-found.tsx` "프로젝트를 찾을 수 없어요" + 목록 링크. HTTP 404 |
| 503 PROJECT_READ_UNAVAILABLE(설정 없음·DB 오류·손상 snapshot) | Callout "프로젝트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요" + 다시 시도 링크 | 같음 |
| 401/403/503 AUTH_*(1단계 뒤 드묾) | 1단계와 같은 이동 | 같음 |
- 로딩: `app/(cloud)/cloud/projects/loading.tsx`(기존 Card 뼈대).
- "준비 중(DB 미설정)"과 "DB 일시 오류"는 adapter가 둘 다 `PROJECT_READ_UNAVAILABLE`로 돌려줘서 화면에서 구분하지 않아요. 구분이 필요하면 Backend adapter 변경이 필요해요(이번 범위 밖, 질문 항목).
- 503 화면은 RSC라 HTTP 상태가 200이에요. 내용은 no-store 동적이에요. 상태 코드 503이 꼭 필요하면 `error.tsx`/throw 방식을 따로 정해야 해요(질문 항목).

## 5. legacy 차단 유지
- 새 페이지는 **(studio)·(workspace) 밖** 새 그룹 `app/(cloud)/`에 둬요. `StudioLayout`(getMenuConfig·checkStartup)을 거치지 않아요.
- `app/(cloud)/layout.tsx`(새)
  - `getRenderAuth` 기반 계정 표시 + `AccountMenu`만 둬요.
  - getMenuConfig·checkStartup·SQLite·lib/services(legacy)를 import하지 않아요. 메뉴 라벨은 DTO의 `menuLabel`(Postgres snapshot)을 써요.
- T-200 `legacyPageGate`·T-198 `requireApiAuth`는 **그대로** 둬요. legacy 화면·API는 클라우드에서 계속 준비 화면·503이에요.
- 새 페이지는 legacy gate를 부르지 않아요. legacy 데이터를 쓰지 않으니까요. 대신 위 판정 순서를 써요.
- 준비 화면 링크(선택, T-202 수용 뒤): `CloudPending`에 "내 프로젝트 보기(읽기 전용) →" `/cloud/projects` 링크를 둬요. 조건은 `selectProjectReadBackend(env, authMode(env))`가 postgres일 때만이에요(순수 함수, I/O 없음). T-200 파일이 검수 중이라 2단계로 나눠요.

## 6. 수정 예정 파일(구현 배정 시)
| 파일 | 종류 |
|---|---|
| `lib/cloud/project-read-page.ts` | 새. 판정·DTO→표시값 변환(server-only) |
| `app/(cloud)/layout.tsx` | 새. 최소 레이아웃 |
| `app/(cloud)/cloud/projects/page.tsx`, `loading.tsx` | 새 |
| `app/(cloud)/cloud/projects/[id]/page.tsx`, `not-found.tsx` | 새 |
| `components/cloud/project-list-readonly.tsx`, `project-detail-readonly.tsx` | 새. 서버 컴포넌트, 기존 primitives만 |
| `tests/t2xx-cloud-read-ui.test.ts` | 새 |
| `tests/t2xx-cloud-read-ui-http.mjs` | 새. B4-G 방식(portable PG 18.7+TLS+fake Auth, 고정 사본) 재사용. Backend 파일 수정 없이 별도 스크립트 |
| (2단계) `components/auth/cloud-pending.tsx`, `lib/auth/legacy-page-gate.tsx` | 링크 조건 추가. T-202 수용 뒤 |
- 바꾸지 않음: Backend adapter/service/repo/SQL, API 라우트, proxy, auth resolver, StudioShell·디자인, package.

## 7. 시험 matrix
| 구분 | 확인 |
|---|---|
| 단위·정적 | (cloud) 파일들이 `lib/services/*`(legacy)·`lib/menus/server`·`startup`·`better-sqlite3`·`legacy-page-gate`를 import하지 않음(import 그래프) |
| 인증 | denied 401/403/503 × 목록·상세 → 이동 대상 정확, adapter·pool·params 0. local → 안내만, adapter 0 |
| owner | adapter actor = verified UUID. 페이지 props에 owner·원본 행 없음. 서로 다른 계정 A/B 목록 분리 |
| 상태 | 빈 목록, 200 목록·상세, 400·404 → notFound(같은 화면), 503 Callout(DSN·SQL·stack 미노출) |
| 인증 1회 | 레이아웃+페이지+adapter 한 화면에서 getUser 1(+proxy 1). 실제 HTTP `/auth/v1/user` 2 |
| legacy 유지 | T-198 t198·T-200 t200 시험 그대로 통과. 클라우드에서 `/`·`/projects/x/brief` 등은 여전히 준비 화면 |
| 실제 HTTP(격리) | 진짜 PG+TLS+fake Auth: A/B/A 목록·상세·남의 것 404, 익명 307, 만료 뒤 이동, DB 손상 503 후 복구, 새 파일 0 |
| 화면 | ego lite 1280·390: 목록·빈 목록·상세·404·503, 키보드 이동, 가로 넘침 0 |
| 회귀 | 관련 auth·api-auth·project-get-routes·postgres unit, tsc·eslint, 격리 build+verify-build |

## 8. 의존성
- **Backend B5(migration runner)와 managed 준비**: 관리형 Supabase에 스키마 적용(검증된 runner), 제한 LOGIN·RLS·pooler·운영 TLS CA, Vercel `DATABASE_URL`·`DREAM_PROJECT_READ_BACKEND=postgres` 비밀 설정.
  - 이게 끝나기 전에 배포하면 `/cloud/projects`는 503 "불러오지 못했어요" 상태만 보여요. 안전하지만 쓸모는 없어요.
  - 실제 개통은 B5 독립 수용 + Master 결정 뒤예요.
- T-202(T-200 독립 검수) 수용 뒤 5장의 2단계 링크를 진행해요.
- 데이터 이전(로컬 SQLite → Postgres)은 C3/C9 범위예요. 그 전까지 클라우드 목록은 비어 있는 게 정상이에요.

## 9. Master 결정 필요(질문)
1. 경로 `/cloud/projects`로 할까요, 아니면 클라우드에서 `/`(홈)를 이 목록으로 바꿀까요? 추천은 전자예요. legacy gate와 겹치지 않아요.
2. 503 화면의 HTTP 상태: 200 + 안내(추천, 단순) vs error.tsx로 500 계열?
3. "DB 미설정"과 "일시 오류"를 화면에서 구분할 필요가 있나요? 있다면 Backend adapter 변경 배정이 필요해요.

## T-204 일시 실패 근거
- T-204 원본+하루 전 첫 실행의 1실패는 요약 줄(`Tests 1 failed | 13 passed`)만 남겼어요. 정확한 시험명·로그는 저장하지 않았어요.
- 재실행 2회는 모두 14/14였어요. Tester에게 넘길 이름·로그는 없어요.
- 재현 명령: 원본 두 시험을 `SHIFT_MS=-86400000`, `NODE_OPTIONS=--require <shift-clock.cjs>`로 실행하면 돼요. 시계 이동 스크립트는 T-204 보고서 방식 그대로예요(Date 생성자와 Date.now만 오프셋, OS 시계 불변).
