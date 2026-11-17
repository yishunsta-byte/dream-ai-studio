# B4-S 신규 Postgres 프로젝트 읽기 서비스 기반

- 담당 Codex(Backend), 상위 CX-MASTER-01, 요청 msg_ea7400baf76e.
- 착수 SHA `0829b861ca28a5932371a18431acfed852edc557`. 검증 중 Master/Front 통합이 진행되어 HEAD `42798971650354baa1b36d19e70976d8f6079825`를 확인했다.
- 입력: B4-C `0575493`, B3 `994a894`, B3-R 독립 bounded PASS `0199fa7`. B3-R 보고서를 읽었으며 이번 변경은 추가 독립 검수 대상이다.
- 상태 **ready_review, 구현자 자체 검증**. 생산 route/API/page는 미연결이며 cloud read 개방/managed 적용 완료가 아니다.

## 변경 파일과 동작

| 파일 | 구현 |
|---|---|
| `lib/services/postgres/project-read-backend.ts` | pure selector: 명시 env 객체·auth mode 입력만 수용. 로컬 default/sqlite 유지, Vercel sqlite/미설정 차단, postgres+auth off 503 AUTH_UNAVAILABLE, invalid/DSN 누락·불량 503. postgres 실패를 SQLite로 우회하지 않음 |
| `lib/services/postgres/project-read-errors.ts` | 발급된 immutable typed 오류만 허용. AUTH_REQUIRED401/AUTH_UNAVAILABLE503/INVALID_INPUT400/NOT_FOUND404/PROJECT_READ_UNAVAILABLE503. unknown Error/object의 message/status/code/stack/cause를 외부 결과에 복사하지 않음 |
| `lib/services/postgres/project-reads.ts` | `postgresProjectReads(pool).list(actor)` / `.get(actor,id)`. 검증된 branded actor 필수, Auth/환경/SQLite 직접 접근 없음. B3 repo 사용, 읽기 전용 repeatable-read, 같은 tx에서 project+states+jobs 수집 후 DTO 생성 |
| `lib/db/postgres/transaction.ts` | 선택 인자에 고정 `mode:'read-only-repeatable-read'` 추가. default B3 BEGIN 동작 유지. 임의 isolation 문자열 거부. trusted `preserveDomainError` classifier를 선택 제공 가능 |
| `tests/postgres/project-read-backend.test.ts` | selector·safe 오류·no actor·ID/driver fail-closed 단위 22건 |
| `tests/postgres/project-reads.test.ts` | 실제 서비스/동일 snapshot/owner·callback 오류·readonly/tx 탈출 통합 9건 |
| `tests/postgres/run-local.mjs` | 고정 `b4` suite 옵션만 추가. 기본 B3 실행은 그대로. suite마다 새 합성 cluster·DB를 사용 |

함수/DTO 계약:

