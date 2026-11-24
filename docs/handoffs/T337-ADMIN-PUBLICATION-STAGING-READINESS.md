# T337 관리자 게시 스테이징 연결 준비안

2026-11-19 KST · Codes(Backend) · 소스 기준 `add9493` · Master 배정 `msg_ac9582eb4460`

**판정은 스테이징 연결 전 준비 단계다.** 관리자 게시에서 공개 목록·표지까지의 DB/Storage 조립은 T336-R에서 격리 검수를 통과했다. 현재 `loadPublicationRuntimeOptions()`의 반환값은 `undefined`다. 저장소와 팀 기록에는 게시용으로 승인된 별도 PG17·Auth·Storage 대상과 보호 Preview를 연결했다는 근거가 없다. 관리자 메뉴 배포 후보 T335도 게시 공급원 미연결을 전제로 한다. [T336-R 검수](T336-R-ADMIN-PUBLICATION-DB-COVER-INTEGRATION-REVIEW.md) · [기본 런타임 구성](../../lib/public-showcase/publication-runtime-config.ts) · [스테이징 대상 인벤토리](T264-STAGING-TARGET-INVENTORY.md) · [T335 후보](T335-ADMIN-HUB-LOCAL-RELEASE-COMMIT.md)

## 기존 이관과 게시 SQL의 경계

| 구성 | 재사용 범위와 누락된 설치 단위 |
| --- | --- |
| `0001_schema.sql`~`0003_rls.sql` | `dream` 프로젝트·렌더·자산과 `auth.users` UUID, 불변조건 및 RLS 기반. 대상의 승인 버전·manifest·이력·카탈로그가 확인되면 기반으로 재사용한다. 신규 기반 설치가 필요한 경우 승인된 대상에 기존 v2 `fingerprint` → `dry-run` → `apply` 절차를 검토한다. [기반 SQL](../../lib/db/postgres/0001_schema.sql) · [RLS](../../lib/db/postgres/0003_rls.sql) · [기존 CLI](../../scripts/postgres/migrate-v2.ts) · [스테이징 실행 기준](T261-MANAGED-PG17-STAGING-CHECKLIST.md) |
| `0004_storage_verification.sql`, `0005_upload_reservation.sql` | 검증된 원본과 업로드 예약의 계약이다. 게시 표지 버킷이나 게시 SQL을 설치하지 않는다. v2 CLI는 `--schema 3/4`를 처리하며, v3 `loadPostgresMigrationsV3()`는 스키마 5의 고정 소스를 검증하는 로더다. 대상에 4/5 적용 여부와 게시 후보가 그 데이터에 의존하는지는 별도로 판단한다. [Storage 검증 SQL](../../lib/db/postgres/0004_storage_verification.sql) · [업로드 SQL](../../lib/db/postgres/0005_upload_reservation.sql) · [v3 소스 manifest](../../lib/db/postgres/migration-manifest-v3.ts) |
| T253 · T293 | T253의 `source_images`, `publishers`, `slots`, `requests`, `apply_command()`가 세대와 상태 전환의 기반이다. T293의 `actor()`, `can_publish()`, `approved_ms()`와 `works/evidence/manifests/app_requests/audit`가 운영자 검증·작품 잠금·요청 재시도·감사를 맡는다. 현재 SQL은 합성 환경 검사와 고정 시험 로그인 매핑을 포함한다. 별도로 버전 관리된 설치 SQL과 실제 로그인↔운영자 바인딩이 필요하다. `cover_objects` 합성 바이트 테이블은 T334의 비공개 Storage 경로에서 필요하지 않으므로 스테이징 설치 범위를 정할 때 분리한다. [T253 fixture](../../tests/fixtures/postgres/t253-showcase-publication.sql) · [T293 fixture](../../tests/public-showcase/t293-admin-publication.sql) |
| T295 · 권리 조회 | `valid_rights()`, `apply()`, `list_approved()`, `find_cover()` 및 attestation·고정 manifest·활성 권리·요청 기록이 필요하다. T332가 확인하는 `rights_state(text,bigint)`는 시험 실행기가 설치한 소유자 범위 읽기 함수다. 승인된 이름의 함수, 정확한 정수 ms 또는 `null` DTO, `t295_writer` 소유·`SECURITY DEFINER`·고정 search path 및 RLS 설정이 들어간 설치 SQL이 필요하다. 구형 `t293.apply_t253()`은 `t295_writer`의 내부 호출에만 허용하며 관리자 로그인 직접 호출은 차단한다. 이 규칙은 T330에서 실제 호출로 검증됐다. [T295 fixture](../../tests/public-showcase/t295-publication-rights.sql) · [권리 함수 시험 설치](../../tests/public-showcase/t332-publication-verified-adapters.pg17.ts) · [T330 검증](T330-ADMIN-PUBLICATION-ADAPTER-CONNECTION-VERIFICATION.md) |

