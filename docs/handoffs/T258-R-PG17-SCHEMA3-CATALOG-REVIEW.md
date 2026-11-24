# T258-R PostgreSQL 17 스키마 3 이관 보완 독립 검수

**판정. `5405938`의 로컬 합성 스키마 3 비교 보완을 수용한다.** PG17.12에서 dry-run 0/3, 최초 적용 3, 재적용 0과 이력 보존을 보존 원본으로 확인했다. 변형 6건이 거절되고 롤백됐으며 PG17 스키마 4 차단과 PG18.7 회귀 66건의 통과 기록도 일치한다. 이 범위에 대해 같은 격리 시험을 다시 실행할 필요는 없다. 비슈퍼유저 이관, 제한 API 로그인과 A/B 실제 조회, 관리형 CA·TLS는 후속 검증 대상이다.

대상은 `54059387c84566163d507408459bd1a9791c37b6`, 비교 기준은 `5e07360e0834e6fd1c2264172a53ebd6d93f84b6`이다. Orca 배정 `msg_d7233985c46d`의 파일 충돌 여부를 확인했고 `msg_41ea2365ef46`으로 수락했다. 고정 [작업자 보고](T258-PG17-SCHEMA3-CATALOG.md)와 PG17·PG18의 보존 파일 SHA-256 5개를 대조했다. 이번에는 DB를 다시 실행하거나 접속하지 않았다.

## 고정 코드와 비교 경계

- 두 커밋에서 SQL 1~4, manifest, CLI, 대상 검사, 기존 v1 runner, v3 카탈로그와 B23 스위트·실행기 등 11개 파일이 동일하다. v2 카탈로그 조회 SQL과 PG18 스키마 3·4 고정 값도 동일하다. v2 runner의 변경은 현재 검사 버전과 최종 요청 버전을 함께 전달하는 한 줄이다. 잠금, 저널, 트랜잭션과 rollback 경로는 그대로다. [v2 runner](../../lib/db/postgres/migration-runner-v2.ts) · [manifest](../../lib/db/postgres/migration-manifest-v2.ts)
- 실제 연결의 `current_setting('server_version_num')::int`에서 계산한 major가 17이고 **검사 버전과 최종 요청이 모두 스키마 3**일 때만 파생 기준을 쓴다. 고정 스키마 3의 기대 제약 행에서 `contype='n'`을 제외한다. 조회된 행은 필터링하지 않고 전체 카탈로그를 비교한다. 스키마 4 요청이 내부에서 스키마 3 접두부를 검사해도 PG17 파생 기준을 선택하지 않는다. 이력과 역할 검사도 비교 뒤 그대로 이어진다. [v2 상태 검사](../../lib/db/postgres/migration-state-v2.ts)
- 고정 descriptor에서 제외되는 행을 독립적으로 계산했다. 156개 전부 테이블 `NOT NULL` 표현으로 기존 T257 원본 PG17 카탈로그의 `attnotnull=true` 컬럼과 일대일 대응한다. 기대 제약의 나머지 174개와 전체 217개 컬럼을 포함한 9개 분류는 T257 PG17 원시 관측과 일치했다. [T257-R 독립 진단](T257-R-PG17-SCHEMA3-DIAGNOSTIC-REVIEW.md)

## PG17.12 보존 원본 대조

`tmp/t258-pg17-a9f47f79-76a7-42c6-9df5-fc5cc0318894/`의 `result.json`과 원본 `postgres.log`를 backend PID·application name별로 대조했다. 보존 연결 식별 기록은 `170012`, UTF-8/C, 루프백, 합성 DB 및 superuser를 보여 준다. 기록된 PostgreSQL 도구 3개의 SHA-256도 현 로컬 파일과 일치했다.

| 항목 | 독립 대조 결과 |
| --- | --- |
| 빈 DB dry-run | `fromVersion=null`, `applied=0`, `pending=3`. 읽기 전용 backend `71292`에는 카탈로그 조회와 COMMIT만 있고 이력·DDL 쓰기는 없었다. 초기 상태에는 앱 스키마·저널·예약 역할이 없고 합성 Auth 두 행이 있었다. |
| PG17 스키마 4 최초 적용 차단 | backend `43848`은 advisory lock을 잡고 SQL 1~3과 이력 INSERT 3회 뒤 접두부 검사에서 `MIGRATION_STATE`를 냈다. SQL 4 DDL 0, COMMIT 0, ROLLBACK 1. 빈 상태와 합성 Auth 두 행이 복구됐다. |
| PG17 스키마 3 최초 적용 | backend `70924`에서 고정 저널 DDL, SQL 1~3과 이력 INSERT 3회, 카탈로그·이력·역할 검사 뒤 COMMIT 1. 로그의 SQL 1~3 본문을 다시 조립한 SHA-256이 고정 로더 결과와 일치했다. `fromVersion=null`, `applied=3`, `pending=0`. |
| PG17 스키마 3 재적용 | backend `76052`에서 advisory lock과 검사 뒤 COMMIT 1, DDL·이력 쓰기 0. `fromVersion=3`, `applied=0`, `pending=0`. 최초·재적용 결과의 이력 ID·checksum·`applied_at`·`xmin`이 일치했다. 세 행 모두 `2026-11-18 21:54:34.488803+09`, `xmin=743`이었다. |
| PG17 3→4 차단 | backend `66092`는 기존 상태 비교에서 `MIGRATION_STATE`, SQL 4 DDL과 이력 쓰기 0, COMMIT 0, ROLLBACK 1. 기존 스키마 3 스냅숏과 이력은 동일했다. |

