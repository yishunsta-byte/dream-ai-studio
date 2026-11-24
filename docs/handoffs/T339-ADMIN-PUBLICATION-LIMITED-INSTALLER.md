# T339 게시 SQL 제한 설치 역할과 기반 공존 검증

2026-11-19 KST · Codes(Backend) · 소스 기준 `7cbd9da` · Master 배정 `msg_27bd7de93020` · 실행기 변경 승인 `msg_cc92a765fdf6`

**판정은 제한 설치 역할 차단이다.** 소유 PG17.12의 TLS 연결에서 대상 DB의 `CREATE`와 `CREATEROLE`을 모두 가진 비슈퍼유저도 게시 함수의 소유권 이전을 통과하지 못했다. 권한을 확대하지 않고 롤백과 기존 상태 보존을 확인했다. 같은 격리 DB에서 시험용 부트스트랩으로는 기반 SQL 0001~0004와 게시 SQL을 물리적으로 공존시켰으며 두 이력을 분리해 읽었다. 이 결과는 관리형 스테이징에서의 적용 승인을 의미하지 않는다. [게시 설치 후보](../../lib/db/postgres/publication/0001_publication.sql) · [설치 코드](../../lib/db/postgres/publication/installation.ts)

## 제한 역할에서 관측한 결과

세 로그인은 `NOSUPERUSER`, `NOINHERIT`, `NOBYPASSRLS`, `NOCREATEDB`, `NOREPLICATION`으로 별도 생성했다. PostgreSQL의 `createrole_self_grant` 기본값은 비어 있었고 실제 접속의 TLS는 모두 `true`였다. 세 로그인 모두 빈 게시 상태를 읽기 검증했고, 설치는 아래와 같이 `42501`에서 차단됐다.

| 초기 역할 권한 | 실제 차단 지점 | 결과 |
| --- | --- | --- |
| 대상 DB `CREATE`만 | 첫 게시 역할을 생성할 권한 없음 | 게시 스키마·역할·이력 없음 |
| `CREATEROLE`만 | 대상 DB 안의 게시 스키마 생성 권한 없음 | 먼저 생성한 역할까지 롤백 |
| 대상 DB `CREATE` + `CREATEROLE` | 내부 함수 소유자 `t253_write_owner`로 `SET ROLE`할 수 없어 소유권 이전 실패 | 생성 중이던 역할·스키마·객체 롤백 |

설치 API는 모두 `PUBLICATION_INSTALL`과 `not-applied`를 반환했다. 각 케이스 뒤 제한 세션 상태는 유휴였고 부트스트랩의 읽기 검증에서 게시 객체와 이력이 비어 있었다. 기반 카탈로그, Auth 표식, Foundation 역할 간선, 기존 이력 체크섬과 시각은 실행 전후가 같았다. 부트스트랩 설치 뒤 별도의 같은 권한 제한 계정은 `t_publication_install` 스키마에 접근할 수 없어 설치 이력을 읽지 못했다. 그 확인 요청도 두 이력에 변경을 남기지 않았다. [전용 시험](../../tests/public-showcase/t339-publication-limited-installer.pg17.ts)

## 기반 SQL과 두 이력

