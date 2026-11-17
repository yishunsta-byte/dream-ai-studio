# T192 · 실제 헤더 높이와 본문 anchor 여백 연결

- 담당: Codex design / CX-DESIGN-01. 배정 `msg_5ccfa6b7389e`, 수락 `msg_468ef0f9c32c`, T190 정정 확인 `msg_88c271d9bdb9`.
- 상태: ready_review · 구현자 자체 검증. Tester 원 T190 보고서를 대체하거나 독립 수용을 주장하지 않는다.
- 격리 사본: `D:/starwork/t192-header-0829b86`. **폴더 이름과 달리 실제 archive 기준은 `5d4a6c8e9e34ff04f0a76ff6cbeb3294043a0b5c`**다. Git ZIP comment로 확인했다. 착수·archive 사이 다른 담당의 T191/운영 커밋이 들어왔으며 전후 같은 사본/인증 코드로 대조했다.

## 원상태 재현과 원인

T190 F190-1의 원 JSON·PNG와 최종 `T-190-MOBILE-HEADER-REVIEW.md`를 읽었다. 상단 제목의 원래 모바일 잘림은 해결됐지만, 상태·오류로 커진 sticky 헤더와 본문 이동 여백이 분리돼 있었다. 데스크톱 `--topbar-h` 기본56px + 간격16px은72px이며 헤더의 실제113.78125px을 반영하지 못했다. 앞 전달의60px 표현은 채택하지 않는다.

별도 실제 Next 운영 빌드·가상 인증·신규 fake DB에서 같은 실패를 재현했다. 실제 로그인과 SDK/SSR 쿠키를 쓰고, 실제 backup POST로 대기1을 만들었다. 로그아웃 fetch만 네트워크 rejection으로 주입해 기존 AccountMenu의 긴 안내를 표시한 뒤 ‘백업’ anchor를 키보드 Enter로 실행했다.

| 1280px, 샘플·대기1·긴 오류 | 수정 전 | 수정 후 |
|---|---:|---:|
| 헤더 하단 | 113.78125 | 113.78125 |
| target scroll-margin | 72 | 129.781 |
| 백업 영역 상단 | 71.703125 | 129.703125 |
| 백업 제목 상단 | **105.296875** | **163.296875** |
| 제목 전체 가시성 | **실패: 위쪽8.484375px 가림** | **통과** |

전후 모두 같은 `headerAnchorClearance()`로 실제 heading 사각형이 헤더/헤더 오류 안내 아래에 있고 viewport 안에 완전히 들어오는지 확인했다. 실패 정의나 제목을 바꿔 통과시키지 않았다. focus는 두 경우 모두 원래 `backup` 영역이었다.

## 최소 수정

- `components/studio-shell.tsx`: 헤더 ref·부모 ref와 layout effect를 추가했다. 최초 layout 및 ResizeObserver의 실제 border-box 높이를 부모의 `--studio-header-height`에 기록한다. observer는 해제 시 disconnect/변수 정리한다.
- `app/globals.css`: 기존 scroll-margin 한 줄이 `var(--studio-header-height, var(--topbar-h)) + 기존 간격`을 사용한다. 셸 밖 로그인 등은 새 변수가 없으므로 기존 기본값을 유지한다.
- `components/studio-shell.module.css`: 모바일 두 행을 가정한 고정 높이 변수·불필요 class를 제거했다. 헤더 min-height는 원래 디자인 토큰을 계속 쓰며 실측 변수를 참조하지 않는다. 따라서 커진 높이가 min-height로 되먹임돼 줄어들지 않는 문제가 없다.
- 모바일 계정 오류는 해당 셸 안에서 정상 flow에 놓아 헤더 높이에 포함한다. `role=alert`를 숨기거나 문구를 줄이지 않는다. 계정 component·인증 동작은 변경하지 않았다.

제목 공간·대기 링크·샘플 정보·계정 접근성 이름·로그아웃44px은 유지했다. 임의의 큰 고정 offset을 추가하지 않았다. 실제 관찰된 높이가61→113→61 또는 긴 오류 시113.781→235.781→113.781로 변하면 이동 여백도 함께 바뀐다.

## 실제 실행과 결과

환경: Windows / Node26.13.0 / Next16.4.6 / Vitest5.1.0. source ZIP을 새 디렉터리에 풀고 node_modules 32,543파일/655.47MB를 **물리 복사**했다. 설치·junction·공유 `.next` 사용은 없다. 신규 fake-runtime에 migration10개/합성 seed1개를 만들었다. 사용자 DB·운영 인증·메일을 사용하지 않았다.

인증 HTTP만 가상 서버43244, 실제 Next43245다. 실제 route/proxy/React/SDK/SSR 쿠키를 사용했다. 대기0/1 준비는 그 fake DB에만 backup POST와 job cancel PATCH를 호출했다. worker·렌더·실제 백업 ZIP 실행은 없다.

