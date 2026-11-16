# T-050 · 코드 데이터 이관 해시 계약 독립 검수

- 담당: CX-REVIEW-08 / Codex, 구현 미참여 독립 검수. coordinator: Codex Master.
- 대상: `80ed292` (T-048). child HEAD `74bf70cf11c8ea95f380ebb1272aa3de3fa5e562`; 대상 이후 차이는 docs/TEAM.md뿐이며 lib/tests/package-lock 차이 없음. 시작 clean.
- 판정: **현재 SQL 0001~0004 호환·트랜잭션/복원 회귀는 scoped PASS. T-048 실행 원문 해시 계약은 FAIL / ready_review 반려. F050-1~3 필수 수정 후 독립 재검수 필요. 제품 0005/P2-1 진행 조건 충족으로 채택하지 않는다.** 제품 코드 단계가 아직 없으므로 현재 사용자 DB에서 코드 이관 오류가 발생했다고 주장하지 않는다.
- 허용 변경: 이 문서 하나. 제품·저장소 시험·고정 fixture·공용 보고서·commit/push 변경 없음. PROGRESS/REVIEW/TEAM 갱신은 Master에게 반환한다. 사용자 DB/원본 runtime/유료 API 접근 없음.

## 1. 읽은 기준과 재현 환경

AGENTS.md, AI_TEAM_RULES.md, CLAUDE.md, docs/team 두 역할 문서, PLAN 14장 K-6/18장, REVIEW/PROGRESS/TEAM 최신 상태, T-017 3.4~3.6, T-048 전체, 실제 code-migration/migrate/live-migrate/migrate-command/server/connection, restore/archive, fixture step/registry 및 관련 시험을 확인했다. Orca orchestration skill과 해당 CLI guide를 읽었으며 helper/worker를 만들지 않았다. Next 16.4.6 로컬 output/tracing 가이드를 읽었다.

OS 임시 증거 루트: `C:/Users/Administrator/AppData/Local/Temp/dream-t050-43e70e9c0a4942e7afd9050c41124e56` (이하 E). `git archive 80ed292`를 E/src로 풀어 검수했다. 최초 child에는 node_modules가 없어 npm 명령이 실행되지 않았고, 형제 검수 폴더의 동일 의존성을 처음 junction으로 연결했다. Turbopack이 workspace 바깥 next 경로를 거부하여 junction을 제거하고 의존성을 E/src/node_modules에 실제 복사한 뒤 빌드 성공했다. 두 초기 실패는 제품 결함으로 세지 않는다. 실제 복사는 robocopy 종료1(파일 복사 성공), Node 26.13.0 / Next 16.4.6이다. npm ci를 이번에 실행했다고 주장하지 않는다.

DREAM_DATA_ROOT를 지워서 검사했다. media 회귀/최종 빌드에는 `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`를 읽기 실행 경로로만 사용했다. root의 사용자 data/storage/backups는 열지 않았다. 독립 재현용 source/DB는 E 및 `TEMP/dream-t050-probe-*` 안에만 만들었고 DB는 :memory: 또는 기존 시험이 생성·정리하는 OS temp 사본이다.

## 2. 실제 실행 결과 (다른 담당 증거와 분리)

| 실행 | 이번 결과 | 증거 |
|---|---|---|
| `npm.cmd test` 원래 archive 줄바꿈, media 설정 전 | 31파일 중 30통과/1실패; 318통과/1실패/2skip | E/test.log. F050-4의 줄바꿈 시험 실패, media/생성 모드 skip |
| 독립 `npx.cmd vitest run tests/t050-independent.test.ts` | **10/10 통과**: 아래 계약 허점이 실제 허용됨을 기대하는 재현 시험 | E/probe-final.log, E/probe-results.jsonl, E/t050-independent.test.ts |
| 실제 CLI 방식의 외부 의존 재현, 별도 두 프로세스 | **동일 저널 hash, 값 10과 20** | E/actual-tsx-external.log, E/probe-external/{entry.ts,outside.ts,registry.mts} |
| 실제 CLI 방식의 암묵적 SQL 현재 시각 재현 | **동일 저널 hash, 서로 다른 현재 시각** | E/actual-sql-clock.log, E/probe-clock/{entry.ts,registry.mts} |
| `npm.cmd test`, fixture 코드 두 사본만 CRLF→LF 정규화 + media 경로 지정 | **31파일 320통과 + 1skip**(s4 최초 생성 모드) | E/test-lf.log. 기존 저장소 시험 그대로; E/src의 fixture 두 개만 EOL 정규화한 조건부 결과 |
| `npm.cmd run lint` | 종료0, 경고0 | E/lint-final.log |
| `npm.cmd run typecheck` | 종료0, typegen/tsc 통과 | E/typecheck-final.log |
| `npm.cmd run build` | 종료0, 경고 없음, verify-build 사적자료 추적 없음 | E/build-local.log, .next/server의 nft.json 32개 |

