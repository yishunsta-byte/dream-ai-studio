# B4-R 프로젝트 읽기 서비스 독립 검수

- 대상: `e260310998eccb87cd4cee6da77b6dcdb1e7295f`, B4-S 보고서 전문, B4-C 계약, T191 Auth resolver 보고서/코드의 읽기 전용 계약 대조.
- 판정: **bounded PASS**. 신규 읽기 서비스·고정 isolation·안전 오류 범위에서 새 필수 결함은 발견하지 않았다. 구현자 자체 검증과 아래 독립 실행은 별개다. 고유 보고서 외 제품 파일은 변경하지 않았다.
- production API/page/Auth와 아직 연결되지 않았다. managed 적용·전체925 회귀·클라우드 공개·B4-I 수용 완료를 뜻하지 않는다.

## 소스와 실행 경계

`git archive e260310`을 OS-temp root `C:/Users/Administrator/AppData/Local/Temp/b4-service-review-b723abe029674c9585f7dbcddab94891/app`에 고정했다. 커밋 변경8파일 모두 `git hash-object --path`로 저장소 EOL 규칙을 적용한 blob을 비교해 **8/8 일치**했다(`source-identity.json`). 이전 검수의 물리 node_modules를 다시 물리 복사했으며 설치·package/lock 변경은 없다.

API/pages/Auth·발행 SQL3개·package/lock·고정 fixtures는 이 커밋에서 diff0임을 확인했다. 사용자 DB/managed DB·운영 DSN·3013/shared `.next`·새 외부 계정/유료 작업·production DDL은 사용/변경하지 않았다. typegen만 고유 사본 `.next`에서 실행했다.

동일 `D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin`을 읽기 전용 실행 대상으로 사용했다. postgres/initdb/pg_ctl/createdb4개 모두 **Valid Authenticode / EnterpriseDB Corporation**, 전후 SHA 동일이었다. 각 SHA는 B3-R과 같다: postgres `4e67c961…`, initdb `1bb6b320…`, pg_ctl `5083fb93…`, createdb `692219ed…`(전문은 전후 JSON). version 출력은 PostgreSQL18.7이다. portable 설치 파일·시스템 PATH/서비스를 고치지 않았다.

## 실제 driver 실행

