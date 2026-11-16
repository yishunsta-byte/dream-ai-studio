# T-059 · 제한된 동기 코드 이관 계약 독립 검수

- 담당: CX-REVIEW-11 / Codex, 구현 미참여 독립 검수. parent T058/T054, coordinator Codex Master.
- 대상: `94a13c2`. 새 child 시작/검수 HEAD `11aeb749ed38fe582c54c9ee217c8ce2734a5abf`; 대상 ancestor 검사 exit0, 차이는 `docs/TEAM.md`뿐. 시작 clean.
- **판정: 현재 제한된 동기 CJS 계약 PASS. F054-1의 보통 즉시/queued rejection 및 T055의 floating/frozen-species/nonconfigurable/species-loop는 Promise 생성 전 안전 거부로 해소됐다. 새 필수 결함 없음.** 과거의 Promise 처리 프레임워크 전체를 수용한다는 뜻이 아니다.
- 허용 tracked 변경은 이 보고서 하나. 코드·저장소 시험·fixture·공용 보고서 수정, commit/push, 제품0005 추가, 사용자 runtime/DB 접근 없음. UI 변경이 없어 브라우저 불필요. 공용 상태 반영은 Master 소유다.

## 1. 기준·환경·증거

AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 역할 지침, TEAM 최신 배정, PLAN 14 K-6/18, REVIEW의 T050/T052/T054 FAIL, T050/T052/T054/T055/T058 인계, 실제 loader/migrate/live-migrate와 시험·fixture를 읽었다. Orca orchestration 스킬과 설치 CLI guide, Next 로컬 output tracing 가이드를 읽었다. helper/worker 없이 직접 수행했다.

증거 E = `C:/Users/Administrator/AppData/Local/Temp/dream-t059-7cc6ea35350443edbef11aac575c068d` (명령 출력에는 ADMINI~1). Node `26.13.0`, Next `16.4.6`. child에 node_modules가 없어서 `robocopy D:/starwork/dream-ai-studio/node_modules ./node_modules /E /NFL /NDL /NJH /NJS /NP`로 의존성을 실제 복사했다(exit1=복사 성공, E/dependencies.log). npm ci를 했다고 주장하지 않는다.

원 CRLF checkout 그대로 실행했다(`git ls-files --eol tests/fixtures/migrations`의 w/crlf 유지). `DREAM_DATA_ROOT`는 제거했다. 전체 회귀/빌드에는 `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`를 읽기 실행 경로로만 지정했다. 원본 data/storage/backups를 열지 않았다. 독립 source와 DB는 E의 가상 파일·메모리 DB만 사용했고, 저장소 시험은 자체 OS temp 사본을 사용했다.

| 이번 직접 명령(repo cwd) | 실제 결과 | 증거 |
|---|---|---|
| `npm.cmd test` | **31파일 379 passed, 1 skipped**, exit0, 19.11초; skip은 s4 생성 모드 | E/test.log |
| `npm.cmd run lint` | exit0, 경고0 | E/lint.log |
| `npm.cmd run typecheck` | exit0, typegen/tsc 성공 | E/typecheck.log |
| `npm.cmd run build` | exit0, 경고 없음, 로컬 데이터·비밀 설정 추적 없음 | E/build.log |
| `node E/replay-runner.mjs` | immediate/queued 각 A/B3회, 정상 후속·100ms 대기완료, 두 child status0·stderr 빈값 | E/rejected-ab.log |
| `node E/independent-runner.mjs` | 기존 독립21 mode 모두 status0·stderr 빈값, assertion 통과 | E/independent.log |
| `node E/ordinary-runner.mjs` | rejected/thrownull/throwundefined/throwstring 모두 status0·normal completion·stderr 빈값 | E/ordinary.log |
| `node E/deadline.mjs` | getter147ms/then110ms, 두 child status0·stderr 빈값 | E/deadline.log |
| `node --conditions=react-server --import tsx E/late.mts` 3회 | 매회 exit0, A/B 직후·대기 뒤 rows=[], A journal base만, final [] [] | E/late-1~3.log |
| `node E/extra-runner.mjs` | 독립25 mode 최종 모두 status0·signal null·stderr 빈값·대기완료 | E/extra.log |
| `node --conditions=react-server --import tsx E/capture.mts E/capture-root` | exit0, source read1회, 디스크 값2로 변경됐어도 실행 결과값1 | E/capture.log |
| `node --conditions=react-server --import tsx E/validation.mts E/validation` | exit0, hash 우선·모든 파일 검사 우선·미참조 helper 거부·열린 DB 불변 | E/validation.log |

