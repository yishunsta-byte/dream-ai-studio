# T257-R PostgreSQL 17 스키마 3 진단 독립 검수

**판정. 격리 PG17.12의 실패 재현과 종료 증거를 수용한다.** 고정 v2는 dry-run에서 3건을 대기 상태로 반환했고, 실제 apply에서는 SQL 1~3과 이력 3행을 한 트랜잭션에 처리한 다음 카탈로그 비교에서 `MIGRATION_STATE`를 반환했다. apply 세션에는 COMMIT이 없었고 ROLLBACK 후 초기 객체·역할 및 합성 Auth UUID 두 행이 보존됐다. PG17 스키마 3 정상 적용은 버전별 카탈로그 비교 보완과 별도 성공 시험이 필요하다.

기준은 `5e07360e0834e6fd1c2264172a53ebd6d93f84b6`과 Orca 배정 `msg_57ffa2f389c9`다. 보고서와 실행기, 지정 결과 경로를 확인하고 `msg_7f809a761030`으로 수락했다. 이번 검수는 보존 파일과 로컬 OS 상태 조회로 수행했다. PostgreSQL 명령, DB 접속 및 외부 접속은 실행하지 않았다.

## 출처와 무결성

- [작업자 보고](T257-PG17-SCHEMA3-DIAGNOSTIC.md)의 SHA-256은 `1f3805d49704c3bdc4fc0714d425ad94ff2e34e23c98415ca1f5adbc7f655256`이다. [진단 실행기](../../tests/postgres/run-t257-pg17-schema3-diagnostic.ts)의 SHA-256은 `8cf07494fb504affbeb0f0709107c9a0caec0a8c8a50e4b4bd333c710aa1d4e3`이며 보고의 고정값과 일치했다.
- 완료 실행 디렉터리 `tmp/t257-pg17-c8870a41-fa40-4d7f-ae0b-e95e562faaf5/`의 `preflight.json`, `dry-run.json`, `fixed-apply.json`, `catalog.json`, `cleanup.json` SHA-256은 보고에 기재한 5개 값과 모두 일치했다. preflight가 고정한 제품 Git blob 8개를 기준 커밋과 작업 트리 양쪽에서 확인했다. SQL 1~3 본문은 로더와 같은 CRLF→LF 규칙으로 계산해 manifest·dry-run·witness 이력과 대조했다. 제품 CLI와 마이그레이션 소스의 기준 커밋 대비 diff는 비어 있었다.
- `postgres.exe`, `initdb.exe`, `pg_ctl.exe`의 파일 SHA-256은 저장된 preflight 값과 일치했다. 서명 유효성은 기존 `Authenticode` 결과의 증거로 받아들였으며 이번에 다시 조회하지 않았다. 서버 증거에는 `server_version_num=170012`, UTF-8/C, 루프백 `127.0.0.1:52118`, 합성 DB `dream_test_t257` 및 합성 superuser가 기록돼 있다.

## 트랜잭션과 초기 상태

집계 JSON과 별도로 원본 `postgres.log`를 backend PID와 application name별로 나눴다. apply와 별도 witness에서 로그의 여러 줄 SQL을 복원해 고정 로더가 잘라낸 SQL 본문 3개와 해시를 비교했다. 두 세션의 저널 DDL도 고정 v2에서 추출한 문장과 같았다.

| 세션 | 독립 대조 결과 |
| --- | --- |
| 고정 v2 dry-run · backend `76176` | `REPEATABLE READ READ ONLY`, advisory lock·DDL·이력 INSERT 0, 읽기 전용 COMMIT 1. `fromVersion=null`, `pending=3`, `applied=0`. 별도 읽기 접속의 초기 상태와 dry-run 후 상태가 같았다. |
| 고정 v2 apply · backend `71076` | `READ COMMITTED` 1회, advisory lock 1회. 저널 DDL 뒤 고정 SQL 1→2→3과 각 이력 INSERT 3회가 같은 세션에 있었다. 최종 카탈로그의 제약 조회와 마지막 타입 조회에 도달했다. 저장된 결과는 `MIGRATION_STATE`, 해당 세션의 SQL ERROR 0, COMMIT 0, ROLLBACK 1. |
| 별도 카탈로그 witness · backend `61672` | 고정 저널 DDL과 SQL 1~3을 다시 대조했다. 트랜잭션 안에서 고정 이력 ID·checksum 3행, 두 스키마 및 `dream_api`·`dream_worker`를 확인했다. witness에서 카탈로그를 읽고 ROLLBACK했고 COMMIT은 없었다. |