게시 SQL은 현재 관리형 이관 manifest에 없다. 첫 구현안은 별도 고정 버전의 게시 SQL, 소유권·권한 매트릭스, 적용 이력 및 읽기 검증을 만드는 것이다. `publication-db-preflight.ts`와 `publication-verified-adapters.ts`가 현재 `t253_showcase`·`t293`·`t295`의 함수와 역할 이름을 사용한다. 기존 이름을 유지할지 바꿀지는 SQL과 호출·사전 검사·회귀를 함께 수정할지까지 포함해 결정한다. 합성 실행기의 승인 조건·고정 계정·시드는 그대로 시험에 사용한다. [DB 사전 검사](../../lib/public-showcase/publication-db-preflight.ts) · [DB 어댑터](../../lib/public-showcase/publication-verified-adapters.ts)

## 실제 연결 입력과 담당안

| 항목 | 확인할 파일·함수와 스테이징 조건 | 실행 담당안 |
| --- | --- | --- |
| 승인 대상 | 별도 PG17 DB/Auth와 Storage 프로젝트 및 보호된 앱 Preview를 고정한다. 대상과 Preview가 동시에 운영을 가리키지 않는지 확인하고, 소스 SHA·실행 방식·복귀 지점을 기록한다. [T264 인벤토리](T264-STAGING-TARGET-INVENTORY.md) | Master가 승인과 범위를 확인하고 플랫폼 담당이 읽기 전용으로 매핑을 대조 |
| 운영자와 DB 자격 | `resolveServerAuth()`가 실제 Auth `getUser`로 얻은 UUID, 서버가 승인한 `adminActorId`, 제한 관리자 DB 로그인에서 `bindActor()`가 반환하는 `t293.actor()`가 모두 일치해야 한다. `t293.can_publish()`와 소유권도 별도로 확인한다. 현재는 승인 운영자 한 명과 관리자 로그인 한 개가 한 구성에 대응한다. 표시 이름, 이메일이나 요청 필드로 UUID를 매핑하지 않는다. 관리자·목록·표지에 서로 다른 제한 로그인을 사용하고 DDL, RLS 우회, 역할 부여 및 교차 함수 호출은 거절한다. 역할 발급·회수와 시크릿 전달 경로는 별도로 승인한다. [Auth 판별](../../lib/auth/resolve.ts) · [어댑터 바인딩](../../lib/public-showcase/publication-verified-adapters.ts) · [DB 사전 검사](../../lib/public-showcase/publication-db-preflight.ts) | 지정 Auth/비밀 담당이 승인된 UUID와 자격 매핑을 제공, Backend가 코드를 연결, Tester가 승인 계정과 별도 계정의 결과를 확인 |
| DB 대상과 TLS | `openVerifiedPublicationDatabase()`는 직접 접속하는 PG17 주 서버의 호스트·포트·DB·클러스터 식별자, 실제 SQL 로그인·역할, TLS와 DB OID를 확인한다. `createPostgresPool()`의 호스트 및 인증서 검증과 실제 세션 `pg_stat_ssl`을 함께 확인한다. 이관 문서 T261의 Session 경로는 게시 런타임에 자동 적용할 수 없다. 연결·포트·로그인 형식이 맞지 않거나 세 역할에 클러스터 식별자 조회 권한이 없으면 게시 연결을 보류한다. 신뢰 검증을 해제하지 않는다. [게시 세션 검사](../../lib/public-showcase/publication-db-preflight.ts) · [공용 TLS 연결](../../lib/db/postgres/connection.ts) | Backend와 플랫폼 담당이 승인 호스트에서 실제 세 역할을 읽기 검증, Tester 독립 확인 |
| 표지와 완성본 데이터 | `createPublicationServerConfig()`에 전달하는 Storage 프로젝트·URL·서버 자격과 `createPublicationCoverStorageReaders()`의 고정 비공개 버킷 `publication-covers-private`을 지정한다. 현재 계약은 서버 `service-role` 형식이다. 실제 제공 방식과 허용 범위는 비밀 담당이 확인한다. staging 작품을 작성할 담당이 완성본 소유자·아티팩트 UUID/리비전/SHA, 공개 동의·만료, 승인된 WebP 바이트와 `slug/generation/<sha256>.webp` 객체를 같은 자료로 등록해야 한다. 기존 원본 자산 경로는 게시 표지 키와 별개다. 현재 `bindEvidence()`는 완성 이미지에 한해 게시를 허용하므로 음악·영상의 게시·재생은 후속 서비스 단위다. [공용 조립](../../lib/public-showcase/publication-server-config.ts) · [표지 Storage](../../lib/public-showcase/publication-cover-storage.ts) · [게시 증빙](../../lib/public-showcase/admin-publication-service.ts) | Backend와 CC-DATA-01이 증빙과 표지 등록 계약을 설계, 지정 플랫폼 담당이 승인 범위에서 비공개 버킷과 전용 접근 확인 |
| 호스트 초기화와 종료 | `loadPublicationRuntimeOptions()`에서 승인 스테이징 구성만 T336 팩터리로 넘기는 서버 공급 연결이 필요하다. T327 런타임은 Node 프로세스 안에서 한 번 초기화한다. `closePublicationRuntime()`은 준비됐고, `instrumentation.ts`는 현재 메뉴 설정만 검사한다. 호스트가 새 요청을 차단하고 진행 중 요청을 비운 뒤 명시 종료를 호출할 수 있어야 한다. 관리형 호스트에서 해당 수명 주기를 확인할 수 없다면 먼저 실행 책임과 대체 방식을 확정한다. [T327 시작·종료](../../lib/public-showcase/publication-runtime.ts) · [현재 instrumentation](../../instrumentation.ts) | Backend가 명시 로더·종료 연결 후보 작성, 메인 PC 플랫폼 담당이 고정 SHA 빌드 및 승인된 스테이징 적용, Tester가 동시 최초 요청·정리 확인 |

