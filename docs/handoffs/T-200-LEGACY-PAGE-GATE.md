# T-200 legacy 화면(RSC) 입구 차단

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: 자체 검수(독립 검수 아님) · **로컬 커밋만, push 안 함**
- 범위 주의: legacy 화면 입구만 닫았어요. 클라우드 읽기 화면(B4-G RSC)은 아직 없어요. 그래서 "메인/클라우드 작업실 개통"이라고 하지 않아요.

## 왜 페이지마다 넣었나
Next는 레이아웃과 페이지를 함께(병렬로) 그려요. 그래서 부모 레이아웃이 CloudPending을 돌려줘도 **페이지 로더는 이미 실행될 수 있어요**. 그래서 각 페이지 입구 첫 줄에 같은 가드를 두고, 레이아웃은 따로 막아요.

## 화면 입구 목록(조사·기록)
| 페이지 | 원래 로더(이 PC 저장소) |
|---|---|
| `(studio)/page.tsx` 홈 | getMenuConfig, checkStartup, listProjects, readRecentOperations |
| `history` | checkStartup, searchParams, readHistory |
| `jobs` | checkStartup, listJobs |
| `library` | readLibrary |
| `menus/[menuId]` | params, getMenuConfig, listProjects |
| `menus/[menuId]/new`(작성) | params, getMenuConfig, projectChoices, snapshotForMenu |
| `projects/[id]`(상세 → brief 이동) | params |
| `projects/[id]/[stage]`(단계) | params, readProject, readPlanning/Production/Editing/Review/Exports |
| `projects/[id]/render` | params, readProject, readEditing, readRenders |
| `projects/new`, `queue` | 이동만(redirect) |
| `settings` | getMenuConfig, checkStartup, readBackups·Configuration, readRestoreInformation, listJobs |
| `setup` | checkStartup |
| `(workspace)/workspaces/[id]` | params, getMenuConfig |
| 레이아웃 `components/studio-layout.tsx`(두 그룹 공용) | getMenuConfig, checkStartup |
- 대상 밖: `/login`, `/account/password`(로더 없음, 인증 전용), `/dev/ui`(예시 화면), `not-found`.

## 바뀐 것
- `lib/auth/legacy-page-gate.tsx`(새, server-only)
  - `legacyPageDecision()`: 인증은 `getRenderAuth`(React cache, 한 번 그리는 동안 1번).
    - 401 → `/login`, 403 → `/login?error=forbidden`, 503 → `/login?error=unavailable`(proxy·기존 로그인 화면 안내와 같은 의미).
    - 그다음 `legacyDataAvailable(env)`(T-198 규칙)가 거짓이면 pending, 아니면 open.
  - `legacyPageGate()`: redirect하거나 `<CloudPending>`을 돌려주고, 열리면 null.
- 14개 페이지: 함수 첫 줄에 `const blocked=await legacyPageGate();if(blocked)return blocked;`. 동기 함수 7개는 async로 바꿨어요. 그 외 내용은 그대로예요.
- `studio-layout.tsx`: getMenuConfig·checkStartup 전에 가드를 둬요. 예전 `VERCEL`이면 CloudPending으로 가던 분기는 가드로 대체했어요.
- `cloud-pending.tsx`(기존 화면 재사용, 문구만 바꿈)
  - "로그인은 정상적으로 됐어요."
  - 제목: "작업실 기능은 아직 클라우드로 옮기지 않았어요". 작품·자료·영상·작업 기록은 아직 내 PC에만 있다고 안내해요.
  - 메인 시안은 적용하지 않았어요.
- 시험 조정
  - `t183`: render 모의에 getRenderAuth를 추가하고 바뀐 문구로 맞췄어요.
  - `t180`: 설정 페이지가 async가 돼서 `await`만 붙였어요. 판정 내용은 그대로예요.
- 바꾸지 않은 것: API 가드, auth resolver/render/server, DB/repo/SQL, package, StudioShell(디자인 셸).

## 확인
| 확인 | 결과 |
|---|---|
| `t200-legacy-page-gate`(새) | **117/117** |
| - 목록 | studio·workspace 페이지 14개 모두 첫 줄이 가드. 레이아웃은 가드가 getMenuConfig·checkStartup보다 앞 |
| - 페이지 단독 실행 × (vercel/postgres/unknown) | 준비 화면(로그인 정상·미이관 문구). getUser 1번. params/searchParams·서비스 로더(11개 모듈 + snapshot)·checkStartup·getMenuConfig·better-sqlite3·redirect **0** |
| - 인증 거절 × 14 × (세션 없음/허용 밖/인증 서버 오류/설정 누락) | `/login`, `?error=forbidden`, `?error=unavailable`로 이동. 이동 전 params·로더·점검·메뉴·SQLite 0 |
| - 레이아웃 단독 | 클라우드는 준비 화면·계정 표시, 자식·점검·메뉴 0. 로그인 꺼진 postgres는 계정 없이 준비 화면, getUser 0 |
| - 대조군(이 PC 기본) | 14개 각각 원래 로더·params·이동 대상(`/menus/shopping-shorts/new`, `/jobs`)으로 진행. 레이아웃도 메뉴·점검 진행 |
| 관련 회귀(t200·t183·t180·t198·api-auth·t191·t182·project-get-routes, 최신 HEAD 2d44be0) | **381/381**, tsc 0 |
| 격리 사본(HEAD + 내 변경만) | `next build` 0, verify-build 0, tsc 0, `eslint .` 0 |
| 격리 전체 시험 | 1164 통과·53 skip·**13 실패(t162·t166 ZIP 내보내기)**. 내 변경을 뺀 같은 HEAD 사본에서도 **같은 13개가 실패**해요. 원래 있던 문제로 따로 보고해요 |

### 실제 HTTP(격리 `next start`, 가짜 인증, 새 포트 43187·43188)
| 설정 | 결과 |
|---|---|
| 클라우드(`VERCEL=1`) 로그인 상태, 14개 경로 | 모두 200 준비 화면 + "로그인은 정상적으로 됐어요". 인증 서버 `/user`는 요청마다 **2번**(proxy 1 + 화면 1). 레이아웃과 페이지가 따로 묻지 않고 cache를 공유해요 |
| 클라우드 비로그인 `/`, `/settings`, `/projects/x/brief` | 307 `/login?next=…`(proxy) |
| 파일 생성 | 빌드 뒤 사본에 새 파일 0, `data`·`tmp/runtime` 폴더 없음 |
| 이 PC 기본 `/`, `/settings`, `/setup`, `/queue` | 준비 화면 0, 기존 시작 점검 화면(사본엔 저장 폴더가 없어 예전과 같음) |
- 서버 종료·포트 비었는지 확인, 사본 삭제, 3013·.next·실제 DSN·Vercel 환경변수는 건드리지 않았어요.

## 남은 것
- 클라우드 읽기 화면 연결(B4-G RSC)은 별도 작업이에요.
- t162·t166 13건 실패는 원래 있던 문제라 담당 확인이 필요해요.