E는 설명용 약어이며 실제 명령에는 위 절대 경로를 전달했다. runner는 repo cwd에서 `--conditions=react-server --import tsx` child를 실행한다. 외부 deadline은 replay/ordinary5000ms, independent/extra6000ms, deadline4000ms이고, timeout/외부 kill은 PASS로 세지 않았다. 실제 최종 child는 모두 스스로 종료했으며 ETIMEDOUT/signal 종료 없음. 전역 rejection listener나 warn 플래그는 사용하지 않았다. 소유 명령·child 모두 종료, 상시 서버/worker 없음, 증거는 보존했다.

Master의 **관련124 PASS**와 작성자의 **379+1skip**은 별도 선행 증거다. 이번 직접 전체379와 합산하지 않는다. 위 live/direct/restore 회귀는 이번 원 저장소 전체 suite 실행 결과이며, 별도의 제품 production Next 실행을 했다고 주장하지 않는다.

## 2. 과거 증거 재실행과 기대값 변경

T054 OS-temp 원본의 .mts/.mjs는 읽기만 해서 E/original에 복사했다. late.mts, timeout.mts, deadline.mjs, ordinary.mts는 원문 그대로 실행했다. rejected-ab.mts와 independent.mts의 실행용 복사본만 아래 **오류 정규식 세 곳**을 조정했다. source body/DB 준비/반복/rollback assertion/대기는 그대로다. 원본 BOM도 보존했고 최종 차이는 E/assertion-diff.txt에 있다.

1. rejected-ab의 `/undefined만/` → `/Promise\.(reject|resolve) is not a function/`.
2. independent의 async 등록 `/동기 함수/` → `/동기 코드만/`.
3. independent의 promise 실행 `/undefined만/` → 해당 mode만 `/Promise.resolve is not a function/`.

옛 rejected-ab-runner는 status1·대기 미완료를 기대하던 **결함 재현용 부모**여서 새 E/replay-runner.mjs로 status0·빈 stderr·WAIT_COMPLETED를 assertion했다. child 원문을 안전하게 만들려고 바꾼 것이 아니다. old runner는 E/original에 그대로 보존했다.

T054의 원문은 각각 `return Promise.reject(new Error('ORDINARY_REJECTION'))`와 `return Promise.resolve().then(()=>{throw ...})`다. 지금은 반환값 판정 전에 TypeError로 거부된다. 동일 step 객체를 열린 A/B에 번갈아3회씩 적용한 여섯 실패 모두 rows=[], journal=[1], tx=false. 같은 연결에 정상 v2를 적용하면 rows=[{value:1}], journal=[1,2]이고 WAIT_COMPLETED 뒤 Node status0·stderr=""다. 따라서 rollback만 통과하고 나중에 프로세스가 죽었던 F054-1과 결과가 다르다.

추가 독립 extra.mts는 floating `Promise.reject`, frozen subclass/species throw, nonconfigurable constructor getter, species 무한반복, `new Promise`, `Array.fromAsync`, `AsyncDisposableStack`을 같은 A/B3회·정상후속·대기로 확인했다. 첫 Promise 생성 경로에서 거부되므로 species getter/무한반복에 도달하지 않는다. arbitrary hostile JS나 host sqlite 탈출을 새 요구로 만들지 않았다.

