# T-053 반환값 실행 경계·늦은 쓰기 F052-1·2 수정 — CC-DATA-01 보고

- 부모: T-051 · 근거: `T-052-CODE-MIGRATION-V2-REVIEW.md`(FAIL), Master 배정 msg_8b1db0e7fb6f, 추천안 msg_a9626b5eae4f → 채택·조건 msg_b444e7008d8b
- 시작 HEAD: b53c504 · 담당: CC-DATA-01 (임시 코딩 위임)
- 고친 곳은 `lib/db/code-migration.ts` 로더 하나예요. `migrate.ts`, SQL 0001~0004, 해시 형식과 v2 해시 입력(시험 5단계 선언 `dd41a479…` 그대로), 고정 s4, 사용자 DB, 공용 문서, 제품 0005는 바꾸지 않았어요.

## 1. 바꾼 계약

| 항목 | 지금 |
|---|---|
| 반환값 | `run`은 **undefined만** 돌려줄 수 있어요. VM 안에서 `result===undefined`로 원시 비교만 해요. 다른 값(native Promise, 일반 thenable, getter `then`, `{}`, `null`)은 **열어 보지 않고** 거부하고 트랜잭션을 되돌려요. 호스트는 반환 객체·`then`·getter를 조회하거나 호출하지 않아요. 검사하려고 `then`을 실행하는 일도 없어요. |
| 실행 공간 | 쓸 때마다 **새 context**예요. 등록 때 확인용으로 한 번 불러서 entry 모양과 `sql` 문자열만 받고 버려요. `migration.run`을 부를 때마다 새 context에서 **같은 캡처 문자열**을 다시 불러오고, `sql`이 등록 값과 같은지 확인한 뒤 실행해요. `afterEvaluate` 모드라서 단계 코드가 예약한 작업은 그 시간 제한 평가 안(트랜잭션 안)에서 끝나요. 그 context는 다시 평가하지 않고 버리므로, 남은 작업이 다른 DB로 흘러갈 길이 없어요. |
| 시간 제한 경계 | 다음은 모두 시간 제한이 걸린 VM 평가 **안에서** 해요. entry의 `run`·`sql` 읽기(getter 포함), async 함수 확인, 오류 `name`·`message`의 문자열화(getter·toString 포함), 예약 작업 소진. 판정 도우미는 사용자 코드보다 먼저 prelude에서 잡아 둔 `Reflect.apply`·`Object.prototype.toString`·`String`을 쓰고, 고칠 수 없는 `__dream`에 둬요. 호스트가 받는 것은 원시 문자열뿐이에요. |
| 호스트 연결 | 불러오기 함수와 DB 전달 함수는 context를 만들 때 넘기고, prelude가 전역에서 지운 뒤 닫힌 범위에만 둬요. 그 뒤로 호스트는 context 전역을 읽지도 쓰지도 않아요. 예전처럼 사용자 코드 실행 뒤에 `__dreamDb`를 대입하던 경로를 없앴어요. |
| 시간 초과 | 시간 초과 오류는 context 쪽 객체로 만들어져요. 그래서 호스트는 그 오류의 **자기 데이터 속성 `code`만** `getOwnPropertyDescriptor`로 확인해요(getter·prototype 조회 없음). 그 결과로 `MigrationTimeoutError`("시간 제한 Nms 안에 끝나지 않았어요 (ERR_SCRIPT_EXECUTION_TIMEOUT)")를 새로 만들어요. |
| 삼킨 require | 목록 밖 require나 형식 오류는 호스트에 기록해 둬요. 단계 코드가 `try/catch`로 삼켜도 등록과 실행 모두 거부하고 되돌려요. |
| 범위 밖(명시) | 믿을 수 있는 마이그레이션 로더이지 보안 격리가 아니에요. host sqlite 객체로 host 영역에 닿을 수 있어요. host 비동기 API(예: `db.backup()`의 host Promise)를 거쳐 늦게 쓰는 것은 **검토한 단계만 쓴다**는 전제로 막고, 임의 격리로 넓히지 않았어요. 시간 제한은 JS에만 걸리고 SQLite 문장 하나 안에서는 걸리지 않아요. |

## 2. 시험 (`tests/k6-code-migration.test.ts`, 26 → 43개)

