# T258 PostgreSQL 17 스키마 3 카탈로그 비교

2026-11-18 KST · Codes(Backend) · 독립 검수 대기

기준 `5e07360e0834e6fd1c2264172a53ebd6d93f84b6`, 배정 `msg_b630ddc2a438`, 수락 `msg_29d6da21384e`, [T257-R 독립 진단](T257-R-PG17-SCHEMA3-DIAGNOSTIC-REVIEW.md). 합성 PG17.12에서 스키마 3 최초 적용 3건과 재적용 0건을 확인했다. 변조 거절 6건과 PG18.7 기존 회귀 66건이 통과했다.

## 변경 범위

- [v2 카탈로그 검사](../../lib/db/postgres/migration-state-v2.ts)는 실제 연결의 `server_version_num`에서 major 17을 확인하고 최종 요청과 현재 검사 버전이 모두 3일 때 PostgreSQL 17용 기준을 선택한다. 고정 스키마 3 기준에서 `contype='n'` 기대 행만 제거한 불변 기준이다. PG17에서 읽은 실제 카탈로그 행은 그대로 비교한다. 전체 컬럼의 `attnotnull`과 나머지 제약, 관계·정책·ACL·기타 카탈로그, 역할·이력 검사를 모두 유지한다.
- [v2 runner](../../lib/db/postgres/migration-runner-v2.ts)는 카탈로그 검사에 최종 요청 버전을 함께 전달한다. 스키마 4의 적용 중 스키마 3 접두부를 검사할 때 기존 기준을 사용하게 하는 한 줄 변경이다. PG18 등 다른 major와 기존 스키마 4 비교 기준, 스키마 5, 고정 SQL 1~3과 manifest 체크섬, advisory lock·이력·트랜잭션·CLI는 기존 구현을 유지한다.
- [격리 PG17 실행기](../../tests/postgres/run-t258-pg17-schema3-local.ts)를 추가했다. T257 실행기와 최초 실패 증거는 보존했고 같은 실패를 재실행하지 않았다.

## 로컬 검증

```powershell
node --conditions=react-server --import tsx tests/postgres/run-t258-pg17-schema3-local.ts
node tests/postgres/run-versioned-migrations-local.mjs --bin <existing-absolute-pg18-bin>
```

PG17.12 실행은 exit 0이다. 기존 Windows EnterpriseDB 서명 도구 3개의 Authenticode·버전·SHA-256을 확인했다. 시작 전 고유 루프백 포트와 폐기 경로를 기록했다. 연결마다 버전 `170012`, 데이터 경로, 루프백 주소/포트, DB, SQL login과 UTF-8/C를 대조했다. Node의 기존 PostgreSQL·운영 연결 환경값을 제거하고 자식 도구에는 필요한 Windows 환경변수만 전달했다. 검증 DB는 `dream_test_t258`, migration role은 합성 superuser `t258_bootstrap`이다. 로컬 `auth.users`에 합성 UUID 2개를 준비했다.

| PG17.12 항목 | 결과 |
| --- | --- |
| 빈 DB dry-run | `fromVersion=null, applied=0, pending=3`. 사전 초기 상태와 실제 확인 결과 일치. |
| 최초 스키마 3 적용 | `fromVersion=null, applied=3, pending=0`. 고정 ID·SHA-256의 이력 3행, 두 스키마, 두 runtime 역할, Auth UUID 두 개 확인. |
| 스키마 3 재적용 | `fromVersion=3, applied=0, pending=0`. 이력 ID·체크섬·`applied_at`·`xmin`과 나머지 스냅숏 일치. |
| 스키마 4 최초 적용과 3→4 | 둘 다 `MIGRATION_STATE`. 빈 DB에서는 이력 INSERT 3회 뒤 접두부 검사에서 중단, SQL 4 실행 0회. 3→4 실패 뒤 완료된 스키마 3과 이력 보존. |
| 컬럼·제약·정책·권한·역할 변조 | 각각 프로젝트 제목의 `NOT NULL` 제거, aspect CHECK 제거, RLS 정책식 변경, 테이블 ACL 변경, API 역할 플래그 변경을 실제 폐기 DB에서 수행했다. 모두 `MIGRATION_STATE`. |
| 이력 변조 | 이력 한 행의 체크섬 변경 뒤 `MIGRATION_HISTORY`. |
| 순차 롤백 | 각 변조는 별도 트랜잭션으로 격리하고 실제 `ROLLBACK` 응답을 확인했다. 각각의 새 runner dry-run은 `fromVersion=3, applied=0, pending=0`을 반환했고, 이력·객체·역할·합성 Auth 스냅숏이 원래 상태와 일치했다. |

PG18.7에서는 기존 B23 runner 회귀 **66/66, skip 0, exit 0**으로 스키마 3·4 및 3→4, 트랜잭션·동시성·이력·롤백 경로를 확인했다. 변경 코드와 진단 실행기 범위의 strict TypeScript 및 ESLint 경고 0 검사도 통과했다.

PG17 postmaster PID 29800과 루프백 포트 60341, PG18 PID 41108과 포트 59592가 종료됐다. PG17 실행기 정리에서 소유 PID·리스너·PID 파일·임시 암호 파일 부재와 `ECONNREFUSED`를 확인했다. PG18 기존 실행기는 PID 파일과 리스너 부재를 기록했다. 두 PID와 포트에 해당하는 프로세스·리스너의 부재를 별도 Windows 조회로 다시 확인했다.

## 증거

| 로컬 파일 | SHA-256 |
| --- | --- |
| `tmp/t258-pg17-a9f47f79-76a7-42c6-9df5-fc5cc0318894/preflight.json` | `d382cd5738bf8ac351dc5e7e2fd47232b111fae3371e78f8b70a9b607437fb13` |
| 같은 경로의 `result.json` | `3eea22b4b8227df6d50da2d33588f3e1d03a86915f079b36d73dfec2affdcbd9` |
| 같은 경로의 `cleanup.json` | `5a82b7fdfb8d1ac9a069a63222d76e6e798a445b52e51eaab2fa4c2eb56a4060` |
| `tmp/b23-postgres-4b25e5e3-f711-4126-a9fc-d0d8d8414b0e/tests.log` | `f045a0c410b76f6cb90d57b993d63eeb36ef5ddfe2a68716083148733ff92a29` |
| 같은 경로의 `cleanup-safe.json` | `3c2548c724096e9e90df0355a4f7dcf61708bc0a9ff23a67cf9570f4941023db` |

이번 작업은 합성 superuser를 사용한 카탈로그 비교와 트랜잭션 검증이다. 비슈퍼유저 이관 역할, API login과 두 계정의 실제 읽기, 관리형 CA·양 구간 TLS, Supabase/Vercel과 운영 배포는 이번에 검증하지 않았다. `DEC-SSL-01`은 결정 대기 상태다.

Master 전달문 — T258의 PG17 스키마 3 비교 보완과 자체 검증을 완료했습니다. 합성 PG17.12 최초 적용 3·재적용 0·이력 보존, 컬럼·CHECK·RLS·ACL·역할·이력 변조 6건 거절과 각각 롤백, 스키마 4 기존 거절을 확인했습니다. PG18.7 기존 66/66 통과와 소유 프로세스 종료를 확인했습니다. 독립 검수에서 고정 코드 및 보존 증거를 대조할 수 있습니다.
