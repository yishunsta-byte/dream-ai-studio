# B3 Postgres driver · actor transaction · 프로젝트 조회

- 담당 Codex(Backend), 상위 CX-MASTER-01. 요청 msg_45a68014d039, portable 시험 환경 허용 msg_7b0d695e9910.
- 착수 SHA `055784ee9aaf749e7a1a841f3c1aa9011336ee7c`. 최종 검증 중 공유 HEAD `0ac750b`(Master 계획 갱신) 확인.
- 상태 **ready_review**. 구현자 자체 검증이며 독립 검수/managed Supabase 수용 완료가 아니다.
- 공통 기준 `docs/MASTER_DEVELOPMENT_PLAN.md` v1.1, B1 `30b302e`의 B3 범위 준수.

## 구현

| 파일 | 변경 |
|---|---|
| `lib/db/postgres/connection.ts` | lazy pg Pool, 명시 DSN만 수용, 유한 pool/접속·statement timeout, 원격 인증서 검증, URL query/hash 거부, loopback dream_test_*만 TLS 비활성 허용 |
| `lib/db/postgres/types.ts` | frozen branded actor와 UUID 검사, 비밀/쿼리/cause를 담지 않는 오류 코드, 제한 tx 타입 |
| `lib/db/postgres/transaction.ts` | 동일 client BEGIN/local role/바인딩 local actor/await callback/COMMIT, 실패 rollback, commit 불확실·rollback 실패·connection error client 폐기, 중첩/종료 후/외부 async context tx 사용 거부 |
| `lib/repo/postgres/projects.ts` | async list/get/stages/jobStates, owner 조건+RLS, archive 필터/기존 updatedAt 정렬, camelCase DTO, 안전 정수/UTC ISO 변환, raw JSON text 보존 |
| `tests/postgres/connection.test.ts` | 실패·설정·callback escape·DTO 경계 unit 20건 |
| `tests/postgres/projects.test.ts`, `fixture.ts` | 실제 pg/제한 login/합성 A·B integration 13건, 빈 로컬 test DB 대상 검증 |
| `tests/postgres/run-local.mjs` | signed portable binary 확인, 매번 새 cluster/loopback 포트/DB/역할, 실제 검사 후 자기 서버 종료, 로그·증거 보존 |
| `package.json`, `package-lock.json` | pg 8.23.1 및 @types/pg 8.23.1 고정 추가만. 기존 dependency 갱신 없음 |
| `.env.example`, `lib/db/postgres/README.md` | 이름만 있는 test/미래 DB 변수, 수명·보안·재현법·미전환 상태 |

DB DSN은 username/password/port/database가 모두 명시되어야 한다. DATABASE_URL 자동 읽기·운영 fallback·import 시 접속/DDL이 없다. search_path/SSL 협상/encoding은 명시한다. 드라이버 기본 bigint 전역 파서는 바꾸지 않는다. driver/provider 예외 상세나 연결 문자열은 사용자 오류로 전달하지 않는다.

callback이 query Promise를 기다리지 않았어도 실행 중 query를 모두 수집한 뒤 commit한다. query 실패를 callback이 삼켜도 성공 처리하지 않는다. COMMIT 응답이 ROLLBACK이면 실패로 간주한다. transaction-local role/actor의 범위는 같은 client 안이며 pool.query로 transaction을 나누지 않는다.

`actorFromVerifiedUserId`는 **인증기 아님**. 신뢰된 서버가 검증한 user.id에 표시를 붙이는 생성기다. B4 전까지 HTTP/인증 경로와 연결하지 않았다. tx.query는 신뢰된 repository의 SQL 전용이며 임의 SQL/SET/COMMIT를 받는 외부 실행 API가 아니다.

## 실제 시험 환경과 출처

