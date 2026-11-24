# 클라우드 콘텐츠 분석 진입 · 운영 반영 최소 범위

2026-11-20 · Codex(Front) · 읽기 전용 소스 대조. 제품 파일 수정, 실제 데이터, 푸시, 배포는 하지 않았다.

- **운영 기준:** `e4fa378` (Release verified admin console and render queue). 현재 개발 HEAD의 조상이 아니다. 개발 HEAD와 503커밋 떨어져 있다.
- **반영 대상:** 메뉴 `a48bb40`, 미연결 안내 `cdd2932`, 디자인 대조 보정 `421b27f`.
- **대조 방법:** 진입 파일 두 개(`app/(cloud)/layout.tsx`, `app/(cloud)/cloud/reference-analysis/page.tsx`)에서 `import`를 따라갔다. HEAD의 파일 내용을 `e4fa378`의 같은 경로와 바이트 단위로 비교했다.
- **HEAD 전체 반영은 제안하지 않는다.**

## 1. 운영과 개발의 차이

| 항목 | 운영 `e4fa378` | 개발 HEAD |
|---|---|---|
| 클라우드 머리 | 브랜드와 계정 메뉴뿐이다. 길잡이가 없다. | 로그인 계정에만 `클라우드 메뉴`가 있다. 항목은 ‘내 프로젝트’와 ‘콘텐츠 분석’이고, 현재 위치를 `aria-current`로 표시한다. |
| `/cloud/reference-analysis` | **경로가 없다.** 저장소에 `reference-analysis` 파일이 0개라 404가 된다. | 보호된 셸이 있다. 미인증과 비허용은 로그인으로 보내고, 로컬은 안내만 한다. 미연결 안내가 있고 분석 실행은 꺼져 있다. |
| 보호 | `proxy.ts`가 `isPublicPath`로 `/cloud/*`를 보호한다. `lib/auth/config.ts`는 HEAD와 같다. | 같다. `proxy.ts`의 차이 7줄은 공개 커버 이미지(T-254) 경로뿐이고, 이 진입과 무관하다. |

메뉴만 반영하고 분석 페이지를 빼면, ‘콘텐츠 분석’ 링크가 404로 간다. 그래서 둘은 **함께** 반영해야 한다.

## 2. 최소 소스 범위

### 2-1. 실행에 필요한 파일 (화면에 실제로 쓰임)

| 경로 | 운영 상태 | 비고 |
|---|---|---|
| `app/(cloud)/layout.tsx` | 다름(+3줄) | 차이는 `CloudNav` import와 `{account && <CloudNav />}`뿐이다. `SessionBoundary`·`ProtectedContent`·`main` 구조는 같다. |
| `app/(cloud)/cloud.module.css` | 다름(+5줄) | `.nav` 규칙만 더해진다. |
| `app/(cloud)/cloud-nav.tsx` | 없음 | 새 클라이언트 부품이다. `next/link`와 `next/navigation`의 `usePathname`만 쓴다. |
| `app/(cloud)/cloud/reference-analysis/page.tsx` | 없음 | 아래 의존 파일은 모두 운영에 **같은 내용**으로 있다. `CloudReadLocal`, `PageHeader`(운영 primitives에 있음), `loginPath`, `getRenderAuth`, `ServerAuthResult`. |
| `components/reference-analysis/studio-registered-analysis-page.tsx` + `.module.css` | 없음 | 미연결 안내다. props를 받지 않고 요청도 하지 않는다(T317). |
| `components/reference-analysis/studio-registered-analysis.tsx` + `.module.css` | 없음 | 기존 분석 부품이다. provider가 없으면 선택과 실행이 꺼진다. |
| `components/reference-analysis/prompt-comparison.tsx` | 없음 | 위 부품이 import한다. 의존 파일은 같은 CSS 하나다. |

실행 경로에 드는 새 패키지는 없다. 인증·세션 관련 의존 파일은 모두 운영과 같은 내용이다. `account-menu`, `session-boundary`, `use-session-watch`, `lib/auth/{config,render,resolve,session-sync,logout-client}`.

### 2-2. 타입 검사만을 위한 의존 (결정 필요)

