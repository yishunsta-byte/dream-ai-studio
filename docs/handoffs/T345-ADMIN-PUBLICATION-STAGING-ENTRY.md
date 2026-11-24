# T345 관리자 게시 스테이징 진입 판정

2026-11-19 KST · Codes(Backend) · 기준 `59778be` · Master 배정 `msg_c78f1552df8d`

**진입 보류.** T337에서 빠져 있던 게시 전용 설치 SQL과 역할 회수, 독립 이력 검증, 서버 연결 및 가동 중 재검증은 소유 루프백 PG17/TLS에서 구현·검수됐다. 기록을 대조한 결과 게시용으로 승인된 비운영 DB·Auth·비공개 Storage와 보호 Preview의 매핑, 해당 대상의 직접 TLS 증거, 실행·회수·복구 담당 지정은 확인되지 않았다. 시작 조건을 충족하기 전에는 게시 공급원을 닫아 둔다. [T337 준비안](T337-ADMIN-PUBLICATION-STAGING-READINESS.md) · [T264 대상 인벤토리](T264-STAGING-TARGET-INVENTORY.md) · [Master 상태 원장](../TEAM.md) · [최초 개발 계획 대조](../MASTER_DEVELOPMENT_PLAN.md)

## 기록에서 확인된 대상과 경계

| 기록 | 확인 범위와 판정 |
| --- | --- |
| 기존 Supabase 및 Vercel | T264에서 식별된 Supabase는 `main / PRODUCTION`이다. 과거 Preview 인증 설정도 같은 운영 Auth를 가리켰다. 별도 스테이징 승인 및 보호 Preview 배포 ID·SHA·리전·HTTPS origin·접근 회수의 기록을 확인하지 못했다. 이후 T335 운영 배포 기록은 관리자 메뉴 후보 `4d52d814`의 게시 서버 미연결 상태를 확인한 것이다. [T264](T264-STAGING-TARGET-INVENTORY.md) · [T335](T335-ADMIN-HUB-LOCAL-RELEASE-COMMIT.md) · [Master 운영 관측 기록](../TEAM.md) |
| 기존 TLS·승인 기록 | T261은 기반 이관과 Preview의 실제 앱 역할 접속을 분리한다. 기존 Session 연결 기록과 로컬의 서버 TLS 성공은 게시용 관리형 Direct 접속 근거로 사용할 수 없다. T262의 동일 Preview 런타임에서 비공개 점검을 수행할 수단과 배포 매핑도 기록상 미확인이다. 기존 운영 `DEC-SSL-01`은 이 판정과 별개다. [T261](T261-MANAGED-PG17-STAGING-CHECKLIST.md) · [T262-R](T262-R-PREVIEW-RUNTIME-TLS-PREFLIGHT-REVIEW.md) |
| T338 `7cbd9da` · T339 `5d579d3` | 게시 v1 고정 SQL의 bootstrap 설치·롤백·이력은 격리 검수됐다. 제한 계정의 v1 소유권 이전과 일반 제한 계정의 이력 접근은 차단됐다. 기반 0001~0003 이력 및 SQL4 물리 공존까지만 확인했다. PG17의 공식 스키마 4 검증은 `MIGRATION_STATE`였고, SQL5는 PG18 조건과 고정 소스를 확인한 범위다. 기반 이력은 게시 이력과 분리한다. [T338-R](T338-R-ADMIN-PUBLICATION-SQL-INSTALLATION-CANDIDATE-REVIEW.md) · [T339-R](T339-R-ADMIN-PUBLICATION-LIMITED-INSTALLER-REVIEW.md) |
| T340 `5d5a519` · T341 `a8ea68c` | 관리 준비, 제한 설치, 임시 권한 회수와 세션 종료, 독립 검증을 분리한 B안을 소유 PG17에서 통과했다. 게시 v2 이력 한 행, 커밋 응답 유실 뒤 상태 재분류, 부분 회수 차단 및 정상 게시를 확인했다. v1이 있거나 부분 스키마가 있으면 v2 후보를 중단한다. 검증자의 영속 DDL 거절은 실증됐고, `TEMPORARY`까지 금지할지는 별도 권한 정책과 시험이 필요하다. [T340-R](T340-R-ADMIN-PUBLICATION-INSTALLER-OWNERSHIP-DESIGN-REVIEW.md) · [T341-R](T341-R-ADMIN-PUBLICATION-DELEGATED-INSTALLER-PROBE-REVIEW.md) |
| T342 `633d319` · T343 `5eecc8e` · T344 `59778be` | 독립 `sealed` 확인 뒤에만 세 공급원을 조립한다. 같은 이름의 DB 교체는 실제 TLS 세션 OID에서 차단한다. 가동 중에는 작업 경계에서 이력·권한을 재검증하고 실패 시 세 공급원을 닫는다. 루프백 SDK 합성 객체의 게시·피드·WebP·철회 및 독립 회귀 696건을 확인했다. 제품 기본 로더는 비활성으로 남아 있다. [T342-R](T342-R-ADMIN-PUBLICATION-SEALED-RUNTIME-GATE-REVIEW.md) · [T343-R](T343-R-ADMIN-PUBLICATION-SEALED-DATABASE-IDENTITY-REVIEW.md) · [T344-R](T344-R-ADMIN-PUBLICATION-RUNTIME-REVALIDATION-REVIEW.md) |