독립 probe는 lint/typecheck 전에 E/src/tests에서 E 루트로 이동했다. 제품에 시험을 추가한 결과가 아니다. Master의 관련44 통과 및 T-048 작성자의 320+1skip은 **별도 기존 증거**이며 위 이번 실행과 합산하지 않는다. 320통과를 원래 CRLF child의 무조건 통과로 표현하지 않는다.

## 3. F050-1 · 필수: 해시 파일과 실제 run 연결 미보장

위치: `lib/db/code-migration.ts:68~90`, `lib/db/migrate.ts:76~80`, fixture registry 및 T-048 4장2.

`CodeStepDefinition.module`은 호출자가 주는 `{entry,run}`이다. constructor는 entry 문자열/함수 타입/디스크 파일 hash를 검사한 다음 **호출자가 준 함수를 그대로 capture하여 freeze하고 WeakSet에 넣는다.** WeakSet은 constructor를 거친 객체임을 증명할 뿐, 그 함수가 해시한 파일에서 로드되었다는 증거가 아니다.

독립 재현은 source `probe/entry.ts`의 run이 `INSERT ... VALUES(1)`인 상태에서, 같은 entry/files/sql/sha256를 주고 별도 run이 `VALUES(2)`를 실행하게 했다. 둘 모두 certified이며 migrateDatabase가 정상 실행했다. 결과는 값1/값2인데 두 저널 모두 다음과 같다:

```json
{"version":1,"name":"0001_probe.ts","sha256":"e487bb209dd5da2365553cdf4b3c1127205df10ea2da3ceea64599eef4e0bfef"}
```

재현의 핵심은 아래와 같다. 실제 시험은 각 목록을 :memory: DB에서 migrateDatabase로 실행하고 저널/rows를 비교한다.

```ts
codeMigration({version:1,name:'0001_probe.ts',root,
  module:{entry:'probe/entry.ts',run:db=>db.exec('INSERT INTO proof VALUES (2)')},
  files:['probe/entry.ts'],sql:'CREATE TABLE proof(value INTEGER)',sha256:hashOfSourceThatInserts1});
```

추가 확인:

- 일반 mutable module에서 constructor **이후** run 프로퍼티를 교체하면 이미 capture한 함수는 바뀌지 않았다(PASS). migration과 sources는 freeze됨.
- getter run은 타입 확인과 capture에서 두 번 읽히며 다른 함수를 반환하면 두 번째 함수가 실행된다. 이것은 보조 경계 증거이며 악성 getter 방어를 별도 제품 필수 요건으로 요구하지 않는다.
- 디스크 source와 declaration을 새 버전으로 같이 맞추고 과거 run을 전달해도 수락했다. 단, **완전히 오래된 빌드의 선언 hash를 유지한 채 디스크 source만 바꾸는 보통 경우는 거부된다**. 실제 과거 Next 번들 전체를 교체한 배포 실험을 했다는 뜻은 아니다.
- 작성자 시험 `changedStep()`도 root/source/hash는 바꾸지만 import된 `step.run`은 그대로다. 기록 mismatch 검사는 통과하나 새 source가 실제 실행된다는 증거가 되지 않는다.

신뢰된 개발자 등록 가정을 인정해도 이번 수락 조건은 “hash 한 함수와 다른 함수 실행 금지”다. 악성 JS sandbox 요구가 아니라 평범한 잘못된 static import/복사한 registry/낡은 실행 artifact의 연결 오류를 지금 잡아야 한다. **entry 문자열 비교와 constructor 인증만으로 이 요구를 통과시킬 수 없다.** T-048의 “등록 import=entry 시험을 미래0005 때 추가”는 현재 계약 수락에는 늦다.

필요 수정: 검토된 registry/build 산출물에서 실제 import 경로와 export run, 닫힌 의존 graph, 해당 artifact와 declaration을 함께 검증하는 경계를 지금 만들고 fixture registry에서 증명할 것. 또는 실행 모듈을 검증된 source 집합으로부터 로드하는 설계를 선택할 것. 구체 구현은 담당자 판단이나, public module 인자를 그대로 인증해 놓고 실행 원문 결합이라고 주장하면 안 된다. 단순 Function.toString hash로 바꾸라는 요구는 아니다. 잘못된 등록을 reject하는 회귀와 정상 registry의 실제 실행 증거가 필요하다.