- selector는 `{backend:'sqlite'}` 또는 `{backend:'postgres',connectionString}`만 반환한다. 연결 문자열은 서버 내부 비밀이며 이 모듈이 process.env/파일을 읽거나 pool을 만들지 않는다. sqlite 결과를 반환했다고 신규 SQLite adapter가 구현된 것은 아니다.
- service는 pool을 명시 주입받고 branded actor 없으면 connect 전 AUTH_REQUIRED401. bare `{id:uuid}`를 인증 사용자로 취급하지 않는다. local auth off는 selector에서 postgres 진입을 거절한다. 실제 T191 Auth denied403은 후속 adapter가 기존 authDeniedResponse로 처리해야 하며 이 서비스가 이메일 허용 목록을 재판단하지 않는다.
- list: 기존 id/title/menuId/menuLabel/aspect/lengthSec/updatedAt/status/states/nextStage를 보존한다. 상태·nextStage는 기존 domain helper를 사용한다. get: 기존 project/snapshot/inputs/states, camelCase·number·ISO/null·저장 JSON 원문을 보존한다. ownerId를 새 client 필드로 넣지 않는다.
- project id invalid400, 없음/타 owner/archive는 동일 NOT_FOUND404. snapshot·inputs JSON/Zod 실패, metadata 불일치, 7단계 누락/중복/잘못된 상태, 알 수 없는 job 상태 등은 503으로 닫는다. 조용히 빈 데이터로 바꾸지 않는다.
- 예상 NOT_FOUND와 DTO 검증은 transaction 완료 뒤 생성한다. DB callback 내부의 typed domain 오류도 classifier가 발급 여부를 검증한 경우에만 **정상 rollback 후** 보존된다. query/connection/rollback 실패 또는 불확실 COMMIT가 있으면 domain error로 위장하지 못하고 DB 안전 오류가 우선한다. classifier가 예외를 던져도 원문 오류를 노출하지 않는다.
- `projectReadFailure(unknown)`은 안전한 `{status,body:{error,code},headers:{cache-control:'no-store'}}` descriptor만 제공한다. 새 HTTP route/Response는 만들지 않았다. 임의 내부 500/SQLSTATE/driver 메시지는 fixed 503 PROJECT_READ_UNAVAILABLE로 변환한다.

## isolation 변경 근거와 경계