## 단계별 진입·중단 기준

| 순서와 담당안 | 다음 단계에 필요한 증거 | 중단 조건 |
| --- | --- | --- |
| **1. 대상·승인 확인** · Master, DB/플랫폼, Front/배포 | 별도 비운영 PG17·Auth·Storage의 식별 정보와 보호 Preview의 배포 ID·고정 SHA·Node 런타임·리전·HTTPS origin·환경 스코프를 하나의 승인에 묶는다. 실행 창, 역할 발급·회수와 시험 접근 해제 담당, 이전 비활성 구성, 복구 지점 및 권한을 기록한다. [T264](T264-STAGING-TARGET-INVENTORY.md) | 운영 매핑, 미지정 담당, 접근 보호·회수 또는 복구 지점 미확인이면 외부 연결부터 보류한다. |
| **2. 읽기 사전 확인** · 지정 DB 관리자와 Backend, Tester 독립 검토 | 승인된 DB에서 호스트·포트·DB 이름·OID·클러스터 식별자, PG17 주 서버, 신뢰 CA와 호스트 검증, 실제 세션의 `pg_stat_ssl`을 대조한다. 관리/설치/검증과 Preview의 제한 게시·목록·표지 접속은 담당별 증거를 남긴다. `postgres` 공통 제어 DB 사용 가능 여부, 필요한 시스템 조회, Foundation 승인 버전·이력·Auth와 기존 게시 객체 유무를 확인한다. 앱 호스트의 사전 확인은 승인된 동일 런타임 비공개 수단을 사용한다. [T261](T261-MANAGED-PG17-STAGING-CHECKLIST.md) · [T262](T262-PREVIEW-RUNTIME-TLS-PREFLIGHT.md) · [T339-R](T339-R-ADMIN-PUBLICATION-LIMITED-INSTALLER-REVIEW.md) | 직접 TLS·대상·역할 증거가 모자라거나 Foundation 상태가 승인 기준과 다르면 중단한다. v1·부분 설치 상태라면 별도 전환안을 먼저 승인한다. TLS 검증 완화와 Foundation 이력 수동 추가를 배제한다. |
| **3. 역할 준비·위임 설치** · 지정 DB 관리자, 별도 설치자 | 클러스터 공통 작업 잠금과 대상 DB 쓰기 잠금 아래 승인 OID·속성·직접 역할 간선·부여자·`ADMIN/INHERIT/SET`·실효 권한 및 PG17 자동 관리 간선을 고정한다. `NOCREATEROLE/NOINHERIT` 설치자의 임시 소유 역할 전환과 설치자·두 스키마 소유자의 임시 DB `CREATE` 범위를 확인한다. 각 역할을 준비한 뒤 사용 전에 새 접속의 승인값을 대조한다. 고정 v2 SQL, ACL과 임시 스키마 권한 정리, NOLOGIN 소유권 이전 및 최초 게시 설치 이력 한 행을 동일 트랜잭션으로 확정한다. 기존 Foundation 이력과 Auth 보존을 대조한다. [T340 설계](T340-ADMIN-PUBLICATION-INSTALLER-OWNERSHIP-DESIGN.md) · [T341 고정 해시와 설치 순서](T341-ADMIN-PUBLICATION-DELEGATED-INSTALLER-PROBE.md) | 조정 잠금, SQL 해시, 역할·소유권·부분 객체 중 하나라도 다르면 설치를 닫는다. 쓰기 결과가 불명확하면 다음 행의 독립 읽기에서 분류할 때까지 재실행을 보류한다. |
| **4. 권한 회수·독립 이력 확인** · 지정 DB 관리자와 별도 읽기 검증자 | 같은 작업 잠금 아래 설치 로그인을 `NOLOGIN`으로 바꾸고 임시 멤버십·DB `CREATE`를 회수한다. 임시 스키마 권한이 남아 있지 않은지, 이미 `SET ROLE`한 설치 세션까지 종료됐는지 확인한다. 검증자가 새 TLS 읽기 전용 세션에서 최초 시각·소스/계획/카탈로그 해시·권한·세션을 대조해 `sealed`를 확인한다. 승인 이력 읽기와 일반 세션의 이력 변경·영속 DDL·교차 권한 거부도 근거에 남긴다. [T341-R](T341-R-ADMIN-PUBLICATION-DELEGATED-INSTALLER-PROBE-REVIEW.md) | `prepared`는 롤백 후 상태를 확인하고 다시 승인된 순서에서 진행한다. `pending-seal`이면 회수·세션 종료부터 완료한다. `UNKNOWN` 또는 조정 접속 종료 뒤에는 새 조정 잠금과 새 읽기 세션으로 상태를 분류한다. 부분 권한, 예상 밖 이력·스키마 또는 검사 불능이면 연결을 보류한다. |
| **5. 앱·비공개 Storage 연결** · Backend, Front/플랫폼, Auth·비밀 및 Storage 담당 | 보호 Preview에 승인된 서버 전용 연결을 구성한다. 최초 조립의 승인 잠금을 유지할 실행 경로와 다중 인스턴스·재시작의 수명 주기 및 종료 방법을 검증한다. 호스트에 전달하는 DB 자격은 제한 런타임과 독립 검증 계정으로 한정한다. Auth `getUser`의 승인 UUID, 제한 로그인 OID 바인딩과 게시 역할이 맞아야 한다. 고정 `t295.rights_state`, 비공개 `publication-covers-private` 버킷, 지정 비밀 담당이 제공하는 서버 전용 Storage 자격, 시험 이미지의 소유자·리비전·SHA·권리/만료·정규 WebP 키를 일치시킨다. [T337 입력 경계](T337-ADMIN-PUBLICATION-STAGING-READINESS.md) · [T334 Storage](T334-ADMIN-PUBLICATION-PRIVATE-COVER-STORAGE.md) · [T342-R](T342-R-ADMIN-PUBLICATION-SEALED-RUNTIME-GATE-REVIEW.md) | 검증자·각 런타임 연결이 동일 승인 OID와 다르거나 초기화 전후 읽기 검증이 실패하면 공급원과 Storage 호출을 닫는다. Auth·Storage의 운영 매핑, 공개 버킷, 관리자 바인딩·검수 자료 불일치, 독립 시작·종료 방법 미확인도 중단 조건이다. |
| **6. 게시·철회 판정** · Tester, Backend/Front 지원, Master 판정 | 승인 운영자·다른 사용자·익명으로 확인한다. 승인 이미지의 준비 전 비노출, 게시 후 피드와 WebP GET/HEAD, 동일 요청 재시도의 이력·감사 중복 방지, 권리 만료·철회 후 목록 제거와 이전 세대 404를 기록한다. 실제 Preview의 Origin·본문 경계, 브라우저 캐시와 뒤로가기, Storage 오류·공개 ACL·이력/권한 변경의 차단 및 정리를 대조한다. 이미지 게시 후보를 이 단계의 합격 기준으로 삼는다. [T306 관리자·공개 경로](T306-ADMIN-TO-PUBLIC-SHOWCASE-E2E.md) · [T337 검증 기준](T337-ADMIN-PUBLICATION-STAGING-READINESS.md) · [T344-R](T344-R-ADMIN-PUBLICATION-RUNTIME-REVALIDATION-REVIEW.md) | 노출·권한·이력·스토리지·Origin 대조가 어긋나거나 종료를 확인할 수 없으면 신규 요청을 닫고 7단계로 이동한다. 가동 중 읽기 검증은 작업 진입 시점의 스냅숏이다. 이미 완료된 커밋이나 전송은 소급해 취소할 수 없다. |
| **7. 중단·복구·재개** · Master, Front/배포, DB·Storage·비밀 담당 | 신규 게시·읽기 진입과 시험 Preview 접근을 차단하고 진행 중 접속을 정리한다. 사전 합의된 미연결 구성으로 돌아가 관리자 쓰기 503, 실제 작품 미노출과 표지 404를 확인한다. Foundation 및 게시 설치 이력, 요청 원장·감사, 시험 표지는 원인 분류까지 보존한다. 데이터 복원이 필요하면 지정 담당이 승인된 비운영 복구 지점에서 시행하고 세션·임시 자격 회수 및 복구 후 실제 DB/역할 OID와 이력·카탈로그를 대조한다. [T337 복구 순서](T337-ADMIN-PUBLICATION-STAGING-READINESS.md) · [T341 복구 경계](T341-ADMIN-PUBLICATION-DELEGATED-INSTALLER-PROBE.md) · [T343-R](T343-R-ADMIN-PUBLICATION-SEALED-DATABASE-IDENTITY-REVIEW.md) | 새 OID는 기존 승인에 승계하지 않는다. 복구 전 상태가 재분류되지 않거나 역할·이력·카탈로그가 다르면 닫힌 상태를 유지한다. 필요한 전환·재승인과 독립 `sealed` 확인 뒤에만 새 런타임 시작을 검토한다. |

