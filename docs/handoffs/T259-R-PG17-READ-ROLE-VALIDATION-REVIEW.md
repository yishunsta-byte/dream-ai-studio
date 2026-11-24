# T259-R PostgreSQL 17 제한 역할과 프로젝트 읽기 독립 검수

**판정. 로컬 합성 PG17.12의 비슈퍼유저 이관, 기존 로그인 역할쌍 및 제한 API 읽기 검증을 수용한다.** 기존 v2 이관으로 최초 3건, 역할쌍 생성 뒤 재적용 0건을 확인했다. 제한 DB 로그인에 합성 `getUser` 응답을 연결한 앱 시험은 4건 통과했다. 단일 API 로그인 구성은 현재 이관 검사에서 거절된다. 실제 공급자 인증, 관리형 권한·TLS, 배포 HTTP와 전체 프로젝트 타입 검사는 별도 판정으로 남는다.

기준은 `e5e986971b6b400e541606c1cf365c204ff732b0`과 [작업자 보고](T259-PG17-READ-ROLE-VALIDATION.md)다. 이전 `54059387c84566163d507408459bd1a9791c37b6` 대비 추가 파일은 작업자 보고와 실행기·시험 두 파일뿐이다. 제품 소스·마이그레이션 SQL·manifest·RLS·역할 템플릿은 변경되지 않았다. 지정 결과 경로의 충돌 없음을 확인하고 Orca `msg_b07714719d09`로 수락했다. 최종 실행의 증거 파일 8개와 도구 SHA-256 3개가 기록과 일치했다. 검수 중 DB를 재실행하거나 접속하지 않았다.

## 비슈퍼유저 이관과 역할쌍

`tmp/t259-pg17-24256cec-4e8e-460f-bf13-2091d4cd5372/`의 `sql-target.json`, `migration.json`, `role-pair.json`, `result.json`과 backend별 서버 로그를 대조했다. 보존된 연결은 PG17.12(`170012`) UTF-8/C의 루프백 폐기 DB였다. 합성 bootstrap으로 Auth UUID 두 행을 준비했고 이관은 실제 `t259_migration` 로그인으로 수행됐다.

| 항목 | 독립 대조 결과 |
| --- | --- |
| 이관 역할 | 실제 접속 증거에서 `CREATEROLE`, DB `CREATE`, `auth` `USAGE`, `auth.users` `REFERENCES`가 확인됐다. SUPERUSER·BYPASSRLS·CREATEDB·INHERIT·REPLICATION 및 `auth.users` SELECT는 부재했다. Bootstrap은 다른 연결에서 관리·정리에만 사용됐다. |
| dry-run과 최초 apply | 빈 상태 dry-run은 `fromVersion=null`, `applied=0`, `pending=3`. 최초 apply backend `75216`의 SQL 1~3 로그 본문을 복원해 고정 로더 본문의 SHA-256과 대조했다. advisory lock 1회, 이력 INSERT 3회, COMMIT 1회, ROLLBACK 0회. 합성 Auth 두 행과 manifest 이력 3행이 기록됐다. |
| 자동 간선 | 두 NOLOGIN 런타임 역할로 향하는 간선의 member는 migration owner, grantor는 bootstrap이었다. 모두 ADMIN true, INHERIT false, SET false였다. 실제 이관 연결의 자동 간선이 기존 owner 예외에서 수용됐다. |
| API 로그인 단독 | backend `4812`에서 API 로그인과 의도된 간선을 만들어 제품 상태 검사기가 `MIGRATION_STATE`로 거절했다. 같은 세션의 COMMIT 0, ROLLBACK 1을 확인했다. 실행기는 이후 별도 읽기의 스키마·이력·역할과 간선을 단독 구성 전 값과 대조했다. |
| 기존 역할쌍 | 템플릿은 두 `PASSWORD NULL` 로그인으로 시작했다. API·worker 로그인은 각각 자기 역할에만 ADMIN false, INHERIT false, SET true로 연결됐다. Migration owner의 admin-only 간선 4개를 합쳐 저장된 간선은 6개였다. 격리 fixture는 API에만 인증 자격을 설정하도록 구성됐다. Worker로 전환하려는 API 연결은 서버에서 거절됐다. |
| 재적용과 읽기 이후 보존 | 재적용 backend `10924`는 advisory lock을 잡고 COMMIT했으며 이력 INSERT는 0회였다. `fromVersion=3`, `applied=0`, `pending=0`이 기록됐다. 실행기는 역할쌍 구성 뒤와 읽기 시험 뒤에 별도 스냅숏을 대조해 최초 이력 ID·체크섬·`applied_at`·`xmin` 및 기대 역할 간선을 확인했다. 서버 로그에서 조회를 확인했으며 별도 raw 반환값은 보존하지 않았다. |

API 단독이 필요해지면 제한 로그인 이름 변경으로 처리할 수 없다. 스키마 3의 기존 역할쌍 제약과 재적용 계약을 별도 변경·검토해야 한다. 이번 수용은 기존 쌍을 사용하는 경로다. [이관 실행기](../../tests/postgres/run-t259-pg17-read-role-local.ts) · [역할 검사](../../lib/db/postgres/migration-state-v2.ts) · [프로비저닝 템플릿](../../lib/db/postgres/provision-template.ts)

## 실제 제한 로그인과 합성 인증의 4개 앱 시험

