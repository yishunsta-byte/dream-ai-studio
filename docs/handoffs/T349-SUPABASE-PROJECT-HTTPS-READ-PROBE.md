# T349 Supabase HTTPS 프로젝트 읽기 격리 검증

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_1189af38ab9e` · 읽기 기준 `59778be`

**소유 PG17의 읽기 권한·RLS와 합성 JWT/모의 HTTP 시험을 통과했다.** 실제 Supabase·PostgREST 연결 및 운영 DTO 검증은 후속 범위다. `865d269`과 `a297c0f`의 관리자 UI 변경을 포함한 작업 HEAD에서 프로젝트 읽기 경로와 기반 RLS는 기준 커밋과 일치했다. [T347 경로 결정안](T347-EXISTING-PROJECT-READ-CONNECTION-OPTIONS.md)

| 검증 경계 | 확인한 결과 |
| --- | --- |
| 실제 PostgreSQL 17.12 | 서명된 기존 도구로 루프백 클러스터를 소유하고 기반 SQL1~3을 고정 로더에서 읽어 적용했다. 테스트 전용 SQL은 기반 위에 별도 스키마·호출자 권한 뷰와 `SELECT` 전용 소유자·승인 정책을 설치한다. A/B는 자기 행만 읽었다. 승인에서 빠진 사용자는 자신의 행도 0건이었다. 다른 소유자·보관 행은 노출되지 않았다. [격리 ACL/RLS SQL](../../tests/postgres/t349-project-https-read.sql) |
| 읽기 전용·기반 비노출 | 실제 제한 역할은 `dream`, `auth`, 내부 승인 스키마를 직접 조회할 수 없고 기존 API·worker 역할로 전환할 수 없었다. 별도의 일반 읽기/쓰기 트랜잭션에서 INSERT·UPDATE·DELETE를 시도해 거절을 확인했다. 집계 뷰의 비갱신성에 더해 실제 DML 권한이 없음을 카탈로그에서 대조했다. 같은 풀의 트랜잭션 종료 후 로그인 역할과 JWT 설정이 복귀했다. |
| 합성 JWT → 실제 DB 역할 | 로컬 모의 검증기가 합성 HS256 서명·issuer·audience·만료·UUID 및 고정 인증 역할을 대조한다. 유효한 요청은 실제 PG 제한 세션의 트랜잭션 로컬 JWT 설정과 `SET LOCAL ROLE`로 연결된다. 합성 `auth.uid()`를 RLS에서 읽는다. 직접 SQL에서는 익명 역할과 허용되지 않은 사용자의 접근이 독립적으로 차단됐다. |
| 모의 HTTP와 DTO | 소켓 없이 `Request`/`Response`로 A/B 목록과 자기 상세를 호출해 기존 PostgreSQL 읽기 서비스와 깊은 동등성을 확인했다. 단계 배열은 기존 저장소의 정렬 미지정 범위를 반영해 단계 이름으로 정규화해 비교했다. 타인·보관·미존재 상세는 같은 404, 차단 사용자는 403, 익명·잘못된 JWT는 401, 쓰기 요청은 405, 노출 프로필 밖은 404, DB 권한 회수 시 503이었다. 검증된 응답은 `no-store`다. 이 HTTP 계약은 기존 앱 경로를 가정한 모의 응답이다. |

실행 명령은 `node --conditions=react-server --import tsx tests/postgres/t349-project-https-read.pg17.ts`다. 각 실행에서 PostgreSQL 연결, 리스너, 임시 클러스터를 정리했다. [실행기](../../tests/postgres/t349-project-https-read.pg17.ts)

기존 프로젝트 읽기 회귀는 기본 조건에서 43건 통과·17건 조건부 건너뜀이다. 변경 실행기 ESLint와 생성 `.next` 검증기 제외 소스 TypeScript 검사도 통과했다.

## 후속 검증

이 장비에서 PostgREST·Supabase CLI·컨테이너 실행 수단이 확인되지 않았다. 따라서 실제 HTTPS 전송, Supabase 발급 JWT와 제공자 역할 전환, PostgREST의 실제 노출·기본 ACL·페이지 및 오류 계약은 미검증이다. 다음 독립 검수는 위 SQL과 모의 HTTP 근거부터 대조한다. 실제 연결은 기존 대상의 승인된 Data API 설정 및 기반 상태 확인, 권한·이관·시험 자료와 복귀 책임 승인 후 진행한다. 제품 코드와 고정 이관, 실제 환경 및 배포는 그대로 유지했다.
