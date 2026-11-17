# B3 Postgres 연결·actor transaction 독립 검수

- 대상: `994a894`(`B3: add Postgres actor transactions and async project reads`), B3-POSTGRES-CONNECTION 보고서 전문·새 driver/repository/test/runner 및 README.
- 판정: **bounded PASS**. 아래 실제 direct PostgreSQL 및 코드/대조 검수 범위에서 새 필수 결함은 발견하지 않았다. 구현자가 아닌 독립 검수이며 제품 파일은 수정하지 않았다.
- 새 고정 사본에서 원본 runner를 그대로 실행했다. 작성자의 중간 전체899/36skip·최종33 자체 결과와 이번 수치는 별개다. managed Supabase/운영 적용·B4 읽기 서비스 전환 완료 판정은 아니다.

## 사본·바이너리·안전 경계

`git archive 994a894`를 `C:/Users/Administrator/AppData/Local/Temp/b3-pg-review-68f4c12e43104e8e9b3883d818a1e1f2/app`에 고정했다. 설치본 node_modules를 물리 복사했으며 npm 설치·갱신·audit fix는 하지 않았다. 사용자3013/shared `.next`/사용자 DB/managed DB/기존 fixture/SQL 발행·설치 바이너리 변경은 없다. 실제 환경 파일/운영 DSN·새 외부 계정·유료 작업은 사용하지 않았다.

