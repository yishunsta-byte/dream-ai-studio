# T-058 코드 이관 동기 전용 제한 — CC-DATA-01 보고

- 부모: T-055 · 배정 Master msg_edbfbf0d837a · 설계 공유 msg_5560b54fc140 → 채택 msg_0f5e31ecfc4d
- 시작 HEAD: 4f543e0(작업 중 Master 커밋으로 c444503) · 담당: CC-DATA-01
- 고친 곳은 `lib/db/code-migration.ts` 로더 하나예요.
- 바꾸지 않은 것:
  - `migrate.ts`
  - SQL 0001~0004
  - `dream-code-migration/v2` 해시 입력과 형식
  - 시험 5단계 원문·레지스트리와 해시 `dd41a479…`
  - 고정 s4, 사용자 DB, 공용 문서
  - 제품 0005(없음)
- 새 의존은 없어요. process 전역 listener나 Node 경고 플래그도 쓰지 않았어요.

## 1. 바꾼 계약 (허용 원문을 좁힌 것, 해시 입력은 그대로)

| 항목 | 지금 |
|---|---|
| 동기 전용 원문 규칙 | `checkSyncSource`를 추가했어요. 해시를 대조한 **같은 문자열**의 목록 모든 파일을 실행 전에 검사해요. 단어 `async`·`await`·`import`가 어디에든 있으면 `MigrationSourceError`("동기 코드만 쓸 수 있어요 ('async' 단어 사용…)")로 거부해요. |
| 이 규칙이 막는 것 | V8은 `\u` 이스케이프로 쓴 키워드를 문법 오류로 거부해요. 그래서 글자 그대로 단어를 찾으면 async 함수·화살표·메서드·생성기, `await`, `for await`, `await using`, 동적 `import()`가 모두 걸려요. |
| 오탐(의도한 보수성) | 문자열·주석·속성 이름 안의 같은 단어도 거부해요. 예를 들어 `"SELECT 'async'"`, `{async:1}`, 주석 속 `import`가 그래요. 이런 곳에서는 다른 말로 바꿔 써야 해요. `fromAsync`, `AsyncDisposableStack`처럼 다른 단어의 일부이거나 대문자인 경우는 걸리지 않아요. 대신 2행의 실행 공간 차단이 맡아요. |
| 실행 공간 Promise 차단 | `Promise`를 고칠 수 없는 차단 함수로 바꿨어요. `Array.fromAsync`도 차단했고 `AsyncDisposableStack`은 지웠어요. Node 26 vm 전역을 실측했어요. 그 밖에 Promise를 만드는 내장은 이미 지운 WebAssembly·Atomics·Temporal뿐이고, `queueMicrotask`는 없어요. 그래서 단계 코드는 Promise를 만들 수 없어요. 돌려주든, 던지든, 버리든 거부된 Promise가 남지 않아요. |
| require·crypto 창구 | 둘 다 **실행 공간 안 함수**로 바꿨어요. 예전에는 호스트 함수와 호스트 Hash 객체를 넘겼어요. 그래서 `require.constructor`로 호스트 Function과 Promise에 닿았고, Hash는 스트림이라 `write` 콜백이 나중에 실행될 수 있었어요. |
| crypto 허용 범위 | `createHash("sha256").update(문자열).digest("hex"|"base64"|"base64url")`만 돼요. 결과는 원시 문자열이에요. 그 밖의 사용(다른 알고리즘, 문자열 아닌 update, 두 번째 digest)은 실행 공간의 Error로 거부해요. 호스트는 원시값만 받아 sha256을 계산하고, 들어온 값의 종류도 다시 확인해요. |
| require 거부 | 목록 밖 의존이나 형식 오류는 호스트에 기록해요. 실행 공간에는 실행 공간 Error를 던져요. 단계 코드가 삼켜도 등록·실행 모두 거부해요(T-053 그대로). 그래서 정상 경로와 실패 경로 모두에서, 단계 코드가 받는 호스트 영역 객체는 `run(db)`의 `db`뿐이에요. |
| 단순화 | T-055의 settle(캡처한 then, `isPromise` 연결, constructor 우회)은 이제 도달할 수 없어서 지웠어요. `run`은 undefined만 돌려줄 수 있고, 실행마다 새 context를 쓰며, 시간 제한과 원시 문자열 경계는 그대로예요. |
| 범위 밖(유지) | 신뢰하는 마이그레이션 로더이지 임의 JS 격리 증명이 아니에요. 단어 검사도 모든 JS 비동기를 증명하는 것이 아니에요. `db`(host sqlite)를 거쳐 호스트 영역이나 비동기 API(`backup()` 등)에 닿는 것은 "검토한 단계는 쓰지 않음" 전제로 남겨요. 시간 제한은 SQLite 문장 하나 안에는 걸리지 않아요. |

