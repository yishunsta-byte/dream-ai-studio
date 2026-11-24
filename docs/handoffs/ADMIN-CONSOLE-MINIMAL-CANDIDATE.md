# 관리자 최소 반영 후보 빌드와 점검

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_691501d5cadb`

**판정은 최소 반영 후보의 로컬 프로덕션 빌드와 미연결 확인 통과다.** 운영 기준 `3c57eff6724886d104faab1937059579647e5ffb`의 임시 사본에 `ff4f9af36c733459e8417f6fcd72d25d696be046`의 제품 11개 경로와 검사 4개를 적용했다. 적용 후 기준 파일 1,225개와 신규 경로를 대조해 예상 밖 소스 차이가 0개였다. 이 후보의 운영 배포와 실제 공급원 연결은 대기 중이다. [반영 범위와 운영 연결 조건](ADMIN-CONSOLE-RELEASE-SCOPE.md)

사용자가 **02 작업 콘솔**을 선택했다. 디자인 담당 확인 `msg_f08310c7a779`와 Master 확인 `msg_fe9f638136e5`를 근거로 이 후보를 유지한다. 02 구현 `0e373e7`과 독립 검수 `e388493`에는 상단 메뉴, 소유자별 프로젝트 조회, 조회 실패 후 재조회, 상세 제목 초점, 기존 게시·계정 진입이 포함된다. 렌더 대기열 `ff4f9af`의 독립 화면 검수는 `32701ec`에서 통과했다. 운영 기준 위에 조립한 동일 후보는 별도 화면 독립 검수가 진행 중이다. [관리자 시안 인계](../design/admin-topnav-options/HANDOFF.md)

## 후보 식별

- 임시 후보 `D:\starwork\dream-admin-candidate-19CgOI\app`, 실행 근거 `D:\starwork\dream-admin-candidate-19CgOI\evidence`
- 운영 기준 `package-lock.json` Git blob `b5255703dd7543245082ddd3f18862cddac381db`, SHA-256 `ef27bdaf7b254d4782fdded9f860eeb51ba60f81c057e8280d37f08657c4fa3b`
- Node 26.13.0, npm 11.20.0. 설치본을 임시 사본 안에 복사하고 잠금 파일과 패키지 버전 427개를 대조했다. 불일치 0개이며 미설치 항목 136개는 모두 lockfile의 선택형 의존성이다.
- 기존 Git 인덱스와 브랜치는 읽기만 사용했다. 실행에는 가상 Auth 설정을 사용했고, 실행이 끝난 뒤 두 Next 서버와 Auth 모의 서버를 종료했다.

### 제품 소스

| 경로 | Git blob |
| --- | --- |
| `components/admin/admin-hub.tsx` | `60a7e429a3aedea469e6e8d910ac7ff5ee7c9a05` |
| `components/admin/admin-navigation.tsx` | `5ed64eabe5a10d9692c0fbf619301d0ba7aa4f35` |
| `components/admin/admin-project-console.tsx` | `ca6d8eac91f1708ba1a953cb35712c1021bbb1b3` |
| `components/admin/admin-projects.tsx` | `70656beb3318a2b72a1318ade75c37bbf7efc29b` |
| `components/admin/admin-render-queue.tsx` | `80367bbbf08a0db6e042dea19dba9312545da7e6` |
| `components/admin/admin.module.css` | `00ec27feaaa94b0f80f9d9320f5f855228204a98` |
| `components/cloud/admin-project-heading-focus.tsx` | `3ded7ce2e65460e66429ed669937d400e4cc940e` |
| `components/cloud/project-detail-readonly.tsx` | `efb8de9963282ccf64eb08f77f8052e91fdf5b69` |
| `app/api/admin/render-queue/route.ts` | `64cec4a79bc5a1a786c8295ce741688bf2628d85` |
| `lib/services/postgres/admin-render-queue-http.ts` | `8b1af510149f7da3773455a96b0c0e17e5457d6f` |
| `lib/services/postgres/admin-render-queue.ts` | `6118e0e5c7db784f3d1849f02d35155d81074042` |

### 검사 소스

| 경로 | Git blob |
| --- | --- |
| `tests/admin/admin-hub-information-architecture.test.ts` | `3f87ac45af35b47dac60069054da78edcfb66783` |
| `tests/t283-admin-overview-projects.test.ts` | `7636839d15726a3f90e36278296a5f61ca75a1a8` |
| `tests/api-auth.test.ts` | `343770a521f3cc514521d206e0af4b5a1f044634` |
| `tests/t198-legacy-gate.test.ts` | `92a7eebfd11705362c1bad44c83ecb1499e07c04` |

두 화면 검사는 고정 개발본에서 가져왔다. 보호 라우트와 레거시 예외 검사는 운영 기준 파일에서 `admin/render-queue` 한 경로와 GET 한 메서드만 추가했다. 빌드는 별도의 제품 수정 없이 완료됐다.

## 실행 결과

| 검증 | 상태와 증거 |
| --- | --- |
| 타입 | 통과. `npm run typecheck`로 Next 라우트 타입을 생성하고 `tsc --noEmit`을 완료했다. `typecheck.log` |
| 관리자·인증 회귀 | 통과. `tests/admin`, `t283-admin-overview-projects`, `t243-admin-login`, `t245-admin-reset-return`, `api-auth`, `t198-legacy-gate`에서 파일 12개, 테스트 334개를 통과했다. `regression.log` |
| 프로덕션 빌드 | 통과. `npm run build`에서 Next 16.4.6 Turbopack 컴파일과 `scripts/verify-build.mjs`가 완료됐다. 신규 동적 GET이 빌드 경로 목록에 포함됐다. 로컬 데이터, 비밀 설정·키, 렌더 실행 도구 추적 검사를 통과했다. `production-build.log` |
| 프로덕션 HTTP | 통과. 동일 빌드의 로컬 production과 로컬 `VERCEL=1` 시험 모두 GET 익명 401 `AUTH_REQUIRED`, 비허용 403 `AUTH_FORBIDDEN`, 허용 503 `ADMIN_RENDER_QUEUE_UNAVAILABLE` 및 POST 405를 확인했다. GET 오류에 작업 목록이 없었고 `no-store`가 적용됐다. `production-http.log` |
| 기존 흐름 | 통과. 익명·비허용 `/admin`은 관리자 로그인으로 307, `/admin/login`과 공개 홈은 200. 허용 계정의 관리자 화면 200, 콘솔의 프로젝트 미연결 안내, 대기열·검수·계정 영역, 게시 GET 200 `{ kind: "closed" }`를 확인했다. `production-http.log` |

첫 빌드의 `next/package.json` 탐색 실패는 임시 사본의 `node_modules` 정션이 Turbopack 빌드 경계 밖을 가리킨 상태에서 발생했다. 후보와 운영 기준의 lockfile 및 패키지 버전을 확인한 뒤, 사본 안에 동일 패키지를 실제로 복사해 같은 빌드 명령을 재실행했다. 제품 소스와 설정 변경 없이 통과했다. 첫 실패는 `production-build-junction.log`에, 버전과 소스 확인은 `manifest.json` 및 `source-check.json`에 보존했다.

HTTP 점검은 가상 인증과 루프백 Next의 실제 요청으로 실행했다. 운영 환경에서의 로그인, DB 권한, 실제 자료 조회·게시 및 배포는 별도 단계다. 작업 콘솔과 대기열의 화면 독립 검수는 고정 개발본에 대한 Tester 판정과 함께 대조한다.
