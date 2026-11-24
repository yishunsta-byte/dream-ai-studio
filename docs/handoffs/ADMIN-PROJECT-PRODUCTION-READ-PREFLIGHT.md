# 관리자 내 프로젝트 운영 연결 사전 점검

2026-11-20 12:03 KST · Master `msg_3fae5809b9e5` · 관리자 `29860f3`, 격리 시험 `7a73cb9`.

기존 Dream AI Studio Supabase에서 공개 anon 키의 역할·프로젝트를 기존 HTTPS 주소와 대조했다. `project_read` 프로필로 `GET /rest/v1/project_list?select=id&limit=0`을 보냈다. 12:03:45 KST 응답은 HTTP 406 `PGRST106`이며 응답이 표시한 노출 스키마는 `public`, `graphql_public`이다. 프로젝트 행은 반환되지 않았다.

| 항목 | 운영에서 확인한 상태 |
| --- | --- |
| `project_read` Data API 노출 | 미노출을 현재 요청으로 확인했다. DB에 스키마가 설치돼 있는지는 응답에서 알 수 없다. |
| 현재 PG 버전과 기반 이력, `dream.projects`, `dream.stage_states`, `dream.jobs` | 승인된 제한 카탈로그 세션이 없어서 현재 상태는 미확인이다. PG17.12는 과거 관측이며 현재 운영 버전으로 사용하지 않는다. |
| 기반의 공통 소유자·ENABLE/FORCE RLS, `anon`·`authenticated`·`authenticator`의 실효 권한 | 현재 운영 상태 미확인이다. 로컬 설치·복귀 및 A/B 독립 시험은 통과했다. |
| 대표 계정의 읽기 승인 및 기존 프로젝트 존재 | 운영 담당의 대상 계정 한정 승인 여부·프로젝트 존재 여부 확인이 필요하다. 이번 조회는 익명 읽기 0행이므로 대표 계정의 데이터 유무를 말해 주지 않는다. |
| 운영 설정 기준과 복구 | 기존 설정값은 미확인이다. 전환에는 `DREAM_PROJECT_READ_BACKEND=supabase-https`, 일치하는 `DREAM_PROJECT_HTTPS_REF` 및 `DREAM_PROJECT_HTTPS_PROFILE=project_read`가 필요하다. 이전 앱 설정과 배포를 기준선으로 보존하고 문제가 생기면 앱 설정부터 복원한 뒤 이번에 추가된 노출과 승인만 회수한다. 설치 자체 제거는 기존 승인 보존 여부와 의존성을 판단한 뒤 고정 복귀 SQL을 사용한다. |

세션 변수 이름과 Windows 기본 PostgreSQL 서비스 프로필, 저장소 설정 경로를 확인했다. 승인된 제한 조회 연결은 발견되지 않았다. [T362 설치·권한 대조 SQL](T362-CATALOG-ACCESS-STATUS.md)과 [결과별 전환·복귀 순서](T362-R-PROJECT-READ-ACTIVATION-REVIEW.md)를 사용할 권한자의 판정이 다음 입력이다. 대표 계정은 승인·보유 여부만 받고 비밀, UUID, 프로젝트 제목과 원본은 공유할 필요가 없다.

기존 자동 승인 검토에서 거절된 Vercel 환경값 조회 및 Supabase 사용자 상태 조회를 실행하거나 다른 경로로 대체하지 않았다. 이번 활동은 기존 공개 역할 무자료 GET과 로컬 조회 경로 확인에 한정했다.

**Master 전달문** · 12:03:45 KST 기존 Supabase 공개 Data API에서 `project_read` 미노출을 재확인했습니다. 승인 제한 카탈로그 세션이 없어 현재 PG·기반·역할·대표 계정 승인 및 자료 존재는 미확인입니다. 권한자의 기존 T362 읽기 판정이 도착하면 설치 상태별 전환 여부를 결정할 수 있습니다.
