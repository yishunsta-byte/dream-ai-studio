# T362 기존 Supabase 운영 읽기 사전 점검

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_f96cb882665c`

**판정은 운영 대상 확인, 현재 Data API·DB 상태 미확인이다.** 기존 Supabase `dream-ai-studio`의 `main / PRODUCTION`이 대상이다. 이번 점검에 이용할 수 있는 기존 승인 읽기 세션이나 제한 DB 경로를 확인하지 못했다. [T346 대상 및 연결 기록](T346-EXISTING-PROJECT-READ-PREFLIGHT.md) · [T361 운영 사전 점검 조건](T361-PROJECT-HTTPS-READ-STACK-VERIFICATION.md)

| 확인 항목 | 판정 | 근거 |
| --- | --- | --- |
| 기존 프로젝트·환경 | 기록에서 확인 | T346·T264의 기존 운영 대상과 과거 공식 대시보드의 프로젝트·환경 표시가 일치한다. 이전 B11의 조직 Owner 관측은 과거 관측이며 현재 자동화 도구에서 이용할 수 있는 승인 세션이라는 근거는 없다. [T264 대상 목록](T264-STAGING-TARGET-INVENTORY.md) · [B11 관측](B11-SSL-CHANGE-READINESS.md) |
| 현재 Data API 사용 여부와 노출 스키마 목록 | 미확인 | T346·T361과 운영 기록에 이 항목의 현재 판정값이 없다. 승인받아 사용할 수 있는 활성 에이전트 브라우저 공간도 확인되지 않았다. 사용자 소유 공간은 인수하지 않았다. |
| `project_read` 설치 여부와 노출 여부 | 둘 다 미확인 | 설치 여부는 DB 카탈로그, 노출 여부는 Data API 설정의 별개 관측이다. 노출 목록에 이름이 없어도 미설치라고 판정할 수 없다. T358 설치·복귀와 T361-R 통합 검수는 로컬 시험이다. [T358 후보](T358-PROJECT-HTTPS-READ-SCHEMA-CANDIDATE.md) · [T361-R 독립 검수](T361-R-PROJECT-HTTPS-READ-STACK-REVIEW.md) |
| 현재 DB 버전·기반 이력·역할 전제 | 미확인 | 과거 B8은 PG17.12와 기반 스키마·이력 부재를 당시 관측했다. Session pooler를 사용한 관리 권한 세션이었다. T346의 메인 PC Direct IPv6 실패 기록 이후 현재 대상에 대한 승인된 제한 읽기 수단은 확인되지 않았다. [B8 당시 관측](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [T346 재개 조건](T346-EXISTING-PROJECT-READ-PREFLIGHT.md) |

## 담당 조치 한 가지와 재개 조건

**Master가 지정한 Supabase 플랫폼 운영 담당이 기존 승인 대시보드에서 Data API 설정을 읽고, 운영 대상 일치 여부·관측 시각·Data API 사용 여부·노출 스키마 이름 목록만 전달한다.** 이 결과가 오면 `project_read` 노출 여부와 기반·승인 스키마의 비노출 여부를 판정할 수 있다. 키·계정 원문·스크린샷은 필요 없다.

DB 설치 여부와 버전·이력·역할 전제는 동일 대상에 대해 이미 승인되어 이용 가능한 제한 읽기 경로가 확인될 때 재개한다. 그때 `project_read` 스키마와 두 조회 뷰, PG 버전, 기반 이력 ID·체크섬, 설치 역할 전제를 카탈로그에서 확인하고 값의 일치 여부만 기록한다. 승인 경로가 확인되기 전에는 DB 판정을 미확인으로 유지한다.

이전 자동 승인 검토는 Vercel 환경값 조회 및 Supabase 사용자 상태 조회를 `UnauthorizedAccess`로 실행 전에 거절했다. 이번 점검에서 두 동작을 재시도하거나 다른 경로로 조회하지 않았다. 운영 SQL 연결·쓰기, 설정 변경, 자원·세션 생성 및 배포는 수행하지 않았다. [기존 거절 기록](../TEAM.md)

> T362 운영 대상은 기존 기록과 일치합니다. 현재 Data API 노출 목록과 후보 설치·DB 전제는 미확인입니다. 지정 Supabase 플랫폼 운영 담당의 읽기 전용 노출 목록 확인을 요청합니다. 기존 제한 DB 읽기 경로가 확인되면 설치·이력·역할 판정을 재개할 수 있습니다.
