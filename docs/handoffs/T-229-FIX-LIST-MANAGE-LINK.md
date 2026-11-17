# T-229-FIX 목록 화면 개인 관리 링크 누르는 영역(F234-1)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_6d05d51c7f3b` · 상태: **ready_review**
- 결함 근거: Tester T234
  - 대상: 고정 `3b32ad0`, 같은 소스 `3c6c5ee`, build `jCnXpAs-wt9bY2U-Cj3X_`
  - `/cloud/projects`의 `a[href=/cloud/manage]` 실측이 1280·390 모두 **102.78×18px**(inline, min-height 0)이었어요.
  - 증거: `D:/starwork/t234-manage-3b32ad0/evidence/list-link-hitbox.json`
  - 이 원래 실패 실측은 그대로 유효해요.
- **고정 SHA `ec1609ee7aead18b2bbf4bd1e09c314520d0094d`** (커밋 `ec1609e`)

## 1. 바꾼 파일
| 파일 | 내용 |
|---|---|
| `app/(cloud)/cloud/projects/(list)/page.module.css` (신규, 목록 전용) | `.manageLink { display:inline-flex; align-items:center; min-height:44px; … }` |
| `app/(cloud)/cloud/projects/(list)/page.tsx` | 해당 링크에 `className={styles.manageLink}`만 추가했어요. 위치·문구·다른 링크는 그대로예요 |
| `tests/t229-cloud-management.test.ts` | 회귀 단언을 추가했어요. 목록 링크 클래스, 목록 CSS `inline-flex`+`min-height:44px`, 관리 화면 `.link` 44px 유지를 확인해요 |

- **목록 전용 새 CSS를 만든 이유**
  - 관리 화면의 `.link`는 관리 page 모듈 안에 있어서 다른 page에서 가져다 쓰지 않았어요.
  - globals와 공통 primitives는 바꾸지 않는다는 조건이 있었어요.
  - 그래서 같은 값을 목록 화면 전용 모듈로 두었어요.
- Auth·layout·globals·공통 sm·링크 위치는 바꾸지 않았어요.

## 2. 검증(실제 출력)
- **시험**
  - t229 + t207 + t220 + t213: **86 passed**
  - `tsc --noEmit` 0, `eslint` 0
  - 전체 vitest: **Test Files 95 passed | 10 skipped (105), Tests 1613 passed | 319 skipped (1932)**
- **고정 SHA 격리 production 서비스(제 소유, 별도 포트)**
  - 서비스: `tmp/t213-http-1af70615-4de8-4f2f-be60-d0255dfdce26`, base.txt=`ec1609e…`, BUILD_ID `VSsfQaXlc6pc4hCIF_RHY`
  - 하네스 종료 출력: `T213 actual HTTP observations passed: 14`
  - 목록 화면 `a[href=/cloud/manage]`: 1280·390 모두 **110.78×44px**, `inline-flex`, `min-height 44px`
  - 가로 넘침: 390에서 0, 1280에서 0
  - 키보드
    - Tab 순서: 로그아웃 → 새 프로젝트 안내 → 프로젝트 상세 → 개인 관리 링크
    - 포커스 링: solid 1px
    - Enter로 `/cloud/manage`(h1 "개인 관리")로 이동해요.
  - 관리 화면 링크 4개(내 프로젝트·개인 관리(현재)·다시 불러오기·내 프로젝트 보기)는 모두 높이 44로 그대로예요. 넘침은 390에서 0, 1280에서 -15예요.
  - 결과 파일: `tmp/t229-fix-shots/result.json`, `list-1280.png`, `list-390.png`(tmp는 커밋하지 않음)
  - 측정 시각: 2026-11-17T17:48Z 직전. 이 서비스는 측정 뒤 stop 파일로 종료했어요.

## 3. 보조 근거(작성자 확인, 독립 검수 아님)
- 시각: 2026-11-17T17:39~17:45Z
- 대상: T234용 원 서비스 `c0d2d1ce`(59665, 3c6c5ee)
- 제가 직접 상태를 바꿔 보며 관리 화면 4가지 상태를 확인했어요. 그 뒤 데이터는 원래대로 돌려놨어요.
  - 정상: 표시 목록 1개
  - 빈 목록: 합성 A 프로젝트를 보관 처리했을 때 0개+조회 시각, "이번에 불러온 목록에 프로젝트가 없어요"
  - 읽기 실패: 합성 PG를 멈췄을 때 "관리 정보를 불러오지 못했어요", 숫자·시각 없음
  - 회복: PG를 다시 켜고 다시 불러오기를 누르면 새 조회 시각이 나왔어요.
- Tester에게 이 개입 구간을 알렸어요(`msg_67623db0618f`). Tester의 독립 실행으로 셈하지 않아요.

## 4. 한계·주의
- 제 FIX 서비스에서 브라우저로 로그인한 일이 Tester의 59665 세션 쿠키(같은 127.0.0.1 이름)를 덮었을 가능성이 있어요.
  - 그 시각은 17:47~17:48Z예요.
  - Tester에게 알리고(`msg_8061f37491e4`), Tester가 끝날 때까지 브라우저 조작을 멈췄어요.
- 독립 재검수는 Tester 몫이에요. push·배포는 하지 않았어요.

## 보호
새 창·agent·worktree 없음. 3013·공유 .next·실계정·운영 미접촉. Tester 원 서비스는 FIX 이후 변경·종료하지 않음. 비밀값 출력 없음.
