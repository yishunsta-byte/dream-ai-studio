# T190 모바일 헤더 독립검수 — F190-1 수정 필요

- 검수자: Codex(Tester), 구현 비참여.
- 날짜: 2026-11-17 KST, 약 18:14~18:26.
- 기준: `44582839c1339b5a39620b0d0249681cde372450` 고정, T188 원보고서 전체 확인.
- 배정 `msg_8fa5b69d5083`, 운영 배포 알림 `msg_9152c4dd6138`.
- **판정: 원래 U185-1의 390px 짧은 제목 수정은 PASS. 전체 지정 범위는 F190-1로 FAIL.** 인증 판정 전체를 무효화하는 결과는 아니다.
- 허용 보고서만 수정. 제품/auth/backend/공용 문서·패키지·사용자 DB·배포를 수정하지 않았다.

## 격리와 실제 실행

새 물리 사본 `D:/starwork/t190-header-4458283`에 `git -c core.autocrlf=false archive 4458283`을 풀었다. node_modules와 `.tools/ffmpeg`는 물리 복사했으며 공유 설치본을 변경하지 않았다. 새로 추가된 pg 의존성도 고정 snapshot의 package.json과 함께 기존 설치본에서 복사했다. 설치 명령은 실행하지 않았다.

종료 후 tracked **731개 Git blob 전부 바이트 일치, 차이0**(`evidence/baseline-integrity.json`). 신규 검수 실행기·자료는 격리본 tmp/evidence에만 있다. Windows/Node v26.13.0/npm 11.20.0/Next16.4.6/Vitest5.1.0에서 수행했다.

두 종류의 실행 근거를 분리한다.

1. **실제 StudioShell 번들:** 고정 제품 StudioShell/AccountMenu/공통 UI/CSS/제품 글꼴을 실행했다. usePathname과 jobs/logout HTTP만 합성 대역이다. 43236 정적 서버, queue0/1·sample0/1·account0/1·일반/긴 제목을 독립 조합했다. before 대조군은 a278e80의 shell TSX/CSS만 읽고 나머지는 같은 현재 컴포넌트를 사용했다. 제품을 checkout/수정하지 않았다.
2. **실제 운영 Next:** 고정 snapshot을 빌드해 43235에서 실행했다. SDK·SSR 쿠키·proxy·API·React는 실제 코드, 인증 HTTP만 43234 가상 서버다. 신규 fake-runtime에 migration/합성 seed를 생성했다. 실제 사용자 DB를 복사하거나 읽지 않았다. 합성 계정 owner@example.com만 로그인했다. 43237 공격용 서버도 실행기와 함께 생성됐으나 이번 헤더 검수에서 공격 폼 검증 수치로 합산하지 않았다.

## F190-1 · P2 · 넓은 화면의 로그아웃 오류로 높아진 헤더가 앵커 제목을 가림

원인: `components/studio-shell.module.css`의 headerStatus는 max-width:70%/flex-wrap:wrap이다. 1280px에서 대기1·샘플·합성 계정 및 로그아웃 실패 안내가 함께 표시되면 상태 그룹이 줄바꿈하며 sticky header 높이가 증가한다. 반면 `app/globals.css:6`의 scroll-margin-top은 `--topbar-h + --sp-4`를 참조하고, desktop의 root 값은 **56+16=72px**로 남는다. 모바일에서만 .withHeaderStatus가 --topbar-h를112px로 바꾼다.

실제 Next 재현:

1. fakeAuth owner로 `/settings`에 로그인했다.
2. 실제 `/api/backups`에 POST하여 자기 fake DB에 대기 작업1을 등록했다(202). worker는 실행하지 않았다.
3. viewport를 실제1280으로 설정했다.
4. 해당 페이지의 `/api/auth/logout` fetch 하나만 네트워크 rejection으로 주입하고 로그아웃 버튼을 눌렀다. T186 오류 안내·재시도 상태가 표시됐다.
5. 키보드로 ‘백업’ 링크에 초점을 두고 Enter를 눌렀다.

측정(`evidence/next-integration.json`):

- header bottom **113.78125px**
- #backup top **71.703125px**, focusId=backup
- #backup-title top **105.296875px**
- 따라서 본문 백업 제목 상단 **약8.48px가 실제 헤더 아래에 가림**. 단순 section 여백만 가린 것이 아니다. PNG를 직접 열어 제목의 윗부분이 잘린 것을 확인했다.
- 문서 가로 넘침은0이다. overflow0만으로 가림이 없다고 판정하면 안 된다.

