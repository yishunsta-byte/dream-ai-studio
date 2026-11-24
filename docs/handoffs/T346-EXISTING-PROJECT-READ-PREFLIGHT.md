# T346 기존 프로젝트 기준 내 프로젝트 읽기 연결 사전 점검

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_f13f87939cb7` · 로컬 `59778be` · GitHub master 관측 `4d52d814`

**판정은 대상 선택 완료, 실제 읽기 연결 보류다.** 사용자가 기존 Supabase와 Vercel 프로젝트를 사용하기로 결정했다. T264/T345의 신규 시험 환경 선택 대기는 종료됐다. 다음 실행 조건은 기존 대상에 대한 승인된 Direct TLS와 제한 읽기 수단을 확인하는 것이다. T346에서 해당 수단을 확인할 기록을 찾지 못해 원격 SQL 실측을 진행하지 않았다. [Master 원장](../TEAM.md) · [T264 기존 대상 기록](T264-STAGING-TARGET-INVENTORY.md) · [T345 출발점](T345-ADMIN-PUBLICATION-STAGING-ENTRY.md)

## 승인 기록과 관측 범위

| 항목 | 확인한 근거 | 판정 |
| --- | --- | --- |
| 기존 대상과 릴리스 | Supabase `dream-ai-studio`의 `main / PRODUCTION` 및 Vercel `dream-ai-studio`의 운영 배포가 기존 대상이다. Master는 GitHub master `4d52d814`, 공개 홈 200, 비로그인 `/admin`의 307 이동을 기록했다. 이번 작업에서 로컬 HEAD `59778be`와 로컬 원격 추적 참조 `4d52d814`를 각각 확인했고, 두 커밋 사이 프로젝트 GET·읽기 서비스·개인 관리 읽기 보조 모듈의 선택 경로에 차이가 없음을 대조했다. | 웹 응답은 Master의 관측이다. 보호된 서버 런타임의 실제 DB 읽기 연결이나 현재 런타임 설정을 증명하지 않는다. [Master 원장](../TEAM.md) · [T264 대상](T264-STAGING-TARGET-INVENTORY.md) · [T335 후보](T335-ADMIN-HUB-LOCAL-RELEASE-COMMIT.md) |
| Direct TLS와 Session 기록 | B7의 Direct는 DB 인증 전 실패했고, B8은 당시 실행 호스트에서 IPv6 `ENETUNREACH`를 관측했다. B8/B11에서 공식 CA와 호스트 이름을 확인한 클라이언트→Session pooler TLS는 성공했다. 실제 PostgreSQL 세션의 자체 `pg_stat_ssl`은 1행, `ssl=false`였다. | 과거 Session 접속의 근거다. 같은 프로젝트의 제한 Direct TLS와 실제 Vercel Node 호스트의 네트워크 상태는 미확인이다. 운영 SSL 결정 `DEC-SSL-01`의 기존 범위를 유지한다. [B7](B7-MANAGED-ENVIRONMENT-CHECK.md) · [B8](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B11](B11-SSL-CHANGE-READINESS.md) |
| 관리형 이관과 역할 | B8 당시 PG17.12와 Auth UUID 기반의 적합성이 관측됐고, `dream`, `dream_migrations.history`, 예약 런타임 로그인은 당시 확인되지 않았다. 그 접속의 SQL 실행자는 `CREATEROLE`·DB `CREATE` 권한이 있었다. B9-R은 Session 이관 연결 계약을 로컬에서 검수했다. | 현재 대상의 기반 이관 버전·카탈로그·읽기 역할 존재 여부는 미확인이다. 과거 관리 접속의 권한과 Session 검수로 제품 제한 로그인을 승인할 수 없다. [B8](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B9-R](B9-R-SESSION-MIGRATION-REVIEW.md) |
| 격리 기초 검증 | T258-R은 소유 PG17의 고정 스키마 3 설치·재실행을, T259-R은 실제 제한 SQL 로그인과 합성 Auth로 A/B 목록·상세·개인 관리 및 익명 차단 4건을 확인했다. 스키마 4 물리 공존 검증과 공식 PG17 v2 상태 판정은 별개이며 SQL5는 PG18 조건이다. | 현재 운영 DB의 최신 이관 결과나 실제 Auth 연동으로 승격할 수 없는 격리 근거다. [T258-R](T258-R-PG17-SCHEMA3-CATALOG-REVIEW.md) · [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md) · [T339-R](T339-R-ADMIN-PUBLICATION-LIMITED-INSTALLER-REVIEW.md) |

## 고정본의 읽기 계약

- `GET /api/projects`와 `GET /api/projects/[id]`, 클라우드 개인 관리의 서버 읽기 보조가 요청 단위 어댑터를 쓴다. Supabase 서버 `getUser`를 기반으로 확인된 사용자 UUID로만 actor를 만들고, 인증 실패는 풀 선택 전에 닫는다. 응답은 `no-store`이고 상세의 다른 소유자·보관·미존재 자료는 같은 404 경계로 처리한다. [목록 API](../../app/api/projects/route.ts) · [인증](../../lib/auth/resolve.ts) · [요청 어댑터](../../lib/services/postgres/project-read-request.ts) · [개인 관리 읽기](../../lib/cloud/project-read-page.ts) · [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)
- `DREAM_PROJECT_READ_BACKEND=postgres`의 명시 설정, Supabase 인증, 서버 전용 유효 DSN이 필요하다. Vercel에서 설정 누락·장애는 `PROJECT_READ_UNAVAILABLE`로 닫히며 클라우드 어댑터가 SQLite로 전환하지 않는다. 프로세스마다 단일 대상 풀이며 구성 변경에는 새 런타임이 필요하다. 공용 풀은 TLS 검증을 켜지만 프로젝트 읽기의 기본 풀은 별도 CA 입력 없이 생성된다. 실제 호스트의 신뢰 체인 또는 승인된 CA 전달이 확인돼야 한다. DSN 형식 검사만으로 환경·직접 접속·DB OID의 승인 일치를 입증할 수 없다. [백엔드 선택](../../lib/services/postgres/project-read-backend.ts) · [프로세스 풀](../../lib/services/postgres/project-read-pool.ts) · [TLS 설정](../../lib/db/postgres/connection.ts)
- 해당 요청은 같은 연결에서 `REPEATABLE READ READ ONLY`, `SET LOCAL ROLE dream_api`, 트랜잭션 범위 `dream.actor_id`를 쓰고 RLS로 격리된다. 승인 제한 로그인으로 전환·조회가 가능해야 하며, 직접 테이블 읽기와 worker 전환은 거부돼야 한다. 별도 이관·쓰기·게시 활성화는 이 읽기 연결의 승인 범위 밖이다. [프로젝트 읽기](../../lib/services/postgres/project-reads.ts) · [트랜잭션](../../lib/db/postgres/transaction.ts) · [T259-R 역할 시험](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)

## 재개 조건과 되돌림

| 순서 | 담당과 다음 판정 조건 |
| --- | --- |
| **1. 대상과 관측 수단 승인** | Master와 DB·플랫폼 담당이 기존 운영 대상의 정확한 ID, 승인된 실행 호스트·시간·접근, 이미 발급된 제한 읽기 계정의 제공 담당을 확인한다. 배포 담당은 앱 런타임에서 점검할 경우 배포 ID·고정 SHA·리전·보호된 실행 경로를 대조한다. 대상·결과의 일치 여부만 공동 기록에 남긴다. 이전 자동 검토가 거절한 Vercel 환경값이나 Supabase 사용자 상태 조회는 기존 범위를 유지한다. [T264 기록](T264-STAGING-TARGET-INVENTORY.md) · [T262 보호 점검 설계](T262-PREVIEW-RUNTIME-TLS-PREFLIGHT.md) |
| **2. 읽기 전용 Direct TLS 실측** | 지정 DB 담당과 Backend가 승인 대상과 접속 프로필을 먼저 대조한다. 실제 실행 호스트에서 인증서 체인·호스트 이름 검증과 자체 `pg_stat_ssl.ssl=true`를 같은 Direct 세션에서 확인한다. PG17 주 서버, DB 이름·OID·클러스터 식별자, 세션 역할과 허용된 카탈로그·이력·유효 권한만 확인하고 읽기 트랜잭션과 연결을 닫는다. Direct 연결·신뢰 체인·제한 로그인·이관 상태 중 하나라도 미확인이면 읽기 연결을 보류한다. 세션 프록시나 넓은 관리 자격으로 대체하면 본 순서의 검증을 충족하지 않는다. [T261 읽기 선행 조건](T261-MANAGED-PG17-STAGING-CHECKLIST.md) · [B11 TLS 경계](B11-SSL-CHANGE-READINESS.md) |
| **3. 독립 확인과 연결 판정** | Master가 1·2단계 증거를 수락하면 Tester가 승인된 환경에서 실제 Auth 시험 계정 A/B·익명으로 읽기만 검증한다. 사전 승인된 기존 시험 자료가 있을 때 목록·자기 상세·타인 상세 404·익명 401·`no-store` 및 실패 시 503을 확인한다. 그 자료 또는 제한 역할이 없거나 기존 이관이 불일치하면 차이를 보고하고 별도 승인 단계로 넘긴다. T346에서는 시드·이관·활성화를 실행하지 않는다. [T259-R 앱 시험](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md) · [T261 독립 판정](T261-MANAGED-PG17-STAGING-CHECKLIST.md) |
| **되돌림** | 읽기 사전 점검은 트랜잭션 종료와 연결 폐기로 마친다. 향후 별도 승인 연결에서 이상이 확인되면 배포 담당이 해당 런타임의 읽기 진입을 닫고 풀을 종료한 뒤 기존 미연결 구성 또는 직전 승인 배포로 복귀한다. 보호 화면의 로그인 이동과 프로젝트 읽기 비가용 응답을 확인한다. 데이터 변경을 동반하는 복구는 별도 승인 범위다. [T261 종료·복구](T261-MANAGED-PG17-STAGING-CHECKLIST.md) |

T346은 저장소와 승인 기록 대조를 완료했다. 이 작업 자체의 새 실측은 로컬 커밋·소스 비교에 한정한다. 관리형 DB나 Vercel에 접속하거나 기존 환경을 변경하지 않았으며, 관리자 화면 파일은 조사 범위에서 제외했다.
