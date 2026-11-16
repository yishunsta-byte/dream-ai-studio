# T-054 · 코드 이관 반환 경계 집중 독립 재검수

- 담당: CX-REVIEW-10 / Codex, 구현 미참여 독립 검수. parent T053/T052, coordinator Codex Master.
- 대상 `78ee04e197e1552ddb1bca8a2486c04cb216f57e`. checkout HEAD `43956e3aa37ecda5ffa96eb334272311a3f468c5`; 대상과 차이는 docs/TEAM.md뿐이다. 시작 clean.
- **판정: F052-1/2 수정은 실행 범위 PASS. 현재 v2 반환 경계 전체 수용은 FAIL: 일반 rejected native Promise 반환이 동기 거부/rollback 후 unhandled rejection으로 Node 프로세스를 종료시키는 F054-1을 재현했다.** 제품0005 진입 조건으로 아직 채택하지 않는다. 보고 작업 완료와 계약 수용 실패를 구분한다.
- 허용 tracked 변경은 이 보고서 하나. 제품/test/fixture/공용보고 수정, commit/push, 제품0005, 사용자 data/storage/backups 접근, 타 담당 프로세스 조작 없음.

## 1. 기준·환경·실행 증거

AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 역할 지침, PLAN 14 K-6/18, REVIEW, TEAM 배정, T052 FAIL/T053 보고, 실제 code-migration/migrate 및 관련 테스트를 읽었다. Orca orchestration 스킬과 설치 CLI guide를 사용했고 helper 없이 직접 수행했다. UI 변경이 없어 브라우저 불필요. Next 로컬 output tracing 가이드도 읽었다.

증거 E = `C:/Users/Administrator/AppData/Local/Temp/dream-t054-293d52fbfcaa48d2afb796d10ebf5114` (쉘에는 ADMINI~1). Node `26.13.0`. 원 CRLF checkout에서 실행, DREAM_DATA_ROOT unset. child에 node_modules가 없어 첫 npm 실행은 vitest 미설치로 실패했다(검증 결과로 세지 않음). `robocopy D:/starwork/dream-ai-studio/node_modules ./node_modules /E /NFL /NDL /NJH /NJS /NP`로 실제 의존성을 복사한 뒤 재실행했다(robocopy exit1=파일 복사). npm ci 수행 주장은 하지 않는다. ffmpeg 경로가 필요한 시험 범위가 아니어서 지정하지 않았다.

| 이번 직접 실행 | 결과 / 증거 |
|---|---|
| `npm.cmd test -- tests/k6-code-migration.test.ts tests/k6-compat.test.ts tests/restore.test.ts` | **3파일 95 passed, exit0**, 11.98초 / E/focused.log |
| `node --conditions=react-server --import tsx E/late.mts` 3회 | 원문 그대로 세 번 모두 final [] []; 각 A/B 실패 뒤 A journal v1만 / late-1~3.log |
| `node E/deadline.mjs` | getter 149ms, then 111ms, 각각 status0·stderr빈값·외부kill 없음 / deadline.log |
| `node E/independent-runner.mjs` | 독립 21 mode 모두 status0, 내부 assertion 통과 / independent.mts, independent-runner.mjs, independent.log |
| `node E/ordinary-runner.mjs` | throw null/undefined/string 정상 오류 반환·rollback·100ms 대기완료, rejected Promise만 status1 / ordinary.mts, ordinary.log |
| `node E/rejected-ab-runner.mjs` | 즉시/queued rejection **두 child 모두 status1**, 정상 대기완료 전 crash / rejected-ab.mts, rejected-ab.log |
| hash-before.json / hash-after.json 비교 | SQL1~4·s4 관련 원본 해시 모두 동일 |

E는 위 절대 경로의 설명용 약어다. 모든 .mts subprocess는 repo cwd에서 `--conditions=react-server --import tsx`로 실행했다. 독립 runner의 각 child 외부 마감은 6000ms, ordinary/rejected A/B runner는 5000ms. timeout/외부 kill은 PASS로 세지 않으며 실제 ETIMEDOUT/signal은 없었다. 실패 child는 Node가 오류로 스스로 종료한 것이지 외부 강제 종료가 아니다. 모든 소유 명령/child는 종료했고 증거 source/log는 보존했다.

