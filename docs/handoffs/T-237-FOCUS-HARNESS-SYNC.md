# T-237 포커스 브라우저 하네스 동기화

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_7c8c2afab787` · 상태: **ready_review**
- 계기: 제 정정 `msg_99b6550ea58a`
  - 저장소 `tests/t235-focus-browser.ego.js`(ebe84ea)는 T235 실행 증거를 만든 최종 스크립트보다 앞선 판이었어요.
  - 그 판은 retry 단계 선택자가 실패하고, 44px 측정이 없었어요.
- 바꾼 파일: `tests/t235-focus-browser.ego.js` 1개(test-only, vitest 대상 아님)
- 바꾸지 않은 것: 제품·Auth·use-session-watch·CSS·다른 시험·SQL

## 1. 바뀐 점
- **최종 실행본과 동기화:** 7개 상황(같은 계정 2회×2폭, 키보드+스크롤, 선택, 다른 컨트롤, 대상 삭제, 확인 실패→다시 확인, 계정 변경 확정 뒤 늦은 same)과 44px 링크 측정(목록·관리 × 1280·390)을 모두 넣었어요.
- **기대값을 하네스 안에서 판정**
  - 단계마다 기대값을 확인해서 `failures`에 쌓아요.
  - 중간 오류(ERR)도 실패로 쳐요.
  - 하나라도 있으면 `T235 FAILED …`를 출력하고 `process.exitCode = 1`로 끝나요. JSON에도 `ok:false`를 적어요.
  - 기대값을 낮추거나 단계를 건너뛰는 처리는 없어요.
- **retry 경합 반영(Tester T236 지적)**
  - 관문은 **버튼을 누르기 전에는 풀지 않아요.**
  - 자동 재확인 요청이 오면 계속 500으로 돌려보내 unavailable을 유지해요. 0.5초 동안 새 요청이 없으면 그때 **안내(`[data-session-notice]`) 안의 "다시 확인" 버튼**을 실제로 눌러요.
  - 누른 뒤 새 확인 요청이 생긴 것(`requestsFromClick ≥ 1`)을 확인하고, 그 요청을 실제 서버로 보내 same 응답을 받아요.
  - 누르기 직전 버튼이 사라졌거나 클릭해도 요청이 없으면 명시 오류로 실패해요.
- **대상 지정:** ego 실행기는 셸 환경변수를 받지 않아요(실측: `process.env.T235_ROOT` undefined). 그래서 `tmp/t235-target.json`의 `{root, tag}`로 대상을 정해요(tmp는 커밋하지 않음).

## 2. 실행(메인 PC 소유 서비스, 끝까지)
- **서비스**
  - 폴더: `tmp/t213-http-18a2fa02-c2e6-4607-b3ef-3a80694acf5d`
  - base.txt: `14fd8a3b7527aec1179a71fe42bbe83d9ffd18e7`(그때 HEAD)
  - BUILD_ID: `V9N3E0lrqbt_dFVP6rtPz`
- **제품 동일성:** `git diff --quiet ebe84ea 14fd8a3 -- app components lib proxy.ts next.config.ts package.json package-lock.json public` 결과 같았어요. 검수된 제품 `ebe84eae6611f5e11eedbe6e678c4a05506e0e7a`와 제품 코드가 같아요.
- **하네스 고정:** 이 커밋의 `tests/t235-focus-browser.ego.js`, git blob `a85895cb1355b734e1a290918781a142d019709c`
- **정상 실행 결과:** `T235 PASS t237 base=14fd8a3… build=V9N3E0lrqbt_dFVP6rtPz`, **종료 코드 0**, `ok:true`, failures 0개

| 상황 | 결과 |
|---|---|
| 같은 계정 2회, 1280 | A → notice → A → notice → A, 같은 본문 DOM |
| 같은 계정 2회, 390 | 같음 |
| 키보드 Tab + 스크롤(390×500) | `A[/cloud/projects]`로 복귀, 화면 안(activeInView true, scrollY 366) |
| 글자 선택 | 선택 유지, 포커스 BODY(빼앗지 않음) |
| 가린 동안 로그아웃 버튼으로 이동 | 로그아웃 유지 |
| 가린 동안 대상 삭제 | 본문 shown, BODY, 오류 없음 |
| 확인 실패 → 안내의 "다시 확인" 실제 클릭 | 안내 "로그인 상태를 확인하지 못했어요", 본문 hidden+inert. 클릭으로 생긴 요청 1건을 same 응답 → A 복귀 |
| 계정 변경 확정(stale) → 늦은 same | 본문 removed 유지 |
| 44px 링크 | 목록 "개인 관리 보기 →" 44(1280·390). 관리 "내 프로젝트"·"다시 불러오기" 44(1280·390). 넘침: 목록 0/0, 관리 -15/0 |

- **실패 신호 확인(음성 대조)**
  - scratch 사본에서 S1 마지막 기대값 하나만 일부러 존재하지 않는 값으로 바꿔 같은 서비스에서 실행했어요.
  - 결과: `same2-1280: …`, `same2-390: …` 실패 2건 출력, **종료 코드 1**(`ego's nodejs process exited with code 1`)
  - 사본은 실행 뒤 지웠어요. 결과 파일은 `tmp/t235-t237-negative.json`이에요.
- 결과 파일: `tmp/t235-t237.json`(정상), `tmp/t235-t237-negative.json`(음성 대조)

## 3. 정리·한계
- 서비스는 stop 파일로 종료했어요. 실행 내내 Tester는 브라우저를 쓰지 않았고, 시작 전에 서로 확인했어요(`msg_503b106858f3`).
- `tmp/t235-target.json`은 실행 뒤 지웠어요.
- 하네스는 ego lite 전역(`taskSpace`)과 T213 하네스 서비스에 의존해요. CI에서 자동으로 돌지 않아요.
- 브라우저 쿠키·캐시를 전체 삭제한 일은 없어요.
- 이 커밋은 test-only예요. 배포 후보 제품은 `ebe84ea` 그대로예요.