```text
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

| 실행 | 이번 결과 | 소유 postmaster/loopback port |
|---|---|---|
| B4 suite | **3파일51 PASS = 실제B4 integration9 + unit42(B3 20/B4 22)**, 779ms, exit0, 18:35:00 KST | PID55144 / 50606 |
| 기존 B3 기본 suite | **2파일33 PASS = 실제B3 integration13 + unit20**, 948ms, exit0, 18:35:54 KST | PID48264 / 63541 |
| 영향9파일 회귀 | **259 PASS**, 7.07초, exit0 | 단위/로컬 회귀, 실제PG와 구분 |
| 독립 추가10 대조 | **10 PASS**, 248ms, exit0 | driver 대역/실제DB 아님 |
| 전체 ESLint 최종/next typegen+tsc noEmit | 각각 exit0 | 사본만 사용 |

두 runner는 각각 새 `dream_test_b3` DB·합성 Auth A/B·제한 API login·전용 cluster를 만들었다. 원본 시험/runner를 수정하지 않았다. 숫자는 명령별 결과이며 반복된 unit20 등을 추가 고유 시험으로 합산하지 않는다. 영향9파일은 projects/planning/jobs/api-auth/t182/t183/t191/B3 connection/B4 backend다. 새 route/UI·production 연결 변경이 없어 전체925 suite와 production build는 반복하지 않았다.

## Snapshot·DTO·owner 증거

실제 B4 통합9개에서 다음 단언을 독립 실행했다.

- 서버의 `transaction_isolation=repeatable read`, `transaction_read_only=on` 확인 및 UPDATE 거절. 임의 mode SQL 문자열은 connect 전에 PG_CONFIG 거절.
- 첫 project SELECT 직후 별도 admin 연결의 **한 SQL statement**로 title/revision/stages를 원자적으로 변경했다. 진행 중 서비스 응답은 Original/기존 stage/queued/brief를 유지했고, 다음 요청은 New snapshot/failed stage/warning/intake를 반환했다. sleep 시간 추정으로 snapshot을 주장하지 않는다.
- A/B 각각의 목록·get·7단계가 자기 owner 자료만 반환. 다른 owner와 없는 UUID는 같은 NOT_FOUND404, archive는 list/get에서 제외됐다.
- raw snapshot/inputs의 공백·한글 원문 보존, decoded inputs, number/UTC ISO·기존 상태/nextStage·ownerId 비노출 확인. snapshot `{}`·inputs 배열·누락 stage를 실제 소유 test DB에서 만들어 PROJECT_READ_UNAVAILABLE503을 확인하고 fixture를 복원했다.
- 발급 NOT_FOUND callback은 정상 rollback 뒤 같은 안전 객체로 보존. 모양만 같은 object는 PG_TRANSACTION. SQL 실패 뒤 발급 NOT_FOUND를 던져도 DB 실패가 우선해 public503. 완료된 tx 사용은 TX_CLOSED.

동일 snapshot 요구를 READ COMMITTED와 혼동하지 않는다. [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html)과 [BEGIN](https://www.postgresql.org/docs/current/sql-begin.html)을 확인했으며 실제 상태/query interleave 결과로 대조했다. 정렬/안전 정수/null·role/claim 초기화·동시 actor·미대기 SQL 실패·실제 deferred COMMIT 실패와 backend 종료/ROLLBACK 연결 실패·client 폐기/PID 교체는 이번 **기존 B3 통합13 및 unit20의 재통과**로 확인했다. B4가 B3 기본 BEGIN 동작을 read-only로 바꾼 것으로 처리하지 않는다.

## Selector·오류 classifier 독립 점검

pure selector는 명시 env/authMode 입력만 사용한다. 로컬 default/sqlite, Vercel missing/sqlite/unknown 거절, postgres+auth off503, 누락/불량 DSN503, 명시 postgres 결과의 truth table을 원본22 unit에서 확인했다. 프로덕션 env/SQLite를 자동 탐색하거나 DB 실패를 다른 backend로 전환하는 경로는 없다.

독립 추가10개는 고유 사본의 `tests/reviewer-b4.test.ts`에만 두었다.

- query 실패·ROLLBACK 실패·COMMIT 실패·connection error가 있으면 **항상 true를 반환하는 trusted classifier를 제공해도** classifier 호출0·PG_TRANSACTION/public503. rollback/commit/connection 불확실 client는 release(true).
- classifier 자체 예외도 callback/driver의 비밀 sentinel을 노출하지 않음. 미대기 query 실패와 발급 NOT_FOUND가 겹쳐도 DB 오류 우선.
- 발급 domain error는 건강한 rollback 후에만 보존·release(false). JSON-shaped classifier는 connect 전 PG_CONFIG.
- 같은 prototype/악의적 status·message·code getter를 가진 외부 오류는 getter를 읽지 않고 fixed503. driver acquisition 실패 때 SQLite openDatabase 대역 호출0.

이 대조는 typed factory/WeakSet·frozen instance의 신뢰 경계와 source 검토를 보완한다. public service가 사용하는 classifier는 `isProjectReadError`로 고정됐고 HTTP에서 classifier/SQL/mode를 받는 API는 없다. 악의적인 서버 JS 자체를 격리한다는 뜻은 아니다. 임의 callback 원문/SQLSTATE/DSN/stack/cause를 public descriptor로 복사하지 않는다. 실제 API/HTML/로그의 end-to-end 비밀 검사를 실행했다는 주장도 하지 않는다(생산 호출이 미연결).

추가 검증기의 최초 lint 실패는 type predicate 인자가 타입에만 쓰인 미사용 인자였으며, 고유 검증기에서 `void` 사용을 추가해 전체 lint를 재실행해 통과했다. 제품 코드를 고쳐 통과시킨 것이 아니다.

## T191·후속 경계

T191의 local/verified{소문자UUID,email}/denied 계약과 실제 resolve 코드 순서를 읽었다. 후속 adapter는 verified.userId만 actor로 전달하고 denied를 기존 응답으로 처리해야 한다. 서비스는 Auth를 호출하거나 이메일/HTTP owner에서 actor를 만들지 않는다. requireApiAuth와 resolver 이중 호출·RSC 요청 간 cache·미전환 SQLite 쓰기 혼합 차단은 이번 연결 완료 항목이 아니다. 인증259 회귀 통과를 실제 서비스/Auth 통합 수용으로 바꾸지 않는다.

managed Supabase login/Auth FK·direct/session/transaction pooler·TLS handshake/인증서 검증·Storage·성능·실데이터·운영 배포는 별도 미검증이다. 기존 SQL18표/36정책의 managed 적용 완료나 전체 정책 행렬 검증을 주장하지 않는다. B4-I/G/U의 API/RSC/읽기 전용 화면·미전환 경로 차단이 남는다. 브라우저는 열지 않았다.

## 소유 프로세스·증거·잔존

소유 run 경로는 `app/tmp/b3-postgres-fabf3d17-3526-425e-b288-e936045da95d`(B4)와 `app/tmp/b3-postgres-ea9982b1-33ac-4859-b74b-81c149821f62`(B3)다. 각 stop.log는 server stopped, runner exit0이며 후속50606/63541 listener 없음·고유 root의 postgres/node 프로세스 없음이다. 사용자3013은 전후 PID51032로 동일하다.

root의 b4-runner.log/b3-regression.log/related.log/independent-controls.log/lint.log/lint-final.log/type.log/source-identity.json/binaries-before.json/binaries-after.json, 두 run의 run.json/signatures/version/listener/tests/stop 로그와 독립 harness를 보존했다. 보고서 이외에는 커밋하지 않는다. 기존 untracked T157 보고서도 보존했다.

고유 OS-temp app 경계를 확인하는 PowerShell 재귀 삭제 요청은 자동 승인 검토가 실행 전에 **`blocked by policy`로 거절**했다. 우회하지 않았다. 정지된 cluster2개·가짜 암호/자료·물리 의존성을 포함해 **36,425파일 / 909,301,100바이트**가 root에 잔존한다. 설치 portable 바이너리는 삭제 대상이 아니다.

## Master 전달문

B4-R e260310은 bounded PASS입니다. 새 실제PG cluster의 B4 integration9/unit42와 기존B3 33, 관련259·독립오류대조10·lint/type가 통과했고 snapshot 동시갱신/owner/404/누락stage503·DBfailure 우선과 fallback없음을 확인했습니다. production Auth/API/RSC·managed/pooler/TLS는 미연결·미검증이며 소유 서버2개는 종료했고 자동 승인 검토의 삭제 거절로 약909 MB 사본이 잔존합니다.