이번 전체 test/build/lint/typecheck 재실행은 하지 않았다. T052의 독립 전체333+생성1skip/lint/typecheck/build를 선행 증거로 구분해 계승한다. T053 작성자 전체350+1skip/build/lint/typecheck와 Master 관련74 PASS는 별도 증거이며 이번95와 합산하지 않는다. 발견한 새 문제는 Promise rejection 생명주기라서 관련 독립 subprocess를 추가해 범위를 넓혔으며, 정적검사/SQL 앱 전체빌드가 이 문제를 입증하거나 해소하지 않아 불필요한 전체 반복을 하지 않았다.

## 2. F052-1/2 수정 재현 · scoped PASS

T052의 late.mts/timeout.mts/deadline.mjs를 원본 읽기만 해서 E로 복사했다. late.mts SHA256은 원본/복사 모두 `146ce658b9deb8ffb4287e172e80097ff11c60501469b4b9983cc61718531d82`; 원본 증거를 고치지 않았다.

정확한 T052 원문:

```js
module.exports.run=function(db){
  return {then(resolve){
    Promise.resolve().then(()=>db.exec("INSERT INTO proof VALUES(7)"));
    resolve();
  }};
};
```

원문 스크립트 자체를 3회 실행해 각 A→B 직후와 50ms 뒤 A/B 모두 [], A journal v1뿐, inTransaction=false를 확인했다. 추가 독립 스크립트는 **동일 step 객체**를 열린 A/B에 A,B,A,B,A,B로 전달했다. 각 거부 직후와100ms 뒤 A/B 모두 rows=[], journal=[1], transaction=false이고, 그 뒤 **같은 연결**에 정상 v2를 적용해 rows=[{value:1}], journal=[1,2]를 확인했다.

이 반복 시험은 원문 thenable, then getter가 microtask를 예약하는 객체, native fulfilled Promise가 VM microtask 쓰기를 예약하는 경우, {}, null, then/toStringTag 접근 시 throw하는 반환 객체, custom module.exports/entry 속성, 사용자 String/Reflect.apply/Object.prototype.toString 변경, 보통 오류 getter/string 변환, 삼킨 목록 밖 require에도 수행했다. async function은 등록에서 동기함수 계약으로 거부했다. return 없음/undefined 허용은 관련 suite에서 직접 통과했다. 반환 then/getter는 실행되지 않고 원시 undefined 비교만 하므로 getter-queued microtask도 새로 생기지 않는다.

원문 deadline의 무한 then/getter는 호출 없이 즉시 거부됐다. 별도 독립 child의 module.exports getter, entry.run getter, entry.sql getter, run Symbol.toStringTag getter의 무한 반복은 등록 내부1000ms에 종료(실측1003~1012ms); error.name/error.message getter와 message.toString 무한 반복은 실행 내부80ms마다 거부됐다. 후자는 A/B3회씩 반복하고 정상후속/대기까지 총658~662ms, 외부6000ms 전 status0이다. suite의 module/run/microtask 무한 반복 포함8개 deadline child도 이번95 안에서 통과했다.

## 3. 필수 잔여 F054-1 · rejected Promise는 동기 거부 후 프로세스를 종료한다

위치: `lib/db/code-migration.ts` PRELUDE의 `run` 반환값 비교(약103~104행), execute의 RUN_SCRIPT 호출 및 context 폐기(약154~158행). 판정은 undefined 원시 비교로 안전해졌지만, native Promise의 거부 상태를 처리하지 않으므로 context가 다시 평가되지 않아도 Node의 unhandled rejection 이벤트가 남는다.

외부 API/host sqlite 탈출 없이 아래 정상적인 오류 표현으로 재현했다. 각각 해시가 맞는 source로 v2를 등록했다.

```js
module.exports.run=function(db){
  db.exec('INSERT INTO proof VALUES(7)');
  return Promise.reject(new Error('ORDINARY_REJECTION'));
};
// 다른 독립 child:
module.exports.run=function(db){
  db.exec('INSERT INTO proof VALUES(7)');
  return Promise.resolve().then(()=>{
    throw new Error('ORDINARY_QUEUED_REJECTION');
  });
};
```

`rejected-ab.mts`는 각각 하나의 step을 열린 A/B에3회씩 반복하고 매번 MigrationSourceError(/undefined만/)를 catch한다. 모든 실패 후 rows=[], journal=[1], transaction=false assertion은 통과한다. 이어 같은 연결의 정상 v2도 동기적으로 성공한다. 그 뒤100ms 대기에서 **WAIT_COMPLETED가 출력되기 전에 Node가 status1로 종료**한다.

