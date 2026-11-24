# T340-R 게시 설치 역할 분리 설계 독립 검토

2026-11-19 KST · Codex(Tester) · 설계 `5d5a519` · 대조 `7cbd9da` / `5d579d3` · Master 배정 `msg_d9073cb99f9e`

**판정은 B안의 소유 PG17 구현·검증 착수 가능이다.** 아래 보완을 구현 명세와 합격표에 반영해야 한다. B안 설치 성공, 독립 검증자 권한, 관리형 적용은 미검증이다.

## 고정 근거와 구현 범위

- T338은 소유 bootstrap에서 게시 v1 동시 설치 한 번, DDL 중간 실패 롤백, 최초 이력 보존 및 게시·철회를 확인했다. 설치기는 이력 없이 내부 역할만 있는 상태를 거절한다. B안의 사전 역할 상태와 새 이력 ACL을 수용하려면 별도 버전·manifest 및 상태 검사기가 필요하다. 이미 게시 v1이 있는 대상은 전환 패키지가 준비될 때까지 중단한다. [T338-R](T338-R-ADMIN-PUBLICATION-SQL-INSTALLATION-CANDIDATE-REVIEW.md)
- T339는 대상 DB `CREATE`와 `CREATEROLE`을 함께 가진 제한 로그인도 함수 소유권 이전에서 차단되고, 설치 뒤 제한 검증 계정은 이력 스키마 접근에서 차단됨을 확인했다. 같은 DB의 양성 대조는 bootstrap이었다. 기반 0001~0003 이력과 SQL4 DDL은 게시 v1과 공존했으며, 공식 스키마 4 검사는 `MIGRATION_STATE`였다. SQL5는 PG18 조건의 소스 검증까지다. 이 근거는 새 권한 절차가 필요한 이유를 뒷받침한다. [T339-R](T339-R-ADMIN-PUBLICATION-LIMITED-INSTALLER-REVIEW.md)

## 필수 보완

