# T-207 클라우드 읽기 전용 화면(구현)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-206 명세 수용) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음
- 운영 Supabase에는 연결하지 않았어요.
- 이 작업으로 하지 않은 것
  - 사용자 3시안 확정, CloudPending 링크 추가
  - 클라우드 작업실 개통이나 전체 I/O 0을 주장하는 것

## 바뀐 것(새 파일만)
| 파일 | 내용 |
|---|---|
| `lib/cloud/project-read-page.ts` | server-only 판정·표시값 변환 |
| `app/(cloud)/layout.tsx`, `cloud.module.css` | 최소 레이아웃: 제목 + 계정·로그아웃. `force-dynamic` |
| `app/(cloud)/cloud/projects/(list)/page.tsx`, `loading.tsx` | 목록. 로딩 화면은 목록 그룹에만 둬요 |
| `app/(cloud)/cloud/projects/[id]/page.tsx`, `not-found.tsx` | 단건. 로딩 경계 밖이라 404가 실제 상태 코드로 나가요 |
| `components/cloud/project-list-readonly.tsx`, `project-detail-readonly.tsx` | 서버 컴포넌트, 기존 primitives만 |
| `tests/t207-cloud-read-ui.test.ts`, `tests/t207-cloud-read-ui-http.mjs` | 시험·실제 HTTP 검증기 |

`project-read-page.ts`가 하는 일:
- 인증은 `getRenderAuth`로 판정해요.
  - denied 401 → `/login?next=/cloud/projects`, 403 → `?error=forbidden`, 503 → `?error=unavailable`
  - local → "이 PC에서는 기존 작업실을 써요" 안내만(adapter 0)
- verified면 화면 그리기마다 `createProjectReadRequest({ resolveAuth: getRenderAuth })`를 새로 만들어요.
- 단건 id는 인증 뒤에만 읽어요(lazy).
- 400·404는 `notFound()`, `PROJECT_READ_UNAVAILABLE`은 공통 안내, adapter의 AUTH_* 코드는 로그인 이동이에요.
- 화면에는 표시할 값만 새 객체로 넘겨요(id·title·menuLabel·aspect·lengthSec·updatedAt·status·다음 단계 / 단계 이름·상태). 원본 행·owner·inputs는 넘기지 않아요.

화면 구성:
- 목록 카드는 상세 링크만 있어요. 상세 화면은 "← 내 프로젝트" 링크만 있어요. legacy 단계·만들기·영상 링크는 없어요.
- 단계 이름은 Postgres snapshot의 이름을 쓰고, 없으면 고정 이름표를 써요(menus.json과 같은지 시험으로 확인).

바꾸지 않은 것: auth/proxy/API/Backend/package/root layout/legacy gate/CloudPending/StudioShell.

## 루트 레이아웃 정적 읽기(구분)
- 새 그룹도 RootLayout을 상속해요. 그래서 요청마다 `getMenuConfigState()`가 빌드에 포함된 **고정 `docs/spec/menus.json`**을 읽어요. T-202에서 Master가 허용 예외로 정한 범위예요.
- 루트 설정이 손상되면 루트가 "메뉴 설정을 확인해 주세요"를 그려서 클라우드 화면도 열리지 않아요. 이 영향은 그대로 남아요.
- 새 (cloud) 코드 자체가 쓰지 않는 것(시험으로 확인):
  - 사용자 SQLite(`better-sqlite3`), `checkStartup`, legacy 서비스, `getMenuConfig`, 업무 파일
  - 실제 HTTP에서 `DREAM_DATA_ROOT` 폴더가 생기지 않았어요.

## 상태 코드(실제 응답 기록, 운영 build+start)
| 경우 | 실제 응답 |
|---|---|
| 목록·상세 정상 | 200, `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` |
| 남의 것·없는 UUID·형식 오류 | **모두 404**, 같은 "프로젝트를 찾을 수 없어요" 화면, 남의 제목 미노출 |
| 비로그인(proxy) | 307 `/login?next=…`, no-store |
| 화면 단계 거절(proxy 통과 뒤 forbidden·인증 서버 오류) — **단건** | 307 `/login?error=forbidden` / `?error=unavailable` |
| 같은 경우 — **목록** | **200 + 스트리밍 안 redirect**(목록 loading.tsx 때문). 브라우저는 로그인 화면으로 이동하고 데이터·Postgres 쿼리는 0. 307이 필요하면 목록 loading.tsx를 빼야 해요(결정 필요) |
| 데이터 503(snapshot 손상) | 페이지 200 + "프로젝트를 불러오지 못했어요"(Master 결정 2). API GET은 기존 503 그대로예요 |

