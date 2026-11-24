# T339-R 제한 설치 역할·기반 공존 독립 검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `5d579d3` · Master 배정 `msg_4d26d501501f`

**검수 통과.** 소유 PG17.12/TLS에서 제한 설치 역할의 예상 차단과 롤백을 재현했다. 같은 DB에서 시험용 bootstrap으로 설치한 게시 v1은 기존 기반 SQL과 공존했고 게시·철회가 동작했다.

## 제한 설치와 롤백

| 시험 로그인 권한 | SQLSTATE 42501 차단 지점 |
| --- | --- |
| 대상 DB `CREATE`만 | 첫 게시 역할 생성 |
| `CREATEROLE`만 | 대상 DB의 게시 스키마 생성 |
| 대상 DB `CREATE`와 `CREATEROLE` | `t253_write_owner`로 `SET ROLE`이 필요한 함수 소유권 이전 |

세 로그인은 비슈퍼유저 TLS 세션이었고 `createrole_self_grant`는 빈 값이었다. 설치 API는 각 실패를 `PUBLICATION_INSTALL` / `not-applied`로 반환했다. 세션은 유휴로 돌아왔고 연결을 닫은 뒤 bootstrap 읽기 검증에서 게시 객체와 이력이 없음을 확인했다. 기반 카탈로그, Foundation 역할 간선, 합성 Auth 표식, 기존 이력 행은 보존됐다. bootstrap 설치 후 동일한 유형의 제한 계정은 `t_publication_install` 스키마 접근에서 차단됐으며 양쪽 이력은 보존됐다.

## 기반 공존과 검증 범위

- **SQL 0001~0003.** 별도 Foundation 비슈퍼유저가 체크섬 검증된 고정 SQL과 기존 v2 이력 계약으로 설치했다. SQL4 적용 전 기존 검사에서 `complete`, 버전 3, 대기 0을 확인했다. TLS 전용 시험이므로 v2 CLI의 synthetic 실행 경로는 검증 범위 밖이다.
- **SQL 0004.** 고정 DDL로 만든 `dream.storage_objects`는 게시 v1 최초 설치·재실행·사용 후에도 보존됐다. 기존 스키마 4 상태 검사는 DDL 적용 전후 모두 `MIGRATION_STATE`를 반환했고 공식 4번 이력 행은 생성되지 않았다. 확인한 범위는 PG17에서의 DDL 공존이다.
- **게시 v1.** 같은 소유 DB의 시험용 bootstrap 세션에서 T338 게시 설치, 동일 요청 재전송, 공개 표지 및 철회를 확인했다. 기존 `dream_migrations.history`의 3행과 체크섬·시각은 보존됐고 게시 전용 `t_publication_install.history`에는 검증된 v1 행이 한 건 있었다.
- **SQL 0005.** v3 고정 소스 로더의 체크섬 검증과 실제 서버 및 예상 입력의 major 18 조건을 확인했다. PG18 적용·공존과 관리형 환경에서의 설치·이력 조회 권한은 이번 판정 범위 밖이다.

무인자 실행기의 T328 TLS 22건과 T330·T332·T336도 통과했다. 관리자·공개·Storage 등 회귀는 26개 파일 642건, PG 종료 후 별도로 실행한 비공개 자산 검증은 1개 파일 54건이 통과했다. 소스 타입 검사, 변경 TypeScript 2개 ESLint와 diff 공백 검사도 통과했다. 두 PG 실행기의 수신기·임시 클러스터 정리, 제한·게시 검증 세션 0건과 소유 PG 프로세스 0건을 확인하고 검수 사본을 정리했다. 운영·스테이징·빌드·배포 변경은 없었다.
