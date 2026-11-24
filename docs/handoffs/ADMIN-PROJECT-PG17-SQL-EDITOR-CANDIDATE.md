# 기존 Supabase SQL Editor의 PG17 스키마 3 설치 후보

2026-11-20 · Master 요청 `msg_53611dfe74b8` · 적용되지 않은 후보.

Master의 기존 운영 SQL Editor에서 PG 17.12, UTF-8, 같은 `postgres` 세션 및 현재 역할, DB 세션 TLS, DB CREATE와 CREATEROLE, Auth UUID·참조와 게이트웨이 전환, 예약 스키마·이력·역할 부재, 비소유자 기본 권한 0건을 확인했다. 이 판정이 동일 프로젝트의 SQL Editor 사용을 뒷받침한다. [기존 조회 입력](ADMIN-PROJECT-PG17-EDITOR-PREFLIGHT.sql)

## 후보가 보존하는 검증

| v2 계약 | SQL Editor 후보 |
| --- | --- |
| 파일과 적용 순번 | 오프라인 생성에서 v2 로더로 SQL 1–3 원문 SHA-256을 확인한다. 출력 SQL은 실제 실행할 본문의 해시를 각 실행 직전에 서버에서 확인하고 같은 순서로 실행한다. |
| 저널과 트랜잭션 | 기존 v2 저널 DDL과 advisory lock을 재사용한다. 한 `BEGIN`에 세 SQL, 공식 체크섬 이력, 전체 사후 검사를 묶는다. 하나라도 어긋나면 예외로 중단하고 전체가 롤백된다. |
| 기대 카탈로그와 역할 | 같은 9개 카탈로그 조회와 PG17용 스키마 3 기대값을 사용한다. 행 내용과 중복 수를 양방향으로 비교한다. 이력 순번·ID·체크섬, NOLOGIN 역할 2개와 제한 역할 멤버십을 커밋 전에 확인한다. |
| 대상 | DB 이름·OID, 서버 포트·정확한 버전, 인코딩과 두 역할을 SQL에서 재확인한다. 같은 플랫폼 프로젝트인지 기존 Supabase 대시보드에서 대표 참조를 확인해야 한다. 클러스터가 달라도 DB 이름과 OID가 같을 수 있다. |
| 연결·재실행 | SQL Editor는 v2 CLI의 DSN 연결, CA·호스트 검증, 승인 해시와 단일 클라이언트 수명을 대신하지 못한다. 후보는 비어 있는 초기 상태에서만 실행된다. 기존 적용 성공 후에는 읽기 검사나 고정 CLI로 상태를 확인한다. |

[오프라인 생성기](../../scripts/postgres/schema3-editor-candidate.ts)는 DB 연결 없이 결과 파일을 쓰고 SQL 전체 SHA-256을 출력한다. 기존 파일에는 덮어쓰지 않는다. 입력은 같은 운영 Editor에서 읽은 프로젝트 참조, DB 이름·OID, 역할, 포트, 정확한 서버 버전이다.

```powershell
node --conditions=react-server --import tsx scripts/postgres/schema3-editor-candidate.ts rollback <project-ref> <database> <database-oid> <owner> <port> <server-version-num> <output.sql>
Get-FileHash -LiteralPath <output.sql> -Algorithm SHA256
```

`rollback` 결과에도 임시 DDL과 잠금이 있으므로 격리 검증에 사용한다. 운영 승인이 별도로 내려지면 `commit` 결과를 생성해 전체 파일 해시를 검토본과 맞추고, 기존 프로젝트의 SQL Editor에서 한 번에 실행한다. 생성 예시에서 약 204KB인 전체 파일의 SHA-256이 출력과 일치했다. 운영 SQL Editor의 이 크기 입력과 제출 동작은 미검증이다. 전체를 한 번에 보낸다는 근거가 없으면 연결이 승인된 CLI 경로로 돌아간다. 적용 직후 보이는 성공 행은 별도 읽기 검증으로 확인한다.

## 실행 전후 판정

1. 같은 기존 Supabase 프로젝트에서 현재 현황과 DB OID를 다시 읽는다. `SELECT current_database(), oid, inet_server_port() FROM pg_database WHERE datname=current_database()`로 DB 이름·OID·포트를 확인한다. 읽기 전 검토의 빈 스키마·권한·기존 Auth 결과가 유지되는지 확인하고, 동일 설치 작업의 동시 실행을 조율한다. 원문과 검토 결과가 달라지거나 일부 객체가 나타나면 실행이 중단돼야 한다.
2. 적용 뒤 새 읽기 트랜잭션으로 `dream_migrations.history`의 순서·ID·체크섬 3개와 기반 스키마·NOLOGIN 역할·RLS를 읽기 검사한다. 승인된 CLI 연결이 있다면 스키마 3 dry-run의 `fromVersion=3`, `applied=0`, `pending=0`으로 9개 카탈로그와 전체 이력을 다시 확인한다. 통신이 끊겨 확정 여부가 불명확하면 재실행 전에 별도 읽기 세션에서 상태를 확인한다.
3. 깨끗한 기반 설치 확인 뒤 같은 소유자로 T358을 적용하는 절차가 이어진다. 현재 PC 작업실과 확인된 백업은 실제 이전 대상 0건이다. 대표 계정 승인, 실제 사용자 자료의 이전, Data API 노출과 앱 설정은 각각 확인이 남았다. [이전 원본 확인](ADMIN-PROJECT-MIGRATION-SOURCE-PREFLIGHT.md) · [기반·조회 적용 순서](ADMIN-PROJECT-PG17-FOUNDATION-PLAN.md)

재현 명령은 `node --conditions=react-server --import tsx tests/postgres/schema3-editor-candidate.pg17.ts`다. 자체 소유 PG17.12에서 클린 상태 정상 롤백, 비슈퍼유저 이관 역할, 대상 OID 불일치, 세 번째 SQL의 본문 변경, 기본 권한에 따른 기대 카탈로그 차이, 정상 커밋, 재실행 거절, 기존 CLI의 `3/0/0`을 확인했다. T358의 설치·A/B 읽기·복귀와 자원 종료까지 종료 코드 0이다. v2·CLI·Session 회귀 126건 통과, 환경 조건부 34건 제외 및 TypeScript·대상 ESLint 통과를 확인했다.

**Master 전달문** · 같은 운영 SQL Editor용 오프라인 생성 후보를 준비했습니다. 고정 1–3의 원문·본문 해시, 단일 트랜잭션·기존 잠금·저널, PG17 카탈로그 및 역할 검증은 유지됩니다. 대시보드 프로젝트 일치와 현재 DB OID·포트가 운영 후보 생성에 추가로 필요합니다. 운영 승인과 실제 자료 이전은 별도 판단입니다.