## 확인
| 확인 | 결과 |
|---|---|
| `t207-cloud-read-ui`(새) | **26/26**: import 그래프(legacy·menus/server·startup·sqlite·gate 없음), loading 위치, 단계 이름=menus.json, 거절 4종×목록·단건(이동 대상, adapter·params·legacy 0), local(adapter·getUser 0), adapter 매번 생성·`resolveAuth===getRenderAuth`, 빈 목록, 표시 필드만·링크 목록, 단건 owner·입력 원문 미노출, 400/404 notFound, 503 안내(내부 정보 없음), adapter AUTH 코드 이동, 레이아웃 |
| 관련 회귀(t207·t200·t198·t183·api-auth·t191·t182·project-get-routes·postgres request/backend) | **443/443**, tsc 0, eslint 0 |
| 격리 사본(HEAD **db77e07** + T-207 파일만) | `next build` 0(`/cloud/projects`, `/cloud/projects/[id]` 동적), verify-build 0, tsc 0, `eslint .` 0, **전체 84 파일·1216 통과·0 실패·65 skip** |

### 실제 HTTP(검증기, 운영 build+start, 진짜 PostgreSQL 18.7 TLS + 실제 SDK + fake Auth)
- 최종 실행 `tmp/t207-http-e618dad1-9e1a-4240-97d5-5891b085fb57/`
  - base `b073269` + T-207 overlay 9개(SHA256은 `source.json`)
  - **12 관찰 PASS**, exit 0
  - 종료 뒤 app·PG·Auth 포트 listener 0, `postmaster.pid` 없음, PG `server stopped`
- 그 전 실행(글머리 수정 전 + 브라우저 확인용 유지 모드) `t207-http-1b040787-…/`도 12 PASS예요. 반복이라 합산하지 않아요.

12 관찰:
1. A→B→A: 목록·상세 200, 자기 제목만. 남의 것·없는 것·형식 오류 404.
2. 요청마다 `/auth/v1/user` 2번(proxy 1 + 화면 1). 레이아웃·페이지·adapter가 cache를 공유해요.
3. 비로그인 307.
4. 화면 단계 forbidden·provider 오류: 단건 307, 목록 200 스트리밍 redirect. 둘 다 거절 전후 `pg_stat_activity` 불변(쿼리 0).
5. snapshot 손상: 목록·상세 공통 안내(내부 정보 없음) → 복구 뒤 200.
6. 클라우드 설정에서 legacy `/`는 여전히 준비 화면.
7. A 토큰 만료 → 307, B는 계속 200.
8. local 대조: 서버를 로그인 꺼진 기본 설정으로 다시 띄우면 `/cloud/projects`·단건은 "이 PC에서는…" 안내, `/`는 기존 화면(준비 화면 아님).
- 모든 응답에서 서버 sentinel·DSN·입력 원문 미노출. 실제 API login 연결은 TLSv1.3 / TLS_AES_256_GCM_SHA384예요.

### 브라우저(ego lite, 유지 모드 서버, 1280·390)
| 확인 | 1280 | 390 |
|---|---|---|
| 목록 가로 넘침 / B 제목 노출 | 0 / 없음 | 0 / 없음 |
| Tab으로 프로젝트 링크(로그아웃 다음) → Enter → 상세 | 2번 → 이동 | 2번 → 이동 |
| 포커스 표시 | solid 1px outline | 같음 |
| 상세 넘침 / Tab 1번 "← 내 프로젝트" Enter → 목록 | 넘침 없음(세로 스크롤바만) / 성공 | 0 / 성공 |
| B 프로젝트 주소 → 찾을 수 없음 화면, 넘침 | 성공, 0 | 성공, 0 |
- 스크린샷: `tmp/t207-shots/{list,detail,notfound}-{1280,390}.png`
- 첫 확인에서 목록 앞에 글머리 점이 보여서 `listStyle:none`으로 고쳤어요. 최종 HTTP는 수정본으로 다시 돌렸어요.
- 빈 목록·503 화면은 브라우저로 따로 보지 않았어요(단위·HTTP로 확인).

## 남은 것·의존성
- 운영 개통 조건(T-206 8장): B5 runner 독립 수용, 관리형 DB 적용·제한 login·RLS·운영 TLS CA, Vercel 비밀 설정, Master 결정.
- 목록의 화면 단계 거절이 200 스트리밍인 점: 그대로 둘지, 목록 loading.tsx를 뺄지 결정이 필요해요.
- CloudPending → `/cloud/projects` 링크는 별도 검수 뒤 배정이에요.
