# B4-I 요청별 프로젝트 읽기 adapter 독립 검수

- 기준: `0bf6da7b9cb6a20f501a7f9af8c0506273f3d931`, B4-I 보고서 전문·request adapter/pool manager/runner/test 전체, B4-C/S 및 T193 수용 범위 대조.
- 판정: **bounded PASS**. 이번 미연결 request adapter·pool 수명 범위에서 새 필수 결함은 발견하지 않았다. 제품 파일 수정 없이 고유 보고서만 반환한다.
- 제작자의 자체49/280과 이번 독립 실행은 별개다. 실제 HTTP API/RSC를 새로 연결하거나 검증하지 않았다. T193 Auth 수용은 아래 구분대로 상속한다.

## 고정 소스와 실행 경계

`git archive 0bf6da7`를 `C:/Users/Administrator/AppData/Local/Temp/b4i-review-a7ce02eba9f14abaaf55faa82f1d1ad7/app`에 고정했다. 변경6파일의 저장소 EOL 규칙 적용 Git blob이 모두 target과 일치했다(`source-identity.json`). 이전 검수의 물리 node_modules를 다시 물리 복사했으며 설치/갱신은 없다.

Auth/API/pages·B3 transaction/repo·기존 B4-S service/selector/errors·SQL3개·packages·고정 fixtures는 이 커밋에서 diff0이다. 사용자 DB/managed DB·실제 환경 파일/DSN·3013/shared `.next`·외부 계정/paid/prod DDL은 사용/변경하지 않았다. typegen은 사본에서만 수행했다.

동일 portable 경로 `D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin`을 읽기 전용으로 실행했다. postgres/initdb/pg_ctl/createdb는 모두 Valid Authenticode·EnterpriseDB Corporation, 실제 version18.7이며 전후 SHA가 동일하다. 각 전문 hash는 binaries-before/after.json에 보존한다. 설치 파일/서비스/PATH는 변경하지 않았다.

## 실제 PostgreSQL와 회귀