두 child의 실제 공통 stdout:

```text
AFTER_REJECTIONS {"a":{"rows":[],"versions":[1],"tx":false},"b":{"rows":[],"versions":[1],"tx":false}}
SYNC_NEXT_SUCCEEDED {"a":{"rows":[{"value":1}],"versions":[1,2],"tx":false},"b":{"rows":[{"value":1}],"versions":[1,2],"tx":false}}
```

stderr는 각각 `Error: ORDINARY_REJECTION` / `Error: ORDINARY_QUEUED_REJECTION` 및 run/execute stack, Node26.13.0을 기록한다. 부모 spawnSync의 error는 undefined이며 status=1이다. 간단한 단일 반환 재현 ordinary.mts에서도 같은 crash를 독립 확인했다. 프로세스에 unhandledRejection listener를 추가하거나 `--unhandled-rejections=warn`으로 동작을 바꿔 통과시키지 않았다.

이는 native Promise를 허용하자는 요구가 아니다. 허용하지 않는 보통 반환값도 migration 오류로 거부한 뒤 caller가 제어를 유지해야 하는 반환 경계 요구다. DB rollback이 성공한 사실과 **실패 뒤 프로세스/후속 비동기 생명주기 보장 실패**를 구분한다. 임의 적대 sandbox 탈출, native SQLite interrupt, host 비동기 API를 끌어들인 사례가 아니다.

필수 수정/독립 재검수 요청: 거부된 native Promise의 즉시/queued rejection이 host process에 남지 않게 처리하되 host에서 임의 then/getter를 조회·호출하지 않는 계약과 timed VM 경계를 유지한다. 일반 thenable을 다시 host에서 호출하는 방식으로 회귀시키면 안 된다. 외부마감 subprocess에서 위2경로의 A/B3회·rollback·normal next·100ms 대기·status0을 증명하고, F052 원문/무한getter·then 재현 및 관련95도 다시 통과해야 한다. 구현은 이 작업에서 변경하지 않았다.

## 4. 원문·실행 identity / 로더 검토

- 실제 코드: lstat/read 각 파일1회 → 캡처문자열 v2 hash 비교 → SQL rules → 같은문자열 execute 순서다. 등록 검사용 context와 매 run context는 별개이며 파일을 다시 읽지 않는다. 이번 독립 sqlidentity는 등록 뒤 **자기 temp source**를 `throw new Error('EDITED DISK')`로 바꿔도 A/B에서 등록한 SQL/table과 데이터1이 그대로 실행됨을 확인했다. T052의 read-hook 한 번읽기 입증은 선행증거로 계승하며 이번 hook 재실행이라고 하지 않는다.
- 이번 suite에서 stale hash before-top-level throw, entry A/B hash/실행값 차이, CRLF/LF, helper순서, 원문 변경/없음, 외부 run/sql/entry 주입 거부, 인증 WeakSet을 직접 통과했다. entry identity는 v2 hash 입력에 포함되고 기존SQL hash는 별도다.
- host bridge는 prelude 전에만 전달하고 사용자 코드 전에 global에서 삭제한다. captured apply/toString/String과 nonwritable frozen __dream을 사용한다. 독립 bridge probe는 __dreamDb setter와 __dreamHost getter/setter를 무한반복으로 정의해도 A/B가 정상 반환해 사용자 실행 뒤 host global 접근 경로가 재생기지 않음을 확인했다.
- custom module.exports getter/entry 속성 읽기도 LOAD_SCRIPT의 timed 호출 stack 안에 있다. 독립 getter-loop/status0과 보통 getter-return/rollback을 직접 확인했다. 내부 함수 변경으로 host가 반환객체를 다시 열어보는 경로는 관찰하지 않았다.
- 닫힌 .cjs loader는 캡처map만 require하고 Node 일반 resolution을 쓰지 않는다. 이번 suite에서 import형식/목록밖·alias·bare dependency/동적지연 require/cycle·cache를 확인했다. 삼킨 require도 sourceError로 남아 최종 거부하는 것을 독립 반복했다.
- 등록 SQL은 primitive string이고 각 실행이 다시 읽은 SQL과 비교해 다르면 migrate transaction을 rollback하는 구조다. 비교는 execute가 run을 마친 **뒤** 수행된다. 따라서 run의 native 외부 부수효과까지 되돌린다는 보장은 하지 않는다. 이번 disk-edit identity와 suite SQL/run/verify/journal rollback은 통과했으나 의도적으로 runtime별 다른 SQL을 만드는 host escape를 새 요구로 만들지 않았다.
- afterEvaluate는 timed 평가 중 VM microtask를 drain하고 context 재평가/재사용은 없다. F052 방식의 다음DB 늦은쓰기 차단은 입증됐지만, context 폐기가 Node native Promise unhandled rejection까지 제거한다는 명제는 F054-1로 성립하지 않는다.

