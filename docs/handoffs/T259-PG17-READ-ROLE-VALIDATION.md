# T259 PostgreSQL 17 제한 역할과 프로젝트 읽기 검증

2026-11-18 KST · Codes(Backend) · 독립 검수 대기

기준 `54059387c84566163d507408459bd1a9791c37b6`, 배정 `msg_416e139f0e38`, 수락 `msg_d257fd5a7e19`. [T256-R 사전점검](T256-R-MANAGED-PG17-PREFLIGHT-REVIEW.md)과 [T258-R 비교 보완 검수](T258-R-PG17-SCHEMA3-CATALOG-REVIEW.md)를 대조했다. 합성 PG17.12에서 비슈퍼유저의 스키마 3 최초 적용 3건, 기존 역할쌍으로 무변경 재적용, 제한 API 로그인으로 A/B의 실제 DB 읽기를 확인했다.

## 이관 역할과 로그인 역할쌍

- [로컬 실행기](../../tests/postgres/run-t259-pg17-read-role-local.ts)는 T258의 고유 폐기 경로·서명·버전·루프백·OS/PID 확인과 부분 시작 정리 조건을 재사용한다. 기존 Windows EnterpriseDB 서명 도구 세 개, `server_version_num=170012`, UTF-8/C, 소유 데이터 경로, 포트와 DB를 확인했다. 기존 PG·운영 연결 변수를 제거하고 자식 환경을 제한했다. 비슈퍼유저 연결에서는 DB·주소/포트와 로그인/현재 역할을 검증했고, 관리자 설정인 data directory 자체는 일치하는 bootstrap 접속과 서버 OS 증거에서 확인했다.
- 합성 bootstrap은 `auth.users(id uuid PRIMARY KEY)`와 합성 UUID 두 행을 준비하고 migration 로그인에 `CONNECT`·DB `CREATE`, `auth` `USAGE`, `auth.users` `REFERENCES`를 부여했다. migration 역할은 `CREATEROLE`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOINHERIT`, `NOREPLICATION`이었다. 실제 migration 연결에 `auth.users` SELECT 권한이 없음을 확인했다. 고정 SQL·이력 쓰기는 이 로그인으로 수행했다.

| 단계 | 실제 결과 |
| --- | --- |
| 빈 스키마 3 dry-run | `fromVersion=null, applied=0, pending=3`. 별도 관측에서 초기 앱 스키마·이력·역할 부재 및 Auth 두 행 보존. |
| 비슈퍼유저 최초 apply | `fromVersion=null, applied=3, pending=0`. 기존 v2 runner로 고정 SQL 1~3과 이력 3행 적용. 두 앱 스키마와 NOLOGIN API·worker 역할 생성. 이력 ID와 loader 체크섬 일치. |
| 자동 멤버십 | PostgreSQL이 migration→`dream_api` 및 migration→`dream_worker` 간선 2개를 생성. grantor는 초기 bootstrap 역할이고 옵션은 각각 ADMIN true, INHERIT false, SET false였다. v2의 기존 migration owner 예외로 통과했다. |
| API 로그인 단독 대조 | 트랜잭션 안에서 `dream_api_login`과 정해진 API 간선만 만들자 기존 검사기가 `MIGRATION_STATE`를 반환했다. ROLLBACK으로 역할·간선을 원상 복구했다. |
| 기존 프로비저닝 템플릿 | migration 역할로 실행해 두 로그인 역할을 만들었다. 각 로그인은 자기 API/worker 역할에만 ADMIN false, INHERIT false, SET true 멤버십을 받았다. migration에 생긴 네 admin-only 간선과 두 runtime 간선을 확인했다. 스키마 3 재적용은 `fromVersion=3, applied=0, pending=0`이고 이력·객체 스냅숏은 보존됐다. |

역할쌍 생성 뒤 소유 bootstrap으로 격리 API 로그인에만 합성 암호를 설정했다. worker 로그인은 템플릿의 `PASSWORD NULL` 상태로 유지했다. 초기화 암호 파일은 삭제 후 부재를 확인했고, 두 실행 로그에서 실제 합성 비밀번호를 포함한 `ALTER ROLE … PASSWORD` 문장이 기록되지 않았음을 확인했다.

## 제한 API 로그인과 A/B 조회

[로컬 앱 시험](../../tests/postgres/t259-pg17-read-role.test.ts) **4/4 통과, skip 0, exit 0**. 실제 PostgreSQL 로그인은 `dream_api_login`, 로그인 역할에 superuser·BYPASSRLS·CREATEROLE·DB CREATE 권한이 없었다. 소유권이 있는 프로젝트·단계 자료는 제한 로그인과 제품 actor 트랜잭션을 사용해 합성 A/B에 입력했다. 합성 Supabase `getUser` 응답과 소유 루프백 시험 풀을 주입해 기존 인증 판정·서비스·GET 핸들러·개인 관리 컴포넌트 및 실제 DB 쿼리를 실행했다. 시험 풀의 TLS 비활성 옵션은 확인된 소유 루프백 클러스터에 한정했다. 리다이렉트는 프레임워크 호출의 목적지를 확인했다.

| 경로 | 확인한 동작 |
| --- | --- |
| PostgreSQL 권한과 RLS | 로그인 역할에서 바로 프로젝트를 읽거나 worker로 전환하면 `42501`. `dream_api`에서 actor 없이 직접 SELECT하면 0행. actor를 A/B로 바꾸어 owner 조건 없는 SELECT를 했을 때 각자 자기 행만 받았다. 정상 A/B 트랜잭션은 max 1의 같은 backend를 사용했고 종료 후 로그인 역할·빈 actor로 복귀했다. |
| `GET /api/projects` 및 `GET /api/projects/[id]` | A 목록 1건, B 목록 2건 및 자기 상세 200. 상대 프로젝트, 보관됨, 존재하지 않는 정상 UUID는 같은 404. 확인한 목록·거부 응답은 `no-store`. |
| `/cloud/manage` | 실제 컴포넌트 렌더에서 A 1개, B 2개와 성공 조회 시각 표시. 상대 프로젝트 식별자 미표시. |
| 익명 요청 | 목록·상세 401 `AUTH_REQUIRED` 및 `no-store`. 상세 params와 DB 풀을 읽기 전에 거부. 개인 관리는 `/login?next=%2Fcloud%2Fmanage`로 리다이렉트 호출. |

시험 후 역할 간선과 이력 ID·체크섬·`applied_at`·`xmin`도 재대조했다.

## 실행 기록과 제한

```powershell
node --conditions=react-server --import tsx tests/postgres/run-t259-pg17-read-role-local.ts
```

- 첫 실행 `tmp/t259-pg17-2f940580-4aa6-41b7-ab42-ba1e48dc6da6/`에서 이관·프로비저닝과 A/B GET·관리·익명 시험 3건은 통과했다. 직접 권한 오류를 내기 전에 측정한 PID를 오류 뒤에도 동일하다고 기대한 RLS 재사용 시험 1건은 실패했다. 원 서버 로그에서 권한 거부 두 건이 차례로 다른 backend에서 처리된 것을 확인했다. 기준 PID를 권한 거부 대조 뒤에 측정하도록 시험을 고쳤고, 역할·actor·같은 소유 backend 검증은 유지했다.
- 수정된 실행기와 시험으로 새 폐기 클러스터에서 전체를 실행했고 진단과 시험 자식 모두 exit 0이었다. 첫 PID 77996/포트 61131 및 최종 PID 78028/포트 61281에서 `pg_ctl` 종료, PID 파일·암호 파일·리스너 부재와 연결 `ECONNREFUSED`를 확인했다. 두 OS PID와 포트는 별도 조회에서도 부재했다.
- 변경한 두 시험 파일과 import 범위의 TypeScript, ESLint 경고 0 검사 통과. 전체 프로젝트의 타입 검사는 기존 `.next` 생성 타입과 이전 T257/T258 진단 실행기 오류로 막혔다. 기존 파일은 그대로 두었다.
- 완료 대상은 로컬 합성 클러스터와 앱 경로 직접 호출이다. 실제 공급자 Auth, 관리형 migration 권한·TLS, 배포 서버의 HTTP와 운영 두 계정은 후속 검증이다. 기존 역할쌍이 수용되는 범위를 확인했다. 장차 API 단독 프로비저닝이 필요하면 현재 쌍 전제를 변경할 별도 검토가 필요하다. 제품 코드·SQL·역할 가드·RLS는 유지했고 `DEC-SSL-01`은 결정 대기다.

완료 증거는 `tmp/t259-pg17-24256cec-4e8e-460f-bf13-2091d4cd5372/`에 있다.

| 파일 | SHA-256 |
| --- | --- |
| `preflight.json` | `ac8154a02f4131eeb6dc2eef8046545b7e536cdf1b595c5c7502aa992aa8194d` |
| `sql-target.json` | `f0fc9dd416fcb8fc2269a7faddfab78ae1723985d3ba40d666fb5108d424e0eb` |
| `migration.json` | `2379702db79f9865ec703365625408f2268828bc29e37f9e8151e1fdeac6a386` |
| `role-pair.json` | `fc1c966271e801e5495c1f0ef65c5685c9cf7952b706ae14f3141593545f0264` |
| `result.json` | `ff4874bd843db9e29732d1c23ea605e9fb2571f29eb9a15e1c5cbdc414063681` |
| `read-tests.log` | `a98e1fbdcbcb220abded94a421b9173289bcb7e971fd32be3c79cba83319605d` |
| `read-test-exit.json` | `ff8ae5796bcef71911ff9c5c3eaea341819c471f669549e252b830106edd4305` |
| `cleanup.json` | `be6025c031d3b4240c505a3353f3141771aa847dd5320b0bb6646654711f0ff5` |

Master 전달문 — T259의 격리 PG17.12 비슈퍼유저 이관과 제한 API 읽기 진단을 완료했습니다. 명시 migration 권한으로 최초 3건 적용, admin-only 자동 간선 확인, API 단독 역할 거절과 롤백, 기존 역할쌍 구성 뒤 재적용 0건·이력 보존을 확인했습니다. 실제 제한 로그인으로 앱 GET·개인 관리와 A/B RLS·익명 4건 모두 통과했습니다. 첫 시험의 PID 기준 문제를 고친 기록과 두 클러스터 종료 증거를 보존했습니다. 제품 변경·운영 연결은 없고 독립 검수 대기입니다.