- 수정 전 Next build+verify 통과 후 원 가림 재현.
- 허용 제품3파일만 격리 사본으로 복사한 뒤 **수정 후 Next production build+verify 통과**. 추적 검사에서 로컬 데이터·비밀·영상 도구·서비스 키 유출 없음.
- 실제 Next **40회 상태/resize 관찰 통과**: 샘플 on/off × 대기0/1 × 정상/긴 네트워크 오류 각각에 대해 1280→390→1280→768→390 순서로 이동. 반복 폭은 커짐/줄어듦을 확인하는 관찰이며40개 고유 상태라는 뜻이 아니다.
- 모든 관찰에서 측정 변수와 헤더 실측 차이0.1px 미만, heading 전체 가시성, Tab/Shift+Tab 순서, Enter 뒤 backup 초점, 제목 공간, 로그아웃44px, 가로 넘침0을 확인했다.
- 모바일 긴 오류에서는 헤더235.78125px, 제목 상단285.796875px로 **오류와 본문 제목 모두 온전히 표시**됐다. 데스크톱으로 돌아오면 작은 실제 높이로 복구됐다.
- 관련 자동 시험 **3파일·52개 통과**: T188 헤더3 + T180 A2 8 + T182 인증41. 새 browser helper를 이52개에 추가 합산하지 않는다.
- 전체 eslint, `tsc --noEmit --incremental false`, `git diff --check` 통과. 공유 `.next`를 쓰는 typegen/build는 실행하지 않았다.

격리 명령: `node node_modules/next/dist/bin/next build`, `node scripts/verify-build.mjs`. 실행기는 격리 `tmp/t192/build.mjs`, `harness.mjs`. 원본 보고서의 harness를 읽은 뒤 자체 경로·포트·가상 값으로 새 실행기를 작성했다.

공유 저장소 검증:

```text
node node_modules/vitest/vitest.mjs run tests/t188-mobile-header.test.ts tests/t180-a2-settings-overview.test.ts tests/t182-auth.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --max-warnings 0
git diff --check
```

## 근거

폴더: [격리 evidence](D:/starwork/t192-header-0829b86/evidence).

- [원상태 JSON](D:/starwork/t192-header-0829b86/evidence/before.json), [수정 후 동일 조건](D:/starwork/t192-header-0829b86/evidence/after-first.json).
- [샘플 on 20회](D:/starwork/t192-header-0829b86/evidence/after-sample.json), [샘플 off 20회](D:/starwork/t192-header-0829b86/evidence/after-no-sample.json).
- [1280 원상태](D:/starwork/t192-header-0829b86/evidence/before-retry-anchor-1280.png), [1280 수정 후](D:/starwork/t192-header-0829b86/evidence/after-retry-anchor-1280.png), [390 긴 오류 수정 후](D:/starwork/t192-header-0829b86/evidence/after-retry-anchor-390-no-sample.png). 세 PNG를 직접 열어 제목의 전후 차이를 확인했다.
- [수정 후 build log](D:/starwork/t192-header-0829b86/evidence/after-build.log), [추적 검증 log](D:/starwork/t192-header-0829b86/evidence/after-verify.log).
- 저장소 회귀 helper: `tests/browser/t192-header-clearance.mjs`. 자체 브라우저 실행기는 공유 `tmp/t192/round-03.mjs`(원1280), `round-04.mjs`(동일 조건 수정), `round-05.mjs`(샘플on), `round-07.mjs`(샘플off), `round-08.mjs`(390 PNG)다. 원본·격리 자료는 커밋 외에 보존한다.

실행기 오류는 제품 결과와 구분한다. 최초 별도 browser 호출이 viewport를 초기화해1409로 측정됐으므로 폐기하고 새 round에서1280을 명시해 원 수치를 재현했다. 수정 후 자료 저장 뒤 snapshot root에 CSS selector를 사용한 오류는 이후 일반 snapshot으로 관찰했다. 샘플 모드 전환 때 자기 서버 종료 직후 포트 재사용이 충돌했고, listener/PID 종료를 확인한 뒤 재시작했다. 이 중간 오류를 제품 실패나 성공 관찰 수에 합산하지 않는다.

## 제한과 정리

이 격리 기준에는 T191 변경이 포함된다. 실제 backup polling GET이 `401 AUTH_REQUIRED`를 반환해 읽기 경고도 화면에 남는 것을 별도 관찰했다. 이 상태에서도 원 가림·수정 후 가시성을 대조했으며 **인증/API 정상 판정은 하지 않는다**. 이를 Master에 `msg_c8616971df22`로 알렸다. T193의 인증 검수와 섞거나 이 작업에서 auth 코드를 고치지 않는다.

Ego TaskSpace29는 종료했다. 자기 fakeauth/Next43244·43245 종료 후 listener 없음 확인. 격리본·신규 fake DB·ZIP·로그·PNG는 보존했다. 원3013·공유 `.next`·실제DB·서비스/auth/패키지·공용 계획·운영 push/deploy는 변경하지 않았다. 다른 담당의 staged T191, backend 작업과 이후 커밋을 보존했다. 물리 휴대폰·스크린리더·모든 확대/폭 조합 및 운영 배포는 미검증이다. Master 통합 뒤 전용 독립 재검수가 남는다.

복사용 전달 메시지: T192 F190-1 수정 반환합니다. 실제Next에서113.781 헤더/105.297 제목으로8.484px 가림을 재현했고, ResizeObserver 실측→상속 변수→scroll-margin 연결 후 같은113.781 헤더에서 제목163.297로 전체표시했습니다. min-height와 측정값을 분리해 resize시 높이가 다시 줄며 모바일 오류도 정상flow로 포함합니다. 샘플on/off·대기0/1·정상/긴오류·반복resize40회·관련52 시험·lint/type·격리production build/verify PASS. 원Tester보고 유지, auth/API정상 수용은 별도입니다. 근거 D:/starwork/t192-header-0829b86/evidence, 고유보고서 T-192-HEADER-HEIGHT-FIX.md. 운영push/deploy없고 전용독립검수 요청합니다.