`studio-registered-analysis.tsx`는 `import type { analyzeStudioReference } from "@/lib/reference-analysis/studio-analysis-contract"`로 결과 타입을 가져온다. 이 import는 빌드 산출물에서 지워지지만, `tsc`와 `next build`의 타입 검사에는 파일이 있어야 한다. 이 계약 파일을 따라가면 운영에 없는 파일이 9개 더 필요하다.

- `lib/reference-analysis/`: `studio-analysis-contract`, `input`, `local-file`, `project-preview`, `registered-snapshot`, `result`, `image-features`, `audio-features`, `video-features`
- 서버 전용(`server-only`)이고 `zod`·`file-type`을 쓴다. 두 패키지는 운영 `package.json`에 있다.
- 이 계약은 운영에서 **내용이 다른** `lib/auth/server.ts`와 `lib/edit/timeline.ts`도 import한다. 필요한 export가 운영 버전에 있는지 별도로 대조해야 한다.

선택지는 두 가지다. 어느 쪽인지는 Master가 결정한다.

1. **계약 묶음을 함께 반영한다.** 파일 9개와 `lib/auth/server.ts`·`lib/edit/timeline.ts`의 export 대조가 필요하다. 화면은 계약 함수를 부르지 않지만, 분석 서버 코드가 운영 소스에 들어간다. API 경로는 추가되지 않는다.
2. **화면 쪽에 결과 타입을 따로 둔다.** 계약 파일 없이 반영할 수 있지만 제품 코드를 바꾸는 일이라, 별도 배정과 검수가 필요하다.

### 2-3. 반영하지 않는 것

- Backend의 권한 조립과 격리 목록 서버 경계(`f90c374`, `7514ad0`), 분석 API 경로, `lib/reference-analysis/studio-registered-analysis-page.ts` 로더.
- 셸이 목록을 요청하지 않으므로 필요 없다.

### 2-4. 시험

| 파일 | 운영 반영 시 처리 |
|---|---|
| `tests/cloud/cloud-nav.test.ts` | 새 파일. 메뉴, 현재 위치, 레이아웃 경계, 미연결 페이지 제목을 본다. |
| `tests/reference-analysis/studio-registered-analysis-unconnected.test.ts` | 새 파일. 안내 문구와 꺼진 조작을 보고, 자료명·예시 결과가 없는지 확인한다. |
| `tests/t207-cloud-read-ui.test.ts` | 운영 22행의 `next/navigation` 흉내에 `usePathname`을 더해야 한다(a48bb40과 같은 한 줄). 빠뜨리면 레이아웃 렌더 시험이 실패한다. |
| `tests/reference-analysis/studio-registered-analysis-page.test.ts` | HEAD 시험이다. 운영에 없는 로더와 연결 모듈을 import하므로 그대로 가져가면 안 된다. 2-2에서 1안을 택해도 로더는 범위 밖이다. |

## 3. 운영 진입의 상태 (메뉴가 보여도 분석은 실행 불가)

- 로그인한 허용 계정에게만 머리 메뉴가 보인다. 계정이 없으면 렌더하지 않는다.
- `/cloud/reference-analysis`는 다음 순서로 그린다.
  1. H1 ‘콘텐츠 분석’과 소개 한 줄
  2. ‘등록 자료 분석을 준비 중이에요’ 안내. 실행할 수 없고, 자료를 보내거나 결과를 만들지 않는다고 밝힌다.
  3. 분석 종류별 예시 형식: 이미지 PNG는 ‘클라우드 연결 시험에서 확인’, 음악 M4A와 영상·쇼츠 MP4는 ‘목표 범위’
  4. 게시물 주소(YouTube·Instagram·TikTok) 미지원 안내
  5. ‘내 프로젝트로 이동’ 링크
  6. 기존 셸: 등록 자료 선택(꺼짐, 옵션 1개), 분석 실행(꺼짐), ‘등록 자료 분석 공급자가 아직 연결되지 않았어요.’
- 서버 렌더는 목록 조회, 자료 ID·라벨, 결과를 싣지 않는다(T317). 클라이언트도 요청하지 않는다.

## 4. 운영 반영 검수 기준