검수 도구 오류도 구분한다. extra 최초 실행은 `$async` 식별자를 허용하리라는 검수자 기대 때문에 adjacent mode에서 assertion이 실패했다. 실제 규칙의 JS 정규식 `\b`는 `$` 뒤 async도 찾는다. 보수적 거부 범위에 맞게 **그 mode의 검수 기대만** 고친 뒤25 mode 모두 재실행했다. 최초 로그는 E/extra-initial-harness-error.log에 보존하며 제품 실패로 세지 않는다. 재현 복사본 BOM을 처음 제거했던 저장 방식도 되돌린 뒤 replay/independent를 최종 재실행했다.

## 3. 동기 제한과 반환·시간 경계

- 해시가 일치한 캡처 문자열 **모든 파일**에 SQL 규칙과 `async|await|import` 단어 검사를 먼저 적용한다. 독립 validation은 entry의 TOP_EXECUTED throw보다 미참조 helper의 async 주석 거부가 먼저임을 확인했다. stale hash에서는 이 검사/entry 실행보다 hash 오류가 먼저다. 열린 A/B의 rows/journal/transaction 불변도 확인했다. 실제 사용자 DB를 사용한 검사는 아니다.
- 독립 nested async arrow, async method/generator, dynamic import, for await/await using, 주석·문자열·속성의 단어는 등록 거부됐다. escaped async arrow/method/generator와 escaped import/await는 V8 compile 거부됐다. suite에는 escaped async function과 helper-only async도 포함되어 통과했다. ordinary ASCII token과 이스케이프 source form 범위에서 fail closed다. 문자열 조립 등 모든 적대적 JS 난독화의 불가능성 증명은 아니다.
- 문자열/주석/속성 이름 오탐은 문서화된 제한이다. `$async`도 보수적 검사에 걸리며, 이를 JS 토큰 파서라고 표현하면 안 된다. 문법 허용 범위를 좁힌 것이고 v2 hash 입력은 바꾸지 않았다.
- VM 전역 Promise와 Array.fromAsync는 nonwritable/nonconfigurable 차단 함수, AsyncDisposableStack은 제거된다. require와 crypto가 context 함수로 바뀌어 loader 창구에서 host Function/Hash를 얻는 보통 경로도 없어졌다. native Promise를 생성한 뒤 settle하는 구 T055 복잡성은 제거됐다.
- old late thenable, then getter, untouched getter/toStringTag, 객체/null, intrinsics 변경, swallowed require는 독립21 mode에서 각각 거부·rollback 후 A/B 정상후속을 통과했다. 반환값은 원시 undefined 비교뿐이어서 일반 then/getter를 host에서 열거나 호출하지 않는다. explicit undefined와 return 없음은 독립/suite에서 정상 실행됐다.
- old deadline then/getter 무한반복은 호출하지 않고 즉시 거부되어147/110ms에 종료했다. 독립 exports/run/sql getter 및 run의 toStringTag getter 무한반복은 등록 내부1000ms 제한으로 약1008~1014ms에 돌아왔다. error.name/message/message.toString 무한반복은 내부80ms씩 A/B3회 거부 후 정상후속까지 약659~669ms에 종료했다. suite의 module/run timeout·proxy trap·microtask-loop도 통과했다. 외부 kill로 돌아온 것을 통과로 세지 않았다.
- 실행마다 새 context이고 다시 평가하지 않는다. 독립 fresh mode는 A/B 각1, source disk-edit mode는 편집된 디스크 대신 등록된 SQL/run을 실행했다. 오류 내용/entry 접근도 timed VM 평가 안에서 처리하고 host에는 원시 문자열로 전달한다.

## 4. 원문 identity·닫힌 로더·crypto

