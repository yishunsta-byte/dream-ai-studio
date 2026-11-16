# T-051 코드 이관 계약 F050-1~4 수정 — CC-DATA-01 보고

- 부모: T-048 · 근거: `T-050-CODE-MIGRATION-INDEPENDENT-REVIEW.md`(FAIL), Master 배정 msg_e257a20a4e81, 설계 추천 msg_a7764d3f7705 → 채택·조건 msg_420899d2a28f
- 시작 HEAD: 7eb12c5 · 담당: CC-DATA-01 (임시 코딩 위임)
- **제품 0005는 없어요.** SQL 0001~0004 원문·해시, 고정 s4, 사용자 DB, 공용 문서는 바꾸지 않았어요. v1(T-048)은 시험에서만 쓰였고 제품 DB·백업에 기록된 적이 없어요. 형식을 v2로 올렸고 v1 기록을 다시 해석하지 않아요.

## 1. 채택 설계: 해시한 원문을 그대로 실행

| 조건(msg_420899d2a28f) | 구현 |
|---|---|
| 해시 대조 전 실행 금지, 순환 금지 | v2 해시 = `dream-code-migration/v2` + 파일마다 `file\0경로\0내용 sha256(LF)`예요(경로 순). 단계 SQL은 실행 모듈 원문 안의 `module.exports.sql`이라 원문이 단계를 완전히 정해요. `codeMigration`은 파일을 **한 번** 읽고, 그 문자열로 해시를 계산해 선언과 대조해요. 같을 때만 **그 같은 문자열**을 실행해요. 해시를 구하려고 먼저 실행하는 일이 없어요. 최상위에 `throw "EXECUTED"`를 넣은 원문은 선언이 다르면 해시 오류로 거부되고, 실행 흔적이 없어요(시험). |
| 임의 module/run 인자 제거 | 정의는 `{version,name,files,sha256,verify?,root?,runTimeoutMs?}`뿐이에요. `module`·`run`·`sql`·`entry` 같은 다른 항목은 거부해요. `run`·`sql`은 원문을 실행해서만 얻어요. 등록 파일(test5-registry)은 단계 모듈을 import하지 않아요. |
| 정확한 목록 require, crypto 창구 | node:vm 새 context에서 CommonJS 모양 `.cjs`를 `vm.compileFunction`으로 실행해요. `require`는 로더가 주는 것만 있어요. 목록 안 파일을 정확한 상대 경로로만 받아요(`.cjs`를 붙여야 하고 확장자를 추측하지 않으며, 정리한 경로가 목록에 있어야 해요). 그 밖에는 `node:crypto`의 `createHash("sha256")` 창구만 있어요. 다른 모듈은 모두 실패하고, `@/`·패키지·`node:fs`·`crypto`·md5·randomUUID도 실패해요. 모듈은 경로마다 한 번만 불러오고 순환은 CommonJS처럼 부분 exports를 봐요. `import`/`export` 문법은 문법 오류이고, 동적 `import()`는 불러오기 콜백이 없어요. 그래서 해시한 목록 말고 다른 실행 graph가 생기지 않아요. tsx와 Next의 해석 차이도 이 경로에는 없어요. |
| 시간 제한·동기 범위 | 최상위 실행은 1초(`LOAD_TIMEOUT_MS`), `run`은 10분(`RUN_TIMEOUT_MS`, 시험에서는 더 짧게 지정 가능)이에요. 둘 다 context 평가 안에서 실행돼서 시간 제한이 걸려요. context는 `microtaskMode:"afterEvaluate"`라서 run이 남긴 대기 작업도 **같은 평가 안, 곧 트랜잭션 안에서** 끝나요. async 함수(`[object AsyncFunction]`)는 등록 때 거부하고, Promise를 돌려주면 거부해서 전부 되돌려요. 늦은 쓰기가 없다는 것은 연결을 열어 둔 채 기존 표에 늦게 쓰게 해서 확인했어요. 단, SQLite 문장 하나가 오래 걸리면 그 문장이 끝난 뒤에 시간 제한이 걸려요. |
| verify query_only | `migrateDatabase`는 모든 `verify`를 `PRAGMA query_only=ON`으로 실행하고 finally에서 **이전 값**으로 되돌려요. verify에서 쓰기를 시도하면 readonly 오류가 나고 전부 되돌려요. 끝난 뒤 query_only=0이고 같은 연결로 쓸 수 있어요(시험). SQL 단계에도 적용되지만, 지금 제품 SQL 단계에는 verify가 없어요. verify가 있는 시험 SQL 단계(k6-compat test5)는 읽기만 해서 영향이 없어요. 코드 해시에 verify가 들어가지 않으니 verify가 변환을 맡을 수 없어요. |
| 경계 표현 | 이 VM은 **믿을 수 있는 마이그레이션 로더이지 보안 격리가 아니에요.** run이 받는 host sqlite 객체로 host 영역에 닿을 수 있어요. 다음은 실행 중에 막아요. 문자열 코드 실행·wasm, `Date`·`Math.random`(던짐), `Intl`·`Temporal`·`WeakRef`·`FinalizationRegistry`·`SharedArrayBuffer`·`Atomics`·`WebAssembly`·`eval`(제거). `process`·`setTimeout`·`performance`·전역 `require`는 처음부터 없어요. |