## 5. 회귀·원본 보존·신뢰 경계

관련95에서 현재 SQL 호환/고정s4, test-only code5의 같은입력/서로다른clock 비교·옛행보존, 실패 SQL/run/verify/journal rollback, query_only복구, live snapshot/direct동등성, staging/direct동등성·ZIP불변·거부목적지없음 등을 실제 실행했다. 별도 UI/live서버를 재실행했다고 주장하지 않는다.

시작/끝 SHA256 동일:

| 원본 | sha256 |
|---|---|
| SQL0001 | ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0 |
| SQL0002 | 6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed |
| SQL0003 | 9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e |
| SQL0004 | 6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3 |
| s4.zip | 6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392 |

s4-build.ts/s4-compare.ts/s4.json도 before/after동일. fixtures/migrations는 i/lf,w/crlf 원래 checkout 상태 유지. own temp source/메모리DB 외 사용자 DB/옛 fake evidence는 고치지 않았다. node_modules 복사와 임시증거 외 추적 변경은 이 보고서뿐이다.

필수결함은 F054-1이다. 다음은 구분되는 기존 신뢰전제다: reviewed trusted migration만 등록, host sqlite로 arbitrary escape 방어를 요구하지 않음, `db.backup()` 같은 host async API 사용에 따른 늦은 작업은 code review로 금지, JS timeout이 SQLite native문장 자체를 interrupt하지 않음. SQL_RULES는 검출목록이며 결정성 증명이 아니고 각 step은 실제입력/서로다른시각 비교·검토가 필요하다. Node/V8/SQLite/better-sqlite3 및 verify는 sourcehash에 포함되지 않으며 lock/Node26 및 read-only verify 전제다. 이 신뢰전제로 F054-1의 보통 rejected VM Promise를 범위밖 처리할 수는 없다.

## 6. 제품0005 통합 조건·반환

기존SQL K6 PASS/P1 사용자 승인 상태는 유지한다. productMigrations는 원래 SQL4뿐이고 제품0005는 추가하지 않았다. F054-1 수정·독립 재검수 전 이번 v2 전체 수용은 FAIL이다.

그 이후 실제0005 등록 때는 source graph/entry선언·source 동봉/Next tracing·cwd, CLI와 production Next의 동일 실행결과, missing/edited/stale source 및 wrongcwd 거부, 각 진입점 DB 접근전 검증, MigrationSourceError/MigrationTimeoutError의 시작안내·CLI코드·오류UI/재시도, 실제 schema검증·oldrows·s4 upgrade/새s5·direct/restore동등성을 통합검증해야 한다. 현재 SQL 앱의 이전 build 성공을 미래 code-step production 배포 증거로 대체하지 않는다.

Master 검수요청: F052-1/2는 닫을 근거가 있으나 F054-1을 필수 수정으로 배정하고 위2개 subprocess의 status0·대기완료를 추가해 반환받는다. 공용TEAM/REVIEW/PROGRESS 갱신은 Master 소유이며 이 작업에서는 고유보고서만 작성했다. 문서작성과 실제전송/수신확인은 구분하며 worker_done 영수증은 Orca 명령 결과로 확인한다.

**Claude design/플래너 전달 복사문:** T054는 78ee04e에서 독립 관련95통과와 T052 원문3회/deadline 재현으로 F052-1/2 보완을 확인했습니다. 다만 보통 rejected native Promise가 동기 거부·rollback 뒤 unhandled rejection으로 Node를 종료시키는 F054-1을 즉시/queued 두 경로에서 독립 재현하여 v2 반환 경계 전체 수용은 FAIL입니다. F054-1 수정과 A/B열린연결3회·정상후속·대기완료·subprocess status0 재검수 후 채택해 주세요; SQL K6/P1승인은 유지하고 제품0005/source동봉·CLI/productionNext·오류UI 통합 조건은 남깁니다.