1. **빌드:** 후보 소스(`e4fa378` + 2-1 + 2-2의 결정안 + 2-4)에서 `npm run build`를 돌린다. `verify-build`(추적 위반 0)와 `tsc`가 통과해야 한다.
2. **보호:**
   - 미인증 `/cloud/reference-analysis`는 `/login?next=%2Fcloud%2Freference-analysis`로 간다.
   - 비허용은 `/login?error=forbidden`, 인증 불가는 `/login?error=unavailable`로 간다.
   - 로그아웃이나 계정 변경 뒤에는 기존 `ProtectedContent` 차단이 그대로 동작해야 한다.
3. **메뉴:**
   - 390px과 1440px에서 첫 화면에 ‘콘텐츠 분석’이 보여야 한다.
   - `/cloud/projects`와 하위 경로, `/cloud/reference-analysis`에서는 해당 항목 하나만 `aria-current="page"`여야 한다. `/cloud/manage`에서는 없어야 한다.
   - 키보드로 Tab과 Enter를 쓰면 두 화면을 오갈 수 있어야 한다. 링크 높이는 44px 이상이다.
4. **미연결:**
   - 본문에서 Tab으로 닿는 곳은 ‘내 프로젝트로 이동’ 하나뿐이다. 꺼진 선택과 실행은 건너뛴다.
   - 꺼진 버튼을 강제로 눌러도 상태 문구가 바뀌지 않아야 한다.
   - 자료명, 예시 결과, 확장자가 붙은 파일명, 입력칸이 0개여야 한다.
   - HTML·RSC 응답에 목록 조회 흔적이 없어야 한다. 합성 표식으로 T317 시험을 재현한다.
5. **넘침:** 두 화면 폭 모두 가로 넘침이 0이어야 한다.
6. **기존 회귀:**
   - 운영의 `/cloud/projects`·`/cloud/manage`·공개 홈·관리자(`e4fa378`) 화면이 그대로여야 한다.
   - t207·t220·t229 레이아웃·세션 시험이 통과해야 한다.

## 5. 2안 적용 결과 (Master 채택, CLOUD-REA-DTO)

**분리 방법**

- `lib/reference-analysis/studio-analysis-result-dto.ts`가 서버 결과 형식을 브라우저 안전하게 옮겨 적은 `StudioAnalysisResult`를 내보낸다. 이 파일은 더 이상 서버 계약을 import하지 않고, `zod`만 쓴다.
- 기존 `satisfies` 검사는 그대로 남겼고, 대상만 `z.ZodType<StudioAnalysisResult>`로 바꿨다. 런타임 스키마와 결과 형식은 바뀌지 않았다.
- `components/reference-analysis/studio-registered-analysis.tsx`는 import 한 줄만 바뀌었다. 계약 대신 DTO 형식을 쓰고, 화면 동작은 그대로다.
- 서버 결과 형식과의 일치는 `tests/reference-analysis/studio-analysis-result-dto-parity.test.ts`가 지킨다.
  - 양방향 대입 가능 검사와 스키마 만족 검사를 한다.
  - DTO, 분석 화면, 보호 셸, 프롬프트 비교 화면이 계약을 import하지 않는지 확인한다.
- 일부러 형식을 틀린 세 경우는 모두 타입 검사에서 걸렸다: bpm 형식 변경, 실패 사유 추가, 음악 초안 필수 칸 추가.
- 서버 결과 형식(`project-preview.ts`의 Candidate)과 HTTP 스키마(`studio-analysis-http.ts`)는 건드리지 않았다.

**운영 기준 최소 조립 (e4fa378 임시 사본)**

넣은 것:

- 2-1의 9개 경로와 결과 DTO 1개, 모두 10개 파일
- 새 시험 2개
- t207 흉내 한 줄

빠진 것: 계약 묶음 9개, 로더, Backend 파일.

| 확인 | 결과 |
|---|---|
| `tsc --noEmit` | 0 |
| 관련 시험 (메뉴·미연결·t207·t220·t229) | 5파일 74건 통과 |
| 사본 전체 vitest | 실패 20건. 모두 사본에 `ffmpeg`와 `tmp` 폴더가 없어서 생긴 환경 실패다. 영상 렌더·음향·저장소 시험이고, 이번 변경과 무관하다. |
| `npm run build` + `verify-build` | 통과. 추적 위반이 없고, `/cloud/reference-analysis`는 동적 경로다. |