## 2. SQL 시각·결정성 (F050-3)

- **검출 규칙(`SQL_RULES`)은 이것뿐이에요.** `random(`·`randomblob(`, 따옴표 안 `now`, `CURRENT_TIMESTAMP/DATE/TIME`, 인자 없는 `date()`·`time()`·`datetime()`·`julianday()`·`unixepoch()`, 형식 인자만 있는 `strftime('…')`이에요.
- 이 규칙은 목록 파일 원문과 실행 뒤 `sql` 값(조립한 문자열 포함)에 적용해요. 시각 값이 있는 `strftime('%Y', created_at)` 등은 허용해요.
- **규칙은 증명이 아니에요.** `strftime('%s', 'n' || 'ow')`는 규칙을 통과해요. 그래서 결정성은 단계마다 **같은 입력을 1.1초 간격으로 두 번 올려 기록 표 말고 전부 같은지** 시험해요(`sameAcrossClocks`). 시험 5단계는 같았고, 위 숨긴 시각 단계는 달라서 잡혔어요. 제품 0005도 이 시험과 검토가 필요해요.
- 해시에는 Node·V8·SQLite·better-sqlite3 버전과 verify가 들어가지 않아요. 같은 입력 → 같은 결과는 package-lock 버전과 Node 26을 전제로 해요.

## 3. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `lib/db/code-migration.ts` | v2 계약, 로더(vm), `SQL_RULES`/`checkSqlText`, 시간 제한·비동기 거부, 정의 항목 제한 |
| `lib/db/migrate.ts` | verify를 query_only로 실행하고 이전 값을 되돌림(`readOnly`). T-048의 인증 확인과 같은 트랜잭션 실행은 그대로 |
| `tests/fixtures/migrations/test5-code.cjs`, `test5-ids.cjs` (새 파일) / `test5-code.ts`, `test5-ids.ts` (삭제) | 시험 5단계를 제한 `.cjs`로 옮겼어요(내용 같음). 머리 주석은 lint용 `/* global */`와 eslint-disable 한 줄이에요. 공용 eslint 설정은 고치지 않았어요. |
| `tests/fixtures/migrations/test5-registry.ts` | 목록과 선언 해시 `eebbe113…`. 단계 import 없음 |
| `tests/k6-code-migration.test.ts` | 13 → 25개 |
| `README.md` | 코드 단계 단락을 v2로 바꿈 |

## 4. 시험과 증거

- **F050-1:** 정의 항목 `module`·`run`·`sql`·`entry`를 거부해요. 원문을 고친 사본(`"p1-edited"`)으로 올리면 그 새 문구가 실제 행에 들어가요. 바뀐 도우미(`test5b:`)로 새로 올린 결과도 원래 결과와 달라요. 그래서 기록 해시가 바뀌면 실제 실행 결과도 바뀐다는 것이 확인돼요. 위조 Migration 3가지는 적용 전에 거부해요.
- **F050-2:** 주석 낀 `import/* */`·`export/* */`, `import type from`, side-effect import, `export const`는 형식 오류로 거부해요. 목록 밖 require 9가지를 거부하고, run 안에서 늦게 부르는 require도 실패하며 전부 되돌려요. 순환과 한 번만 불러오기를 확인했어요.
- **F050-3:** 규칙 12개를 거부하고 4개를 허용했어요. T050 재현 문구 `strftime('%Y-%m-%dT%H:%M:%fZ')`와 조립한 `date`+`time()`을 거부해요. 단계별 다른 시각 동등성: 시험 5단계는 같고, 숨긴 시각은 달라요.
- **실행 중 차단 12가지**, 시간 제한(최상위 무한 반복과 run 무한 반복, 되돌림), async·Promise(늦은 쓰기 없음), verify 쓰기 거부와 query_only 복구를 확인했어요.
- **F050-4:** 시험이 CRLF를 만들기 전에 LF로 맞춰요. 손으로 쓴 해시 입력과 같고, CRLF 사본과 LF 사본이 모두 같은 선언으로 등록돼요.
- **유지:** SQL 0001~0004 해시 = 원문 = s4 manifest예요. 그 밖에 다음이 모두 통과했어요.
  - 결정성(applied_at만 다름)과 옛 행 보존
  - 변환·검사 실패 시 전부 되돌림
  - 지금 DB 올리기에서 사본·직접 결과와 같음, 실패 시 DB 그대로·사본 남음
  - 기록 해시가 다르면 거부
  - staging 복원 4→5가 직접 migrate와 같고 ZIP이 그대로
  - v5 백업 same / MISMATCH / TOO_NEW와 목적지 없음
