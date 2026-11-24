# T366 클라우드 업로드·저장 최소 연결 범위와 PG17 호환성

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_884683ff2dc2` · 기준 `1801176`

**권고는 PG17에서 비공개 이미지 한 건의 예약·검증·프로젝트 저장을 끝까지 시험하는 별도 설치 후보를 만드는 것이다.** 고정 SQL1–4의 상태와 검증 계약을 재사용하고, 원본 SQL5·기반 이력·로컬 API 동작은 보존한다. 현재 PG17에서 원본 SQL5를 사용하는 제품 연결은 불가하다. 운영 DB의 현재 버전과 권한은 미확인이다. [T364 현행 진입점 검증](T364-PRIVATE-UPLOAD-PROJECT-RENDER-LOCAL.md) · [T362 운영 사전 점검](T362-PROJECT-HTTPS-PRODUCTION-READ-PREFLIGHT.md)

| 현재 구성 | 확인한 동작과 남은 연결 |
| --- | --- |
| `POST /api/assets/upload` | 기존 인증과 로컬 데이터 가드를 통과하면 파일을 로컬 Storage에 쓰고 SQLite에 등록한다. 클라우드 설정에서 가드가 닫히므로 처리 시작 전에 503을 반환한다. 클라우드용 예약, 비공개 수신, 검증 완료 및 장애 정리는 아직 제품 API에 연결되지 않았다. [업로드 라우트](../../app/api/assets/upload/route.ts) · [기존 API 가드](../../lib/auth/api.ts) |
| `POST /api/projects` | 같은 가드를 통과한 뒤 SQLite 서비스가 입력·파일 형식을 검증하고 프로젝트, 단계, 파일 연결, 작업 기록을 저장한다. 별도의 조회 설정으로 클라우드 쓰기가 열리지 않는다. [프로젝트 라우트](../../app/api/projects/route.ts) · [로컬 저장 서비스](../../lib/services/projects.ts) |
| `postgresProjectCreateWithStorage` | 서버가 전달한 검증된 사용자와 설정으로 소유자 범위 행을 잠그고, 실제 비공개 바이트의 키·MIME·크기·SHA-256을 검사한 뒤 DB에 저장한다. 이는 이미 등록된 이미지·영상의 바이트 검사다. 이 팩토리 자체에는 SQL4의 현재 검증 기록과 정책 세대를 대조하는 게이트, 재시도용 프로젝트 생성 원장, 업로드 예약·완료·정리, HTTP 인증·라우트 조립이 없다. 다음 후보는 이 검사를 재사용하고 현재 검증 기록 확인과 생성 결과의 재조회를 추가해야 한다. [Storage 결합 저장 서비스](../../lib/services/postgres/project-create-storage.ts) · [B15 검증](B15-PROJECT-CREATE-STORAGE-ADAPTER.md) |
| SQL5 설치와 카탈로그 | 원본 SQL5는 서버 major 18, 설치 소유자 OID, 고정 설정과 제한 역할 관계를 확인하고 시작한다. PG17.12에서는 `B27_PREFLIGHT_UNVERIFIED`로 거절됐고 예약 스키마와 역할이 생기지 않았다. v3 카탈로그 검사도 서버 18로 고정되며 PG17에 없는 `pg_constraint.conenforced`·`conperiod`를 읽는다. 반면 중복 JSON 키를 검사하는 `IS JSON … WITH UNIQUE KEYS`는 PG17에서 지원된다. 따라서 버전 숫자만 낮춰서는 동일한 설치·증거 계약을 충족할 수 없다. [SQL5](../../lib/db/postgres/0005_upload_reservation.sql) · [v3 카탈로그 검사](../../lib/db/postgres/migration-catalog-v3.ts) · [PG17 제약 카탈로그](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) · [PG18 제약 카탈로그](https://www.postgresql.org/docs/18/catalog-pg-constraint.html) · [PG17 JSON 명세](https://www.postgresql.org/docs/17/functions-json.html) |
| SQL5 예약 서비스 | 설정 파서는 `schemaVersion: 5`·`serverMajor: 18` 및 승인된 후보 식별값을 요구하고, 실행기는 실제 서버 major·로그인·함수 OID 등을 대조한다. `approved-runtime`은 현재 서비스에서 `DISABLED`이며 소유 합성 범위만 실행한다. SQL5 설치가 성공하는 환경에서도 이 코드에는 공급자 전송·검증 완료·정리 연결이 없다. [예약 서비스](../../lib/services/postgres/upload-reservations.ts) · [예약 실행 경계](../../lib/db/postgres/reservation-attempt.ts) |

## 권고안과 검수 기준

첫 후보는 **각 소유자의 비공개 이미지 1건을 예약하고, 검증 완료된 파일 ID로 프로젝트 1건을 만드는 경로**다. 소유한 PG17.12와 격리된 비공개 Storage 환경에서 확인한다. SQL4의 물리 공존 시험은 시작 근거이며, PG17에서 운영 설치 가능하다고 판정하려면 기반 이력·카탈로그·제한 역할과 후보의 설치·복귀를 별도로 검증해야 한다. 후보의 DB 변경이 필요하면 SQL5와 별개로 버전·권한·복귀를 고정한다. [SQL4](../../lib/db/postgres/0004_storage_verification.sql) · [T281 PG17 시험](T281-REA-MANAGED-AUTHORITY-GENERATIONS-PROBE.md)

1. **인증·예약**. 서버가 확인한 UUID를 사용한다. 소유자·요청 ID·정규 입력을 묶어 동일한 재시도에 같은 예약과 파일 ID를 돌려준다. 입력이 바뀐 동일 ID는 거절한다. 예약이 확정된 뒤에만 비공개 쓰기를 시작한다. 예약 COMMIT 결과가 불분명하면 동일 요청 상태를 대조한다.
2. **수신·검증 완료**. 수신 경로와 최종 경로의 소유자 및 객체 식별자를 서버가 고정한다. 바이트·MIME·크기·해시를 검사한다. SQL4의 파일 검증 기록과 현재 상태 포인터를 재사용해 소유자·정책 세대·검증 작업·현재 객체가 맞을 때만 등록 완료한다. 검증 작업과 정리 역할을 분리하고, 같은 완료 요청은 기존 결과를 재사용한다. 파일 키나 공급자 토큰을 응답에 싣지 않는다.
3. **중단·정리**. 예약 중단, 검증 실패, 공급자 응답 유실, 완료와 정리의 경합을 각각 시험한다. 원본에 바이트가 더 들어올 수 있는 동안 정리를 확정하지 않는다. DB에서 정리 권한과 상태 전이를 확정한 뒤 대상 객체만 삭제하고, 지연된 최종 쓰기가 다시 등록되지 않는지 확인한다. 이미 등록된 파일은 미등록 파일 정리 대상에서 제외한다.
4. **프로젝트 생성**. 현재 검증 기록을 사용해 소유자와 정책·객체 상태를 같은 생성 트랜잭션에서 대조한다. 기존 바이트 검증을 재사용한 뒤 프로젝트·7단계·파일 링크·감사 기록과 생성 결과를 한 번에 확정한다. 생성 응답을 잃어도 동일 요청으로 같은 프로젝트 ID를 확인한다. 철회되거나 오래된 검증 기록을 가진 새 요청, 타인 파일, 비공개가 아닌 버킷은 쓰기 전에 차단한다.
5. **제품 경계**. 우선 소유 PG17에서 전 구간을 입증한다. 이후 배정에서는 두 POST와 별도 서버 요청 조립 모듈을 검토하되 클라우드 쓰기는 독립된 명시적 활성화와 검증된 파일·DB 역할이 있을 때만 연다. 기존 로컬 요청, Vercel의 기존 로컬 쓰기 차단, 프로젝트 조회 설정을 그대로 회귀 시험한다. 승인되지 않은 직접 테이블 쓰기, 넓은 권한, 공개 버킷 또는 SQLite 대체 경로로 클라우드 요청이 진행되지 않아야 한다.

첫 검수에는 A/B 소유자 격리, 중복·상이 입력 재시도, 정책 변경과 검증 완료의 경합, 예약·완료·생성 응답 유실, 취소·늦은 쓰기·정리의 경합, 롤백 뒤 재개, 설치·복귀 전후 기반 이력과 로컬 API 동등성을 포함한다. 영상 첨부, 음악 자료와 분석 적용은 이미지 경로를 입증한 뒤 같은 검증 계약을 사용해 확장한다. [업로드·정리 순서 계약](B16-FIX-UPLOAD-WORKER-CONTRACT.md)

## 이번에 확인한 근거

- `node tests/reference-analysis/managed-authority-generations.pg17.mjs`를 재실행해 SQL5 적용 거절, 새 스키마·역할 부재, SQL1–4에서 기존 권한 시험과 임시 클러스터 정리를 확인했다.
- `node --conditions=react-server --import tsx tests/reference-analysis/t312-issuance-ledger-storage.pg17.mjs`를 재실행해 SQL4의 현재 검증 기록, 재검증·정책 경쟁, 동일 요청 재시도, 철회 후 지연 발급 차단 및 A/B 격리를 확인했다. 이 시험은 REA의 권한 발급을 검증한다. 후보 업로드·등록·정리·프로젝트 저장 전체의 시험은 남았다. [T312 근거](T312-REA-ISSUANCE-LEDGER-STORAGE-INTEGRATION.md)
- 기존 프로젝트 생성, 예약 실행·클라이언트·응답, 업로드 상태 전이, 레거시 가드 회귀 6개 파일 289건 통과. 운영 접속·설정, 공유 SQL·제품 경로 수정과 배포는 수행하지 않았다.

> T366에서 PG17의 원본 SQL5 거절을 재현했습니다. 첫 최소 연결은 기존 SQL4 검증 기록과 잠금·정리 계약을 유지하는 이미지 1건의 소유 PG17 업로드·저장 후보로 권고합니다. 기존 두 POST를 운영에 연결하기 전에 독립된 후보 설치·복귀와 전체 시험 범위를 배정해 주세요.