근거: `next-retry-anchor-1280.png`, `next-integration.json`, `browser-04-next.mjs`.

같은 실제 Next의 정상 대조군은 header bottom61 / #backup top71.921875로 가림 없음(`next-control.json`). 실패 안내 뒤에도 세션이 남아 있을 수 있음을 정직하게 표시했고, 네트워크 주입 해제 후 재시도하면 로그인으로 이동·API401·쿠키0이 됐다. 이번 문제는 인증 성공/실패 분류가 아니라 sticky 헤더와 앵커의 배치 문제다.

독립 번들 전후 대조(`anchor-before-after.json`): 아래쪽에 충분한 여백을 둬 최대 스크롤 한계에 가림이 숨지 않게 했다. 같은 AccountMenu/같은 오류 메시지/1280에서:

| shell | 오류 후 헤더 높이 | 앵커 target top | 결과 |
|---|---:|---:|---|
| a278e80 이전 shell | 61.78125 | 71.96875 | 가림 없음 |
| 4458283 shell | 113.78125 | 71.96875 | 41.81px 구간이 헤더 아래 |

각 앵커의 computed scroll-margin-top은72px이며, 두 animation frame 뒤에도 재현됐다. 새 그룹의 wrap과 고정 scroll offset 불일치가 이전 shell 대비 차이임을 분리했다. 초기 Master 중간 메시지의 root60 표기는 후속 `msg_fc6ca0c9679a`에서 실제56으로 정정했다. 본 보고서는56을 사용한다.

최소 수정 제안: 실제 헤더 높이를 앵커 offset에 반영하거나, 해당 넓은 화면 오류 상태에서 헤더 높이가 고정 offset을 넘지 않도록 배치한다. 동적 높이를 사용할 경우 헤더 min-height와 같은 변수를 순환 참조해 높이가 줄지 않는 문제를 만들지 않아야 한다. 정상/오류/복구의 header 크기 변화와 실제 settings 앵커를 재검수한다. 검수자는 수정하지 않았다.

## U185-1 기본 수정과 상태 조합: PASS

원래 390 문제를 제품 글꼴·실제 shell로 재현했다(`before-after.json`).

| 390, queue1/sample/account | 제목 실제 폭 | crumb 공간 | 결과 |
|---|---:|---:|---|
| 이전 shell | 24.203125px | 8.046875px | 짧은 ‘설정’ 잘림 |
| 수정 shell | 24.203125px | 287px | 제목 전체 표시, 상태·계정 다음 행 |

실제 innerWidth **1280/390 × queue0/1 × sample0/1 × account0/1 × 일반/긴 제목 =32개**는 기본 배치 단언을 모두 통과했다(`matrix32.json`).

- 일반 제목 전체 표시, 첫 행 제목/모바일 다음 행 상태 분리.
- 표시 조건에 맞는 상태 그룹, queue0일 때 대기 링크 없음, account0일 때 로그아웃 없음, sample0일 때 샘플 표시 없음.
- 본문 h1 전체 문자열 유지·줄바꿈·정상 상태에서 header 아래 배치.
- 메뉴/대기 링크/로그아웃 높이 최소44px 및 가로 경계 내, 문서 overflow0.
- 긴 제목의 DOM/strong title/h1은 동일한 전체 문자열이다. 합성 긴 제목 폭492.953125px는 390의 crumb287px를 넘어 **실제 말줄임**, 1280의 crumb547.34375px 안에서는 **전체 표시**다. CSS에 ellipsis가 있다는 이유로 두 폭 모두 생략됐다고 주장하지 않는다.
- 실제 Next 정상 화면에서도1280 crumb547.34375/header61/h1Top85, 390 crumb287/header113/h1Top133, overflow0을 확인했다.

## 키보드·실패 상태

`keyboard.json`: **12개 독립 확인 중11 PASS/1 FAIL(F190-1)**. 실패를 정상 확인 개수에 합산하지 않는다.

