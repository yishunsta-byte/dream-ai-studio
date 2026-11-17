# T188 · 모바일 상단 제목 잘림 수정

- 담당: Codex design / CX-DESIGN-01
- 배정: Master `msg_d7e886a49b92`, 수락 `msg_d45b964e3845`. 통합 계획 참고/현재 범위 유지 `msg_e1fd5a7dda4d`.
- 기준: 착수 `bdc6a1e`, T185 U185-1. 작업 중 다른 담당의 계획·B3·T187 커밋을 보존했다.
- 상태: ready_review · 구현자 자체 검수. 독립 검수/운영 배포 완료가 아니다.

## 원인과 수정

기존 헤더는 메뉴 버튼·breadcrumb·대기 링크·샘플 모드·계정을 한 flex 행에 놓고 breadcrumb에 `flex:1;min-width:0;overflow:hidden`을 적용했다. 390px에서 다른 요소의 폭이 먼저 소비돼 짧은 제목까지 잘렸다. **본문 h1은 정상이며 상단 breadcrumb 문제**다.

실제 StudioShell·공통 UI·현재 AccountMenu·제품 PretendardVariable을 별도 번들로 실행해 T185 수치를 그대로 재현했다. 합성 대기1/샘플/로그인 상태에서 ‘설정’ 텍스트24.203125px, crumb8.046875px였다. 문서 가로 넘침은0이어도 제목은 잘렸다.

제품 변경은 허용된 두 파일뿐이다.

- `components/studio-shell.tsx`: 상태/계정 요소를 이름 있는 한 그룹으로 묶고, 표시할 정보가 있을 때만 렌더한다. 기존 대기 링크 텍스트·조건·목적지, 샘플 모드 의미, AccountMenu props/동작은 유지했다. 제목 전체 문자열은 DOM과 `title` 속성에 남긴다.
- `components/studio-shell.module.css`: 639px 이하에서 **첫 행은 메뉴+제목, 다음 행은 상태·계정**으로 배치한다. 상태 그룹은 줄바꿈 가능하며, 헤더 안 버튼과 대기 링크 높이는 최소44px이다. 넓은 화면은 기존 가로 배치를 유지한다.
- 모바일 두 행 높이는 기존 토큰으로 계산해 자식 본문의 `--topbar-h`에도 반영한다. sticky 헤더 아래로 본문 anchor 대상이 가려지지 않는지 확인했다. 공용 토큰·global CSS·계정 메뉴 파일은 변경하지 않았다.
- 긴 제목은 확보된 폭 안에서 말줄임한다. 본문 제목은 정상 줄바꿈하고, 헤더 DOM·접근성 트리·title에는 전체 제목을 유지한다. ‘설정’ 같은 짧은 제목은 완전히 표시된다.

## 전후 측정

동일 합성 계정 `owner@example.test`·대기1·샘플 모드, 제품과 같은 로컬 글꼴을 사용했다. viewport는 실제 `innerWidth`1280/390이며 세로 scrollbar 영역을 제외한 본문 폭으로 clip/overflow를 계산했다.

| 폭 | 수정 전 crumb | 수정 후 crumb | ‘설정’ 텍스트 | 결과 |
|---|---:|---:|---:|---|
| 390 | 8.046875px | **287px** | 24.203125px | 제목 전체 표시, 상태·로그아웃 다음 행 |
| 1280 | 550.25px | 550.25px | 24.203125px | 제목 전체 표시, 가로 배치 유지 |

수정 후 로그아웃 조작 높이는 양폭44px이고 이름 `로그아웃 (owner@example.test)`를 유지했다. 대기0일 때 기존처럼 대기 링크는 숨기고, 대기1일 때 `진행 0 · 대기 1`과 `/jobs`를 유지한다.

## 실행 검증

| 검증 | 실제 결과 |
|---|---|
| 1280/390 × 대기0/1 × 샘플없음/있음 × 로컬/합성로그인 × 일반/긴제목 | **32개 배치 확인 통과** |
| 각 배치 | 일반 제목 clip없음, crumb최소100px 이상, 긴 제목 전체 문자열 보존, 조작 요소 가로경계 안, 문서 overflow0, 본문h1 정상/헤더 아래 |
| 키보드·재시도·anchor | **13개 확인 통과** |
| 모바일 메뉴 | Enter 열기, 닫기 버튼 초점, Shift+Tab/Tab 순환, Esc 뒤 열기 버튼 복귀 |
| 헤더 Tab/Shift+Tab | 대기 링크↔로그아웃 순서 유지 |
| 로그아웃 실패 상태 | 합성503으로 기존 AccountMenu의 재시도·alert 표시. 긴 재시도 문구에서도 제목·alert·44px·가로경계 유지 |
| 본문 anchor | Enter 이동 뒤 sticky 헤더에 대상이 가려지지 않음(1280/390) |
| 자동 시험 | **3파일·52개 통과**: 신규 헤더 의미3, 기존 T180 A2 8, T182 인증41 |
| lint / 타입 / diff | 전체 eslint, `tsc --noEmit --incremental false`, `git diff --check` exit0 |