6개 변형은 **각 미커밋 트랜잭션 안에서 제품 상태 검사기를 호출**한 것이다. 독립 로그에서 각 변형 명령과 최종 카탈로그 검사, ROLLBACK 1회와 COMMIT 0회를 연결했다. 이어진 별도 backend 6개의 v2 읽기 전용 dry-run은 각각 `3 / 0 / 0`으로 회복됐다.

| 변형 | 변형 backend | 검사 결과 | 롤백 후 dry-run backend |
| --- | ---: | --- | ---: |
| 프로젝트 제목 `NOT NULL` 제거 | `71728` | `MIGRATION_STATE` | `62324` |
| aspect CHECK 제거 | `62584` | `MIGRATION_STATE` | `63160` |
| RLS `owner_access` 변경 | `56768` | `MIGRATION_STATE` | `24480` |
| 테이블 ACL에 TRUNCATE 추가 | `3264` | `MIGRATION_STATE` | `77080` |
| API 역할 INHERIT 변경 | `2464` | `MIGRATION_STATE` | `38308` |
| 이력 행 checksum 변경 | `24320` | `MIGRATION_HISTORY` | `39692` |

이력 ID·checksum·시각·`xmin`을 읽은 독립 snapshot SQL은 로그에 9회 있었다. 실행기는 별도 접속의 값을 최초 적용 스냅숏과 비교해 단언하며, 결과 JSON에는 여러 성공 항목에 공통 스냅숏이 저장된다. 원시 SQL 로그에는 조회한 필드와 시점이 있고 반환값의 독립 덤프는 없다. 따라서 보존 결과, 단언과 쓰기 없는 원본 로그를 함께 근거로 삼았다.

## PG18 회귀와 로컬 종료

- `tmp/b23-postgres-4b25e5e3-f711-4126-a9fc-d0d8d8414b0e/`의 `version.txt`와 실제 서버 시작 로그가 PG18.7을 가리킨다. `tests.log`에는 1파일 **66/66 통과**, 실패·skip 표시 없음이 기록됐다. native advisory lock 관측은 5레코드다. 기존 스위트 소스의 스키마 3·4, 3→4 및 원자성 경로는 기준 대비 동일했다.
- PG17의 PID `29800`, 포트 `60341`과 PG18의 PID `41108`, 포트 `59592`를 시작·리스너·종료 증거로 대조했다. 두 원본 서버 로그에 정상 shutdown이 있고 두 저장 정리 기록 및 현재 PID/리스너 목록에서 모두 부재였다. 두 `postmaster.pid`와 PG17 초기화 임시 파일은 없었다. PG17의 `ECONNREFUSED`는 저장 기록이며 이번에 연결 시도하지 않았다. PG18의 기존 합성 fixture 파일은 증거 경로에 남아 있으며 파일명과 존재 여부만 확인했다.
- 실행 기록에는 종료 증거와 통과 결과가 있지만 부모 프로세스의 별도 종료 코드 영수증이나 당시 소스 blob 목록은 없다. 소스 검토는 고정 커밋을, 실행 검토는 그 커밋의 보고서가 해시로 묶은 기존 증거를 사용했다. 동일 실행을 재현한 것으로 표기하지 않는다.

## Master 전달용

> T258-R 독립 오프라인 검수 완료. 5405938의 PG17 schema 3 기대 `NOT NULL` 행 156개만 조정하는 비교를 수용합니다. 고정 SQL·PG18 기준과 실제 컬럼·카탈로그·역할·이력 검사는 유지됩니다. 보존 원본의 PG17.12 dry-run 0/3·최초 3·재적용 0과 이력 checksum·시각·xmin, 변형 6건의 거절·롤백, 스키마 4 최초/업그레이드 차단과 PG18.7 66/66, 두 소유 서버 종료를 대조했습니다. 동일 로컬 시험 재실행은 이 판정에 필요하지 않습니다. 비슈퍼유저·제한 API 로그인·A/B 읽기·관리형 TLS는 별도입니다. 결과는 `docs/handoffs/T258-R-PG17-SCHEMA3-CATALOG-REVIEW.md`입니다.