각 단계 뒤의 **새 읽기 전용 접속** 기록을 초기 스냅숏과 비교했다. `dream`, `dream_migrations`, history, 예약 역할 4개, 관련 관계와 함수는 모두 부재했고, 합성 `auth.users` UUID 두 행은 그대로였다. 여기서 증명된 원자성은 카탈로그 비교 단계의 통제된 거절과 정상 롤백이다. SQL 2 중단이나 COMMIT 응답 유실을 PG17에서 시험한 증거는 이번 기록에 없다.

## 카탈로그 차이 독립 재계산

제품의 `complete3` 고정 값과 저장된 `catalog.json` 원시 `actual` 행을 사용했다. 작성자의 집계값을 입력으로 쓰지 않고 객체 키를 정렬해 행을 비교하고, 중복 행을 보존한 양방향 차이를 계산했다.

| 카탈로그 | 기준 / PG17 | 기준에만 있음 / PG17에만 있음 |
| --- | ---: | ---: |
| 스키마 · 관계 · 컬럼 | 2 / 2 · 19 / 19 · 217 / 217 | 0 / 0 |
| 제약 | 330 / 174 | 156 / 0 |
| 인덱스 · 정책 · 트리거 | 90 / 90 · 36 / 36 · 18 / 18 | 0 / 0 |
| 함수 · 타입 | 3 / 3 · 3 / 3 | 0 / 0 |

누락된 156개는 모두 `contype='n'`, `convalidated=true`인 테이블 `NOT NULL` 제약 행이었다. 누락 행의 스키마·테이블·컬럼을 PG17의 `attnotnull=true` 컬럼 156개와 일대일 대조했다. 이 대조에서는 `"position"`처럼 인용된 SQL 식별자의 따옴표를 해제했고, 카탈로그 행 자체의 비교는 원래 값을 유지했다. 217개 컬럼의 나머지 속성과 174개 제약도 일치했다. 따라서 **이번 PG17.12 UTF-8/C 합성 스키마 3 관측**에서는 `NOT NULL` 의무가 사라진 정황 없이 카탈로그 표현만 달랐다.

## 시작 실패 2건과 종료

| 시도 | 관측 근거와 판정 |
| --- | --- |
| `d4cf51cb…` · PID `69664` · 포트 `58142` | `postgres.log`의 관리자 권한 실행 거절, start assertion, 자식 exit 1, SQL 로그 0건을 확인했다. 저장 `cleanup.json`은 PID 및 리스너 부재와 `ECONNREFUSED`를 기록한다. |
| `323d959c…` · PID `69320` · 포트 `60798` | 서버는 준비됐으나 PID 소유권 assertion과 최초 정리 가드가 실패했다. `postmaster.opts`의 `/` 표기 `-D` 경로와 `spawn.json`의 Windows 경로는 같은 소유 데이터 디렉터리로 해석됐다. SQL 로그 0건이었다. 독립 복구 기록에는 실행 파일·데이터 경로 대조, PID·리스너·PID 파일 부재와 `ECONNREFUSED`가 있고 서버 로그에도 해당 PID의 fast shutdown 완료가 있다. 초기 정리 실패 기록을 보존했다. |
| `c8870a41…` · PID `73844` · 포트 `52118` | PID·루프백 리스너 소유 기록, `pg_ctl` 종료 출력, 해당 PID의 shutdown 완료, `cleanup.json`의 PID·리스너·PID 파일·임시 암호 파일 부재와 `ECONNREFUSED`를 대조했다. 작업자 보고의 진단 exit 0은 실패 재현을 끝냈다는 뜻이다. 보존 파일에는 진단 실행기 부모 프로세스의 별도 종료 코드 영수증이 없었으므로 0 자체는 작업자 기록으로 구분한다. |

