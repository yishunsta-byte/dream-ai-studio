# T257 격리 PostgreSQL 17 스키마 3 진단

2026-11-18 KST · Codes(Backend) · 결과 독립 검수 대기

**PostgreSQL 17.12에서 고정 v2의 최종 카탈로그 비교 실패를 재현했다.** 빈 DB dry-run은 대기 3건으로 성공했다. 실제 apply는 고정 SQL 1~3과 이력 3행을 같은 트랜잭션에서 실행한 뒤 `MIGRATION_STATE`로 거부하고 롤백했다. 유일한 카탈로그 차이는 PG18.7 기준의 테이블 `NOT NULL` 제약 행 156개다. PG17의 컬럼 `attnotnull=true` 156개는 컬럼 정의 전체와 함께 일치했다. 최초 상태 복원과 모든 시작 시도의 종료를 확인했다.

기준 `5e07360e0834e6fd1c2264172a53ebd6d93f84b6`, [T256-R](T256-R-MANAGED-PG17-PREFLIGHT-REVIEW.md), 배정 `msg_55d5826d7589`, 수락 `msg_6928f6f6c942`. [진단 실행기](../../tests/postgres/run-t257-pg17-schema3-diagnostic.ts)와 이 보고서만 추가했다. SQL 1~3, v2 runner·카탈로그 비교기, CLI의 기준 커밋 대비 diff는 비어 있다.

## 실행 환경과 결과

- Windows Node 26.13.0에서 `node --conditions=react-server --import tsx tests/postgres/run-t257-pg17-schema3-diagnostic.ts`를 실행했다. TypeScript strict 범위 검사와 ESLint 경고 0 검사도 통과했다. 실행기는 기준 커밋의 연결·대상·manifest·runner·상태 비교 등 8개 소스 Git blob과 기존 loader의 SQL 1~3 SHA-256을 확인한다.
- 기존 `.tools/t253-postgres-17.12/pgsql/bin`의 `postgres.exe`, `initdb.exe`, `pg_ctl.exe`에 대해 Authenticode Valid/EnterpriseDB Corporation 서명, 파일 SHA-256, 세 도구의 17.12 버전을 확인했다. 고유 `tmp` 경로와 루프백 포트를 시작 전에 기록했다. 자식 도구 환경에는 필요한 Windows 변수만 전달했다. Node에서도 기존 `PG*` 및 운영 연결 변수를 제거하고 생성한 합성 SCRAM 자격을 메모리로만 연결에 전달했다. 초기화용 암호 파일은 삭제 및 부재를 확인했다.
- 완료 실행의 PID는 **73844**, 리스너는 **127.0.0.1:52118**이다. 시작 후 PID 파일, Windows 실행 파일·`-D` 경로, 리스너 소유 PID를 대조했다. SQL 연결마다 `server_version_num=170012`, `data_directory`, 루프백 주소/포트, DB, session/current role과 UTF-8/C를 대조했다. 서버 준비용 DB와 시험 DB는 각각 `postgres`, `dream_test_t257`이며 합성 migration role은 superuser `t257_bootstrap`이다. 두 합성 UUID를 `auth.users(id uuid PRIMARY KEY)`에 넣었다.

| 단계 | 관측 결과 |
| --- | --- |
| 초기 상태와 고정 v2 dry-run | `fromVersion=null`, `applied=0`, `pending=3`. 전후 새 읽기 전용 접속에서 `dream`, `dream_migrations`, history, 예약 역할 4개, 관련 관계·함수 모두 부재. Auth UUID 2개 보존. |
| 고정 v2 apply 1회 | 반환 코드 `MIGRATION_STATE`. 서버 로그에 READ COMMITTED 시작 1회, advisory lock 1회, 고정 이력 INSERT 3회, 마지막 카탈로그 조회 도달, ROLLBACK 1회, COMMIT 0회, 해당 세션 SQL ERROR 0회. 새 읽기 전용 접속에서 초기 상태와 일치. |
| 카탈로그 증거용 별도 트랜잭션 1회 | 고정 runner에서 읽은 저널 DDL과 loader로 검증한 SQL 1~3을 같은 순서로 실행했다. 트랜잭션 안에서 스키마 2개, 관계 109개(인덱스 포함), 함수 3개, NOLOGIN 역할 2개와 세 이력 ID·체크섬을 확인했다. 제품의 읽기 함수와 상태 검사기를 그대로 호출해 전체 카탈로그를 수집하고 `MIGRATION_STATE`를 확인했다. 명시 ROLLBACK 후 새 읽기 전용 접속에서 초기 상태와 일치했다. |
| 최종 종료 | 진단 실행기 exit 0. `pg_ctl -m fast -w stop` 성공, PostgreSQL shutdown 완료 로그, PID·리스너·PID 파일·임시 암호 파일 부재 및 연결 `ECONNREFUSED`를 확인했다. 이 exit 0은 실패 재현·정리의 완료다. |

## 실제 비교 차이

| 분류 | PG18.7 기준 | PG17.12 관측 | 차이 |
| --- | ---: | ---: | --- |
| 스키마 / 관계 / 컬럼 | 2 / 19 / 217 | 2 / 19 / 217 | 0 |
| 제약 | 330 | 174 | `contype='n'` 156개만 누락, 추가 0개 |
| 인덱스 / 정책 / 트리거 | 90 / 36 / 18 | 90 / 36 / 18 | 0 |
| 함수 / 타입 | 3 / 3 | 3 / 3 | 0 |