`lstat/read` 각1회 → 그 문자열 hash 비교 → 모든 source 규칙 → 같은 문자열 compile 순서다. 독립 capture.mts(T052 원문 복사)는 read hook으로 **자기 temp 파일만** 읽은 즉시 값1→2로 편집해 read1회·DB값1·디스크값2를 입증했고 hook은 finally 복구했다. suite의 stale hash+top-level throw, entry A/B 실제값 차이, CRLF/LF, helper 순서 불변, 경로/내용 변경, 누락/편집 source, 외부 module/run/sql/entry 주입 거부, certified WeakSet 회귀도 이번 전체에서 통과했다.

해시 입력은 `dream-code-migration/v2`, `entry\0<첫경로>`, 경로순 `file\0path\0sha256(LF text)`다. entry identity가 바뀌면 hash가 바뀌고 helper 순서만 바뀌면 같다. v1 기록은 v2로 재해석하지 않으며 exact journal prefix 비교에서 다른 해시는 mismatch다. version/name은 journal 별도 열이다.

닫힌 map만 require하고 Node 일반 resolution은 쓰지 않는다. 정확한 .cjs 상대경로, 목록 안으로 정규화되는 상대경로, cache·partial exports cycle을 허용한다. extension 생략/alias/package/목록 밖·import/export 별도 graph는 거부된다. 삼킨 require 실패도 sourceError에 남아 최종 거부되고 rollback한다. 이 회귀와 지연 require를 이번 suite/독립 swallowed mode에서 확인했다.

require, crypto.createHash, hash.update/digest는 context Function이고 module/exports/hash는 context 객체다. sourceError는 host 내부에만 남기고 사용자에게 context Error를 던진다. 독립 facade는 정상 함수 원형·write/on/copy 부재와 require/crypto 잘못된 사용의 Error 원형을 확인했다. suite도 frozen require/crypto/hash, 정상/실패 경로 context Error를 확인했다. host bridge는 prelude에서 global에서 제거하고 사용자 코드 뒤 host가 global 속성을 다시 읽지 않는다. 독립 bridge getter/setter loop도 정상 실행했다.

crypto는 sha256/string update/hex·base64·base64url digest만 제공한다. 독립 한글+emoji 분할 update의 세 encoding을 host SHA256 정답과 비교해 통과했다. suite는 a의 hex/base64 정답·잘못된 algorithm/update/encoding·digest후 재사용 거부를 확인한다. host Hash/stream callback API가 필요하지 않은 실제 test5의 derivedId 변환은 같은 s4 입력의 모든 snapshot을 새 timeline 행으로 옮기고 옛 업무행·UUID 형태·기록 해시를 유지해 PASS다. 축소된 facade가 현재 시험 변환을 깨지 않았다.

## 5. 결정성·rollback·현재 SQL 호환

SQL_RULES는 시각/난수 표현 검출 목록이다. 모든 SQL 결정성의 증명이 아니다. 이번 full suite는 SQL clock/randomness와 Date/Math.random 등 보통 숨은 입력 거부, 같은 s4 입력을 실제1.1초 다른 시각에 실행한 test5 결과 동등성, 문자열 조립한 시각 표현은 등록돼도 단계별 비교가 차이를 잡음을 확인했다. **새 단계마다 같은 입력·다른 clock 결과 비교와 검토는 계속 필요하다.** Node/V8/SQLite/better-sqlite3·verify는 source hash에 포함되지 않으며 lockfile/Node26 기준이다.

이번 전체 회귀에서 직접 확인한 범위: SQL/run/verify/journal 실패의 전체 transaction rollback, verify query_only=ON 내부 확인과 finally 원값0 복구·이후 쓰기 성공, old rows 보존, live의 변경 전 snapshot·실패 DB 불변/사본 보존, direct/live 동등성(의도된 activity/journal time 제외), staging s4→code5/direct 동등성, code backup same/mismatch/too_new·거부 목적지 없음·원본 ZIP 불변. verify 이전값1은 source finally가 보존하는 구조이며 이번에 그 callback 경로를 별도 구성해 실측했다고 주장하지 않는다.