검수 시점의 Windows 프로세스 목록과 TCP 리스너는 위 PID 3개와 포트 3개에 해당하는 항목이 없었다. 세 데이터 경로의 `postmaster.pid`와 `init-password.txt`도 모두 부재했다. 포트 연결 시도는 하지 않았으며 연결 거절은 보존 증거에서 읽었다. 폐기 데이터 디렉터리와 로그는 증거로 남아 있다.

## 다음 최소 변경과 재검수

1. **v2의 PostgreSQL 17 스키마 3 예상 카탈로그만 보완한다.** 실제 major 17과 요청 스키마 3을 명시 판별하고, 고정 PG18.7 스키마 3 기준에서 관측된 테이블 `contype='n'` 기대 행만 제외한 별도 불변 비교값을 사용한다. 관측 행은 그대로 검사하고, 전체 컬럼과 `attnotnull`, 174개 제약, 인덱스·정책·ACL·역할·이력 비교를 유지한다. SQL 1~3·저널·트랜잭션·CLI 해시의 변경은 이 차이를 해결하는 데 필요하지 않다. PG18 기준은 유지하고 PG17 스키마 4/5나 다른 major 지원을 함께 넓히지 않는다.
2. 이번 관측만으로 비교 보완에 착수할 수 있다. 같은 고정 버전을 한 번 더 실패시키는 실행은 선행조건이 아니다. 수정본은 별도 폐기용 PG17.12에서 실제 fresh apply 3건, reapply 0건과 기존 이력 보존을 검증해야 한다. 컬럼 `NOT NULL` 제거, 다른 제약·RLS/ACL 변경, 이력 불일치가 여전히 거절되고 PG18 기존 회귀가 통과해야 한다. 진단 실행기를 재사용하면 `NOT NULL` 값/개수에 더해 **나머지 분류의 누락과 추가가 모두 0이며 `contype='n'`만 빠진다**는 조건을 실행기에서 직접 단언할 것을 권고한다. 현 실행기가 이 조건을 저장하므로 이번에는 오프라인으로 확인할 수 있었지만 0 종료만으로는 이를 강제하지 않는다.
3. 이번 진단은 합성 superuser 범위다. CREATEROLE을 가진 비슈퍼유저 migration owner, 제한 API 로그인과 재적용, A/B RLS 및 관리형 CA/TLS는 후속 증거가 필요하다. 특히 이번 `MIGRATION_STATE`는 역할 검사보다 앞선 카탈로그에서 발생했으므로 역할 계약 수용으로 해석하지 않는다. 관리형 이관 및 `DEC-SSL-01`은 별도 대기다.

## Master 전달용

> T257-R 오프라인 독립 검수 완료. 5e07360과 러너, 보존 증거의 해시를 대조했습니다. 고정 apply의 SQL 1~3 및 이력 3행, 최종 검사 도달, MIGRATION_STATE, COMMIT 0·ROLLBACK 1과 초기 객체/역할/Auth 보존을 원본 로그로 확인했습니다. 9개 카탈로그 분류의 유일한 차이는 PG18.7의 NOT NULL 제약 행 156개였고, PG17의 attnotnull 컬럼 156개는 모두 일치했습니다. 시작 실패 2건의 기록과 종료, 완료 PID/포트/파일 부재를 확인했습니다. 다음 최소 변경은 PG17·스키마 3의 기대 제약 행만 좁게 조정하는 비교 기준입니다. 동일 실패의 재실행은 선행조건이 아니며 수정 뒤 fresh/reapply 및 거부 회귀가 필요합니다. 보고서 `docs/handoffs/T257-R-PG17-SCHEMA3-DIAGNOSTIC-REVIEW.md`를 추가했습니다.