공식 [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [BEGIN](https://www.postgresql.org/docs/current/sql-begin.html)을 2026-11-17 확인했다. 기존 기본 READ COMMITTED의 연속 query는 같은 snapshot을 보장하지 않으므로 새 service만 고정 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`를 사용한다. 동적으로 SQL 옵션을 조립하지 않는다. B3의 일반 read/write transaction은 기본 BEGIN을 유지한다.

추가된 domain classifier는 서버 내부 신뢰 정책이다. `isProjectReadError`는 외부 object의 name/code/status 모양이나 prototype만으로 허용하지 않고 자체 발급 WeakSet에 등록된 frozen instance만 인정한다. 이것은 악의적 서버 JS를 sandbox하는 기능이 아니며 HTTP에서 classifier/SQL/mode를 받는 API는 없다.

## 실제 검증

portable PostgreSQL18.7과 B3에서 검증한 동일 EDB 서명 바이너리를 사용했다. 기존 설치/서비스/PATH/운영 env/실 DSN은 사용하지 않았다. 각 runner는 새 tmp cluster, loopback 고유 포트, dream_test_b3, 합성 Auth A/B, 제한 API login을 provision하고 종료했다.

| 명령 | 실제 결과 |
|---|---|
| `node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4` | **3파일51 PASS = B3 unit20 + B4 unit22 + 실제 B4 integration9**, exit0, 18:28 KST |
| 기본 `node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin` | **2파일33 PASS = B3 unit20 + 실제 B3 integration13**, exit0. 기존 commit/rollback/actor/pool 회귀 포함 |
| 관련9파일 vitest(projects/planning/jobs/api-auth/t182/t183/t191/B3 unit/B4 unit) | **259 PASS**, exit0, 18:29 KST |
| `npm.cmd run lint` | exit0, 경고0 |
| `npx.cmd tsc --noEmit --incremental false` | exit0 |
| `git diff --check` | exit0 |

숫자는 명령별 결과이며 반복된 B3 unit20 등을 추가 검사로 합산하지 않는다. 전체 suite는 이번에 반복하지 않았다. build/typegen은 공유 .next 보호를 위해 실행하지 않았다. API/화면 변경이 없으므로 브라우저 동작/managed 접속 완료로 표현하지 않는다.

실제 B4 integration9의 핵심:

1. list/get DTO·한글/공백 포함 raw JSON·정수/ISO·7단계·A/B 소유자 분리를 실제 driver로 확인.
2. 타 owner/없는 UUID 동일404, archive 제외 확인.
3. callback에서 발급 NOT_FOUND를 throw하면 rollback 후 같은 안전 객체 보존. 모양만 같은 object는 PG_TRANSACTION으로 차단. size1 다음 B actor 정상 확인.
4. 실제 `transaction_isolation=repeatable read`, `transaction_read_only=on`, UPDATE 거부 및 알 수 없는 mode가 connect 전에 거부됨 확인.
5. 첫 project SELECT 직후 **다른 admin 연결의 한 SQL statement**가 title/revision/stage 상태를 원자적으로 변경하도록 interleave했다. 진행 중 서비스 조회는 기존 title+기존 stages/status/nextStage를 유지하고, 다음 새 요청에는 변경 title+failed stages가 반영됨을 확인했다. 대기 시간 추측 대신 query 완료 시점에 대조했다. revision 후퇴 없이 표시 상태만 복원했다.
6. snapshot `{}`, inputs 배열, stage 누락을 실제 DB에 합성으로 만들고 fixed503을 확인한 뒤 fixture를 복원했다. 운영 데이터나 고정 fixture는 변경하지 않았다.
7. SQL 실패 뒤 callback이 NOT_FOUND를 대신 throw해도 queryFailed가 우선하여 PG_TRANSACTION→public503으로 처리됨 확인.
8. callback 완료 후 tx.query는 TX_CLOSED로 거부됨 확인.

## 증거와 종료

- B4 실제 run: `tmp/b3-postgres-7857434b-91e4-4151-b3db-b5e89751e40c/`, postmaster PID78764, port58761, bind127.0.0.1. tests.log/signatures.log/version.txt/listener.log/run.json/stop.log 보존.
- B3 회귀 run: `tmp/b3-postgres-c55bf6d4-b7f3-4d5d-812e-7be06ac3cb1e/`, 동일 형식 증거 보존.
- 각 runner stop.log는 server stopped, exit0. 후속 확인에서도 두 run의 PID 파일 없음·해당 listener0(58761/49475)을 확인했다. 바이너리와 증거/합성 DB는 삭제하지 않았다.

## T191 대조와 다음 B4-I

Master msg_5aaf8f1b49e0와 `T-191-AUTH-RESOLVER.md`, 실제 `lib/auth/resolve.ts`를 읽었다. local/verified{lowercaseUUID,email}/denied{status,code}는 B4-C와 일치한다. 독립 T193 수용 여부는 이번 Backend가 대신 판단하지 않는다. Backend는 Auth 파일에 import 연결이나 수정을 하지 않았다.

B4-I adapter는 route에서 resolveServerAuth 1회, denied는 authDeniedResponse, verified.userId만 actorFromVerifiedUserId로 전달해야 한다. requireApiAuth+resolver 이중 호출·이메일→UUID·local actor 임의 생성은 금지한다. selector에 authMode를 명시 전달하고 pool 수명/secret 환경 접근을 별도로 관리한다. RSC는 T191 getRenderAuth를 쓰고 요청 간 인증/조회 결과를 공유하지 않는다.

남은 범위: 실제 API/RSC 연결, legacy API/RSC의 SQLite 혼합 접근 차단, read-only UI·오류 경로, managed Supabase login/pooler/Auth/TLS 검증과 독립 review. 이번에는 Auth/API/pages/기존 SQLite services/worker/발행 SQL3개/migration/package/3013/.next/운영 DB·production DDL을 변경하지 않았다. 다른 세션의 UI/browser WIP·미추적 고유 보고서는 선택 stage에서 제외한다.

복사/전달 메시지:

> B4-S ready_review. 신규 postgresProjectReads/typed safeerror/pure backendselector와 fixed read-only repeatable-read 옵션 구현, 생산호출은 미연결. 실제PG B4 9건 포함51PASS·기존B3 33PASS·영향9파일259PASS·lint/type exit0. 동시갱신 snapshot·owner/404·callback domain보존/driver우선503·rawDTO·tx탈출 확인. T191 DTO코드대조일치,Auth/제품/API/SQLite/SQL/package/3013/.next/managed불변. 고유 B4-S 보고서와 실제 Node runner 증거로 독립검수 요청, 이후 B4-I 배정 필요.
