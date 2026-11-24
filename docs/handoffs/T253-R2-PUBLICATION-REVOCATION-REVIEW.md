# T253-R2 공개 승인 저장·철회 독립 검수

**판정 FAIL · 소유 로컬 PG17.12 첫 실행에서 발행 SQL 중단**

대상 `f2b34795c5ec847e81ab7be745d11977e9401162` · 이전 검수 `75e1b7114872302b8c26f262edfaf6d887705acf` · 주소 수정 `64b5b383e21643ab73aa5d1993cab323b9d30980`

## 첫 실패와 수정 범위

러너는 DDL 롤백·설치와 첫 권한 분리 검사를 지나 발행 허용·원본 소유권 묶음에 도달했다. 발행 허용에 없는 actor의 준비 요청은 예상대로 거부됐다. 이어서 발행 허용에 있는 다른 소유자의 준비 요청이 기대한 `source-unavailable`에 도달하기 전에 `invalid input syntax for type json`으로 중단됐다. 서버 로그는 `Token "display" is invalid.`와 `apply_command` 본문의 실패 조건식을 기록했다. 러너는 exit 1을 반환했다.

원인은 `tests/fixtures/postgres/t253-showcase-publication.sql:183`의 `payload->'display' - ARRAY[...]`다. PostgreSQL 17은 `-`를 `->`보다 먼저 묶는다. 따라서 키를 제거할 왼쪽 피연산자로 하위 JSON 객체 대신 문자열 리터럴 `'display'`가 해석돼 JSON 변환 오류가 발생한다. `(payload->'display') - ARRAY[...]`로 묶거나 하위 객체를 별도 변수에 담는 변경을 권고한다. 허용 키만 가진 manifest의 성공과 추가 표시 키 거부를 함께 시험한다. 원 SQL과 러너는 수정하지 않았으며 두 번째 실행은 하지 않았다. [PostgreSQL 17 연산자 우선순위](https://www.postgresql.org/docs/17/sql-syntax-lexical.html#SQL-PRECEDENCE) · [JSONB 키 제거](https://www.postgresql.org/docs/17/functions-json.html)

## 이전 지적 대조

| 항목 | 소스 판정과 실제 시험 범위 |
| --- | --- |
| F1 · 주소 확인 | `host(inet_server_addr())`와 루프백·데이터 경로·포트·DB·major 확인을 유지했다. READ COMMITTED도 단언한다. 실제 실행은 폐기 DB DDL과 발행 함수 호출까지 이 검사를 통과했다. |
| F2 · 양방향 잠금 경쟁·세대·원장 | 잠금 후 현재 준비 또는 활성 포인터가 관찰한 세대와 일치할 때 그 포인터만 닫는다. 같은 관찰 버전·세대를 두 물리 연결에서 읽고 `pg_blocking_pids`로 대기를 확인하는 양방향 시험이 있다. 다른 세대의 유지, 교체된 과거 주소, 세대가 포함된 원장 지문 및 재생 대조군도 추가됐다. 첫 실패로 이 시험들은 도달하지 못했다. |
| F3 · RLS와 읽기 권한 | 활성·준비·철회 행 공존을 확인하고, 함수 소유자로 직접 허용 열 SELECT를 실행해 정책만으로 행을 제한하는 시험이 있다. FORCE RLS와 함수 소유자·여섯 역할·membership을 확인하는 시험도 추가됐다. 첫 권한 분리 묶음의 반대 함수·발행 함수·기저 접근 거부는 도달했지만 공존 RLS와 카탈로그 단언은 실행되지 않았다. |
| 환경·롤백·정리 | Node의 `PG*` 및 `NODE_PG_FORCE_NATIVE` 제거가 `pg` 로드보다 앞선다. 첫 DDL 묶음은 롤백 후 스키마와 여섯 역할의 부재, 기존 합성 행을 보존한 재설치를 확인한다. 그다음 묶음까지 도달했으므로 순차 검사상 DDL 묶음과 첫 권한 묶음의 단언은 끝났다. 명령 롤백·정렬 등은 도달하지 못했다. 이 실패 실행에는 최종 `result.json`이 없다. |

## 실행 및 종료 증거

- 고정 커밋의 SQL·러너·인수인계가 작업 파일과 일치했다. 러너 strict TypeScript 및 파일 단위 ESLint `--max-warnings 0`과 Git 공백 검사는 통과했다.
- 지정 `.tools/t253-postgres-17.12/pgsql/bin`의 `postgres.exe`, `initdb.exe`, `pg_ctl.exe` 모두 EnterpriseDB Authenticode `Valid`와 제품 버전 17.12를 확인했다. 고정 러너 자체의 버전·서명 확인을 거쳐 한 번 실행했다.
- SQL SHA-256 `bb74aeb22df0aec64296d12ebf6892f998ee04a743de8d3803646a21350731ae`. 러너 SHA-256 `f37128b2d3ee7c9715730c1b439f0a98e52506c0bbdb255115bdf0593305e55e`.
- 소유 폐기 클러스터와 DB는 `tmp/t253_654d2c206a23468182ee2ab584a4c61e` 및 같은 이름의 DB다. Windows PostgreSQL 서버 로그는 17.12와 `127.0.0.1:57474`, postmaster PID `47704`, 빠른 종료 완료를 기록했다.
- `cleanup.json`은 PID 파일 부재와 `ECONNREFUSED`를 기록했다. 별도 OS 조회에서 포트 리스너 0, 기록된 PID 부재, PID 파일과 임시 초기화 암호 파일 부재를 확인했다. 수동 종료는 필요 없었다.
- 첫 실패 출력·종료 코드는 `tmp/t253-r2-f2b3479-review/first-run.txt`, `first-run.exit`에 있고, 첫 SQL 실패와 종료 원본은 소유 클러스터의 `postgres.log`와 `cleanup.json`에 있다. 운영 DB·기존 클러스터·실제 자료·게시·배포는 이번 실행 범위 밖이다.

## Master 전달문

T253-R2 FAIL. 고정 `f2b3479`의 단일 소유 PG17.12 실행이 발행 함수에서 중단됐다. SQL 183행은 하위 JSON 객체를 괄호로 묶어 키 제거 연산의 순서를 고정해야 한다. 주소 확인·DDL 묶음·첫 권한 분리 묶음을 지난 뒤 정상 발행자의 준비 요청이 실패했다. F2/F3 보완은 소스에서 확인했으며 양방향 경쟁과 공존 RLS는 실행되지 않았다. 첫 기록과 종료 증거를 보존했고 수정본으로 별도 폐기 DB에서 재검증이 필요하다.