**사본에서 실제 로그아웃 버튼 확인 (Chromium 390·1440)**

조건:

- 화면 렌더 인증은 합성 계정으로 바꿨다.
- 세션 확인과 로그아웃 API는 합성 응답으로 바꿨다(사본 전용).
- 합성 로그아웃 경로는 `POST(_request)` 형태여야 기존 시험의 타입 검사를 통과한다.

결과:

- **메뉴:** ‘내 프로젝트(현재)’와 ‘콘텐츠 분석’이 보이고, 링크 높이는 44px이다. Enter로 분석 화면에 가면 ‘콘텐츠 분석’이 현재 위치가 된다.
- **분석 화면:** 제목 순서는 안내 → 등록 자료 분석이다. 조작 요소는 링크 1개, 꺼진 선택, 꺼진 실행뿐이다. 본문에서 Tab은 링크에만 닿는다. 가로 넘침은 0이다.
- **로그아웃 실패(503):** 화면에 머물고 “로그아웃하지 못했어요. 다시 시도해 주세요.”를 보여 준다. 요청은 1회였다.
- **로그아웃 성공:** 분석 화면을 떠나 `/login`으로 간다. 요청은 1회였다. 합성 로그인이 계속 로그인 상태라서 `/login`이 다시 `/studio`로 넘겼는데, 이것은 사본의 특성이다.

**운영 반영 최소 범위 (확정 후보)**

- 2-1의 9개 경로
- `lib/reference-analysis/studio-analysis-result-dto.ts`
- 시험: `tests/cloud/cloud-nav.test.ts`, `tests/reference-analysis/studio-registered-analysis-unconnected.test.ts`, 그리고 t207 흉내에 `usePathname` 한 줄
- 일치 시험(`…-dto-parity.test.ts`)은 서버 계약이 필요해서 운영 후보에는 넣지 않는다. 개발 HEAD에서만 돈다.

## 6. 최종 배포 후보 고정 (CLOUD-REA-CANDIDATE)

합성 인증이나 합성 API 소스는 후보에 넣지 않았다. 검수가 같은 사본을 쓸 수 있도록 보존한다.

### 고정 정보

| 항목 | 값 |
|---|---|
| 기준 | `e4fa378`, tree `git rev-parse e4fa378^{tree}` |
| 후보 tree | `1341083f72b571b54c3d4ccd5c032d6b1c544878` |
| 바뀐 파일 | 13개: 제품 10개, 시험 3개. 710줄 추가, 1줄 삭제 |
| 고정 patch | `git diff --binary e4fa378 1341083f…`, sha256 `5848448c01f00c34a4f9b080b424ab6ecb73311048d038f6f5a08f0c0e90318f` |
| 출처 | 제품 10개와 새 시험 2개의 blob은 `9c7f093`과 같다. t207은 `e4fa378` 원본에 `usePathname` 한 줄을 더했다. |
| lockfile | `package-lock.json` blob `b5255703dd7543245082ddd3f18862cddac381db`. 기준과 HEAD가 같다. |
| 빌드 | BUILD_ID `6ySrF3m613BG2kQI4gSfV` |

- 후보 tree는 별도 임시 인덱스(`GIT_INDEX_FILE`)로 만들었다. 공용 인덱스와 브랜치는 건드리지 않았고, 저장소에 blob만 기록했다.
- 경로별 blob은 보존 폴더의 `evidence/blobs.txt`에 있다.

### 보존 위치

- 사본: `D:/starwork/rea-cloud-candidate/cand`. 소스, `node_modules`, `.tools/ffmpeg`(파일 사본, 연결 아님), 빌드 산출물 `.next`가 들어 있다.
- 증거: `D:/starwork/rea-cloud-candidate/evidence`. patch, 대조 목록, 각 실행 로그가 있다.
- 합성 시험 도구: `D:/starwork/rea-cloud-candidate/harness`. 외부 합성 인증 서버와 브라우저 스크립트가 있다.