## 4. F050-2 · 필수: 유효한 import 문법이 닫힌 목록 검사를 빠짐

위치: `code-migration.ts:45 IMPORT`, `:51~64 resolveImport/checkCodeStepSource`.

아래는 모두 일반 TS/JS 문법이며 문자열 조립/평가 코드 공격이 아니다.

| 형태 | 이번 검사 결과 | 판단 |
|---|---|---|
| `import {x} from './outside'` | 거부 | PASS |
| `import './outside'` | 거부 | PASS: 단순 side effect 검사는 작동 |
| `export {x} from './outside'` / 일반 공백 주석 from | 거부 | PASS |
| `import/* comment */ {value} from './outside'` | **허용** | runtime 외부 의존 누락 |
| `export/* comment */ {x} from './outside'` | **허용** | runtime 재수출 의존 누락 |
| `import type {X} from './outside'` | 허용 | 올바른 type-only 허용 |
| `import {type X} from './outside'` | 거부 | 보수적 거부/문법 지원 한계, 실행 의존 유출 아님 |
| `import type from './outside'; ... type ...` | **허용** | `type`라는 default runtime binding을 type-only로 오인 |
| `import ... from '@/probe/helper'`, helper.ts 목록 포함 | 허용 | 현재 root alias 정상 예제 |
| `import ... from './helper.js'`, helper.ts만 목록 포함 | 거부 | TS extension substitution 문법의 보수적 거부 |

**실제 실행 재현:** E/src 안 `probe-external/entry.ts`에는 아래 세 줄만 두고 목록은 이 entry 하나만 넣었다. registry.mts는 정상 namespace import한 바로 그 step을 constructor에 넘겼다. 따라서 F050-1의 가짜 run 없이도 재현된다.

```ts
import/* module dependency */ { value } from './outside';
export const entry='probe-external/entry.ts';
export function run(db:any){db.prepare('INSERT INTO proof VALUES (?)').run(value);}
```

`node --conditions=react-server --import tsx probe-external/registry.mts`를 outside.ts의 `export const value=10;`과 `...=20;` 두 상태에서 각각 실행했다. 동일 entry/hash/sql/declaration/registry에 대해 두 저널 모두 `d19a4c0ea2fb3f4f686468025187f3a5cb528072733d5831a03ac320420e620c`, 결과는 10/20이다. **같은 hash로 다른 외부 의존 결과가 실행되는 실계약 FAIL**이다.

해결은 parser 기반의 실제 runtime import/reexport/type-only 분류 또는 명시적으로 지원하는 문법 이외를 빠짐없이 거부하는 제한 문법이다. side effect/reexport/default binding named type/comments를 회귀에 넣고, 사용하는 TSX와 Next loader의 실제 resolution에 맞춰 경로를 확인해야 한다.

해석 한계: 별도 TS→CommonJS 실제 require 실험에서는 extensionless helper가 목록 helper.ts 대신 helper.js를 로드하여 동일 hash로 값11/22였다(E/probe-results.jsonl RESOLUTION). 그러나 **현재 CLI TSX 실험에서는 helper.ts를 골라 값1**이었다(E/tsx-resolution.log). CommonJS 결과를 현재 TSX 제품 경로의 확정 결함으로 확대하지 않는다. `.js`→`.ts` substitution은 현 검사에서 거부되고 `@/` 기본 alias는 통과했다. Next/CLI resolution이 동일하다는 검증 또는 실제 artifact graph 결합은 수정 시 필요하며 모든 alias/extension을 이번에 실행 검증한 것은 아니다.

## 5. F050-3 · 필수: 결정성 검사와 보장 설명 범위 불일치

위치: `code-migration.ts:34~43 SQL_FORBIDDEN/FORBIDDEN`, README 계약 단락, T-048 1/5장.

`Date`, `Math.random()`, process/globalThis, crypto 난수 식별자, SQL 'now'/CURRENT_*/random()의 통상 예제는 거부한다. 하지만 `Math['random']()`, `Intl.DateTimeFormat().format()`, SQL `datetime()`가 수락된다. `Math . random()`은 regex가 놓치지만 SQL randomness regex가 우연히 잡아 거부했다(“전부 놓친다”로 과장하지 않음).

핵심 실증은 우회 표현이 필요 없는 **SQLite의 인자 생략 현재 시각**이다. 다음 실제 step을 정상 namespace로 import하고 동일 :memory: 입력에 두 번 실행했다. migration now는 0으로 고정했다.