## 2. 시험 (`tests/k6-code-migration.test.ts`, 56 → 72개)

자식 프로세스 시험은 모두 외부 마감 10초 안에 status 0으로 스스로 끝나야 하고, stderr가 비어 있어야 해요.

**실행에서 거부되는 16가지 (Promise를 만들기 전에 막힘)**
- 열린 A·B에 3번씩 번갈아 썼어요. 6번 모두 거부됐고, 매번 행 0개, 기록은 1단계, 트랜잭션 없음이었어요.
- 같은 연결에서 정상 단계가 성공했고, 100ms 대기도 끝났어요.
- 거부 문구는 넷 중 하나예요: `Promise.reject/resolve is not a function`, `Promise·Array.fromAsync is not available`, `AsyncDisposableStack is not defined`, `Code generation from strings disallowed`.

| 묶음 | 경우 |
|---|---|
| T-054 원문 | `ab-reject-immediate`, `ab-reject-queued` |
| T-055 처리 대상 | `ab-reject-subclass`, `ab-reject-species-getter`, `ab-throw-rejected`, `ab-species-throw`, `ab-constructor-getter-throw` |
| T-055 한계 4가지 (예전엔 status 1, 지금은 안전 거부로 시험 교체) | `limit-frozen-species-throw`, `limit-nonconfigurable-constructor`, `limit-species-loop`, `limit-floating` |
| 새로 추가 | `ab-new-promise`, `ab-from-async`, `ab-async-disposable`, `ab-require-constructor`, `ab-crypto-constructor` |

`limit-floating`(돌려주지 않고 버린 `Promise.reject`)은 T-055에서 정상 적용된 뒤 Node가 꺼졌어요. 지금은 실행에서 거부되고 적용되지 않아요.

**등록에서 거부되는 10가지 (실행 전)**
- 등록이 `MigrationSourceError`로 거부됐어요.
- 열린 A·B에 쓰기가 없었고, 정상 후속 단계가 성공했고, 대기도 끝났어요.

| 거부 이유 | 경우 |
|---|---|
| 동기 전용 규칙 | `reg-async-run`, `reg-nested-async`(run 안 async 화살표), `reg-async-method`, `reg-async-generator`, `reg-dynamic-import`, `reg-helper-async`(도우미 파일 쪽), `reg-word-in-string`(오탐 기록) |
| V8 문법 오류("정해진 .cjs 형식이 아니에요") | `reg-escaped-async`, `reg-escaped-import`, `reg-escaped-await` |

**창구 확인 (같은 프로세스 시험)**
- 아래가 모두 실행 공간 영역이고, 그중 `require`·crypto 창구·Hash는 얼어 있었어요: `require`, `require.constructor`, crypto 창구, Hash, `module`, `exports`.
- `digest`의 hex·base64 값이 sha256('a') 정답과 같았어요.
- 다음 6가지 잘못된 사용은 모두 실행 공간 `Error`로 거부됐어요: 두 번째 update, 두 번째 digest, md5, 숫자 update, 인코딩 없는 digest, latin1.