### 사본 대조

- 대상은 1,241개 파일이다. 내용은 모두 후보 tree와 같다.
- 128개는 `git archive`를 풀 때 생긴 CRLF 차이뿐이다. 줄바꿈을 지우면 blob이 같다.

### 검증 결과

| 확인 | 결과 |
|---|---|
| 타입 검사(tsc) | 0 |
| eslint (클라우드·분석 경로와 시험) | 0 |
| 집중 회귀 | 7파일 178건 통과: 메뉴, 미연결, t207, t220, t229, t213, t198 |
| 전체 vitest | 115파일 통과, 10파일 건너뜀. 2,216건 통과, 실패 0 |
| `npm run build` + `verify-build` | 통과. 추적 위반 없음 |
| 산출물의 서버 분석 코드 흔적 | `resolveRegisteredSource` 등을 찾았고, 클라이언트·서버 묶음 모두 0개 파일 |

**지난 환경 실패 20건 재확인**

- 원인은 사본에 FFmpeg와 `tmp` 폴더가 없었던 것이다. 개발 저장소의 `.tools/ffmpeg`를 파일로 복사하고 `tmp` 폴더를 만든 뒤 다시 돌렸다.
- 후보 전체 실행에서 20건 모두 통과했다.
- 같은 조건의 순수 `e4fa378`에서 해당 9파일을 함께 돌리면 `storage-private-read`가 1건 시간 초과됐다. 이 파일만 따로 두 번 돌리면 46건 모두 통과했다.
- 후보 쪽 남은 불확실성은 동시 부하에서 나는 시간 초과 가능성뿐이다. 이번 후보 전체 실행에서는 생기지 않았다.

### 익명 보호

제품 소스는 그대로 두고 실행 설정만 바꿔서 확인했다.

| 설정 | 결과 |
|---|---|
| 기본 실행(설정 없음, 이 PC 모드) | 설계대로 `/cloud/*`가 로컬 안내를 보여 준다. 분석 화면과 메뉴는 나오지 않는다. |
| `DREAM_AUTH_MODE=supabase`, Supabase 설정 없음 | `/cloud/reference-analysis`, 질의 붙은 주소, 프로젝트, 관리, RSC 프리페치, 가짜 쿠키가 모두 503 `no-store`이다. 화면 문구는 0이다. |
| 로그인 모드, 연결 불가 합성 인증 주소 | 위 경로가 모두 307로 `/login?next=…`에 간다(질의 포함). 가짜 쿠키도 같고, 화면 문구는 0이다. |

### 실제 버튼 확인 (Chromium 390·1440)

조건:

- 제품의 로그인·세션·로그아웃 코드는 원본 그대로다.
- 인증 서버만 외부 합성 서버(`harness/fake-auth.mjs`, 127.0.0.1)로 바꿨다. 계정과 비밀번호는 합성이다.
- 로그인은 제품 로그인 화면에 입력해서 했다. 쿠키는 제품이 직접 설정했다.

결과:

- **로그인:** `next`로 받은 `/cloud/reference-analysis`에 도착했다. 메뉴에서 ‘콘텐츠 분석’이 현재 위치이고, 안내 제목이 보이며, 계정 버튼은 ‘로그아웃 (합성 계정)’이다. 가로 넘침은 0이다.
- **인증 서버 로그아웃 실패(503):** 제품이 이 브라우저 로그인만 지우고 `/login?notice=logout-partial`로 갔다. 안내는 “이 브라우저의 로그인은 지웠어요. 다른 기기의 로그인까지 끝났는지는 확인하지 못했어요.”였다.
- **정상 로그아웃:** `/login`으로 갔다. 인증 서버의 로그아웃 요청은 1회였다.
- **로그아웃 뒤:** `/cloud/reference-analysis`에 다시 들어가면 `/login?next=%2Fcloud%2Freference-analysis`로 간다.

## 7. 남은 확인

- 실제 운영 로그인 계정으로 보는 화면 검수와 실제 Supabase 로그아웃 확인. 배포와 운영 DB는 별도 승인 사항이다.
- 운영 후보 소스의 독립 검수(Tester)