```ts
export const entry='probe-clock/entry.ts';
export function run(db:any){
  db.exec("INSERT INTO proof VALUES(strftime('%Y-%m-%dT%H:%M:%fZ'))");
}
```

양쪽 저널 sha는 `bb6361eb004e099ddfa42974cb21f4f364c9f8f90cf16e354da70b0ccec7a8dd`로 같다. 값은 `2026-11-16T05:40:55.703Z`와 `.750Z`로 달랐다. 이 정도의 통상 SQL 표현도 거부하지 않으므로 “시각 금지 검사가 있어 같은 입력이면 같은 출력”이라는 일반 보장은 성립하지 않는다.

필요 수정: 암묵 SQL clock 등을 제한하거나 검증 가능한 좁은 실행 규칙을 정하고, source 검사 설명은 검출하는 규칙 수준으로 좁힐 것. 결정성은 **해당 step에 대해 같은 입력/다른 clock에서 실제 결과 동등성 검증 + 검토**로 별도 증명할 것. v1 hash는 format/sql/path/source text를 묶지만 TS compiler/Next/TSX/Node/SQLite/node:crypto 구현 버전·환경·verify 함수는 포함하지 않는다. 허용 플랫폼/도구 버전 가정을 명시하고 향후 hash 입력 정책 변경 시 v1 기록을 재해석하지 않도록 해야 한다. 일반 보안 sandbox, 임의 적대적 JS 전체 차단 또는 모든 실행 환경의 수학적 결정성 증명을 요구하지 않는다. fixture의 결정적 변환이 통과했다는 사실과 검사가 임의 step의 결정성을 보장한다는 주장을 구분해야 한다.

## 6. F050-4 · 회귀 시험 수정: CRLF 입력 중복 변환

`tests/k6-code-migration.test.ts:48`은 읽은 파일에서 `/\n/g`를 바로 CRLF로 바꾼다. core.autocrlf=true이며 `.gitattributes`는 SQL에만 LF를 지정하므로 이 child/아카이브 TS fixture는 이미 CRLF다. 이 변환은 CRCRLF를 만들고 기존 codeMigrationSha256의 CRLF→LF 정규화 뒤 CR 하나가 남아 비교 실패한다. 수신 hash `8cbdd3bb...` vs 예상 `e20c30e4...`.

이것은 LF hash 함수의 실제 CRLF 정규화 결함이 아니라 **시험 생성 입력의 결함**이다. 독립한 명시 문자열 vector로 LF/CRLF 동일성을 통과했다. E/src의 fixture 코드 두 사본만 LF로 바꾼 뒤 기존 전체320+1skip을 통과했고 원본 저장소 파일은 바꾸지 않았다. 시험은 먼저 LF로 정규화한 문자열에서 CRLF를 생성하거나 LF 고정 문자열로 검증하도록 수정해야 Windows 기본 checkout도 통과한다. F050-1~3보다 우선순위는 낮으나 재검수의 full test는 원 checkout에서 통과해야 한다.

## 7. scoped PASS와 유지되는 한계

- 독립 hash vector가 `dream-code-migration/v1\n`, `sql\0<sha>`, 경로별 정렬된 `file\0path\0<sha>`와 정확히 같았다. sql/path/dependency 내용 변경은 hash를 바꾸고 정상 LF/CRLF와 파일 목록 순서만 바꾼 경우는 같았다. 선언 mismatch와 파일 없음/경로/첫 파일/중복/함수 없음 검사는 기존13과 독립 vector/probe로 확인했다.
- 기존 코드13개를 이번 full suite에서 다시 실행했다. 같은 입력의 fixture step 결과(저널 applied_at 제외) 동일, 옛 업무행 보존, 변환 오류/verify 오류 시 SQL 표·저널까지 rollback, live 적용 전 snapshot/실패 snapshot 보존, live/direct 동등성, s4 restore staging/direct 동등성, 코드5 백업 same/mismatch/too_new/목적지 없음/ZIP 불변을 통과했다. **현재 fixture에서의 PASS**이며 원문/run 결합을 보완하지 않는다.
- migrateDatabase는 SQL 다음 run, 그 다음 journal 기록을 같은 immediate transaction/savepoint에 실행한다. 미인증 run/kind=code인 **남은 단계**는 어느 적용 단계 실행 전 거부한다. 이미 적용된 단계의 run은 다시 실행하지 않는다. source constructor 거부는 DB 없이 가능하지만 migrateDatabase 자체는 이미 받은 DB에서 검사를 수행하므로 “모든 진입점이 DB 접촉 전에 거부”라고 표현할 수 없다.
- 제품 목록은 여전히 SQL4개다. original SQL hash: `ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0`, `6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed`, `9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e`, `6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3`. s4 sha=`6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392`. 이번 전후 원본 동일, s4 manifest/SQL 기록 대조 회귀 통과.
- `verify`는 해시 입력 밖의 임의 함수다. 지금 계약은 검사용 trusted callback이라는 가정이다. malicious verify를 sandbox로 차단하는 추가 요구는 하지 않지만 transform을 verify로 옮겨 hash 계약을 우회해도 된다는 의미는 아니다.