1. PATH psql/postgres/pg_ctl/docker/podman, Postgres/Docker 서비스, 통상 설치 디렉터리를 읽기 확인했으나 기존 실행 환경을 찾지 못했다. 운영 env/DSN은 읽지 않았다.
2. Master가 portable 준비를 허용한 뒤 공식 [PostgreSQL Windows](https://www.postgresql.org/download/windows/) → [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries) 경로를 확인했다.
3. 다운로드: `https://get.enterprisedb.com/postgresql/postgresql-18.7-1-windows-x64-binaries.zip`, PostgreSQL **18.7**, msvc x64. 위치 `.tools/b3-postgres-18.7/`(ignored).
4. 수신 ZIP SHA256: `ead0bbc27fb678fa24dcf86b738981323042abd073c744103bf7f3aed23f9a33`. 공식 게시 checksum과 대조했다고 주장하지 않는다. 바이너리 신뢰 검증은 postgres/initdb/pg_ctl/createdb.exe의 **Valid Authenticode, EnterpriseDB Corporation**으로 확인했다. ZIP 목록 `archive-entries.txt`, 공식 페이지 사본 `official-download-page.html` 보존. 압축 추출 대상이 tools root 아래인지 확인했다.
5. 시스템 서비스 등록·시스템 PATH 변경·공개 bind 없음. 별도 initdb synthetic cluster, 임의 미사용 127.0.0.1 포트, 전용 dream_test_b3/제한 API LOGIN, dummy 암호만 사용했다. fixture owner와 API login을 분리하고 API는 NOSUPERUSER/NOBYPASSRLS/NOINHERIT다.

초기 수동 cluster는 `.tools/b3-postgres-18.7/run-05c99438ee5b4326875436f1fb843dca`, PID27972/port54121. 자기 pg_ctl로 정상 종료, 이후 해당 listener 0개 확인. 첫 setup에서 fixture SQL의 동일 parameter UUID/text 추론 오류로 실패했고 `$2::uuid::text`로 수정했다. 수정 후 같은 **소유 합성 DB**의 dream/auth schema·시험 role만 초기화하여 재검증했다. 제품 SQL3개는 변경하지 않았다.

첫 PowerShell 재현 파일은 머신 ExecutionPolicy로 실행이 거부됐다. 정책을 변경하지 않고 해당 미사용 파일을 Node 실행기로 대체했다. Node runner 자체로 새 cluster 생성→실제 검사→종료를 재현했다. 최초 PowerShell Start-Process -Wait가 descendant 종료까지 기다리는 현상도 있었으며 Node runner는 pg_ctl 자체 exit를 기다린다.

## 실제 검증 결과

| 검사 | 결과 |
|---|---|
| 최종 `node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin` | **2파일33 PASS**, exit0, 18:07 KST. 실제 integration13 + unit20 |
| 실제 driver 검사 | 제한 login/role/actor, A/B RLS 조회·쓰기 차단, owner 없는 직접 query 대조, actor 없음 거부, size1 pool commit/rollback 뒤 actor·role 초기화, 동시 A/B, 만료/외부 context tx 거부, 중첩 거부, unawaited query 오류 실패 처리 |
| 실제 DB 장애 대조 | temp deferred UNIQUE 위반으로 **실제 COMMIT 실패**, admin이 자기 시험 backend PID를 종료하여 **실제 ROLLBACK/접속 실패**. 각 경우 다음 transaction의 PID 교체·정상조회 확인 |
| DTO | archive 제외/updatedAt 내림차순, raw JSON 공백 포함 보존, number/UTC ISO/null, MAX_SAFE_INTEGER. 범위 초과 거부는 unit 별도 |
| `npm.cmd test` | 중간 구현 snapshot **74파일 PASS / 4파일 skip, 899 PASS / 36 skip**, exit0. 실제DB 기본 opt-in13건은 이 skip에 포함. 이후 설정·검사 보강분은 최종33건+lint/type로 재검증했으며 전체 재실행으로 표현하지 않는다 |
| 최종 `npm.cmd run lint` | exit0, 경고0 |
| 최종 `npx.cmd tsc --noEmit --incremental false` | exit0 |
| `git diff --check` | exit0 |

최종 runner 증거: `tmp/b3-postgres-878ef3bb-3255-4ff5-b368-869be5fdd9b4/`의 run.json, signatures.log, version.txt, initdb.log, listener.log, tests.log, stop.log. 앞선 재현 `tmp/b3-postgres-13b7cc53-1546-47ef-ab36-67bf22412bfc/`, `tmp/b3-postgres-ad92f967-6526-432f-a955-17f69d6ad6d9/`도 보존했다. 실제 Postgres PASS를 mock/PGlite로 대체하지 않았다. 증거 파일은 ignored 위치이며 배포·공유 업로드하지 않았다.

## 미검증 · 통합 주의 · 다음 B4

- **제품 서비스/routes/기존 SQLite/worker/고정 fixtures/발행 SQL3개/3013/.next/운영 DB/외부 Supabase는 수정하지 않았다.** Front 인증 WIP·Master/Design 문서는 선택 stage 대상에서 제외했다. npm 설치는 pg와 타입 추가만, audit 자동수정 없음.
- build/typegen은 공유 .next 보호를 위해 실행하지 않았다. 새로운 Next UI/route는 없다. 실제 managed Supabase Auth FK/login provision/pooler/TLS 인증서·배포·성능/부하·Storage는 미검증이다. SQL 자체의 독립 검수도 B3 자체 테스트와 별도다.
- 사용자 입력으로 arbitrary SQL·role·actor를 설정할 경로는 만들지 않았다. 브랜딩은 악의적인 서버 JS에 대한 격리 장치가 아니다. 신뢰된 서버/인증/자격관리 전제를 유지한다.
- B4: Front가 검증된 user UUID 반환 계약을 먼저 제공하고 Backend가 프로젝트 **읽기** 서비스/호출자부터 async로 전환한다. 기존 Response|null guard, local off, 401/403/503·no-store·Origin 규칙을 보존하며 cloud actor를 임의 생성하지 않는다.
- B4의 승인/권리 등 도메인 오류는 기존 공개 코드·DTO를 보존하도록 safe domain error 전달 계약을 별도 확정해야 한다. 현재 DB wrapper는 예상 밖 callback/driver 오류를 일괄 PG_TRANSACTION으로 정리하므로 기존 서비스를 그대로 감싸고 응답 계약이 유지됐다고 할 수 없다.
- 쓰기·Storage·worker/claim·운영 스키마 적용은 B4 읽기 범위 밖이다. 독립 reviewer는 동일 Node runner와 새 cluster에서 재현 가능하다. 신규 외부 계정·paid 작업·운영 DDL 권한은 없다.

복사/전달 메시지:

> B3 ready_review. pg8.23.1 연결/동일client transaction-local actor/프로젝트 async조회 구현. 공식 EDB18.7 서명 검증 portable의 새 합성cluster에서 최종33 PASS(실driver13+unit20), 실제 COMMIT/ROLLBACK 연결실패·PID폐기까지 확인, lint/tsc exit0. 전체 회귀는 중간snapshot899PASS/36skip으로 구분. Node runner 생성→시험→종료와 증거 보존 완료. 제품/Auth/SQL/SQLite/worker/3013/.next/managedDB 불변. 고유 B3 보고서 검토와 독립 실제PG 재검수 후 B4 인증actor+project읽기 계약 배정 요청.
