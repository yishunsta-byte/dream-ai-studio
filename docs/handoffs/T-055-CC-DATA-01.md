# T-055 거부된 native Promise 프로세스 종료(F054-1) 수정 — CC-DATA-01 보고

- 부모: T-053 · 근거: `T-054-CODE-MIGRATION-RETURN-RECHECK.md`(F054-1)
- 배정: Master msg_514bff02bd17, 설계 공유 msg_5f6592619f9d, 설계 채택·조건 msg_8abec904b93b
- 시작 HEAD: cf8424b · 담당: CC-DATA-01
- 고친 곳은 `lib/db/code-migration.ts` 로더 하나예요.
- 바꾸지 않은 것:
  - `migrate.ts`
  - SQL 0001~0004
  - 해시 형식과 v2 입력(시험 5단계 `dd41a479…`)
  - 고정 s4, 사용자 DB, 공용 문서
  - 제품 0005(추가하지 않음)
- process 전역 listener, `--unhandled-rejections` 같은 Node 플래그, 검증 끄기는 쓰지 않았어요.

## 1. 바꾼 것

| 항목 | 지금 |
|---|---|
| 판정 | 그대로예요. `run`은 undefined만 돌려줄 수 있어요. 다른 값은 거부하고 되돌려요. 실행마다 새 context를 쓰고, 실패한 context는 다시 쓰지 않아요. |
| 거부 처리 대상 | 돌려준 값, 또는 `throw`로 던진 값 중에서 **진짜 native Promise만** 처리해요. 판별은 호스트의 `util.types.isPromise`가 해요. 이 함수는 내부 슬롯만 보고 trap·getter를 부르지 않아요. 그래서 일반 thenable과 Proxy는 아무것도 건드리지 않아요. |
| 처리 방법 | prelude가 사용자 코드보다 먼저 `Promise.prototype.then`을 잡아 둬요. 시간 제한이 걸린 `__dream.run` 평가 안에서 `then(undefined, 빈 함수)`로 거부 처리기를 붙여요. 이때 일어나는 `constructor`·`Symbol.species` 조회도 같은 평가 안에서 일어나요. 새로 생기는 파생 Promise는 undefined로 끝나므로 그 자체가 미처리 거부가 되지 않아요. |
| 조회가 실패할 때 | 그 Promise에 자기 속성 `constructor: undefined`를 정의해요. 그러면 기본 %Promise%를 쓰고 species를 조회하지 않아요. 그 상태에서 처리기를 한 번 더 붙여요. |
| 오류 문구 | 던진 값이 Promise이면 기존 문자열화 규칙대로 `undefined: undefined`가 돼요. 거부와 되돌림은 그대로예요. |

## 2. 실제로 처리되는 범위와 한계 (자식 프로세스에서 확인)

처리되는 경우예요. 아래 7가지 모두 A·B에 3회씩 번갈아 실행했어요. 매번 거부됐고, 행 0개, 기록은 1단계, 트랜잭션은 없었어요. 같은 연결에서 정상 단계도 성공했어요. 100ms 대기가 끝난 뒤 자식은 **status 0**, stderr는 비어 있었어요.

| 경우 | 설명 |
|---|---|
| `ab-reject-immediate` | T054 원문. `return Promise.reject(...)` |
| `ab-reject-queued` | T054 원문. `Promise.resolve().then(()=>{throw})` |
| `ab-reject-subclass` | `class P extends Promise`의 `P.reject` |
| `ab-reject-species-getter` | 자기 `constructor` getter가 Promise를 돌려줌 |
| `ab-throw-rejected` | 거부된 Promise를 `throw` |
| `ab-species-throw` | 서브클래스의 species getter가 throw. 두 번째 시도로 처리돼요 |
| `ab-constructor-getter-throw` | 설정 가능한 `constructor` getter가 throw. 두 번째 시도로 처리돼요 |

손대지 않는 값도 확인했어요(외부 마감 전 스스로 종료).

| 경우 | 결과 |
|---|---|
| `then-loop`, `then-getter-loop` | 돌려준 thenable을 부르지 않고 "undefined만"으로 거부돼요 |
| `thrown-then-loop` | 던진 thenable을 부르지 않아요 |
| `proxy-trap-loop` | 모든 trap이 끝나지 않게 만든 Proxy예요. trap을 하나도 부르지 않고 거부돼요 |

