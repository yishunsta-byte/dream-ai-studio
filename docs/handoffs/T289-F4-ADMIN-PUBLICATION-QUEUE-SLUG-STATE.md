# T289-F4 관리자 게시 큐 — 정상 주소의 줄 상태 보완

- 담당: Codex(Front) · 배정 Master `msg_fb495e81b5b0`
- 기준: `64bbf02`, [T289-F3-R 재검수](T289-F3-R-ADMIN-PUBLICATION-QUEUE-ACTIVE-WRITE-REVIEW.md) F289-F3-1
- 고정 코드 SHA: `29616194dae2630c5fcdaa3840fc82043fb85284`
- 판정: 보완과 자체 확인을 마쳤어요. 재검수 전이에요.

## 원인과 수정

**원인:** 모델과 T253 SQL이 허용하는 주소 이름 `constructor`를 화면이 `writes[item.slug]`로 읽었어요. 이 값은 일반 객체가 상속받은 `Object.prototype.constructor` 함수예요. 그래서 쓰기가 0건인데도 그 줄이 “undefined 요청 중”으로 잠겼어요.

**수정:** 큐 안에서 slug로 상태를 찾는 곳을 모두 점검하고, 자체 키만 인정하는 `ownEntry(record, key)`(`Object.prototype.hasOwnProperty.call`)로 바꿨어요.

| 위치 | 바뀐 코드 |
|---|---|
| `rowsAfterList` | `ownEntry(rows, item.slug)` |
| `row()` | `ownEntry(rows, slug) ?? EMPTY_ROW` |
| `patch()` | `ownEntry(all, slug) ?? EMPTY_ROW` |
| 렌더 중 진행 쓰기 | `ownEntry(writes, item.slug) ?? null` |

- `rowsAfterFailedLoad`는 원래 `Object.entries`(자체 키만)라 바꾸지 않았어요.
- 진행 쓰기의 동기 판정은 원래 `Map`(`inflight`)이라 바꾸지 않았어요.
- 쓰기 시작과 끝은 `{...all, [slug]: …}`와 `delete`라 자체 키만 다뤄요.
- 모델·SQL·주소 규칙은 바꾸지 않았어요. `constructor`는 그대로 지원해요.

## 바꾼 파일

- `components/admin/publication-queue.tsx`: `ownEntry`와 위 네 곳.
- `tests/admin/publication-queue-slug-state.test.ts` (새 파일, 6개 시험)
  - 모델이 `constructor`를 허용하는지, `ownEntry`가 자체 키만 읽는지 확인
  - `constructor`·`tostring`·`valueof`·`hasownproperty`·`isprototypeof`·`propertyisenumerable`·`tolocalestring` 7개 주소의 유휴 화면
    - 권리 체크 7개가 모두 켜져 있고, `요청 중`·`undefined`·재시도 표시가 없는지 확인
  - 줄 상태 정리(같은 버전 유지·새 버전 삭제·실패 보존·`retryDecision`)
  - 공급자로 `constructor` 준비 → 게시 → 같은 UUID 재생
  - 화면 소스에 slug 직접 인덱싱이 없는지 확인

이 새 시험을 이전 컴포넌트(`64bbf02`)에 돌리면 3건이 실패하고(유휴 화면 포함), 새 컴포넌트에서는 6/6 통과해요.

## 검증 (실제 출력)

**명령 결과**
- 집중 `tests/admin`: `Tests 52 passed (52)`
- 전체 vitest: `Test Files 135 passed | 16 skipped (151)`, `Tests 2634 passed | 385 skipped (3019)`
- 격리 사본 전체 tsc는 오류 0줄이에요. T289-F3 때 보고한 T293 타입 오류가 HEAD에서 해소됐어요.
- 변경 파일 eslint exit 0, `git diff --cached --check` 통과. 격리 사본 `npm run build` 성공(시험 파일 제거 없이).

**브라우저 확인** (ego 공간, 격리 서버 127.0.0.1:43293). 사본 전용 확인 화면에서 `constructor` 줄과 일반 줄을 메모리 공급자로 넣었어요. 1280과 390에서 같은 결과가 나왔어요.

- **유휴:** `constructor` 줄 v0은 권리 체크가 켜져 있고, 버튼 0개·`undefined` 없음이에요. 상단 새로고침은 켜져 있고 44px예요. 조회·쓰기는 0건이에요.
- **실행:** 준비 쓰기를 보류하니 그 줄만 `게시 준비 요청 중`으로 잠겼어요.
  - 다른 줄의 체크는 그대로 켜져 있었어요.
  - 상단 새로고침은 꺼져서 눌리지 않았어요.
- **종료:** v1 `게시 준비됨`이 되고, 체크와 상단 버튼이 다시 켜졌어요.
- **실패·재시도:**
  1. 커밋 전 게시 실패 뒤 `같은 게시 요청 다시 시도`가 나왔어요.
  2. 쓰기를 보류한 채 재시도 버튼을 같은 이벤트에서 두 번 눌렀어요. 추가 전송은 1건이었고, 진행 중에는 재시도·새로고침이 꺼졌어요.
  3. 보류를 풀자 v2 `게시 중`이 됐어요. 게시 UUID 두 건의 끝자리가 같았고(1280 `4573ba`, 390 `102324`), 서버 version은 2였어요.
- **기존 잠금:** 조회 보류 중에는 체크가 안 됐고 상단 버튼은 꺼져 있었어요(44px). 풀린 뒤 `constructor` 줄은 v2 그대로였어요.
- 가로 넘침이 없어요(1280: 1265 = 스크롤바를 뺀 너비, 390: 390).

정리: 격리 사본·서버·ego 공간을 닫았고, 원본 `node_modules`는 283개 그대로예요. 실제 DB·외부 요청·배포는 없었어요.

## 한계

- 모델 규칙상 `__proto__`처럼 밑줄로 시작하는 주소는 원래 허용되지 않아서 시험하지 않았어요.
- DOM 클릭 시험 도구가 없어서 화면 상호작용은 ego로 확인했어요.