명령:

```text
node node_modules/vitest/vitest.mjs run tests/t188-mobile-header.test.ts tests/t180-a2-settings-overview.test.ts tests/t182-auth.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --max-warnings 0
git diff --check
```

브라우저의 비동기 대기 상태·키보드13개를 신규 Vitest 시험으로 합산하지 않는다. 신규 자동 시험3개는 전체 제목·샘플 의미·계정 접근성 이름과 빈 상태 그룹 생략을 검증한다. 레이아웃의 실측 근거는 아래 JSON·PNG다.

## 전후 PNG와 재현 근거

허용 문서 경계에 맞춰 근거 파일은 공유 작업공간의 **무시되는 임시 폴더**에 보존하고, 이 보고서 외의 docs 파일은 추가하지 않았다.

- [390 수정 전](../../tmp/t188/before-390.png) / [390 수정 후](../../tmp/t188/after-390.png)
- [1280 수정 전](../../tmp/t188/before-1280.png) / [1280 수정 후](../../tmp/t188/after-1280.png)
- [390 긴 제목](../../tmp/t188/after-long-390.png) / [1280 긴 제목](../../tmp/t188/after-long-1280.png)
- [390 재시도](../../tmp/t188/after-retry-390.png) / [1280 재시도](../../tmp/t188/after-retry-1280.png)
- [전후 실측·32개 상태 JSON](../../tmp/t188/layout-audit.json), [키보드13개 JSON](../../tmp/t188/keyboard-audit.json).

전후390·수정 후1280·긴 제목390·재시도390 PNG를 직접 열어 확인했다. PNG는 현재 사용자 데이터나 운영 계정 화면이 아니다. 합성 화면 안내와 합성 이메일을 표시한다. 같은 실제 AccountMenu를 쓰되 fetch 응답만 가짜 jobs/로그아웃 응답으로 제한했다.

재현 실행기: `tmp/t188/build.mjs before`는 `bdc6a1e`의 shell TSX/CSS를 메모리로 읽고, 기본 인수는 수정 파일을 묶는다. 다른 제품 파일을 checkout하거나 바꾸지 않는다. 두 번들 모두 현재 AccountMenu와 제품 글꼴을 사용했다. `navigation.mjs`만 usePathname을 합성 경로로 제공한다. `round-03.mjs`는 수정 전 실측, `round-04.mjs`는32개 배치, `round-05.mjs`는13개 키보드·재시도 확인이다. Ego TaskSpace24·별도 정적 서버3188에서 실행한 뒤 둘 다 종료했다.

## 범위·미검증·반환

허용 제품2파일·고유 시험1파일·이 보고서만 변경했다. 인증 route/AccountMenu/설정Panel/서비스/DB/패키지/공용 문서·확정 시안은 변경하지 않았다. 백엔드 package WIP를 설치/빌드/리셋하거나 stage하지 않았다. 작업 중 B3·T187 커밋은 다른 담당의 결과로 보존했다. 기존 미추적 T122/T137 문서도 보존했다.

공유3013·공유 `.next`·실제 DB·Vercel·실제 인증·메일·계정의 로그아웃은 사용하지 않았다. 표현만 바꾼 셸은 타입 검사와 실제 브라우저 번들로 확인했고 새 production Next build는 실행하지 않았다. 실제 Next 라우팅/인증 통합·운영 배포·물리 휴대폰·스크린리더 적합성·전체 폭/글자 확대 조합은 이번 통과 범위가 아니다. 기존 T186/T187 인증 수용 판정을 대신하지 않는다.

복사용 전달 메시지: T188 U185-1 수정 반환합니다. 제품 글꼴+실제셸 가짜상태에서390 crumb8.046875/텍스트24.203125 재현 후 제목행/상태계정행 분리로crumb287px 확보했습니다. 대기 링크/샘플/계정 이름·로그아웃44px 유지, 긴 제목DOM전체/말줄임 및 본문h1 구분 확인했습니다. 1280/390 상태조합32·키보드/재시도13·관련52 시험·전체lint·tsc PASS. 전후PNG와 JSON은 tmp/t188, 고유보고서 T-188-MOBILE-HEADER.md. 제품허용2파일 외 auth/panel/DB/패키지/공용문서/3013/.next/Vercel 변경 없음. 자체검수이며 실제폰·전체Next인증통합/운영배포 미확인입니다.
