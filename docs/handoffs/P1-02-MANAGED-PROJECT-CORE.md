# P1-02 관리형 프로젝트 생성·브리프 인계

기준은 운영 `33ff5a07d169aad0ea02f26b2bbbbb30bd3cc401`다. 별도 Orca 작업 사본의 `backend/p102-managed-project-core`에서 서버 연결을 구현하고 자체 검수했다. 운영 Supabase와 Vercel, Front, 파일 저장 경로의 변경은 없었다.

## API

| 요청 | 응답과 조건 |
| --- | --- |
| `GET /api/projects` · `GET /api/projects/:id` | 관리형 프로젝트 저장소를 선택하면 기존 소유 프로젝트 응답을 같은 DB에서 읽는다. 예전 서버 선택과 DTO는 유지한다. |
| `POST /api/projects` | 같은 출처의 JSON `{menuId, inputs}`와 UUIDv7 `Idempotency-Key`로 활성 쇼핑숏츠 프로젝트를 생성한다. 현재 영수증이 있는 소유 원본 자료만 참조한다. 프로젝트·초기 단계·자료 링크·감사를 한 번에 저장하고 `201 {id}`를 반환한다. |
| `GET /api/projects/:id/brief` | 활성 소유 프로젝트의 브리프와 현재 `revision`, `intake/brief/plan` 상태를 읽는다. |
| `POST /api/projects/:id/brief` | 같은 출처의 `{acknowledged:true, revision}`과 UUIDv7 `Idempotency-Key`가 필요하다. 프로젝트를 잠그고 브리프를 승인한 뒤 기획을 열며 감사 기록까지 같은 트랜잭션에서 저장한다. 결과는 `200 {stage:"plan", revision}`이다. |

서버에서 확인한 Supabase 사용자 UUID를 사용한다. 타 소유, 누락 또는 보관 프로젝트는 404다. 쓴 응답을 받지 못했을 때 동일 키와 입력으로 재요청하면 이전 결과를 돌려주며, 같은 키를 다른 입력에 쓰거나 낡은 버전으로 승인하면 409다. 잘못된 대상, TLS, 권한 또는 구성에는 503을 반환한다. Vercel에서 관리형 서버를 선택하지 않았을 때 기존 클라우드 차단이 동작한다. 이 사본은 프롬프트·기획 본문·장면·파일 자체의 저장을 연결하지 않는다.

## 변경 파일

- 라우트 `app/api/projects/route.ts`, `app/api/projects/[id]/brief/route.ts`.
- 설정 및 서버 접속 `lib/cloud/managed-project-core.ts`, `lib/cloud/managed-project-core-http.ts`, `lib/db/postgres/transaction.ts`.
- 재사용 서비스 `lib/services/postgres/project-create.ts`, `project-read-request.ts`, `project-reads.ts`.
- 역할·영수증 SQL `lib/db/postgres/managed-project-core/0001_install.sql`.
- 검수 `tests/postgres/managed-project-core*.mjs`, `tests/t198-legacy-gate.test.ts`.

## 자체 검수