**처리하지 못하는 한계예요(처리로 세지 않아요).** 아래 4가지는 실제로 status 1로 끝나요. 시험은 이 결과를 그대로 기록해요.

| 경우 | 왜 못 막는지 |
|---|---|
| `limit-frozen-species-throw` | 확장이 막힌 Promise에서 species가 throw해요. 우회 속성을 정의할 수 없어요. |
| `limit-nonconfigurable-constructor` | 고칠 수 없는 `constructor` getter가 throw해요. |
| `limit-species-loop` | species 조회가 끝나지 않아요. 실행은 시간 제한 200ms로 거부·되돌림되지만, 처리기를 붙이지 못한 거부가 남아요. |
| `limit-floating` | 돌려주지 않고 버린 `Promise.reject()`예요. context 단위로 거부를 잡을 방법이 없어요. **이번 반환값 수정과는 별개의 남은 문제예요.** 이 경우 단계는 undefined를 돌려줘서 정상 적용돼요. 그 뒤 프로세스가 종료돼요. |

위 한계는 README에 "검토한 단계에서 쓰지 않음"으로 적었어요. 막을지 여부는 Master가 판단할 수 있게 남겨요.

## 3. 시험 (`tests/k6-code-migration.test.ts`, 43 → 56개)

- 위 거부 7가지(자식 프로세스, 외부 마감 10초, 마감 시 실패)를 넣었어요.
- 한계 4가지는 status 1과 stderr 표지를 그대로 기록해요.
- 손대지 않는 값 2가지(`thrown-then-loop`, `proxy-trap-loop`)를 추가했어요.
- 기존 T053의 늦은 쓰기 5가지 × 3회, 끝나지 않는 8가지 등은 그대로 통과해요.
- **되돌려 보기:** 아래 보호 장치를 하나씩 빼면 시험이 실패했어요. 원래대로 돌린 뒤에는 모두 통과했어요.

  | 뺀 보호 장치 | 실패한 시험 수 |
  |---|---|
  | 돌려준 값 처리 | 6 |
  | 던진 값 처리 | 1 |
  | 두 번째 시도 | 2 |
  | native 판별 | 1 (`proxy-trap-loop`이 trap을 불러 시간 초과) |

## 4. T054 원본 재현을 복사해서 실행

T054 증거 폴더의 스크립트를 제 OS 임시 폴더에 복사했어요. 원본은 읽기만 했고 해시가 같아요. 저장소 cwd에서 실행한 뒤 임시 폴더는 지웠어요.

| 재현 | T054 결과 | 지금 |
|---|---|---|
| `rejected-ab.mts` immediate × 3 | status 1, WAIT_COMPLETED 없음 | 3회 모두 status 0, `SYNC_NEXT_SUCCEEDED`·`WAIT_COMPLETED`, stderr 0바이트, 약 0.3초 |
| `rejected-ab.mts` queued × 3 | status 1 | 3회 모두 위와 같아요 |
| `ordinary.mts` rejected / thrownull / throwundefined / throwstring | rejected만 status 1 | 4개 모두 status 0, "normal completion" |
| `independent.mts` 21가지 | status 0 | 21가지 모두 status 0 |
| `late.mts` × 3 | final [] [] | 3회 모두 final [] [] |
| `deadline.mjs` | getter 149ms, then 111ms | getter 165ms, then 114ms, status 0, stderr 없음 |

참고로 원본 `rejected-ab-runner.mjs`는 status 1을 기대하도록 짜여 있어요. 그래서 `.mts`를 직접 실행해 결과를 기록했어요.

## 5. 전체 검증

- lint 통과(경고 0), typecheck 통과
- test 31파일 363개 통과, 1개 건너뜀(s4 생성 모드)
- build 경고 0개
- 빈 임시 폴더에서 `db:migrate`를 두 번 실행했어요. 처음엔 4개, 다음엔 0개였어요.
- SQL 0001~0004 해시와 s4 대조 회귀도 같은 실행에서 통과했어요.

## 6. 남은 것

- 2장의 한계 4가지가 남아 있어요. 특히 버린 거부(`limit-floating`)는 별도 판단이 필요해요.
- 제품 0005 통합 조건은 T-050·T-052 6장 그대로예요. Next 실행, 원문 동봉·cwd, 오류 문구·UI는 아직 확인하지 않았어요.