동일 portable 경로 `D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin`을 **읽기 전용 실행 대상으로** 사용했다. 공식 [PostgreSQL Windows](https://www.postgresql.org/download/windows/)가 안내하는 [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries) 출처 경로를 독립 확인했다. 기존 ZIP SHA256 `ead0bbc27fb678fa24dcf86b738981323042abd073c744103bf7f3aed23f9a33`는 작성자 기록과 같았다. 새 다운로드나 공식 게시 checksum과의 대조를 했다는 뜻은 아니다.

| 실행 파일 | 이번 전후 SHA256 | Authenticode |
|---|---|---|
| postgres.exe | `4e67c961ac182a36c44a18fefcb5548d1ad5b40b252abb9cfa1259112d7faf75` | Valid EnterpriseDB Corporation |
| initdb.exe | `1bb6b320887e52e45d1cdf0e7db57aded35854992cabc31bdba525f774708483` | 동일 |
| pg_ctl.exe | `5083fb9353a569ab00cefb8bee79f2e9b98b96ae527fdae2fb30a2737d11aff4` | 동일 |
| createdb.exe | `692219edc530da333f9ed3477f72d9be043ac88a5073f2d966b9125ea5c2472b` | 동일 |

별도 전후 서명/해시 JSON 대조는 동일 true였다. 실행 version은 **PostgreSQL18.7**이다. 시스템 서비스/PATH/설치 파일을 바꾸지 않았다.

## 실제 새 클러스터 실행

```text
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

원본 runner의 실행 exit0, **2파일33 PASS = 실제 integration13 + unit20**, 904ms(시험 구간)였다. 생성/서명/종료까지 포함한 명령은 약8.6초였다. 2026-11-17 18:13:48 KST 시작이다.

- 신규 소유 cluster: `app/tmp/b3-postgres-271f59dc-ec1b-4d7a-8a41-30c696e492c3/cluster`.
- postmaster PID **64004**, 포트 **52329**, bind **127.0.0.1**, DB **dream_test_b3**. runner의 listener.log에서 소유 loopback listener 검증 통과.
- 합성 auth.users A/B와 제한 API login만 사용했다. 새 빈 test DB에 fixture가 기존 SQL을 적용한 것이며 운영 SQL 발행이 아니다.
- 최종 stop.log `server stopped`, runner exit0. 후속52329 listener 없음, 고유 root를 사용하는 postgres/node 프로세스 없음. 사용자3013은 전후 PID51032로 동일하다.

요청의 max1 동시 재사용을 명확히 하려고 원본 사본을 별도 보존한 뒤 **검수 사본 test에만 1개 통합 case**를 추가했다. 두 번째 새 cluster `app/tmp/b3-postgres-1b799580-dafd-4cbd-957e-07c7d4234972`에서 **14 integration+20 unit=34 PASS**(861ms, 18:19:51 KST), runner exit0이었다. max1에 A/B를 Promise.all로 동시에 대기시키고 pg_sleep을 거쳐 **같은 backend PID 재사용·각 actor A/B 및 PA/PB 자료 격리**를 확인했다. 이는 최초 원본33 무수정 실행과 별도이며 추가34개라고 합산하지 않는다. 두 번째 postmaster PID76900/port62885도 정상 stop·listener0·소유 프로세스0을 확인했다.

## 요구 경계의 실제 증거

원본 통합13개를 수정하지 않고 실행했다. 다음은 해당 단언이 실제 driver/server에서 통과한 범위다.

- 제한 login이 schema owner/superuser/BYPASSRLS가 아님, transaction의 current_user=dream_api와 actor A, 허용 계정의 프로젝트 조회.
- repository owner 조건뿐 아니라 owner 조건 없는 직접 SELECT도 A만 반환, B의 UPDATE는 빈 결과, 다른 actor 소유 INSERT는 RLS 거절.
- 없거나 unbranded actor는 connect 전에 거절. dream_api에서 actor unset이면 조회0/쓰기42501.
- **max1 pool**에서 commit/rollback 뒤 같은 backend의 login role 복귀·actor null, 직접 dream.projects 권한 거절, B 재사용과 A 원래 제목 보존.
- max2 동시 A/B와 pg_sleep에서 각각 actor·owner 자료 격리. 종료한 tx를 다음 actor transaction에서 사용 불가, 중첩 tx는 deadlock 전에 거절.
- 독립 추가 실제 case에서는 max1의 동시 A/B 요청이 같은 client를 순차 재사용해도 actor를 넘겨받지 않음.
- 미대기 SQL 오류는 성공으로 반환하지 않음. 실제 deferred UNIQUE 위반의 **COMMIT 실패** 뒤 client 폐기/PID 교체·다음 B 정상 조회.
- admin이 자기 fixture backend를 종료하여 실제 query/ROLLBACK 연결 실패를 만들고, 다음 transaction의 PID가 바뀜을 확인.

실패/교체된 각 backend PID 원시 쌍은 원본 test 로그에 출력되지 않는다. 이번에는 그 단언 통과와 cluster 소유 PID/port를 기록했으며, 없는 PID 수치를 만들어 제시하지 않는다.

## 독립 추가 대조·기존 회귀

사본에만 `tests/reviewer-b3.test.ts`를 작성했다. driver 대역을 이용한 **독립15개**는 실제 DB 증거와 구분한다.

- 한 client의 정확한 BEGIN→SET LOCAL ROLE→바인딩 set_config→work→COMMIT 순서와 acquire/release1회.
- callback이 query rejection을 catch해도 queryFailed가 rollback 강제·COMMIT 없음. COMMIT의 command=ROLLBACK도 성공 처리하지 않고 client 폐기.
- SQL처럼 생긴 project id는 SQL 본문에 삽입되지 않고 `[actorId,id]` parameter에만 전달.
- raw UTF-8 JSON 공백·한글과 null/0·UTC ISO DTO 보존, 범위 초과/음수/분수/NaN/Infinity 거절.
- 유효한 원격 DSN의 TLS 해제 거절, pool max0/21/분수 거절, custom CA에도 rejectUnauthorized=true 및 유한 timeout/search_path 유지, 생성 시 접속0.

추가 대조 + 원본 unit20 + 기존 api-auth/t182-auth/maintenance/projects 회귀를 실행해 **6파일194 PASS / integration13 skip**, exit0(935ms)을 얻었다. 구성은 독립15+unit20+기존159다. 기본 opt-in13 skip은 위 실제33 PASS를 대체한 것이 아니며 unit20은 두 명령에서 반복됐다. 이를 서로 다른 추가20으로 합산하지 않는다.

검증기 최초 실행의 한 실패는 `toMatchObject({cause:undefined})`가 원래 존재하지 않는 cause property도 요구한 단언 문제였다. 코드/메시지 안전성 단언은 유지하고 이 요구만 교정해 재실행했다. 첫 lint 실패도 사본의 감사 helper 전역 선언/중간 BOM·추가 test의 미사용 인자였으며, **제품 파일을 고치지 않고** 고유 검증기만 수정했다. 최초/최종 로그를 보존한다. lock audit 최초 cwd 상대경로 오류 역시 검증기 문제로 구분한다. 마지막 실제 max1 case의 row spread 타입 추론 오류도 명시적 query row generic으로만 보완해 추가 tsc exit0을 확인했다(실행 동작 변경 없음).

## DTO·설정·의존성 검토

실제 통합에서 list의 updatedAt 내림차순/archive 제외, raw JSON text 보존, number·ISO·null, MAX_SAFE_INTEGER를 확인했다. get/stages/jobStates는 actor predicate와 RLS를 함께 사용한다. stages/jobStates에 새 정렬 계약을 만들어 주장하지 않는다.

driver는 explicit DSN만 받고 DATABASE_URL fallback/import DDL이 없다. URL query/hash를 거절하고 원격 인증서 검증을 유지한다. TLS 비활성은 loopback/dream_test_*의 명시 시험 옵션뿐이다. 실제 TLS handshake·인증서 거절을 실행한 것은 아니다. [node-postgres SSL 문서](https://node-postgres.com/features/ssl)의 DSN SSL 옵션 덮어쓰기 주의와 코드 경계를 대조했다.

단일 client transaction, transaction-local role/actor, handle 수명/async context, pending query 수집, 불확실한 commit/rollback·연결 오류의 폐기 정책을 읽고 실행 결과와 대조했다. [공식 transaction](https://node-postgres.com/features/transactions), [pool/release](https://node-postgres.com/apis/pool), [PostgreSQL SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html)을 참고했다. SQL은 신뢰된 repository의 고정 문장/바인딩 값이며 HTTP arbitrary SQL 진입점은 없다. actor 브랜드 생성은 인증기가 아니고 신뢰된 서버 JS를 격리하는 장치도 아니다. B4 Auth 연결 전제와 callback 도메인 오류의 PG_TRANSACTION 변환 한계를 유지한다.

lock JSON 감사: pg/@types/pg **8.23.1**을 직접 고정, lock package15개 추가, 삭제0, 기존 non-root package 항목 변경0. 기존 항목의 resolved/integrity를 바꾸지 않았다. 발행 SQL3개는 부모와 diff0이다. 18표/36정책은 기존 SQL의 구조이며, 이 시험을 모든 정책/표의 독립 행렬 검증 또는 managed 적용 완료로 부르지 않는다.

전체 ESLint 최종 exit0, 사본 next typegen + `tsc --noEmit --incremental false` exit0. 새 Next route/UI나 제품 연결 변경이 없어 production build/전체 suite는 반복하지 않았다. typegen은 사본 `.next`에서만 수행했다.

## 미검증·정리·잔존

direct PostgreSQL의 새 합성 cluster 검증만 완료했다. **Supabase managed Auth FK/실제 login provision·pooler·TLS·배포·부하·Storage·실데이터 이전·B4 서비스 연결**은 별도 미검증이다. 관리 DB·운영 DDL·외부 계정·paid 작업은 하지 않았다. 브라우저를 열지 않았다.

증거는 root의 `runner.log`, `pool-one-runner.log`, `original-projects-test.ts.txt`, `binaries-before.json`, `binaries-after.json`, `baseline-controls.log`, `baseline-controls-final.log`, `lint*.log`, `type.log`, `type-after-extra-final.log`, 사본의 `lock-audit.json`, 독립 test와 두 run root의 run.json/signatures.log/version.txt/initdb.log/listener.log/tests.log/stop.log다. 단순 mock/PGlite로 실제 PG 결과를 대체하지 않았다. 바이너리 전후 동일 검사는 두 번째 실행 뒤에도 다시 통과했다.

고유 OS-temp app 경계를 검증하는 PowerShell 재귀 삭제 요청은 자동 승인 검토가 실행 전에 **`blocked by policy`로 거절**했다. 우회하지 않았다. 추가 대조까지 마친 최종 집계는 정지된 합성 cluster2개·가짜 암호/자료·물리 의존성을 포함해 **36,268파일 / 906,857,421바이트**다. 설치 portable 경로는 삭제 대상이 아니다. 기존 untracked T157 보고서를 보존했다.

## Master 전달문

B3-R 994a894는 bounded PASS입니다. 같은 Valid EnterpriseDB18.7 바이너리로 원본 integration13+unit20과 새 cluster의 max1 동시 A/B 추가1개를 독립 통과했고 실제 commit/rollback 연결실패·PID폐기·owner/actor 경계 및 대조15/기존159, lint/type·lock 보존을 확인했습니다. managed Supabase/pooler/TLS/B4 연결은 남으며 소유 cluster2개는 종료됐고 자동 승인 검토의 삭제 거절로 약907 MB 사본이 잔존합니다.
