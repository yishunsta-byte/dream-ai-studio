# T251-R 공개 홈 승인 목록 연결 독립 검수

**판정 PASS** · 코드 `dda80966c611e92de7c1ccbdbfa0f9a4ca704f2f` · 작성자 인수인계 `a9d193c8d6fc0a0a5e3d155196527c3bf09ebf8a`

승인된 합성 작품만 공개 홈 화면에 전달됐다. 거절만 있는 목록, 철회만 있는 목록, 빈 목록에서는 예시 6개가 표시됐다. 실제 기본 공개 홈도 격리 Next.js에서 예시 6개와 기존 로그인 링크를 제공했다. 검수 범위에서 제품 결함을 발견하지 않았다.

## 코드와 전달 범위

- `lib/public-showcase/showcase-feed.ts`는 `server-only`로 표시된 서버 모듈이다. 기본 공급원은 분리된 동결 빈 배열이며, 명시적 입력을 기존 `toPublishedWorks`에 전달한다. 변환기는 공개 상태, 승인 시각, 철회, 권리 확인, 완성 상태, 공개 주소 검사를 거쳐 표시용 필드를 새로 구성한다.
- `app/(public)/page.tsx`는 `buildShowcaseFeed()` 결과의 작품 배열과 기존 작업실 로그인 링크만 화면 컴포넌트의 props로 전달한다. 변환기의 제외 이유와 원자료를 전달할 경로가 없다. 두 모듈의 의존과 해당 코드에서 개인 프로젝트, DB, 저장 파일, 로그인 사용자 조회를 호출하지 않음을 확인했다.
- `tests/public-showcase/showcase-feed.test.ts`의 6건과 `tests/t241-public-home-route.test.ts`의 import 기대값 갱신을 확인했다. 코드 4경로와 작성자 인수인계 1경로를 고정 커밋과 대조했다.

## 독립 실행

| 검사 | 결과 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/public-showcase tests/t241-public-home-route.test.ts tests/t243-admin-login.test.ts` | 5파일 65/65 |
| 변경 코드 4경로 ESLint, `--max-warnings 0` | PASS |
| `node node_modules/typescript/bin/tsc --noEmit -p tmp/t251r-dda8096/type.json` | PASS. 격리 Next 생성 타입, 공개 홈·공급 모듈, 관련 5개 테스트와 import 그래프 |
| 고정 커밋에서 추가로 실행한 홈 props 검사 | 4/4 |
| 격리 Next.js 16.4.6 개발 서버 익명 HTTP | PASS |

추가 props 검사는 격리 사본에서 공급 함수의 호출만 감싸 고정 시각과 합성 기록을 실제 변환 함수에 주입했다. 공개 홈 함수와 `NeonShowcase`는 실제 구현을 사용했다. 승인·거절·철회가 섞인 경우 승인 작품의 표시용 필드와 `media`만 넘어갔고, HTML에도 승인 작품만 표시됐다. 거절만 있는 목록, 철회만 있는 목록, 빈 목록은 각각 동일한 `SAMPLE_WORKS`를 넘겨 카드 6개를 출력했다. 네 경우 모두 props와 HTML에 제외 작품 식별자, 제외 코드, 원자료 표식이 없었다. 페이지 props 키는 `works`와 `loginHref`였다.

HTTP 검사는 고정 커밋 사본의 실제 기본 경로로 실행했다. Supabase 자격 설정을 제거한 로컬 서버에서 `/`는 200, 예시 카드 6개, `NEON AFTER HOURS`, 예시 안내, 작업실·관리자 로그인 링크를 반환했고 세션 쿠키를 설정하지 않았다. 같은 설정에서 `/admin`은 503이었다. Next.js가 여러 잠금 파일을 감지해 작업공간 루트 안내를 출력했다. 생성 타입과 개발 산출물은 격리 사본에 있었고, 검수 서버 종료 후 포트 51973에 리스너가 없음을 확인했다.

첫 HTTP 검증 스크립트는 PowerShell 파이프에서 한글 정규식이 손상되어 실행 전에 종료됐다. UTF-8 파일로 실행한 검증은 통과했다. 로컬 증거와 검증 스크립트는 `tmp/t251r-dda8096/`에 있다.

이 판정의 범위는 코드 검토, 대상 타입·린트, 합성 입력, 로컬 HTTP다. 실제 승인 공급원 연결, 개인 데이터 및 운영 조회, 게시·배포, 전체 저장소 타입 검사, 브라우저 화면과 실제 미디어 재생은 별도 범위다.

## Master 전달문

T251-R 독립 검수 PASS. 코드 `dda8096`, 작성자 인수인계 `a9d193c` 기준. 관련 65건, 실제 홈 props 및 렌더 4건, 범위 타입·린트, 격리 Next HTTP 통과. 승인 합성 작품만 표시했고 거절·철회·빈 목록에서는 예시 6개가 표시됐다. 실제 승인 공급원과 운영은 이번 검수 범위 밖이다.
