# T362-R 운영 프로젝트 읽기 연결 판정 및 전환 순서

Master 배정 `msg_ba4b9ff5da39` · 2026-11-19 · 기존 기록과 설치·복귀 SQL 문서 검토

**현재 판정은 운영 Data API 응답 확인, project_read 미노출, DB 설치 상태 미확인이다.** 22:19 KST에 기록된 anon 키·project_read 프로필의 목록 GET(limit=0)은 HTTP 406/PGRST106을 반환했다. 응답의 노출 목록은 public, graphql_public이었다. 요청은 프로필 선택 단계에서 끝났으므로 두 뷰의 존재, 실효 권한, 사용자별 행 격리는 아직 확인할 수 없다. [T362 실측](T362-DATA-API-LIVE-READ.md)

T361-R에서는 로컬 PG17.12와 실제 PostgREST를 사용해 승인된 A/B의 목록·상세 분리, 타인·보관 상세 404, 승인 회수와 복구, 조회 실패 시 503 및 no-store를 확인했다. 관리형 DB의 설치·권한과 운영 사용자 세션은 별도 확인 대상이다. [T361-R 검수](T361-R-PROJECT-HTTPS-READ-STACK-REVIEW.md)

## 권한자가 확인할 항목

동일 운영 대상에서 플랫폼 담당자는 대시보드의 Data API 사용 여부와 노출 스키마를 읽는다. DB 담당자는 승인된 제한 읽기 세션에서 대상·시각·서버 버전을 기록하고 카탈로그만 조사한다. 다음은 객체 분류를 위한 **미실행** 예시다. 개인 프로젝트 행이나 승인 UUID를 읽을 필요가 없다.

```sql
BEGIN READ ONLY;
SELECT current_database(), current_setting('server_version_num');
SELECT nspname, pg_get_userbyid(nspowner) AS owner,
       obj_description(oid,'pg_namespace') AS marker
FROM pg_namespace WHERE nspname IN ('project_read','project_read_private');
SELECT n.nspname, c.relname, c.relkind, c.reloptions,
       pg_get_userbyid(c.relowner) AS owner, obj_description(c.oid,'pg_class') AS marker,
       c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('project_read','project_read_private')
   OR (n.nspname = 'dream' AND c.relname IN ('projects','stage_states','jobs'));
SELECT schemaname, tablename, policyname, roles, cmd, permissive, qual
FROM pg_policies
WHERE schemaname = 'project_read_private'
   OR (schemaname = 'dream' AND tablename IN ('projects','stage_states','jobs'));
ROLLBACK;
```

- **설치 지문** — 두 스키마와 네 객체의 소유자·v1 주석을 확인한다. 공개 목록·상세와 비공개 project_data 세 뷰는 security_invoker=true여야 한다. pg_get_viewdef로 정의를 대조하고, approved_users 테이블에는 자기 승인만 읽는 정책과 RLS가 있어야 한다.
- **행 격리** — 기반 세 테이블의 ENABLE/FORCE RLS 및 모든 적용 가능한 SELECT·ALL 정책을 확인한다. 프로젝트는 auth.uid() 소유·미보관·승인을 모두 요구하고 단계·작업은 자기 소유이며 조회 가능한 프로젝트에 속해야 한다. 정책 이름 외에 조건·대상 역할·v1 주석까지 비교한다.
- **실효 권한** — 역할 존재 확인 후 has_schema_privilege, has_table_privilege, has_column_privilege 및 pg_has_role로 상속까지 대조한다. authenticated는 공개 스키마 USAGE와 두 뷰 SELECT, 내부 뷰 SELECT·승인 id 및 설치문에 열거된 기반 열 SELECT만 갖는다. dream·project_read_private 스키마 USAGE, 기반 테이블 단위 SELECT, 쓰기나 재부여 권한은 허용하지 않는다. anon·authenticator에는 공개 프로필 USAGE가 없어야 한다. PUBLIC·기본 ACL·열 ACL과 역할 전환을 통한 우회 권한도 설치문과 대조한다.
- **설치 전제** — PG17 이상, 기반 이력·열 타입·공통 테이블 소유자, 설치 역할의 DB CREATE, auth.uid() 반환형·실행권, authenticator의 anon/authenticated 전환 가능 여부를 대조한다. 카탈로그 가시성이 부족하면 해당 항목은 미확인으로 남기고 DB 소유자의 판정을 받는다. [설치문과 정확한 권한 목록](../../lib/db/postgres/project-https-read/0001_install.sql)

## 결과별 다음 조치

| DB 판정 | 권한자가 수행할 다음 단계 |
|---|---|
| 두 스키마 모두 없음 | 기반 테이블·역할·정책·ACL 전제를 대조한다. 충족하면 변경 승인 후 공통 테이블 소유자가 고정 설치 SQL을 한 번 실행하고 카탈로그를 재검증한다. 기반 이력 누락은 별도 작업으로 반환한다. |
| v1 완전 설치 및 최소 권한 일치 | 재설치를 생략한다. 기존 사용자 승인 상태를 권한자가 확인하고 대상 계정에 필요한 승인만 별도로 처리한다. |
| 일부 설치·정의 불일치·예상 밖 객체나 권한 | 노출을 보류한다. 차이와 객체 소유자를 Master에게 전달해 보정 범위를 정한다. 기존 스키마 자동 삭제나 설치 재실행은 하지 않는다. |
| 읽기 세션 또는 가시성 부족 | 운영 담당자에게 대상 일치, 시각, 위 항목별 일치·불일치·미확인 결과만 요청한다. |

**적용 순서.** 변경 전 앱 설정·노출 목록·기반 이력·ACL·정책을 기록한다. 설치 및 권한 검증이 끝나면 기존 노출 목록에 project_read만 추가하고 PostgREST 캐시를 갱신한다. 승인된 검증 계정의 같은 JWT로 목록·상세, 타인·보관 행 제외, anon 차단, Content-Profile과 Content-Range를 확인한다. 앱은 마지막에 검증한 ref, project_read 프로필, supabase-https 읽기 설정으로 전환하고 목록·상세 및 no-store를 재확인한다. [적용 절차](T358-PROJECT-HTTPS-READ-SCHEMA-CANDIDATE.md)

**복귀 순서.** 앱 설정을 변경 전 값으로 복원하고 이번에 추가한 노출만 회수한 뒤 캐시를 갱신한다. 기존 설치를 재사용한 경우 이번 변경에서 추가한 승인·설정만 원복한다. 이번에 설치한 v1 자체를 제거해야 하면 승인 목록 보존 필요성을 먼저 판단한다. 제거 시 해당 목록이 삭제된다. 동일 설치 소유자가 고정 복귀 SQL을 실행하고 후보 객체·열 권한 회수와 기반 이력·ACL·정책·트리거 보존을 기준선과 대조한다. 소유자·버전 지문·의존성 충돌 시 중단해 차이를 검토한다. [복귀 SQL](../../lib/db/postgres/project-https-read/0001_remove.sql)

> Master 전달문 — 기존 실측에서 project_read 미노출을 확인했습니다. 설치 여부는 아직 미확인입니다. 다음 담당은 동일 운영 DB의 제한 카탈로그 읽기가 가능한 권한자입니다. 완전 설치면 재설치를 생략하고, 미설치면 전제 확인 후 승인된 설치로, 부분 설치면 차이 검토로 진행합니다. 이번 검수는 문서·소스 대조로 완료했습니다.