## 8. 제품0005 때의 통합 요건 (현재 구현 완료로 주장하지 않음)

현재 codeMigration은 기본 source cwd, 시험 root override, static namespace와 별도 literal declaration 구조다. 제품0005 등록 없음. 이번 production build 성공과 사적자료 추적 없음은 **현재 SQL 앱의 빌드**이며 코드 step source 동봉/trace/실행 검증은 아니다. 동적 root read에는 turbopackIgnore가 있어서 원문이 배포 산출물에 포함된다는 보장이 없다.

F050-1~3의 계약 수정/fixture 입증은 **지금 수락 전에** 필요하다. 이후 실제0005 통합 때는 다음을 별도 검증한다:

1. 제품 registry의 실제 import=entry 및 runtime 의존 graph, Next build/CLI 실행 모듈/declaration/source bundle 결합, cwd 또는 동봉 source 경로. build 후 source만 변경/제거, 낡은 artifact, wrong cwd 각각 거부되는지 확인한다.
2. source validation을 DB access 전 배치하는 각 CLI/startup/restore 진입점. runMigrateCommand는 list를 먼저 만들지만 함수 try 밖에 있어 source error UI/CLI 안내까지 구현된 것은 아니다. withDatabase는 DB를 열고 verifyMigrations/default list를 만들며 checkDatabase는 source 오류가 일반 catch로 들어간다. 이것은 미래 code 등록 시 통합 조건이지 현재 미등록 단계에서 발생한 UI 결함이라고 주장하지 않는다.
3. MigrationSourceError의 시작 화면/CLI 오류 코드·사용자 문구·안전한 재시도 경로, build/source missing 오류 처리. 제품 code stage가 실제 있는 상태의 trace/배포/startup 시험을 해야 한다. 이번 browser/UI 변경은 없어 브라우저 미실행.
4. 실제0005의 데이터 검증/옛 행 보존/고정s4 upgrade·새s5·direct/restore 동등성. 지금 test-only5로 제품0005 규칙이 구현된 것은 아니다.

## 9. 반환과 다음 단계 진입 조건

Master가 F050-1(실행 결합), F050-2(runtime dependency 누락), F050-3(암묵 clock/보장 표현)을 필수 수정으로 배정하고 F050-4 시험 입력도 정리한다. 수정 후 wrong module/run 및 정상 static registry, 실제 TSX commented import/default named type/reexport, 암묵 SQL clock, artifact/source mismatch의 재발 거부를 독립 재검수한다. full tests/lint/typecheck/build와 원본 해시 보존을 함께 통과하기 전 T-048을 완료로 채택하지 않는다. 기존 SQL K-6 PASS·기존 P1 사용자 승인 범위는 바꾸지 않는다.

이번 소유 서버/worker/browser/상시 process는 만들지 않았고 실행 명령은 모두 종료했다. 재현 source/log/build는 E에 증거로 보존, 임시 probe 디렉터리는 fake source만 보존했다. 원본 workspace는 이 문서만 untracked 변경이다. 문서 작성/Orca 완료 전송/수신 확인은 구분하며 아래는 복사용 메시지다.

**Claude design/플래너 전달 복사문:** T050 독립 검수는 SQL4 호환·fixture 코드 이관 rollback/snapshot/restore 회귀와 조건부 전체320+1skip·lint/typecheck/build를 통과했지만 T048 실행 원문 해시 계약은 FAIL입니다. F050-1에서 정상 constructor가 hash한 원문과 다른 run을 인증했고 F050-2는 실제 CLI TSX에서 동일 hash로 외부 의존 변경 결과10/20을 실행했으며 F050-3은 암묵 SQL 현재 시각으로 같은 입력 결과가 달랐습니다. import=entry 검증을 미래0005로 미루지 말고 계약 수정과 독립 재검수 후 수락해 주세요; 현재 제품0005는 없고 기존 SQL K6/P1 승인 상태는 유지하며 CRLF 회귀 시험 입력도 수정이 필요합니다.