비교는 제품과 같은 행 정규화 후 중복을 보존한 양방향 차집합을 계산했다. 컬럼 217개와 `attnotnull=true` 156개가 모두 같은 행으로 대조됐다. 174개 나머지 제약도 일치했다. 따라서 이 환경에서 고정 비교를 막은 이유는 SQL 구문·실행 오류 없이 생기는 PG17의 테이블 `NOT NULL` 카탈로그 표현 차이다.

## 시작 시도와 정리 증거

| 시도 | 결과 및 종료 확인 |
| --- | --- |
| `t257-pg17-d4cf51cb-4c24-40ea-b190-4457d0df7298` | Windows 관리자 토큰으로 `postgres.exe`를 직접 시작해 PostgreSQL이 종료 코드 1로 거절했다. SQL 미실행. PID 69664, 포트 58142, PID 파일 모두 부재와 연결 거절을 확인했다. |
| `t257-pg17-323d959c-5240-4b3b-a532-fbba98a7ca73` | `pg_ctl`로 시작했으나 Windows 프로세스의 `-D`가 슬래시로 표시되어 최초 프로세스 확인과 자동 정리 가드가 중단됐다. SQL 미실행. 첫 실패 파일을 보존한 채 별도 PowerShell에서 구분자를 정규화하고, 정확한 실행 파일·`-D`·PID 파일·루프백 리스너를 확인한 후 **PID 69320의 자기 클러스터만** `pg_ctl`로 종료했다. `cleanup-recovery.json`에 PID 69320·포트 60798·PID 파일 부재와 연결 거절을 기록했다. 실행기는 이후 경로 구분자를 정규화하고 시작 출력에 파일 핸들을 사용하도록 수정했다. |
| `t257-pg17-c8870a41-fa40-4d7f-ae0b-e95e562faaf5` | 위의 완료 실행. 세 PID와 포트는 실행 후 별도 Windows 조회에서도 모두 부재했다. |

완료 실행의 근거는 `tmp/t257-pg17-c8870a41-fa40-4d7f-ae0b-e95e562faaf5/`에 보존했다.

| 파일 | SHA-256 |
| --- | --- |
| `preflight.json` | `1bb4dcbd76ba6db9443acff0c519a93e8adbdaeb3f3fdcc6c3cf3ffbde6da45f` |
| `dry-run.json` | `07e8553436e578239493105b062fb853d751d4addf1fc71b39ab909d48b803ee` |
| `fixed-apply.json` | `829b97139fb8d680b1f82cde0a2d5a3e0df4e8f13c6051a87990b0f8972eaa13` |
| `catalog.json` | `a937ad9dea9e681dc091043b62adf9ed1ec290a26f346af44dab4390beb18d20` |
| `cleanup.json` | `25a44bca7be009a0e788dffad836d80d90067229fff01395aad68b22b2cc4dad` |
| 진단 실행기 | `8cf07494fb504affbeb0f0709107c9a0caec0a8c8a50e4b4bd333c710aa1d4e3` |

## 다음 최소 변경안

v2 스키마 3에만 PostgreSQL 17 비교 기준을 추가하는 안을 제안한다. **고정 PG18 기준에서 스키마 3의 테이블 `contype='n'` 기대 행만 제외한 파생 기준**을 PG17에 사용하고, 전체 `pg_attribute` 비교, 나머지 174개 제약, 나머지 모든 카탈로그 비교, 역할·이력 검증을 유지한다. 이번 실측에서는 NULL 금지의 컬럼 측 표현과 제약을 제외한 카탈로그가 전부 일치했으므로 기대값을 실행 대상에서 가져올 필요가 없다. PG18의 전체 비교와 PG17에서 스키마 4/5의 기존 미수용 경계를 유지한다.

후속 검수는 폐기용 PG17.12의 fresh apply 3건·reapply 0건, `NOT NULL` 제거·다른 제약/ACL/RLS 변경·이력 차이의 거부와 PG18 기존 회귀를 포함한다. 합성 superuser를 사용한 이번 판정과 비슈퍼유저 migration owner·제한 API login·두 계정 RLS 통합·관리형 TLS는 각각 독립 검증 대상으로 남는다. 운영 접근·변경·배포는 없었고 `DEC-SSL-01`은 결정 대기다.

Master 전달문 — T257 완료, 독립 검수 대기. 고정 5e07360 v2 schema 3의 PG17.12 dry-run은 0 적용·3 대기, 실제 apply는 최종 카탈로그 비교에서 MIGRATION_STATE가 나와 ROLLBACK됐습니다. 9개 분류의 유일한 차이는 PG18 제약 행 156개이며 PG17 컬럼 NOT NULL 156개와 나머지 제약 174개는 일치했습니다. 신규 진단 실행기와 보고서만 작성했습니다. 최초 두 Windows 시작 단계 실패와 종료 증거를 보존했고 최종 진단은 exit 0·자기 PID/포트 부재를 확인했습니다. 다음 최소 변경은 PG17 스키마 3의 기대 제약 행만 좁게 조정하는 비교 기준입니다.