- 두 폭의 대기 링크→Tab→로그아웃, Shift+Tab 역순 PASS.
- 390 메뉴 Enter 열기/닫기 초점, Shift+Tab 마지막 설정 링크, Tab 닫기 복귀, Escape 메뉴 열기 초점 복귀 PASS.
- 두 폭의 로그아웃 실패 후 재시도 문구·44×44px 이상 조작 영역·짧은 제목 전체 표시·overflow0 PASS.
- 390 앵커는 targetTop128.1875/headerBottom113/focusId=body-target로 header를 피함. 다만 기존 U187-1의 모바일 오류 배너가 본문 위에 겹치는 현상은 남아 있으며 배너를 포함한 전체 가림 해소라고 주장하지 않는다.
- 1280 오류 뒤 앵커는 FAIL. 실제 Next에서 같은 현상을 추가 재현했다.

PNG before/out390, 기본1280, 긴 제목390, 재시도390, 실제 Next 오류 앵커1280을 직접 열어 확인했다.

## 실행 검사

| 명령 | 결과 |
|---|---|
| `npm.cmd test -- tests/t188-mobile-header.test.ts tests/t180-a2-settings-overview.test.ts tests/t182-auth.test.ts` | exit0, 3파일/52 PASS, related52.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| `npm.cmd run build` | exit0, 운영 Next+verify-build, build.log |
| 물리 ffmpeg/probe 복사 후 `npm.cmd run build` | exit0, 로컬 도구·비밀·데이터 추적 검사 유지, build-physical-tools.log |
| 고정 tracked blob 검사 | 731개 일치, 차이0 |

물리 ffmpeg SHA256 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`. 실제 영상 실행이나 전체882를 불필요하게 반복하지 않았다. 합성 상태32와 키보드12는 Vitest52에 합산하지 않는다.

## 운영 HTTPS 읽기 전용 관찰 — 로컬 독립 검수와 분리

`production-readonly.json`에 시각·GET만 사용·credentialsSent=false·commitIdentityVerified=false를 기록했다. 운영 URL `https://dream-ai-studio-orpin.vercel.app`에 쿠키/계정/메일을 사용하지 않고 GET만 보냈다.

- /login200 및 로그인 화면 제목 확인, private/no-store.
- /와 /settings는 상대 로그인 주소로307/no-store.
- /api/jobs는401 AUTH_REQUIRED/no-store.

이는 익명 접속 보호의 실제 HTTPS 관찰이다. 인증 뒤 운영 header는 열지 않았고, 이 결과만으로 운영 배포 SHA4458283을 독립 확정하지 않았다. 배포 이력은 Master/Front 알림과 구분한다. 운영 계정·사용자 데이터를 변경하지 않았고 신규 push/deploy는 없다.

## 정리·한계·반환

ego TaskSpace28 finish. 자기 정적 서버PID61308, 가상 인증 harnessPID2696/NextPID67420을 종료하고 43234/43235/43236/43237 listener 부재를 확인했다. 공유3013은 PID51032로 유지됐으며 공유 .next를 대상으로 명령을 실행하지 않았다. 격리본·archive·증거는 보존했다. 자동 승인 거절은 없었고 삭제/우회/도구 설치는 없다. 신규 fake DB에는 점검용 queued backup이 남으며 worker는 켜지 않았다.

물리 휴대폰/스크린리더/전체 글자 확대·임의로 긴 이메일·전체 폭 조합은 미검증이다. 브라우저 번들의 합성 pathname과 상태는 실제 Next 통합 확인으로 대체하지 않고 각각 표시했다. T186 인증 경로는 실제 로그인/실패 안내/재시도/쿠키 제거의 좁은 범위에서 정상이며 T187 인증 판정 전체를 다시 검수한 것은 아니다.

Master 복사용: T1904458283 고정 원검수 완료, U185-1 짧은 제목 수정·32기본배치·관련52/lint/type/물리도구build PASS지만 F190-1 P2로 전체 수용 FAIL입니다. 1280 queue1+sample+account의 logout 오류 뒤 status wrap으로header113.78인데 scroll-margin은56+16=72라 앵커를 가립니다. 실제 Next settings에서 #backupTop71.70/#backup-titleTop105.30/headerBottom113.78로 제목상단8.48px 실제가림을 확인했고, 이전shell/정상상태 대조는 통과했습니다. 키보드12중11PASS/1FAIL을 분리했습니다. 인증 재시도는 정상 종료/API401/cookie0이며 운영은 익명HTTPS GET만 별도 확인했습니다. 제품/push/deploy/3013/사용자DB 변경 없음, 자기서버·브라우저 종료, 근거 보존. 헤더 실제높이와 앵커offset 보완 후 새snapshot 집중 재검수를 요청합니다.