최종 `read-tests.log`의 4/4 통과와 `read-test-exit.json`의 시험 자식 exit 0을 확인했다. PostgreSQL 연결은 실제 `dream_api_login`이었다. 시험은 `createSupabaseServer().auth.getUser()` 응답과 풀 선택, Next 리다이렉트 실행을 대역으로 두고 GET 핸들러와 개인 관리 컴포넌트를 직접 호출했다. 제품 인증 판정과 소유권 서비스는 이 경로에서 실행됐다. 같은 루프백 PG에 실제 쿼리를 보냈으며, 실제 Supabase 세션이나 Next HTTP 서버는 시험에 포함되지 않았다. [고정 시험](../../tests/postgres/t259-pg17-read-role.test.ts)

| 시험 | 확인 범위 |
| --- | --- |
| 제한 로그인과 RLS | 권한 거부는 DB 로그에 직접 남았다. `dream_api_login`의 직접 프로젝트 SELECT와 `SET ROLE dream_worker`가 각각 실패했다. 정상 backend `40036`에서 API role의 actor 없는 직접 SELECT, actor A·B의 owner 조건 없는 SELECT 2회, 각 트랜잭션의 PID·role·actor 조회를 확인했다. actor 없는 조회 0행, A/B 자기 행만 반환, 종료 후 같은 backend의 login 역할·빈 actor는 고정 테스트 단언과 4/4 결과로 확인했다. |
| A와 B의 GET 두 시험 | 목록 A 1건·B 2건 및 자기 상세 200. 상대·보관·미존재 상세는 동일 404 본문, 목록과 비교 대상 거부 응답에 `no-store`. 동작은 테스트 단언과 실제 프로젝트·단계 조회 로그에 근거한다. |
| 개인 관리 | 위 두 시험에서 실제 컴포넌트 렌더가 A 1개·B 2개, 조회 시각을 표시하고 상대 식별자를 포함하지 않았다. |
| 익명 GET·개인 관리 | 목록·상세 401과 `no-store`. 상세 파라미터 getter와 DB 풀 호출 전에 거절되고 관리 컴포넌트는 `/login?next=%2Fcloud%2Fmanage`로 리다이렉트 호출했다는 테스트 단언을 확인했다. |

첫 시험 로그는 **3통과·1실패**, 자식 exit 1이었다. 직접 SELECT 거부 직전 기준 PID는 `5168`, 이어진 worker 거부 PID는 `15528`, 그다음 트랜잭션 PID는 `65544`였다. 실패한 테스트는 첫 PID가 이후에도 같다고 가정했다. 설치된 `pg-pool`의 `Pool.query` 오류 경로는 `release(err)`를 호출하며, 세 PID의 로그와 부합한다. 최종 시험은 권한 거부가 끝난 뒤 `40036`을 기준으로 잡고 정상 A/B 트랜잭션의 동일 세션과 actor 정리를 확인했다. 첫 실패 결과는 보존했다.

## 타입 검사와 종료

- `tmp/t259-typecheck.json`은 새 실행기·시험과 import 범위를 선택하며 해당 범위 통과와 린트 통과는 작업자 기록이다. 전체 타입 검사 원본 `tmp/t259-whole-typecheck.log`에는 오류 헤더 22개가 있었다. `.next/types`와 `.next/dev/types` 생성 validator에서 4개, 기존 T257·T258 진단 실행기에서 각 9개다. 후자의 오류는 `NODE_ENV`가 필수인 `ProcessEnv`에 환경 맵을 넘기는 overload에서 발생한다. 전체 로그에 이번 T259 두 파일의 오류는 없었다. **전체 타입 검사는 미통과**로 기록한다.
- 첫 PID `77996`/포트 `61131`, 최종 PID `78028`/포트 `61281` 각각의 shutdown 로그와 `cleanup.json`에서 PID·리스너·PID 파일·임시 초기화 파일 부재 및 `ECONNREFUSED`를 대조했다. 검수 당시 Windows 프로세스와 로컬 TCP 리스너 목록에도 해당 두 PID와 두 포트가 없었고 두 `postmaster.pid`, `init-password.txt`도 부재했다. 연결 거절은 보존 기록에서 읽었다. 두 서버 로그에서 실제 암호 리터럴을 담은 해당 `ALTER ROLE` 문장은 발견되지 않았다.
- 별도 실행 없이 이 로컬 범위를 수용할 근거가 충분하다. 관리형 스테이징의 비슈퍼유저 이관 권한, 제한 로그인, 실제 Auth와 두 계정의 배포 HTTP, CA 및 양 구간 TLS는 별도 증거를 요구한다. `DEC-SSL-01`은 기존 대기 상태다.

## Master 전달용

> T259-R 오프라인 독립 검수 완료. e5e9869와 보존 해시 8개, 제품/SQL 무변경을 확인했습니다. PG17 비슈퍼유저 이관 최초 3건, 자동 admin-only 간선 2개, API 단독 거절/롤백, 기존 역할쌍 뒤 재적용 0건을 대조했습니다. 실제 제한 API DB 로그인과 합성 getUser를 사용한 RLS, A/B GET·개인 관리, 익명 시험은 최종 4/4입니다. 첫 실패는 권한 오류 전 PID를 재사용 기준으로 둔 시험 문제이며 역할·actor 복귀 검증은 최종 시험에 유지됐습니다. 두 소유 서버 종료를 확인했습니다. 전체 타입 검사 미통과는 기존 Next 생성 타입과 T257/T258 실행기 오류이며, 관리형 Auth·TLS·배포는 후속 범위입니다. 결과는 `docs/handoffs/T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md`입니다.