```text
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4i
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4
node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

세 명령은 **각각 새 합성 cluster/DB**에서 원본 runner/test를 수정하지 않고 실행했다. 같은 binary를 공유하되 각 target/로그는 분리됐다.

| 명령/검사 | 이번 실제 결과 |
|---|---|
| b4i | **3파일49 PASS = 실제integration8 + 신규unit21 + B3unit20**, 1.28초, exit0 |
| 기존 b4 | **3파일51 PASS = 실제integration9 + unit42**, 926ms, exit0 |
| 기존 B3 | **2파일33 PASS = 실제integration13 + unit20**, 1.03초, exit0 |
| 관련10파일(request/connection/backend/api-auth/t191/t182/t183/projects/planning/jobs) | **280 PASS**, 7.32초, exit0 |
| 독립 추가 대조 | **13 PASS**, 458ms, exit0, 아래 driver/SDK 대역 범위 |
| 전체 ESLint 최종·사본 next typegen+tsc noEmit | 각각 exit0 |

숫자는 명령별 결과이며 반복된 unit20/21 등을 추가 고유 시험으로 합산하지 않는다. 전체925 suite/production build는 반복하지 않았다. 새 route/page/production 연결이 없으므로 이번 범위에서는 관련 회귀·타입·실제 driver 실행을 선택했다.

## b4i 실제8개가 확인한 경계

실제 pg·제한 login·RLS·B4-S service·pool manager를 사용했고, 인증 결정은 **fake verified resolver**였다.

- 동일 request의 동시 list/get(lazy params)에서 resolver/environment/getPool 각1회, 실제 각 조회와 원래 DTO/no-store 성공.
- max1 manager의 동일 backend client가 A→B에 재사용돼도 B의 목록만 표시, B의 A 단건은404. 직접 client 대조는 같은 PID·login role 복귀·actor null.
- denied401/403/503 각각 환경/getPool/connect0, local·sqlite/off·DSN 없음·Vercel 설정 없음도 실제 pool 접속 전에 거절.
- 성공 요청 뒤 **새 request 객체**의 만료 결정은401, pool 접근 없음. 기존 request를 다른 HTTP에 재사용해도 된다는 뜻은 아니다.
- 실제 합성 DB의 snapshot 손상은 fixed503이며 DSN/SQL을 public reply에 복사하지 않음.

기존 B4-S51을 다시 통과해 read-only repeatable-read·동시 project/stages 수정 중 snapshot 유지와 다음 요청 반영·owner/404/손상stage503·DB 실패 우선·tx 탈출 보호가 보존됐다. B333도 다시 통과해 기본 BEGIN/쓰기·role/actor 초기화·commit/rollback·실제 deferred COMMIT 실패/연결 종료 후 폐기가 깨지지 않았음을 확인했다.

## 인증·params 순서와 독립 추가13개

원본 unit21은 실제 T191 resolver와 **가짜 SDK getUser**를 사용한다. 한 closure의 동시 list/get에서 getUser1회·pool 결정1회·각 operation별 connect2회를 확인했고, 다음 request의 user 없음은 다시 getUser를 호출해401이다. 데이터 DTO를 cache하지 않고 Auth/access 결정만 closure에 저장한다는 코드와 일치한다.

검수 사본에만 `tests/reviewer-b4i.test.ts`를 추가해 다음을 별도 단언했다.

- denied401/403/503, local, 잘못된 **사용자 UUID** 각각 동시 list/get(lazy)에서 순서 기록은 `auth` 한 번뿐. 환경·pool·params를 읽지 않는다. 임의 params 예외보다401 등이 먼저 반환된다.
- verified 후 unknown/sqlite/DSN 없는 선택은 auth→env까지만 실행해503. 환경 getter 예외도 고정503이며 params/pool 미접근·비밀 sentinel 미노출.
- verified의 잘못된 **프로젝트 UUID**는 auth→env→lazy pool 선택→params 뒤400, 실제 connect0. 이는 사용자 UUID 선행 거절과 구분한다. pool 선택이 lazy Pool을 만들 수 있는 것과 DB 접속은 다른 단계다.
- params callback 예외는 fixed503, connect0·DSN 미노출.
- pool.end의 비동기 실패를 주입했을 때 모든 중복 close가 **같은 Promise/같은 안전 PG_UNAVAILABLE**을 공유하고 end1회만 호출. 이후 get은 종료 상태로 거절한다.
- manager/global metadata JSON에 자격/actor/request 값이 직렬화되지 않고 global Symbol slot은 non-enumerable. manager는 get/close만 제공한다.

최초 전체 lint의 한 실패는 이 고유 검증기의 미사용 type import였다. 검증기 import만 제거해 전체 lint를 재실행해 통과했고 제품 파일은 수정하지 않았다. 테스트 기대값이나 제품 실패를 숨긴 것이 아니다.

## Pool·비밀·후속 연결 조건

import는 manager slot만 만들고 pool/connect/env/DDL/signal handler를 실행하지 않는다. 첫 get도 B3 lazy pool이며 같은 문자열 target은 재사용, target 변경은 PG_CONFIG다. close 전 최초 미사용 종료·중복 종료·module reload 후 같은 process manager/terminal close는 원본 unit으로 확인했다. 기본 pool은 원격 TLS 인증서 검증/유한 timeout을 유지하고 시험 manager만 명시 loopback test TLS 예외를 사용한다. 실제 TLS handshake나 운영 CA 검증은 아니다.

request에는 신뢰된 resolver 결과의 verified.userId만 전달되고 request owner/header/email에서 actor를 만드는 경로가 없다. 미지정/unknown backend·pool/driver/params 예외는 고정 descriptor로 바뀌며 SQLite fallback 코드가 없다. default environment snapshot에 server 값이 담길 수 있지만 server closure에서만 쓰고 reply/JSON/log로 내보내지 않는다. manager는 request/Auth promise/DTO를 global에 저장하지 않는다. 신뢰된 서버 JS 자체를 sandbox한다는 주장은 아니다.

T193 `be59435` 지정 로컬 Auth resolver/API adapter/RSC 요청별 중복 제거·요청간 계정 분리 수용을 **기존 증거로 상속**했다. 그 보고서 전문을 읽었으며 이번 b4i의 fake verified resolver+real PG를 T193의 실제 SDK/Next 실험으로 바꿔 세지 않는다. 반대로 T193은 Backend/RLS 연결을 검증하지 않았으므로 이번 결과와도 구분한다.

실제 HTTP GET/RSC 연결·no-store Response 생성·legacy-data 차단·호출자가 request 객체를 HTTP마다 새로 만드는 검증·managed Auth FK/login/pooler/TLS·Storage·부하·운영 배포는 남는다. legacy SQLite 호출자 보호 없이 opt-in으로 외부 공개할 조건을 충족했다고 하지 않는다. 브라우저/Next 서버를 띄우지 않았다.

## 소유 종료·증거·잔존

| suite/run suffix | 소유 PID / 127.0.0.1 포트 | 종료 |
|---|---|---|
| b4i `187ce932-da7d-4fb7-a471-c96aa19fc2f5` | 36460 / 56254 | server stopped·exit0 |
| b4 `95822f03-723b-4619-87ee-dcb396216e3e` | 31720 / 56255 | 동일 |
| B3 `7c80df8d-a35d-4658-ba07-3ec6e7a0b745` | 72232 / 56256 | 동일 |

run은 모두 root의 `app/tmp/b3-postgres-<suffix>`에 있다. 후속56254/56255/56256 listener 없음·고유 root의 postgres/node 프로세스 없음, 사용자3013은 전후 PID51032 동일이다.

root의 b4i-runner.log/b4s-regression.log/b3-regression.log/related.log/independent-controls.log/lint.log/lint-final.log/type.log/source-identity.json/binaries-before.json/binaries-after.json, 세 run의 run.json/signatures/version/listener/tests/stop 로그 및 추가 harness를 보존했다. 보고서 외에는 커밋하지 않으며 기존 untracked T157 보고서도 보존했다.

고유 OS-temp app 경계를 검증하는 PowerShell 재귀 삭제 요청은 자동 승인 검토가 실행 전에 **`blocked by policy`로 거절**했다. 우회하지 않았다. 정지된 cluster3개·dummy 자격·물리 의존성·로그를 포함해 **38,021파일 / 964,585,072바이트**가 잔존한다. 설치 portable 경로는 삭제 대상이 아니다.

## Master 전달문

B4-I-R 0bf6da7은 bounded PASS입니다. 새 실제PG b4i49·기존B4-S51/B333·관련280·독립경계13과 lint/type가 통과했고, 인증 선행 거절·closure1회·max1A/B·pool lazy/module reload/종료 실패·비밀 safe reply를 확인했습니다. 실제HTTP/RSC/legacy gate/managed는 남으며 소유 서버3개는 종료했고 자동 승인 검토의 삭제 거절로 약965 MB 사본이 잔존합니다.