## 검증·중단·복구 순서

1. **적용 전.** Master가 대상·담당·실행 승인과 실행 시각을 남긴다. 지정 실행자가 게시 manifest 및 이력 대조와 읽기 사전 검사를 하고, 대상 일치와 복원 지점을 확인한다. Backend와 데이터 담당은 게시 작성·권리 함수에 필요한 제한 권한과 기존 데이터가 보존되는 범위를 검토한다. 검증이 실패하면 기본 런타임 미연결로 유지한다.
2. **스키마 적용.** 승인된 실행자가 고정 SHA와 대상에 버전 관리된 게시 설치 SQL을 적용한다. 스키마·권한·이력 읽기 검증을 끝낸 뒤 연결한다. 커밋 여부가 불명확할 때는 새 읽기 세션에서 이력·권한과 실제 상태를 확인한 뒤 재시도 여부를 판단한다. 부분 카탈로그를 수동 보정하지 않는다.
3. **공급원 실행.** Tester가 보호 Preview와 실제 Auth로 승인 계정 A, 다른 계정 B, 미인증을 확인한다. 등록한 시험 이미지 하나에서 준비 전 비노출, 게시·동일 UUID 재시도와 원장/감사 한 건, 홈·표지 GET/HEAD, 권리 만료·철회·구 세대 404, Storage 장애의 미완료와 오류 비노출을 확인한다. PC·모바일 뒤로가기·캐시, 실제 호스트의 Origin·본문 수신 경계, 동일 SHA 중단·종료·복구를 추가로 검증한다. [로컬 수신 경계](T303-API-PRODUCTION-MODE-INGRESS.md) · [PC/모바일 기준](T308-PUBLICATION-PRODUCTION-HYDRATION-CHECK.md)
4. **문제 발생 시.** 신규 게시·읽기 진입을 차단하고 호스트 종료를 확인한 뒤 승인된 이전 미연결 Preview 또는 구성으로 복귀한다. 관리자 쓰기 `503 PUBLICATION_UNLINKED`, 홈 예시, 표지 GET/HEAD `404`를 확인한다. DB 이력·요청 원장·감사·표지 객체는 증거로 보존한다. 데이터 자체의 복원이 필요하면 데이터 담당이 별도 승인된 스테이징 복구 지점과 동일 대상에서 검증한다. 운영 환경에는 적용하지 않는다.

## 다음 구현 단위와 결정 사항

- **지금 배정 가능한 구현.** Backend가 게시 전용 고정 SQL 초안과 권한·이력 검증을 추가하고, Tester가 새 SQL을 설치한 소유 격리 PG17에서 기존 T328/T330/T332/T336 실행기를 회귀에 재사용한다. 기존 테스트가 직접 심던 곳만 새 SQL을 거치게 해 설치·권한·롤백 차이를 검증한다. T327의 첫 요청/명시 종료 시험과 T306/T308의 관리자↔공개 종단 단언은 대상으로 연결하는 코드가 생겼을 때 재사용한다. 이번 조사에서는 기존 합성 시험을 다시 실행하지 않았다. [기존 PG17 실행기](../../tests/public-showcase/t328-publication-db-preflight.pg17.ts) · [T327 런타임 기준](T327-ADMIN-PUBLICATION-RUNTIME-WIRING.md) · [T306 흐름](T306-ADMIN-TO-PUBLIC-SHOWCASE-E2E.md)
- **Master가 확정할 항목.** 시험 대상과 Preview의 승인 여부 및 보호·회수 담당, 게시 SQL 패키지의 버전과 스키마 이름, 첫 승인 운영자 한 명으로 진행할 범위, 완성 이미지·동의·표지의 등록 책임, 호스트 수명 주기와 적용·복구 책임을 정한다. 기존 승인 내에서 자리를 정할 수 없을 때만 정확한 대상 선택, 신규 자격 권한 또는 비용 범위를 사용자 결정으로 올린다.

> T337 준비안을 작성했습니다. 격리 게시 통합 코드는 검수됐으며, 스테이징 게시 SQL·권리 함수, 실제 운영자 바인딩·비공개 버킷, 보호 Preview와 종료 연결은 미확정입니다. 다음 구현 단위로 게시 전용 버전 관리 SQL과 권한·이력 검증을 진행할 수 있습니다.