- **늦은 쓰기(5가지 × 3회):** T052 원문 일반 thenable, getter가 예약하는 then, native Promise, `{}`, `null`이에요. **같은 migration 객체**를 열어 둔 메모리 DB A·B에 A,B,A,B,A,B 순서로 썼어요.
  - 매번 거부되고, 그 직후와 50ms 뒤 모두 A·B 행 0개, 기록은 1단계뿐, 트랜잭션 없음이에요.
  - 같은 연결에서 뒤이어 정상 2단계를 올리면 A·B 모두 성공하고, 행 `1`과 기록 1·2단계가 남아요.
- **undefined 반환:** `return` 없음과 `return undefined`는 정상 적용돼요.
- **새 실행 공간:** 최상위 `count`가 다음 실행으로 넘어가지 않아서 A·B 모두 1이에요.
- **도우미 고정:** 최상위에서 `__dream` 교체, `Object.prototype.toString`, `Reflect.apply`를 바꿔도 async run은 거부되고, 객체 반환은 거부되며 행이 0개예요. 호스트 연결 `__dreamHost`는 단계 코드에 보이지 않아요.
- **삼킨 require:** 최상위와 run 안 모두 거부하고, run에서 쓴 행은 되돌려요.
- **끝나지 않는 8가지(자식 프로세스, 외부 마감 10초):** `module-loop`, `entry-run-getter`, `entry-sql-getter`, `run-loop`, `then-loop`, `then-getter-loop`, `error-getter-loop`, `microtask-loop`이에요.
  - 모두 외부 마감 **전에 스스로** 종료 코드 0으로 끝났고, 경과 시간은 5초 미만이에요(실측 약 0.1~1.2초).
  - 불러오기 셋은 "시간 제한 1000ms"로 등록 거부, then 둘은 "undefined만"으로 거부(then을 실행하지 않음), 나머지 셋은 "시간 제한 200ms"로 거부돼요. 실행 단계의 기록은 1단계뿐이에요.
  - 외부 kill(ETIMEDOUT/signal)은 실패로 쳐요.
- 기존 26개(계약, 로더, SQL 규칙, verify, 결정성, live, staging, 백업)는 그대로 통과해요.
- **되돌려 보기:** 다음 보강을 하나씩 빼면 시험이 실패했어요.

  | 뺀 항목 | 실패한 시험 수 |
  |---|---|
  | undefined 판정 | 9 |
  | afterEvaluate | 3 |
  | 불러올 때 삼킨 require | 1 |
  | 실행 때 삼킨 require | 1 |
  | 잡아 둔 내장 함수 | 1 |
  | 연결 숨기기 | 1 |
  | 시험 run 시간 제한 | 시험이 멈춰 13개만 돈 뒤 끊김 |

  원래대로 돌린 뒤 모두 통과했어요.

## 3. T052 실제 재현을 그대로 다시 실행

T052 증거 폴더의 `late.mts`, `timeout.mts`, `deadline.mjs`를 제 OS 임시 폴더에 **복사해서**(원본은 읽기만 함, late.mts 해시 같음) 저장소 cwd에서 실행했어요. 끝난 뒤 그 임시 폴더는 지웠어요.

| 재현 | T052 결과 | 지금 |
|---|---|---|
| `late.mts`, A 다음 B (3회 반복) | B 실행 뒤 A에 `{value:7}`, 기록 1단계 | 3회 모두 A·B `[]`, A 기록 1단계, A 트랜잭션 없음, 50ms 뒤 `final [] []` |
| `deadline.mjs` getter | 외부 4초 마감 ETIMEDOUT | 142ms에 스스로 종료(status 0), "run은 undefined만 돌려줄 수 있어요" |
| `deadline.mjs` then | 외부 4초 마감 ETIMEDOUT | 103ms에 스스로 종료(status 0), 같은 거부 |

## 4. 전체 검증

lint 통과(경고 0), typecheck 통과, test 31파일 350개 통과(+1 건너뜀: s4 생성 모드), build 경고 0개예요. 빈 임시 폴더에서 `db:migrate`를 두 번 실행하니 4개, 다음엔 0개였어요. SQL 0001~0004 해시와 s4 대조 회귀도 같은 실행에서 통과했어요.

## 5. 남은 것

- 제품 0005 통합 조건은 T-050·T-052 6장 그대로예요. 빌드된 Next에서 실제 단계를 불러오는지, 원문 동봉·cwd, `MigrationSourceError`·`MigrationTimeoutError`의 시작 점검·CLI 문구와 코드는 아직 확인하지 않았어요.
- `tests/fixtures/migrations/deadline-child.mts`는 시험용 자식 프로세스 도우미예요. 받은 임시 폴더 안에만 원문을 써요.