**바뀐 기존 기대값**
- async run과 import 문법은 이제 "동기 코드만"으로 거부돼요.
- native Promise 반환은 `Promise.resolve is not a function`으로 거부·되돌림돼요.
- `microtask-loop`는 Promise가 없어서 바로 거부돼요.
- `proxy-trap-loop`는 Promise 대신 빈 객체를 감싼 Proxy로 바꿨어요(trap은 여전히 하나도 불리지 않아요).

**유지된 것**
- T-053 늦은 쓰기 5가지 × 3회
- 끝나지 않는 9가지
- 시험 5단계의 결정적 변환·require·crypto·순환 require·같은 입력 같은 결과
- verify, live, staging, 백업

**되돌려 보기** (원래대로 돌린 뒤 모두 통과)

| 뺀 보호 장치 | 실패한 시험 수 |
|---|---|
| 동기 전용 원문 규칙 | 10 |
| Promise 차단 | 14 |
| fromAsync 차단 | 1 |
| AsyncDisposableStack 제거 | 1 |
| 실행 공간 require/crypto | 4 |

## 3. T-054 원본 재현을 복사해서 실행

T-054 증거 폴더의 스크립트를 제 OS 임시 폴더에 복사했어요. 원본은 읽기만 했어요. 저장소 cwd에서 실행한 뒤 임시 폴더는 지웠어요.

| 재현 | 결과 |
|---|---|
| `rejected-ab.mts` 원본, immediate·queued 각 3회 | **status 1**이에요. 첫 거부의 오류 문구 확인 `assert.throws(…, /undefined만/)`에서 멈췄어요. 실제 오류는 `TypeError: Promise.reject is not a function`이에요. 계약이 "반환 뒤 거부"에서 "만들기 전 거부"로 바뀐 데 따른 문구 차이예요. |
| `rejected-ab.mts` 복사본, 각 3회 | 그 정규식 하나만 `/Promise\.(reject|resolve) is not a function/`로 바꿨어요(줄바꿈 말고 다른 차이 없음을 대조함). 6회 모두 **status 0**, stderr 0바이트, `AFTER_REJECTIONS` A·B 행 0·기록 1·트랜잭션 없음, `SYNC_NEXT_SUCCEEDED`, `WAIT_COMPLETED`예요. |
| `ordinary.mts` rejected / thrownull / throwundefined / throwstring | 4개 모두 status 0, "normal completion"이에요. rejected는 "TypeError Promise.reject is not a function"으로 끝나요. |
| `independent.mts` 21가지 | **19가지 status 0**이에요. `promise`(`/undefined만/` 기대, 실제 `Promise.resolve is not a function`)와 `async`(`/동기 함수/` 기대, 실제 "동기 코드만…")는 같은 이유로 문구 확인에서 status 1이에요. 이 두 경우의 거부·행 없음·되돌림은 2장 시험(native Promise A/B 3회, async 등록 거부)이 확인해요. |
| `late.mts` × 3 | 3회 모두 `final [] []`이에요. |
| `deadline.mjs` | getter 151ms, then 104ms, status 0, 내부 "undefined만" 거부예요. |

검수자 원본의 문구 기대값 세 곳은 이번 계약 변경으로 맞지 않게 됐어요. 독립 재검수 때 새 문구 기준으로 다시 확인해 주셔야 해요.

## 4. 전체 검증

- lint 통과(경고 0), typecheck 통과
- test 31파일 379개 통과, 1개 건너뜀(s4 생성 모드)
- build 경고 0개
- 빈 임시 폴더에서 `db:migrate`를 두 번 실행했어요. 처음엔 4개, 다음엔 0개였어요.
- 시험 5단계 원문·레지스트리, `migrate.ts`는 HEAD와 같아요. SQL 0001~0004 해시와 s4 대조 회귀도 같은 실행에서 통과했어요.

## 5. 남은 것

- `db`(host sqlite)를 거친 호스트 영역·비동기 API는 신뢰 단계 전제로만 막혀 있어요.
- 제품 0005 통합 조건은 T-050·T-052 6장 그대로예요. Next 실행, 원문 동봉·cwd, 오류 문구·UI는 아직 확인하지 않았어요.
