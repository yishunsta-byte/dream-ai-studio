# T-052 · 코드 이관 v2 독립 검수

- 담당: CX-REVIEW-09 / Codex, 구현 미참여 독립 검수. Coordinator: Codex Master.
- 대상: `cc75f57` (`1bbaa98` 포함). 실제 checkout HEAD `4f180411bd27deef1d1d2cbdc5ff94c84be76346`; 대상과 차이는 docs/TEAM.md뿐이며 lib/tests/package/lock 변경 없음. 시작 clean.
- **판정: 현재 v2 계약 수용 FAIL. F050-1/2/4 및 규칙 수준으로 좁힌 F050-3은 실행 범위 PASS이나, F052-1 일반 thenable 처리에서 rollback 후 늦은 쓰기를 실제 재현했다. F052-2 같은 경계의 timeout 누락도 확인했다. 수정 후 독립 재검수 전 제품0005 진행 조건으로 채택하지 않는다.**
- 허용 tracked 변경은 이 보고서 하나. code/test/fixture/공용문서 수정, commit/push, 제품0005, 실제 사용자 DB, 타 담당 프로세스 조작 없음. 보고 작업은 완료이며 구현 수락 실패와 구분한다.

## 1. 기준·환경·증거

AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 두 역할 문서, PLAN 14 K-6/18, REVIEW, TEAM 최신 배정, T050 FAIL, T051 전체/entry 보완, 현재 loader/migrate/live-migrate/migrate-command/connection/fixture/회귀 시험을 확인했다. orchestration skill 및 설치 CLI guide를 사용했고 helper 없이 직접 검수했다. Next 로컬 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`를 확인했다. 브라우저/UI 변경이 없어 브라우저를 실행하지 않았다.

증거 E = `C:/Users/Administrator/AppData/Local/Temp/dream-t052-c52941cc0f144d0d88c950a9b1ea1ff5` (쉘 표시에는 ADMINI~1 가능). Node `26.13.0`, Next `16.4.6`, lockfile 기준 의존성. child에는 node_modules가 없어 `robocopy D:/starwork/dream-ai-studio/node_modules ./node_modules /E /NFL /NDL /NJH /NJS /NP`로 실제 복사했다. npm ci 재실행은 아니다. root 사용자 data/storage/backups를 읽지 않았다. 새 source는 최종 재현에서 E의 고유 하위 폴더, DB는 별도 :memory: 연결 또는 기존 시험이 만든 OS temp fake 사본만 사용했다.

모든 full 명령은 **원 checkout(CRLF)** 에서 실행했다. `Remove-Item Env:DREAM_DATA_ROOT -ErrorAction SilentlyContinue` 후 실행했고 full test/build에는 `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`를 읽기 실행으로만 지정했다. fixture EOL 변경 없음: `git ls-files --eol tests/fixtures/migrations`는 세 파일 모두 i/lf, w/crlf.

| 이번 직접 명령 | 실제 결과 | E 증거 |
|---|---|---|
| `npm.cmd test` | 31파일, **333 passed / 1 skipped**(s4 생성 모드), exit0 | test.log |
| `npm.cmd run lint` | exit0, 경고0 | lint.log |
| `npm.cmd run typecheck` | typegen/tsc exit0 | typecheck.log |
| `npm.cmd run build` | exit0, 빌드 경고 없음, verify-build 사적자료 추적 없음 | build.log |
| `node --conditions=react-server --import tsx E/probe.mts` | 독립 16 named probe assertions 통과 | probe.mts, probe.log |
| `node --conditions=react-server --import tsx E/capture.mts` | 한 번 읽은 검증 문자열 그대로 실행 | capture.mts, capture.log |
| `node --conditions=react-server --import tsx E/late.mts` | **F052-1 실제 늦은 쓰기 재현** | late.mts, late.log |
| `node E/deadline.mjs` | **F052-2** getter/then 각각 4초 외부 마감으로 종료 | deadline.mjs, timeout.mts, timeout.log |

위 E는 설명용 변수이며 실제 명령에서는 그 절대 경로를 전달했다. deadline은 `spawnSync(process.execPath, ['--conditions=react-server','--import','tsx',E/timeout.mts,mode], {timeout:4000,windowsHide:true})`; 자기 자식 두 개만 종료했다. Master 관련57 통과, 작성자333+1skip은 별도 기존 증거이며 합산하지 않았다.

검수 도구 실수: 최초 probe는 URL pathname을 직접 쓴 탓에 `~`가 `%7E`로 남아 fake source 일부를 `C:/Users/ADMINI%7E1/AppData/Local/Temp/dream-t052-c52941cc0f144d0d88c950a9b1ea1ff5`에 만들었다. `fileURLToPath`로 고친 뒤 모든 최종 probe를 위 정상 E에서 다시 실행했다. 최초 probe의 미기록 DB를 거부하는 준비 오류도 base migration을 먼저 적용하도록 고쳐 재실행했다. 첫 deadline은 경로 오류라 timeout 증거에서 제외했고 최종 두 ETIMEDOUT만 사용한다. 잘못된 경로의 자기 fake .cjs 16개는 목록을 읽어 확인했지만 정리 명령 자동 승인 검토가 `blocked by policy`로 거부되어 보존했다(더 구체적인 사유 미제공). 재시도 우회나 다른 경로 삭제는 하지 않았다. 정상 E source/log도 재현 증거로 보존한다.

## 2. 필수 수정 F052-1 · thenable의 처리 뒤 rollback한 DB에 늦게 쓰기

위치: `lib/db/code-migration.ts:75,109,111` (`isThenable` / `call(run)` 뒤 직접 `.then(...)` 호출).

run은 timed `runInContext` 안에서 호출하지만, 반환값의 `.then` 조회 및 `.then(()=>{},()=>{})` 호출은 평가가 끝난 뒤 **host 호출 경로**에서 한다. 일반 thenable의 then이 VM Promise microtask를 예약하면 이 작업은 해당 평가에서 drain되지 않는다. migration 객체/VM을 재사용해 다른 DB에서 실행하면 다음 평가가 앞 DB 참조를 가진 작업을 drain한다. 앞 DB는 이미 rollback을 끝냈으며 그 작업은 앞 DB 트랜잭션 밖에서 실제 commit된다.

재현 원문(파일 전체를 정상 hash 선언으로 등록, 탈출/host constructor/보안 우회 없음):

```js
module.exports.run = function(db) {
  return {then(resolve) {
    Promise.resolve().then(() => db.exec('INSERT INTO proof VALUES(7)'));
    resolve();
  }};
};
```

재현 준비: 별도 열린 메모리 DB A/B에 정상 base migration v1 `CREATE TABLE proof(value INTEGER)`를 각각 적용한다. 위 source를 v2로 한 번 codeMigration하여 **동일 migration 객체**를 A와 B의 `migrateDatabase({migrations:[base,step]})`에 차례로 전달한다. 각 실패를 catch하고 연결을 열어 둔 채 조회한다.

| 시점 | A proof | B proof | A journal | A inTransaction |
|---|---|---|---|---|
| A에서 Promise 오류/rollback 직후 | [] | [] | base v1만 | false |
| B에서 같은 Promise 오류/rollback 직후 | **[{value:7}]** | [] | base v1만 | false |
| 50ms 뒤 | **[{value:7}]** | [] | base v1만 | false |

즉 A에는 v2 기록 없이 v2 데이터가 남는다. 한 번 실행하고 기다리는 기존 native Promise 시험은 이 경로를 잡지 못한다. 동일 객체 재사용은 임의 적대 JS 조건이 아니라 migrations list를 live/direct/staging 등에 재사용할 수 있는 API의 통상 사용이다. 제품 단계가 아직 없으므로 실제 사용자 DB에서 발생했다고 주장하지 않는다.

필요 수정/재검수: thenability 판별/접근자와 필요한 rejection 처리까지 timed VM 평가·같은 트랜잭션 범위에 넣고, 거부된 작업이 다음 평가로 이월되지 않게 한다. 일반 thenable을 무조건 호출하는 접근도 재검토한다. 재현처럼 A/B 열린 연결 재사용 및 getter-queued microtask, native Promise/async 거부, 실제 rollback/journal 불변을 확인해야 한다. 단순 문구 한정으로 데이터 rollback 보장을 대체할 수 없다.

## 3. F052-2 · 반환값 getter/then 함수는 run timeout 밖에서 실행

같은 `:75,111` 경계다. `runTimeoutMs:50`으로 등록하고 run에서 다음 중 하나를 반환한다.

```js
return {get then(){while(true){}}};
// 또는
return {then(){while(true){}}};
```

두 경우 모두 등록 완료 로그(`constructed getter/then`) 뒤 내부 timeout/오류로 복귀하지 않았다. 소유 subprocess의 외부 4000ms deadline이 각각 약4012/4009ms 뒤 ETIMEDOUT으로 종료했다. 임의 native SQLite callback이나 VM 보안 탈출을 이용하지 않는다. 무한 반복은 시간 제한 경계 확인용이며 데이터 늦은 쓰기 결함 F052-1과 구분한다. 정상 module-top-level/run 무한 반복은 기존 suite에서 내부 제한에 걸려 rollback함을 확인했다.

반환 then getter/then 실행도 제한 안으로 옮기고 재현으로 확인해야 한다. `entry.run`, `entry.sql`, toStringTag 조회도 :104~106에서 평가 밖임을 읽기 확인했으나 이 추가 경로는 별도 실행 입증하지 않아 새 결함으로 세지 않는다. 장시간 SQLite native 문장 자체의 중단 보장은 현재 명시된 제한이며 새 보안 요구를 하지 않는다.

## 4. 수정된 F050 항목의 실행 범위 PASS

### F050-1 · 검증 원문 = 실행 원문, identity

- codeMigration은 파일별 lstat/read 한 번으로 문자열을 capture → 그 문자열 hash/declaration 비교 → SQL rule 검사 → 동일 문자열 compile 순서다. 별도 module/run/sql/entry 인자를 거부한다. 인증 WeakSet은 이제 이 닫힌 생성 경로만 받는다.
- 독립 `capture.mts`는 **해당 OS temp 파일만** 읽기 hook에서 read 결과를 얻은 직후 디스크 원문을 값1→값2로 변경했다. constructor의 read 횟수1, DB 결과값1, 디스크는 값2였다. 검증 후 파일을 다시 읽어 실행하지 않는다는 실제 증거다. hook은 finally 복구했다.
- stale hash + top-level throw는 hash 오류이고, 같은 throw source에 맞는 hash는 TOP_EXECUTED 오류다. 잘못된 cwd/없는 source/편집 source/낡은 선언도 각각 거부했다.
- 독립 A/B 두 entry: AB hash `74736efa917905246558dbd71663e783c2bbb81650e7902b5cd9f265ab991fc4`, 결과1; BA hash `ef341ab7a93193197d4c7102330a4458120172c9b61b8a4c09b2cf55b8cd6827`, 결과2. AB 선언으로 BA 등록은 hash 오류다. helper 순서만 바꾼 불변성/수기 vector/경로·내용 변화/CRLF 변환은 original full suite에서 통과했다.
- 입력은 `dream-code-migration/v2`, `entry\0<첫 경로>`, 경로순 `file\0path\0sha256(LF text)`를 newline으로 묶는다. 버전/name은 journal 별도 열이며 실행 entry를 hash에 포함한다. v1은 시험 전용이었고 v1 기록 재해석을 하지 않는다.

### F050-2 · 닫힌 .cjs 로더

- 독립 실제 tsx CLI에서 regular import, comment import, `import type from`(runtime binding 이름 type), reexport, side-effect import 모두 .cjs compile 오류로 거부했다. 정규식 import scan으로 외부 graph를 추측하는 v1 문제가 사라졌다.
- out-of-list actual dependency 값10/20은 둘 다 거부했다. 포함하면 각각 hash `c6ca21a0d0615134f263fd93b199b514ec0990d3c60293f70834047bddf320bc`/`8c9da1f24fd38640859fe656e0d5059a1c30225ca60130302e7e2175d8112593`, 실행값10/20이다. 동일 hash의 다른 실행값을 허용하지 않았다.
- full suite는 명시 .cjs 상대 경로·확장자 생략/목록 밖 traversal/alias/package/bare crypto/fs 거부, sha256 전용 node:crypto facade, cache 동일 객체/한 번 실행/CJS partial-export cycles, run 안 지연 require 실패 rollback을 통과했다. `../p/helper.cjs`가 정규화되어 목록 안이면 허용하는 계약이며 모든 `..` specifier 거부라고 과장하지 않는다.
- 로더가 tsx/Next의 일반 module resolution을 사용하지 않고 vm에 같은 capture text를 주는 경계는 타당하다. 실제 Next에서 제품 코드 step을 실행한 증거는 아직 없다. trusted reviewed migration 경계이며 host sqlite를 통한 악성 escape 차단을 새 필수 보안범위로 만들지 않았다.

### F050-3 · SQL rules·개별 결정성·동기 제한

- 독립 omitted date/time/datetime/julianday/unixepoch/strftime 거부와 explicit clock 입력 허용을 확인했다. original suite에서 quoted now/CURRENT_*/random/randomblob, 조립된 exported SQL 검출 및 Date/Math.random/Intl/eval/code generation/process/timer/performance/WeakRef 등 런타임 차단이 통과했다.
- suite의 같은 s4 입력/실제 1.1초 다른 clock 비교에서 정상 test-only5 결과는 같고, `strftime('%s','n'||'ow')`는 등록을 통과하나 출력이 달라 per-step comparison이 잡았다. SQL_RULES는 문자열 검출 목록이며 모든 SQL/스크립트 결정성 증명은 아니다. README/source/T051은 이 한계를 정확히 표현한다.
- 해시는 Node/V8/SQLite/better-sqlite3 버전 및 verify를 포함하지 않는다. package-lock 및 Node26 가정 안에서 개별 실행 비교+검토가 필요하며 clock 두 번 같음만으로 모든 입력의 수학적 증명이라 하지 않는다.
- async function 등록 거부, native Promise 대기 쓰기 rollback, module top-level/run timeout은 suite PASS. 독립 단순 thenable 동기 쓰기/getter 동기 쓰기/native Promise도 실패 뒤 열린 DB에서 rows0을 확인했으나 **추가 microtask thenable F052-1을 상쇄하지 않는다.**

### verify 및 F050-4

- verify는 새 단계 모두 실행 후 동일 transaction 안에서 query_only=ON으로 호출하며 finally에서 이전 값을 복구한다. 원문 코드 확인 및 suite/독립 probe에서 write readonly 거부·SQL/run/journal rollback·0 복구·이후 연결 쓰기 성공을 확인했다. caller query_only=1은 초기 쓰기 자체를 거부하고1을 유지했다. verify 시작 시 이전값1을 가진 실제 callback 경로를 별도로 구성해 시험한 것은 아니다.
- verify 함수 변경은 step sha에 영향을 주지 않으며 정상 trusted read-only check 전제다. 악성 verify가 pragma를 해제하는 임의 적대 코드까지의 sandbox 증명을 요구하지 않는다.
- F050-4는 먼저 LF 정규화 후 CRLF를 만드는 시험으로 수정됐다. original CRLF checkout에서 full333+skip1 통과했고 fixture나 EOL을 고쳐서 통과시킨 결과가 아니다.

## 5. 유지 회귀 및 원본 보존

이번 original full suite에서 직접 재실행한 범위: test-only5의 옛 업무행 보존/동일 입력 결과, journal sha, 잘못된 source record 거부, 변환/검사 실패 전체 rollback, live pre-snapshot/direct 동등성(의도된 activity/journal time 제외), 실패 DB 불변/사본 보존, staging s4→test5/direct 동등성, code5 backup same/mismatch/too_new/거부 목적지 없음/원본ZIP불변. 새로운 독립 direct/live/staging 스크립트를 추가 작성한 것은 아니며 저장소 관련 회귀를 이번 full run에서 실행했다.

`hash-before.txt`/`hash-after.txt` 동일. 원래 SQL 파일 sha:

1. 0001 `ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0`
2. 0002 `6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed`
3. 0003 `9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e`
4. 0004 `6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3`

s4.zip sha `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392`. SQL4 manifest/journal/hash 동일성도 suite PASS. 빌드·tests가 만든 ignored node_modules/.next만 있고 추적 변경은 이 보고서뿐이다.

## 6. 제품0005 통합 조건·반환

현재 productMigrations는 SQL4만 반환한다. 이번 build 성공은 **현재 SQL 앱 빌드**이며 제품 .cjs source 동봉/배포 tracing/cwd/Next runtime code-step 로드를 증명하지 않는다. 실제0005 시 등록 source graph/entry 선언, CLI 및 production Next의 동일 실행결과, source missing/edited/stale artifact/wrong cwd 거부, 각 진입점 DB 접근 전 source validation 배치, MigrationSourceError 시작 화면/CLI 오류코드·사용자 안내·재시도, source bundle/trace, 실제 schema 데이터 검증/old rows/s4 upgrade/새s5/direct-restore를 검증해야 한다. 특히 현재 기본 list 생성이 CLI try 밖이며 startup catch가 일반 오류 처리인 점을 현재 미등록 product UI 결함으로 오인하지 않는다.

Master 요청: F052-1/2를 같은 반환값 실행 경계 수정으로 배정하고 A/B 열린 DB 회귀 및 외부 deadline을 통과시킨 뒤 독립 재검수한다. 기존 SQL K6/P1 사용자 승인 상태는 바꾸지 않지만 이번 v2 수용/제품0005 조건은 충족하지 않았다. 보고 문서 작성과 Orca 전송/수신확인은 구분하며 worker_done 영수증은 실제 명령 결과로 확인한다.

**Claude design/플래너 전달 복사문:** T052는 original CRLF checkout에서 독립 전체333통과+생성1skip 및 lint/typecheck/build를 통과했고 F050-1/2/4·entry identity·규칙 수준의 F050-3 보완을 확인했습니다. 그러나 일반 thenable 처리로 rollback한 DB A에 다음 DB B 실행 때 늦은 쓰기가 남는 F052-1과 then/getter timeout 누락 F052-2를 실제 재현해 현재 v2 계약 수용은 FAIL입니다. 반환값 처리까지 timed transaction 평가에 포함하는 수정과 독립 재검수 후 채택해 주세요; 제품0005/실사용 DB는 건드리지 않았고 실제 제품 source 동봉·CLI/Next·MigrationSourceError UI 통합은 미래0005 조건으로 남깁니다.