- SQL 1–3의 고정 해시를 확인하고 격리 PostgreSQL 17.12에 비슈퍼 이관 역할로 설치했다. CA·호스트 검증 TLS 1.3, 강제 RLS 18개, 브라우저 역할의 내부 스키마 권한 0건을 확인했다.
- Webpack 운영 빌드에서 실제 Next 서버를 실행했다. 합성 Supabase HTTPS 인증 요청 127건, 실제 격리 TLS PG17, 설정 누락·잘못된 호스트·잘못된 CA의 503을 확인했다. 동일 DB의 설치 표식이 다른 프로젝트를 가리킬 때도 503이었다.
- 두 소유자의 생성, 목록·상세·브리프 격리, 보관 상태, 다른 소유의 자료와 만료된 영수증 차단을 확인했다. 같은 생성 키의 동시 제출은 프로젝트 한 개를 만들었고 서로 다른 브리프 키가 경합하면 200과 409가 하나씩 반환됐다. 생성 및 브리프의 HTTP 응답 유실 뒤에도 기존 결과를 복원했다. 최종 영수증 쓰기 실패와 브리프 감사 쓰기 실패 모두 롤백됐다. 같은 연결을 반복 사용한 뒤에도 정상 저장됐다. 최종 합성 상태는 프로젝트 12, 단계 84, 감사 23, 자료 링크 12, 요청 결과 23, 기획·장면 0건이다.
- 재사용 연결에서 기존 `guard_row()`가 일반 실행 계획을 선택한 뒤 렌더·기획 열 권한을 검사하는 문제가 드러났다. SQL 1–3은 손대지 않고 검사식에 등장하는 최소 열의 SELECT만 추가했다. 세 관계에 새 역할이 적용받는 RLS 정책이 없어 행을 읽을 수 없고 기획 본문·렌더 입력에 접근할 수 없다.
- 기존 프로젝트 생성 20건과 기존 프로젝트 읽기 51건의 실제 격리 PG 회귀가 통과했다. 추가 집중 Vitest 52건, 변경 범위 ESLint, TypeScript, 빌드 추적 검사도 통과했다. T198 전체는 고정 기준과 후보에서 동일한 기존 Style DNA 관련 19건이 실패했고, 실패 테스트 이름이 같았다.
- 첫 테스트 클러스터는 Windows 런처 프로세스의 출력 파이프 문제로 중지했다. 데이터베이스는 종료됐다. 수정한 실행기는 후속 시험에서 자기 클러스터를 종료하고 정리했다.

## 향후 운영 적용 최소 절차

1. 기존 Supabase의 공통 기반 SQL 1–3과 검증된 자료의 SQL 4 계약, 설치 소유자, Auth UUID 관계를 대조한다. 현재 운영에는 공통 스키마가 아직 없어 해당 설치와 자료 등록이 선행해야 한다. 운영에서 파일·자료를 실제로 등록하는 기능은 별도 단계다.
2. 같은 운영 DB의 공식 TLS Session 연결에서 설치 소유자 세션에 `dream.project_core.install_ref`를 기존 Auth 프로젝트 참조로 설정한다. 그 세션에서 전용 역할 SQL `managed-project-core/0001_install.sql`을 승인 범위에 맞춰 적용한다. LF 원문 SHA-256은 `c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182`다.
3. `dream_project_core_app`의 서버용 LOGIN과 암호를 별도로 준비하고 브라우저 또는 Worker 역할과 연결되지 않았음을 확인한다. 공식 Session 5432의 전용 URL과 제공자 CA를 서버 변수 `DREAM_PROJECT_CORE_DB_URL`, `DREAM_PROJECT_CORE_DB_CA`로 보호한다. 설정과 실제 TLS 로그인 및 권한 검증이 끝난 뒤 `DREAM_PROJECT_CORE_BACKEND=supabase-postgres`를 승인 환경에 설정한다.
4. 배포 후 승인된 관리자 계정과 이미 검증된 소유 자료로 생성·조회·브리프 재열기·재시도를 확인한다. 운영 설치·설정·배포는 이번 결과의 범위에 포함되지 않는다.

격리 검수 명령은 `node tests/postgres/managed-project-core.pg17.mjs --http`다. `P102_PG_BIN`에는 로컬 PostgreSQL 17 실행 디렉터리를 지정하고, 먼저 `next build --webpack`을 실행한다. 인증서와 Auth·자료 표본은 실행기가 합성한다.

> Master 인계. P1-02 관리형 첫 구현에서 동일 DB의 프로젝트 생성·브리프와 소유 조회를 연결했습니다. 고정 SQL 1–3, 격리 Next+합성 HTTPS Auth+TLS PG17, 자료 참조·경합·유실·롤백·최소 권한을 자체 검수했습니다. 기존 Style DNA 분류 시험의 기준 19건 실패를 재현했고 신규 실패는 없습니다. 운영 변경 없이 독립 검수로 넘깁니다.