1. **역할 계획과 관리자의 잔여 권한.** 승인 기록에 설치·검증 로그인, 영속 소유자, 실행 역할의 OID·속성과 관련 멤버·부모·부여자 OID 및 세 멤버십 옵션을 고정한다. 직접 간선과 유효 `SET`·상속 경로를 대조한다. 비슈퍼유저 `CREATEROLE` 발급자에게 자동으로 생기는 관리 간선도 명시한다. 예상 영속 관리 권한과 회수 대상 간선을 구분하고, 예상 밖 간선이나 같은 이름의 새 OID를 거절한다. 내부 상속 두 개는 `INHERIT=true, SET=false, ADMIN=false`로도 기존 게시·공개·RLS가 동작해야 한다. [PostgreSQL 17 역할 속성](https://www.postgresql.org/docs/17/role-attributes.html) · [역할 멤버십](https://www.postgresql.org/docs/17/role-membership.html)
2. **DDL 단계별 실행 주체.** 함수·테이블·이력과 스키마별 최종 NOLOGIN 소유자를 고정하고, 각 `GRANT`·`REVOKE`·소유권 이전을 수행할 현재 역할과 순서를 기록한다. v1은 함수 소유권 이전 직후 ACL을 변경한다. B안 설치자의 임시 간선은 `INHERIT=false`이므로 v1의 실행 순서를 그대로 쓸 경우 그 ACL 변경에 필요한 현재 소유자 권한을 별도로 확보해야 한다. 함수·테이블 소유자의 스키마 `CREATE`와 최종 스키마 소유자의 DB `CREATE`를 따로 검증한다. 소유자 변경 뒤 강제 RLS, `SECURITY DEFINER`의 고정 검색 경로와 실행 권한을 실제 게시 경로에서 다시 확인한다. [ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html) · [ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html) · [ALTER SCHEMA](https://www.postgresql.org/docs/17/sql-alterschema.html)
3. **단계 전체 직렬화와 회수 완료 조건.** 준비부터 권한 회수·검증까지 한 작업만 진행되게 하는 조정 주체와 작업 키를 명시한다. 설치 트랜잭션 잠금은 커밋에서 끝나므로 DB 내 설치 잠금과 단계 전체 조정을 함께 둔다. 클러스터 공용 역할 때문에 같은 역할 집합을 다루는 다른 DB 작업도 조정 범위에 넣는다. 회수 단계는 새 설치 접속을 통제하고 이미 소유자로 전환된 세션까지 종료됐음을 확인한다. 임시 멤버십, DB·스키마의 유효 `CREATE` 및 설치자의 객체 소유권을 최종 상태에서 대조한다. 회수 실패나 조정 주체 중단 뒤에는 새 검증 세션이 상태를 분류할 때까지 런타임을 닫는 적용 지점을 명시한다. 현재 기본 런타임은 비활성이며 이 개방 조건을 구현한 경로는 없다. [PostgreSQL 17 advisory lock](https://www.postgresql.org/docs/17/explicit-locking.html) · [pg_locks](https://www.postgresql.org/docs/17/view-pg-locks.html) · [SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html)
4. **독립 검증과 이력 대조.** 사전에 승인된 대상·계획·영속 카탈로그 계약을 기대값으로 사용한다. 이력의 해시는 현재 카탈로그와 대조하고, 임시 간선 및 DB ACL은 회수 전후의 별도 허용 목록으로 검증한다. 이력 조회 전 객체 유형·소유권·열 권한을 확인한다. 검증 로그인은 TLS와 클러스터 식별자를 실제 조회할 수 있어야 한다. 쓰기·DDL·역할 전환·게시 호출 거절은 `READ ONLY`가 가리는 경우를 피하도록 실제 ACL과 격리 시험의 일반 세션에서도 확인한다. 커밋 응답 유실 뒤 준비 상태, 커밋 후 회수 대기, 최종 완료, 부분 오류를 구별하고 최초 이력을 보존한다. [PostgreSQL 17 SET TRANSACTION](https://www.postgresql.org/docs/17/sql-set-transaction.html)

## PG17 합격표에 추가할 항목

| 시험 | 합격 기준 |
| --- | --- |
| B 정상 흐름과 회수 | `NOCREATEROLE` 설치자, 오직 승인된 OID·간선, 최종 NOLOGIN 소유권 및 이력 한 행. 회수 전 런타임 폐쇄. 회수 후 기존 설치 세션 0, 유효 전환·DDL·영속 소유권 없음. 독립 읽기 검증 뒤 준비→게시→표지→철회 성공. |
| 동시 실행과 부분 실패 | 해시·대상이 다른 계획과 같은 역할을 쓰는 다른 DB 작업 차단. DDL 중간·커밋 응답 유실·회수 중단 후 새 세션으로 상태를 분류. 이력 중복·덮어쓰기 및 권한 재부여 없이 재검증. |
| 기대값과 권한 변동 | 새 역할 OID, 부여자·옵션 변경, 우회 상속, 임시 DB `CREATE` 잔류, 이력 내용 또는 ACL 변경을 거부. 승인된 Foundation 이력·Auth·SQL4 물리 객체 보존. |
| 검증자 실제 권한 | 승인 이력 열과 필수 시스템 식별자는 읽을 수 있고 이력 변경·게시 데이터 조회·DDL·역할 전환·런타임 함수 호출은 거절. 최초 시각·해시 보존 및 시험 리스너·세션 정리. |

관리형 직접 TLS, 클러스터 식별자 읽기, 실제 관리자의 역할 발급·소유권·권한 회수 및 세션 종료, 독립 검증 로그인, 복원 후 OID 재승인은 관리형 판단에 남는다. 이번 검토는 문서·고정 소스·기존 결과를 읽어 대조했다. 새 시험 실행이나 DB·운영·스테이징 변경은 없었다.