현재 productMigrations는 SQL1~4뿐이다. 기존 SQL hash/manifest/journal과 s4 호환은 유지됐다. E/hash-before.json과 hash-after.json 전체8항목은 동일하다.

| 원본 | 시작/끝 SHA256 |
|---|---|
| SQL0001 | ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0 |
| SQL0002 | 6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed |
| SQL0003 | 9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e |
| SQL0004 | 6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3 |
| s4.zip | 6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392 |

s4.json/build/compare도 동일하고 시험5 원문/registry 및 원 CRLF 상태를 수정하지 않았다. 의존성·.next와 OS 임시 증거 외 tracked 변경은 이 보고서뿐이다.

## 6. 수용 범위와 다음 통합 조건

현재 문서의 동기 보장은 **허용된 source 문법 + loader가 노출하는 창구 + 검토된 trusted step** 범위로 읽어야 정직하다. host sqlite는 여전히 host realm과 native async API(`backup()` 등)에 닿는다. 따라서 “모든 JS 비동기가 불가능하다”, “host DB까지 격리됐다”는 주장은 하지 않는다. reviewed migration에서 그 API를 사용하지 않는 전제, SQLite native 문장 자체는 JS timeout으로 interrupt하지 못하는 한계는 유지된다. 이번에 임의 hostile host DB escape 차단을 새 필수 요건으로 추가하지 않았다.

이 한계를 명시한 **현재 restricted synchronous CJS 계약은 PASS**이며 F050/T052 수정 및 F054-1 해소 근거를 반환한다. 새 필수 결함을 재현하지 않았다. Master가 공용 PLAN/REVIEW/TEAM 상태를 이 제한 범위에 맞춰 통합하면 된다. P1 사용자 승인 상태나 SQL K6 기존 PASS는 바꾸지 않는다.

아래는 계약 미구현 결함이 아니라 **실제 제품0005 등록 때의 다음 통합 요구사항**이다. 제품0005는 이번에 추가하지 않았다.

- 실제 source graph/entry·registry 선언, 그 단계의 old rows/schema/data 검사·같은 입력 다른 clock 비교, s4 upgrade/새 고정s5·direct/restore 동등성.
- 원문 source bundle/Next tracing 동봉, 배포 cwd 기준과 missing/edited/stale source/wrong cwd 거부, CLI와 production Next에서 실제 code-step 동일 실행 결과.
- 각 제품 진입점의 DB 접근 전 source 검증 배치, MigrationSourceError/MigrationTimeoutError의 CLI 종료코드·시작 안내·오류 UI와 재시도 흐름.

이번 SQL 앱 build 성공은 아직 등록되지 않은 code-step의 production 실행·동봉을 증명하지 않는다. 문서 작성과 Orca 전송/수신/통합은 별개이며 worker_done은 실제 CLI 영수증으로 확인한다.

**Claude design/플래너 전달 복사문:** T059는 94a13c2와 제품 동일한 새 clean child에서 원CRLF 전체379통과+생성1skip·lint/typecheck/build를 독립 실행했습니다. T054 immediate/queued 원문의 기대 정규식만 바꾼 A/B각3회·rollback·정상후속·대기완료·Node status0/빈stderr와 floating/species/비설정constructor/loop·nestedasync/import/이스케이프·loader/crypto 경계를 확인하여 현재 제한된 동기CJS 계약은 PASS이며 새 필수 결함은 없습니다. host sqlite native async 금지의 검토 전제와 단계별 다른clock 비교는 유지하고, 실제0005 등록·source동봉/cwd·CLI/productionNext·오류UI는 다음 통합 요구사항으로 배정해 주세요; 제품0005와 사용자DB는 건드리지 않았습니다.