1. **SQL 0001~0003.** 별도의 비슈퍼유저 Foundation 계정에 대상 DB `CREATE`, `CREATEROLE`, 합성 `auth.users`의 스키마 사용·참조만 제공했다. TLS 전용 시험 안에서 v2 고정 소스 로더와 기존 카탈로그 검사, 실제 v2 이력 테이블 계약을 사용해 트랜잭션으로 설치했다. 독립된 읽기 검증은 `complete`, 버전 `3`, 대기 `0`을 반환했다. TLS 전용 소유 클러스터를 유지하기 위해 무TLS인 v2 `synthetic` CLI 프로필은 사용하지 않았다. [v2 고정 소스](../../lib/db/postgres/migration-manifest-v2.ts) · [기존 상태 검사](../../lib/db/postgres/migration-state-v2.ts)
2. **SQL 0004.** 같은 Foundation 계정으로 PG17의 v2 스키마 4 검사를 호출하면 3단계 카탈로그에서 `MIGRATION_STATE`가 반환됐다. 고정 SQL4 DDL을 소유 시험 DB에만 적용해도 기존 스키마 4 비교는 `MIGRATION_STATE`였다. SQL4의 실제 DDL 공존을 검증할 목적으로만 남겼고 v2 이력에는 승인되지 않은 4번 행을 추가하지 않았다. PG17의 v2 기준은 스키마 3 단독일 때만 PG17의 카탈로그 표현을 반영한다. [SQL4](../../lib/db/postgres/0004_storage_verification.sql) · [T258 기준](T258-PG17-SCHEMA3-CATALOG.md)
3. **게시 v1.** 위 격리 DB에 기존 T338 시험용 부트스트랩을 사용해 설치와 실제 게시·철회를 통과시켰다. `dream_migrations.history`는 기존 3행과 시각·체크섬이 같았고 `t_publication_install.history`에는 게시 v1 해시 한 행만 생겼다. `dream.storage_objects`와 기반 카탈로그는 게시 최초 설치·재설치·사용 뒤에도 같았다. 부트스트랩은 격리 시험의 양성 대조에만 사용했다. [T338 시험](../../tests/public-showcase/t338-publication-installation.pg17.ts)
4. **SQL 0005.** v3 소스 로더로 체크섬을 검증했고 SQL의 실제 서버 major `18` 및 기대 입력 `18` 조건을 확인했다. PG17 시험에서 이 SQL을 실행하지 않았으며 PG18 설치·게시 공존은 검증 범위 밖이다. [SQL5](../../lib/db/postgres/0005_upload_reservation.sql) · [v3 고정 소스](../../lib/db/postgres/migration-manifest-v3.ts)

## 재현과 인계

`node --conditions=react-server --import tsx tests/public-showcase/t328-publication-db-preflight.pg17.ts --limited-publication-installer`를 사용한다. 기존 실행기에 모드·호출만 추가했다. 소유 PG17.12 프로세스에서 TLS를 유지하며, 검사 완료 뒤 제한 세션과 시험 리스너 및 임시 클러스터를 정리했다. 후보 설치 코드, 기반 `0001`~`0005`·v2/v3·CLI와 운영 자원은 변경하지 않았다. [격리 실행기](../../tests/public-showcase/t328-publication-db-preflight.pg17.ts)

신규 모드와 무인자 T328/T330/T332/T336, 관리자·공개·Storage 회귀 299건이 통과했다. 변경 TypeScript ESLint와 생성 `.next` 검증 파일을 제외한 소스 530개 진입 파일 타입 검사도 통과했다.

관리형 스테이징 연결은 보류한다. 다음 설계에서는 내부 NOLOGIN 소유자에게 DDL을 이전할 수 있는 승인된 소유권 관리 절차와 별도 이력 읽기 권한의 경계를 검토해야 한다. 기존 게시 후보는 이력 없는 사전 생성 역할을 부분 상태로 거절하므로, 역할을 미리 공급하는 방식을 택하면 버전 고정 설치와 검증 모델도 함께 검토해야 한다. 이번 검증으로 `CREATEROLE`과 DB `CREATE`가 필요함은 확인했으며, 관리형에서 충분한 최소 권한은 아직 입증되지 않았다.

> T339에서 권한을 확대하지 않은 제한 계정의 설치·이력 조회 차단을 입증했습니다. 격리 부트스트랩 대조에서 기반 SQL1~4와 게시 v1이 공존하고 이력이 분리됐습니다. PG17에서 v2 스키마 4 승인은 차단됐고, SQL5는 PG18 소스 조건까지만 확인했습니다.