## 현재 빠진 입력과 재개 책임

| 빠진 입력 | 해소 담당과 재개 조건 |
| --- | --- |
| 비운영 DB·Auth·Storage·보호 Preview의 대상과 승인 | Master가 기존 승인 여부를 확인하고 플랫폼·Front 담당이 비운영 매핑과 환경 스코프를 문서로 확인한다. 기존 승인으로 대상 확보가 불가능하면 Master가 선택·자원·비용 범위를 사용자에게 올린다. 승인 적용 범위가 고정되면 지정 담당의 읽기 사전 확인부터 재개한다. |
| 관리형 직접 TLS, 대상·역할 확인 및 회수 | 지정 DB/플랫폼 담당이 관리 권한과 세션 종료 권한의 담당을 확정한다. Backend와 독립 검증자가 실제 대상별 접속·역할·최소 권한·회수 증거를 기록하면 위임 설치 실행 승인을 검토할 수 있다. |
| Preview 서버 연결, Auth/Storage, 시험 자료 | Front/배포와 Backend가 보호 Preview의 비공개 실행 및 첫 시작·종료 방식을 확정한다. Auth·비밀·Storage 지정 담당과 데이터 담당이 비운영 사용자·역할, 버킷의 비공개 판정, 시험 이미지·권리의 일치 결과를 원문 자격 없이 보고하면 해당 Preview에서 Tester 검증을 검토한다. |
| 복구 지점과 운영 책임 | Master가 이전 비활성 구성, DB·Storage 복구 담당과 원장·감사·객체 보존 범위를 확정한다. 복구 및 재승인 조건까지 정해져야 스테이징 설치·연결을 승인할 수 있다. |

이번 판정은 저장소 승인·시험 기록의 문서 대조다. 관리형 연결, 비밀값 열람, 제품 코드 변경, 배포 및 원격 시험 실행은 없었다.
