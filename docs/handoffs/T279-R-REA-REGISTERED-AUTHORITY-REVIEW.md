# T279-R REA 현재 등록 상태 조회 독립 검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `09dab66edd8ff515838b1b897effed80b8c2090e` · Orca `msg_b923010a69a6`

**판정 — 조회 범위 통과.** 소유자와 현재 프로젝트 링크가 일치하고 활성 스토리지 세대의 `ready` 검증이 유효한 등록만 관측합니다. 성공 결과도 `analysisAuthority: "unavailable"`이고, 제품 호출부에서 분석이나 적용으로 연결되지 않습니다. [조회 모듈](../../lib/reference-analysis/registered-authority.ts) · [구현 인계](T279-REA-REGISTERED-AUTHORITY.md)

## 코드와 스키마 대조

- 공통 Auth가 `getUser`와 허용 이메일 검사를 거쳐 반환한 UUID로 액터를 구성합니다. 요청은 프로젝트·자료 ID만 받습니다. 미인증, 금지, 로컬 및 잘못된 액터는 관리형 읽기에 진입하지 않습니다. 검증된 로그인도 SQLite 행에 사용자 소유권을 부여하지 않습니다. [인증 해석](../../lib/auth/resolve.ts) · [기본 스키마](../../lib/db/schema.ts)
- `0001`의 소유자 복합 FK는 프로젝트와 자료의 연결에 같은 소유자를 요구합니다. 조회는 프로젝트·자료·링크·스토리지 객체·현재 검증의 소유자를 고정 바인딩으로 대조합니다. `0003`은 기본 테이블에 소유자 RLS를 강제하고, `0004`는 검증 테이블에 소유자 `SELECT`만 허용합니다. 액터 트랜잭션은 `READ ONLY REPEATABLE READ`, `SET LOCAL ROLE dream_api`, 트랜잭션 로컬 액터 설정을 사용합니다. [복합 FK](../../lib/db/postgres/0001_schema.sql#L314) · [기본 RLS](../../lib/db/postgres/0003_rls.sql) · [스토리지 RLS](../../lib/db/postgres/0004_storage_verification.sql#L554) · [트랜잭션](../../lib/db/postgres/transaction.ts)
- `asset_receipt_state.current_receipt_id`를 따라 등록 객체 및 자료 ID, 객체 식별 다이제스트, 활성 검증 세대와 유효 시간 구간을 대조합니다. 객체 키·SHA-256·크기·종류·MIME도 등록 행과 일치해야 합니다. 공통 객체 키 검사와 64 MiB 한도를 거치며, 결과는 서버 내부 메타데이터만 반환합니다. 재연결은 현재 링크 존재를 확인할 수 있습니다. 링크·권한·복원 세대의 연속성은 이 관측으로 증명할 수 없습니다. [조회 조건](../../lib/reference-analysis/registered-authority.ts#L35) · [객체 키 계약](../../lib/storage/supabase/object-key.ts)
- 이 조회는 PNG·JPEG·WebP와 MP4·MOV·WebM 범위입니다. 기본 DB에 `audio` 자료가 있고 로컬 REA에 MP3·WAV·M4A 분석기가 있어도, 관리형 조회의 SQL·스토리지 형식 계약은 음악을 지원하지 않습니다. [로컬 입력](../../lib/reference-analysis/input.ts#L26) · [관리형 형식](../../lib/storage/supabase/object-key.ts#L5)

## 실행 증거

| 환경 | 확인 결과 |
| --- | --- |
| 실제 로컬 PostgreSQL 17.12 | 서명이 검증된 저장소 도구로 새 루프백 전용 클러스터를 시작했습니다. 고정 커밋의 SQL1–3을 적용하자 조회가 `managed_unavailable`로 닫혔습니다. SQL4 소스를 그 클러스터에만 적용하고 실제 제약과 트리거를 유지한 채 합성 이미지와 검증 이력을 커밋했습니다. 제한 로그인으로 실제 조회 모듈을 호출해 현재 활성 검증만 등록 정보를 반환함을 확인했습니다. 만료, 타 소유, 연결 해제, 철회, 연결된 `audio`는 거절했고 재연결은 관측됐습니다. 카탈로그에서 조회 대상 6개 테이블의 강제 RLS 및 읽기 권한을 확인했습니다. 다른 액터는 SQL의 소유자 조건 없이 직접 조회해도 자료·검증 행을 0건 받았습니다. 세션에서 `dream_api`, 읽기 전용, 반복 읽기를 확인했습니다. 클러스터 정지와 임시 파일 정리를 확인했습니다. |
| 집중 SQLite 합성 시험 | **8/8** 통과. 합성 관계에서 조회 SQL 실행과 등록 값 불일치, 활성 세대 변경, 기본 스키마 실패, 로컬 폴백 부재를 확인했습니다. 이 시험의 PostgreSQL 클라이언트와 역할 전환은 모의했습니다. |
| 회귀 및 정적 검사 | 기본 REA **108 통과, 60 건너뜀**. 네이티브 REA·타임라인·오디오·PostgreSQL 요청/백엔드 묶음 **247 통과, 별도 DB 연결 조건이 있는 통합 8건 건너뜀**. 범위 `tsc -p tmp/t279-rea-typecheck.json`와 변경 파일 ESLint `--max-warnings 0` 모두 통과. |

로컬 PostgreSQL 실행에서는 Auth 액터를 합성 주입했습니다. 실제 Auth, 관리형 환경의 마이그레이션 및 역할 배치 상태, 관리형 비공개 객체 바이트는 검수 범위 밖입니다. SQL4 관계를 로컬에 적용한 결과로 관리형 배포 상태를 판정할 수 없습니다. [집중 시험](../../tests/reference-analysis/registered-authority.test.ts) · [SQL4 소스 계약](../../lib/db/postgres/migration-manifest-v2.ts)

**Master 전달문** — T279-R 통과. 실제 격리 PG17의 고정 SQL1–4와 제한 `dream_api`에서 소유·현재 링크·유효 검증, 타 사용자 RLS, 철회·만료·재연결 및 SQL3의 안전한 실패를 검증했습니다. 분석·적용 권한은 닫혀 있고 관리형 음악은 지원하지 않습니다. 집중 8/8, 회귀 247 통과, 범위 타입·린트 통과입니다.
