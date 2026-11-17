# T-198 미전환 legacy API 차단(gate)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 근거: `B4-I-PROJECT-READ-REQUEST.md` "다음 공개 GET/legacy 차단 범위안" 2항
- 상태: 자체 검수(독립 검수 아님) · **로컬 커밋만, push 안 함**
- 범위 주의: **API gate만** 끝났어요. RSC·page loader(화면 서버 렌더) 차단은 별도 작업이라, 이것으로 "클라우드 전체 안전"이라고 하지 않아요. CloudPending 화면은 DB 차단을 대신하지 않아요.

## 바뀐 것
- `lib/auth/legacy-gate.ts`(새, 순수 함수): `legacyDataAvailable(env)`
  - `VERCEL`이 있으면 false.
  - `DREAM_PROJECT_READ_BACKEND`가 없거나 `"sqlite"`일 때만 true. `"postgres"`·알 수 없는 값(대소문자 다름·빈 값 포함)은 false.
  - Backend `selectProjectReadBackend`의 sqlite 허용 경계와 같아요(시험이 원문 패턴을 확인해요).
- `lib/auth/api.ts`: `requireApiAuth({ scope })`, Response|null 호환.
  - 기본 scope **`legacy-data`**: 인증 판별 1회(401/403/503) → 통과하면 legacy 차단(503 `LEGACY_DATA_UNAVAILABLE`, `{error,code}`, no-store, 리다이렉트 없음).
  - **`auth-only`**: 인증만 해요(클라우드에서도 열려요).
  - 인증 거절이 항상 먼저예요(Vercel에서도 비로그인은 401).
- `app/api/auth/logout/route.ts`: `requireApiAuth({ scope: "auth-only" })`. T186 Origin 검사·로그아웃 실패 정직 처리(PARTIAL/FAILED)는 그대로예요.
- 기존 업무 라우트 파일, resolve/render/server, RSC, DB/SQL, 패키지, `api-auth.test.ts`는 바꾸지 않았어요(인자 없는 `requireApiAuth()` = legacy-data 기본).
- 새 Postgres 읽기 GET(Backend B4-G WIP: `projects` GET, `projects/[id]` GET)은 이 가드를 부르지 않아요. 시험에서 "새 조회 GET"으로 빼고, 같은 파일의 POST 등은 legacy로 검사해요.

## 확인
| 확인 | 결과 |
|---|---|
| `t198-legacy-gate`(새) | **73/73** |
| - 순수 규칙 | 기본·sqlite만 열림, Vercel·Vercel+sqlite·postgres·`SQLite`·빈 값·mysql 닫힘, Backend 경계와 일치 |
| - scope | 비로그인 Vercel 401 우선, 허용 계정 Vercel 503(no-store·리다이렉트 없음·키 error/code·getUser 1회), postgres/unknown 503, auth-only 통과, 이 PC 로그인 꺼짐은 getUser 없이 통과 |
| - 기존 업무 라우트 전체 × 모든 메서드 × (vercel/postgres/unknown) | 503 LEGACY, getUser 1회, 본문(json/text/formData/arrayBuffer/blob)·params **미접근**, `better-sqlite3` 생성 **0**, 시작 점검(파일 쓰기) **0** |
| - 대조군 | 로그아웃 클라우드 200(signOut 1·getUser 1), 외부 출처 403, 비로그인 401, Supabase 오류 502 PARTIAL. 이 PC 기본에서 jobs GET은 서비스(시작 점검)까지 진행 |
| 관련 회귀(api-auth[Backend WIP 포함]·project-get-routes·t182·t191·t183·t197·maintenance) | 통과 |
| 전체 시험(작업 폴더, Backend WIP 포함) | **1060 통과·53 skip** |
| 격리 사본(커밋 HEAD + 내 파일만, Backend WIP 제외) | `next build` 0, verify-build 0, 관련 236 통과, `tsc` 0, `eslint .` 0 |

### 실제 HTTP(격리 사본 `next start`, 가짜 인증, 새 포트 43187·43188)
| 설정 | 결과 |
|---|---|
| 클라우드(`VERCEL=1`) 로그인 상태 | jobs GET/POST, projects POST, backups GET/POST, assets/upload POST, renders/x/file GET, restore/inspect POST → **503 LEGACY_DATA_UNAVAILABLE**, 인증 서버 `/user` 2번(proxy 1 + 핸들러 1). 없는 메서드는 405. 데이터 폴더 생성 없음 |
| 클라우드 비로그인 | 401 AUTH_REQUIRED |
| 클라우드 로그아웃 | 200 → 이후 API 401. 외부 출처 비로그인 로그아웃 401(인증 먼저) |
| 이 PC 기본 | jobs·backups → 기존 서비스 응답(사본에 저장 폴더가 없어 "시작 점검" 503, LEGACY 코드 아님). 로그아웃 200 |
- 서버 종료·포트 비었는지 확인, 사본 삭제, 3013 그대로예요. 실제 DSN·관리 DB·Vercel 환경변수는 건드리지 않았어요.

## 남은 것
- RSC·page loader의 legacy(SQLite) 차단은 별도 작업이에요. 예: 클라우드에서 화면이 SQLite를 읽지 않게.
- 운영 반영은 Master·Tester 확인 뒤예요.
