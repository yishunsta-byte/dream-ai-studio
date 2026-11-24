# T362 운영 Data API 실측

2026-11-19 22:19:08 KST · 앱 기준 `c6c49c5` · 자체 검수

기존 프로젝트의 운영 Data API가 응답했다. 현재 노출 스키마는 `public`, `graphql_public` 두 개다. 서버가 조회할 `project_read`는 미노출 상태여서 프로젝트 목록과 상세를 이 경로로 운영 연결할 수 없다.

| 항목 | 확인 결과 |
|---|---|
| 대상과 신원 | 앱에 설정된 Supabase HTTPS origin과 공개 anon 키의 프로젝트 ref·역할을 대조했다. |
| 실행 | 앱의 프로젝트 목록 경로에 `GET /rest/v1/project_list?select=id&limit=0`을 보냈다. `apikey`는 공개 anon 키, `Accept-Profile`은 `project_read`였다. |
| 응답 | HTTP 406 및 `PGRST106`. PostgREST가 반환한 노출 목록은 `public, graphql_public`였다. 서버는 스키마 선택 단계에서 요청을 종료했다. |
| 권한 경로 | 앱은 로그인 세션의 사용자 토큰을 검증한 뒤 같은 토큰으로 `project_read.project_list`와 `project_read.project_detail`을 읽도록 구현돼 있다. 설치 SQL은 `authenticated` 역할에 두 뷰의 SELECT를 부여한다. 운영 DB의 실제 설치·권한과 로그인 사용자의 조회는 미검증이다. |
| 게시 관리 | 게시 읽기·쓰기는 별도의 PostgreSQL 권한과 비공개 Storage를 사용한다. Data API 조회 결과로 게시 관리 연결은 판단할 수 없다. [게시 연결 조건](T345-ADMIN-PUBLICATION-STAGING-ENTRY.md) |

로컬에서 `node node_modules/vitest/vitest.mjs run tests/postgres/t352-project-https-read.test.ts tests/postgres/t354-project-https-read-assembly.test.ts tests/postgres/t356-project-https-read-app.test.ts`를 실행해 3개 파일 84개 테스트가 통과했다. 이번 변경 파일은 이 실측 기록이다.

다음 단계는 기존 DB의 제한 읽기 세션에서 두 뷰의 설치 여부, 소유자 격리 정책과 실제 권한을 확인하는 것이다. 결과에 따라 설치 또는 스키마 노출 변경 범위를 정한다. 운영 설정·권한 변경과 배포는 수행하지 않았다. [설치 후보와 복귀 검증](T358-PROJECT-HTTPS-READ-SCHEMA-CANDIDATE.md)

> 플래너 전달문 — 운영 Data API가 응답했고 노출 목록은 public, graphql_public입니다. project_read 미노출을 확인했습니다. DB 내부 설치·권한 확인에 사용할 제한 읽기 세션이 필요합니다. 게시 관리는 별도 PostgreSQL 및 Storage 연결 상태를 확인해야 합니다.