- **되돌려 보기 13가지:** 인증, run 실행, 선언 대조, 해시 전 실행(EXECUTED), prelude, 목록 require, 정의 항목, Promise, query_only, SQL 규칙, microtaskMode, LF, async를 하나씩 빼면 시험이 실패했어요. 다시 돌린 뒤 모두 통과했어요. 시간 제한을 빼는 경우는 무한 반복으로 시험 실행이 멈추기 때문에 빼 보지 않았어요. 정상 시간 제한 시험만 통과했어요.
- **실제 CLI(tsx, 경우마다 별도 프로세스, OS 임시 폴더, 끝난 뒤 삭제):** 스크립트는 scratchpad `t051-cli-probe.mts`예요.
  - 주석 낀 import 값 10과 20 → 둘 다 형식 오류로 거부
  - 목록 밖 require 10/20 → 거부. 목록에 넣으면 10은 `fa181582…`, 20은 `dec2b940…`로 해시가 서로 달라요(같은 해시에 다른 결과 없음).
  - `module.run`을 넘기면 거부, 정상 원문은 값 1
  - strftime 인자 생략 → 등록 거부
- **전체:** lint 통과, typecheck 통과, test 31파일 332개 통과(+1 건너뜀: s4 생성 모드), build 경고 0개예요. 빈 임시 폴더에서 `db:migrate`를 두 번 실행하니 4개, 다음엔 0개였어요.

## 5. 남은 일과 한계

- **원문 동봉·Next:** 로더는 CLI와 Next가 같은 코드예요. SQL 파일처럼 실행할 때 cwd(앱 소스 폴더)의 `.cjs` 원문을 읽고, 원문이 없거나 다르면 거부해요. 단계 코드는 Next 번들에 들어가지 않아요. 이번 build 성공은 로더(vm 포함)가 서버 번들에 문제없이 들어간다는 뜻일 뿐이에요. **제품 코드 단계가 아직 없어서 Next 실행 중에 단계를 불러온 증거는 없어요.** 0005 때 다음을 검증해야 해요.
  - 빌드 앱과 CLI에서 같은 결과가 나오는지
  - 원문이 없거나 바뀌었을 때, 그리고 cwd가 틀렸을 때 거부되는지
  - `MigrationSourceError`의 시작 점검·CLI 문구와 코드(T-050 8장)
- **제품 단계 lint:** `.cjs` 단계 파일마다 머리 주석 두 줄이 필요해요. 공용 eslint 설정에 마이그레이션 `.cjs` 블록을 두려면 Master 승인이 필요해요.
- **실행 범위:** 보안 격리가 아니고 host 객체로 탈출할 수 있어요. 시간 제한은 JS에만 걸리고 SQLite 문장 하나 안에서는 걸리지 않아요. SQL 규칙은 검출 목록이고, 결정성은 단계별 실행 비교와 검토로 증명해요. 기록과 사본 진위는 PC 안 기준이에요.
- **실수 기록:** 첫 CLI 재현 때 임시 폴더를 만드는 명령의 따옴표가 틀렸어요. 그래서 제가 만든 재현 폴더 6개(가짜 `.cjs` 파일만)가 Git 설치 폴더(`C:\Program Files\Git\`) 아래에 생겼어요. 그 6개만 확인하고 지웠고 남은 것이 없어요. 다른 파일은 건드리지 않았어요.
