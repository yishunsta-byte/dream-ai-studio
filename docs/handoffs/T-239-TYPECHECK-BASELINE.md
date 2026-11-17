# T-239 전체 타입 검사 기준선 보완

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_d0293b2d25e2` · 상태: **ready_review**
- 출발점: HEAD `0ef11ec`
- 계기: Backend B33 전체 `tsc`가 두 가지 이유로 실패했어요.
  - 보호 대상 B28~B31 native 하네스 4개에서 TS2769가 났어요. `childEnv`에 Next가 늘려 둔 `ProcessEnv`의 필수 `NODE_ENV`가 없었어요.
  - 보존된 `tmp/` 안의 옛 하네스 사본에서 상대 import 오류와 같은 env 오류가 났어요.

## 1. 바꾼 것(5개 + 이 보고)
| 파일 | 변경 |
|---|---|
| `tsconfig.json` | `"exclude": ["node_modules"]` → `["node_modules", "tmp"]` |
| `tests/b28-schema5-native-owned.ts` | `childEnv` 맨 앞에 `NODE_ENV: "test" as const` 추가 |
| `tests/b29-reservation-races-native-owned.ts` | 같음 |
| `tests/b30-reservation-wire-native-owned.ts` | 같음 |
| `tests/b31-reservation-history-native-owned.ts` | 같음 |

- 하네스 diff는 파일마다 한 줄이에요.
  - 바뀐 것은 고정 문자열 `NODE_ENV:"test"` 하나뿐이에요. 환경 상속(`...process.env`), PATH 변경, `as any`, `@ts-ignore`, `@ts-expect-error`는 없어요.
  - `as const`는 문자열을 `"test"` 리터럴로 좁혀 ProcessEnv의 `"development"|"production"|"test"`와 맞추는 용도예요.
  - 자식 프로세스(psql·pg_ctl 등)에 새로 가는 값은 `NODE_ENV=test` 하나예요. PG 기본값·DSN·인증 정보는 그대로 넘기지 않아요.
- `include`(`**/*.ts`, `**/*.tsx`, `.next/types` 등)는 그대로예요. app·tests·lib 검사 범위와 strict 등 검사 옵션도 줄이지 않았어요.
- `tmp/` 안 예전 증거 원문은 고치거나 지우지 않았어요. 검사 대상에서만 빠져요.

## 2. 검증(실제 출력)
- **변경 전 전체 `tsc --noEmit`(HEAD 0ef11ec 작업 트리)**
  - `tmp/b30-native-cdf03867-…/harness-before-hash-pin-fix.ts`: TS2307 4개, TS2769 1개
  - `tests/b28·b29·b30·b31-…-native-owned.ts`: TS2769 각 1개
  - 다른 오류는 없었어요.
- **변경 후**
  - `npx tsc --noEmit -p tsconfig.json`: **exit 0, 오류 0**
  - `npx eslint . --max-warnings 0`: **exit 0**
  - 전체 vitest: **Test Files 99 passed | 10 skipped (109), Tests 1702 passed | 319 skipped (2021)**
- **출처 분리:** 위 결과는 Backend B33 미추적 WIP(`lib/db/postgres/reservation-*.ts`, `lib/repo|services/postgres/upload-reservations.ts`, `lib/storage/uploads/reservation-client.ts`, `tests/postgres/reservation-*.test.ts`)가 작업 트리에 있는 상태에서 나왔어요.
  - 이 WIP에서 별도 tsc 오류는 나오지 않았어요.
  - WIP는 건드리지 않았고 커밋하지도 않았어요.
- **하지 않은 것**
  - native 하네스 실제 실행, PG cluster·DB·빌드·배포
  - `tsconfig.json`을 eslint에 직접 넘기면 "matching configuration 없음" 경고가 나요. 원래 lint 대상이 아니에요. 그래서 `eslint .` 결과를 기준으로 했어요.

## 3. 기준선 기록
- 이 커밋을 **새 전체 tsc 기준선**으로 기록해요.
- 이전 검수 SHA·해시·보고(B28~B31 등)는 소급해서 바꾸지 않아요.
- 하네스 4개는 내용 해시가 바뀌었어요. 앞으로 그 하네스를 고정해 실행하는 검수는 이 커밋의 해시를 기준으로 삼아야 해요.
- 미확인
  - Next가 `next build` 때 `tsconfig.json`을 다시 쓰는지: 이번에 빌드를 실행하지 않았어요.
  - B33 WIP가 나중에 커밋될 때 tsc 결과: Backend 재검증 몫이에요.

## 보호
- 제품·Auth·SQL·package·lock 파일, B33 새 모듈, 옛 tmp 미변경이에요.
- 새 agent·창·worktree 없음, 비밀값 출력 없음이에요.
