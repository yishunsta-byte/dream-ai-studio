# T351 실제 PostgREST 프로젝트 조회 루프백 검증

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_a596a06f3c83` · T349 기준 `b6447a4`

공식 PostgREST Windows x64 v16.6 ZIP을 임시 폴더에서 사용했다. 실행 전 공식 ZIP SHA-256 `77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea`와 대조하고 실행 파일 버전을 확인했다. 기존 서명된 PG17.12와 T349 SQL fixture를 재사용했다. [PostgREST 공식 릴리스](https://github.com/PostgREST/postgrest/releases/expanded_assets/v16.6) · [T349-R 격리 기준](T349-R-SUPABASE-PROJECT-HTTPS-READ-REVIEW.md)

## 실제 루프백 계약

| 검증 범위 | 관측 결과 |
| --- | --- |
| 합성 JWT와 DB 역할 | 실제 HTTP가 서명된 A/B JWT를 처리했다. 진단 뷰에서 연결 로그인은 고정되고 트랜잭션 역할·JWT subject는 각각 A, 익명, B에 맞게 바뀌었으며 GET은 읽기 전용이었다. 잘못된 서명·audience·만료는 401이고, 허가되지 않은 DB 역할을 명시한 토큰은 403이었다. 이 구성에서는 같은 서명 키의 다른 issuer 또는 audience가 생략된 토큰도 허용됐다. Supabase 발급·검증과 앱 허용 계정 확인은 제품 단계에서 입증해야 한다. [PostgREST 인증 계약](https://docs.postgrest.org/en/stable/references/auth.html) |
| 권한과 노출 | A/B는 자기 활성 프로젝트만 읽었다. 차단된 사용자는 자신의 프로젝트가 있어도 0건이었다. 익명 조회는 401, 기반 `dream`·`auth`·내부 승인 스키마를 지정한 요청은 406이었다. 실제 DELETE는 집계 뷰에서 500/`55000`으로 거부됐고 DB 프로젝트 행은 보존됐다. 진단 뷰는 이 시험에만 추가했다. |
| 페이지와 DTO | B의 두 작품을 고정 정렬에서 페이지 1·2로 읽고 `Content-Range`의 총 2건과 중복 없는 ID를 확인했다. 원시 목록 보조 필드와 상세 행을 앱 DTO로 변환한 결과가 기존 읽기 경로와 일치했다. 단계 배열은 저장소의 정렬 미지정 범위에 맞춰 단계 이름으로 정규화했다. |
| 오류와 응답 캐시 | 실제 PostgREST는 차단 사용자의 목록을 200/빈 배열로, 타인·보관·미존재 상세를 복수형 200/빈 배열과 단수형 406으로 반환했다. UUID 형식 오류는 400, DB 조회 권한 회수는 403이었다. 성공 목록의 원시 응답에는 `Cache-Control`이 없었다. 기존 앱 경로의 `no-store`와 단일 404 계약은 대조 실행에서 확인했다. 향후 어댑터가 앱 권한, DTO 변환, 오류 정규화, `no-store`를 유지해야 한다. [현재 읽기 요청](../../lib/services/postgres/project-read-request.ts) · [PostgREST 오류 계약](https://docs.postgrest.org/en/stable/references/errors.html) |

실행 명령은 `node --conditions=react-server --import tsx tests/postgres/t351-postgrest-project-read.pg17.ts`다. 공식 ZIP 다운로드와 해시 확인, 실행, 소유 로컬 PG17과 HTTP 연결 확인 및 종료를 한 실행 안에서 처리한다. [실행기](../../tests/postgres/t351-postgrest-project-read.pg17.ts)

프로젝트 읽기 회귀는 기본 실행 조건에서 43건 통과·17건 조건부 건너뜀이다. 변경 실행기 ESLint와 생성 `.next` 검증기 제외 소스 TypeScript 검사도 통과했다.

검증 경계는 **실제 루프백 HTTP, 로컬 PostgreSQL SCRAM, 합성 JWT**다. 외부 Supabase HTTPS와 실제 Supabase 발급 JWT, 관리형 설정 및 운영 배포는 별도 범위다. 실행 후 두 측 포트의 접속 거부와 임시 ZIP·실행 파일·클러스터 경로 제거를 확인했다.
