# T356 프로젝트 HTTPS 조회 연결

T355에서 만든 Supabase HTTPS 조회 어댑터를 프로젝트 목록·상세 API와 클라우드 개인 프로젝트 목록·상세에 연결했다. `POST /api/projects`의 프로젝트 생성과 기존 SQLite, Postgres, 조회 비활성화 설정은 그대로 동작한다.

| 적용 경로 | 동작 |
| --- | --- |
| `GET /api/projects`, `GET /api/projects/[id]` | 명시적으로 선택된 HTTPS 모드에서 실제 요청의 `AbortSignal`을 전달한다. Next 라우트의 쿠키 저장소를 사용한다. 상세 ID는 기존처럼 인증을 통과한 뒤 읽는다. |
| 클라우드 개인 프로젝트 목록·상세 | HTTPS 모드에서는 T355가 현재 세션을 확인한다. 서버 렌더링은 요청 쿠키를 읽고 기존 proxy가 세션 갱신을 담당한다. 로그인 이동, 존재하지 않는 프로젝트, 조회 불가 표시를 기존 화면 처리에 연결했다. |
| HTTPS 설정 누락·불일치 | GET API는 데이터베이스로 우회하지 않고 캐시 금지 응답으로 실패한다. 클라우드 화면은 기존 조회 불가 처리로 연결한다. |

## 설정

- `DREAM_PROJECT_READ_BACKEND=supabase-https`일 때만 새 경로를 사용한다.
- `DREAM_PROJECT_HTTPS_REF`에는 Supabase 프로젝트 ref를, `DREAM_PROJECT_HTTPS_PROFILE`에는 이 어댑터용 조회 스키마 이름을 설정한다.
- Supabase 인증 모드에서 등록된 `NEXT_PUBLIC_SUPABASE_URL`은 해당 ref의 표준 HTTPS 주소와 일치해야 한다. 기존 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 설정에는 T355가 허용하는 publishable key를 사용한다. 기존 허용 이메일 정책이 적용된다.

## 검증

| 검증 | 결과 |
| --- | --- |
| Vitest | 앱 진입점, 기존 라우트와 클라우드 읽기, T354/T355 조립, T352 어댑터 회귀 5개 파일 128개 통과. |
| `node tests/t356-project-https-read-next.mjs` | 격리한 로컬 Next 개발 서버 두 구성에서 통과. 원본 proxy로 만료 세션 쿠키 갱신, 새 쿠키의 다음 요청 재사용, 목록·상세 404·클라우드 목록 렌더링, 비로그인 401을 확인했다. 테스트용 복사본에서 proxy를 제외한 구성은 GET 라우트 자체의 `Set-Cookie`와 다음 요청 재사용을 확인했다. |
| 정적 검사 | 변경 파일 ESLint와 전체 소스 TypeScript 검사 통과. TypeScript 검사에서 기존 `.next` 생성 파일은 제외했다. |
| 검증 범위 | 외부 Supabase 호출은 로컬에서 합성 응답으로 대체했다. 실제 Supabase 및 운영 환경, 쿠키를 일부 기록한 뒤 실패했을 때의 복구는 검증 범위에 포함되지 않았다. |
