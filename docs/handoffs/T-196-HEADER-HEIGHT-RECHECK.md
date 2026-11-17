# T196 T192 헤더 실측 높이·원 F190-1 독립 재검수

- 검수자: Codex(Tester), 수정 구현 비참여.
- 날짜: 2026-11-17 KST.
- 기준: **`fd334a6bf19ab40e4c9037685beabcd828088229` 고정**. 배정 `msg_983554c59b0a`.
- T192 원보고서 전체와 원 T190 FAIL/대조를 읽고, 같은 인증 코드에서 헤더 3파일만 전후 대조했다.
- **판정: 지정 로컬 범위 PASS. F190-1 수정 해소를 독립 확인. 새 필수 실패 없음.** 운영 배포·전체 Auth/API·전체 디자인 수용을 의미하지 않는다.
- T190 원본 FAIL과 T193 보고서는 수정하지 않았다. T194 새 정적 시나리오를 읽거나 변경하지 않았다. 공유 저장소에서는 본 고유 보고서만 작성했다.

## 기준 SHA와 격리

새 물리 사본 `D:/starwork/t196-header-fd334a6`을 사용했다. 폴더 이름으로 기준을 추정하지 않았다.

- source ZIP은 `git -c core.autocrlf=false archive fd334a6`으로 생성했다.
- ZIP EOCD comment를 직접 읽어 **fd334a6bf19ab40e4c9037685beabcd828088229**임을 단언했다(`evidence/audit.json`).
- 수정본 복원 후/종료 후 tracked **748파일 모두 해당 Git blob과 바이트 일치, 차이0**(`baseline-integrity.json`).
- node_modules·ffmpeg/probe는 기존 검수 물리 사본에서 robocopy /E /XJ로 복사했다. 설치·공유 node_modules/.tools 변경은 없다.
- Windows / Node26.13.0 / npm11.20.0 / Next16.4.6 / Vitest5.1.0.

전후는 **같은 fd334a6의 Auth/T191·API·서비스·신규 fake DB·가상 계정·SDK/SSR 쿠키**를 사용했다. before만 `components/studio-shell.tsx`, `components/studio-shell.module.css`, `app/globals.css`를 고정 **44582839c1339b5a39620b0d0249681cde372450** blob으로 사본 안에서 대체했다. 이후 세 파일을 fd334a6 blob으로 정확히 복원하고 별도로 빌드했다. stage-before/fixed.json에 각 출처 SHA와 파일 SHA256을 남겼다. 공유 제품 파일을 checkout/수정하지 않았다.

실제 Next 운영 실행기는43275, 가상 인증은43274다. 실제 proxy/route/React/SDK·SSR 쿠키를 쓰며 Supabase HTTP 응답만 합성한다. 계정 owner@example.com, UUID `00000000-0000-4000-8000-000000000196`은 합성이고 신규 fake-runtime에 migration10/샘플 seed만 만들었다. 실제 사용자 DB·계정·메일·Supabase/Vercel 설정은 사용하지 않았다. harness에서 DATABASE_URL/VERCEL을 제거했다.

## 원 F190-1 대조: 동일 수치 재현 → 수정 후 PASS

실제 로그인 → settings → 실제 fake DB backup POST202로 queue1 → 1280/sample on → 앱 logout fetch 하나만 네트워크 rejection → 백업 anchor에 Tab/ShiftTab/Enter를 수행했다. 인증/서비스 코드를 대역으로 교체하지 않았다.

| 동일 조건 | 이전 헤더 3파일 | fd334a6 수정본 |
|---|---:|---:|
| 헤더 실제 높이/하단 | 113.78125 | 113.78125 |
| 측정 변수 --studio-header-height | 없음 | 113.78125 |
| computed scroll-margin-top | 72 | 129.781 |
| backup 영역 top | 71.703125 | 129.703125 |
| backup 제목 top | **105.296875** | **163.296875** |
| backup 제목 bottom | 131.296875 | 189.296875 |
| 제목 전체 가시성 | **FAIL: 위8.484375px 가림** | **PASS** |
| Enter 후 초점 | backup | backup |
| 정상 로그인 backup GET | 200 | 200 |

`before.json`/`fixed-first.json`과 before-1280.png/fixed-1280.png를 직접 열어 확인했다. 본문이나 실패 정의를 바꾸지 않았고, 같은113.78px 헤더에서 이동 위치만 적절히 확보된 것이다. 원 T190 FAIL 보고서의 판정을 덮어쓰지 않는다.

## ResizeObserver·토큰·resize·키보드: PASS

독립 실행기 `measurement.mjs`/`browser-03-matrix.mjs`로 실제 Next에서 측정했다. T192 helper를 실행했다는 서명만 사용하지 않고, DOM 실측/상속 변수/computed margin/실제 heading 사각형/초점/6개 animation frame의 위치를 JSON으로 남겼다.

**sample on/off × queue0/1 × 정상/긴 오류 =8조건**, 각 조건마다 **1280→390→1280→768** 순서로 관찰해 **32/32 PASS**(`matrix32.json`). 반복1280은 복구 검증이며32개 고유 화면이라는 뜻은 아니다.

- 실측 높이와 `--studio-header-height` 차이0.1px 미만.
- computed scroll-margin = 실측 높이+기존16px, 차이0.1px 미만.
- header 안 alert의 bottom도 포함한 occupiedBottom 아래에 backup heading 전체가 표시되고 viewport 안에 들어옴.
- anchor Tab→restore 링크, ShiftTab→backup 링크, Enter→backup 초점 유지.
- 6개 연속 frame에서 scroll 변화0.5px 미만·헤더 높이 변화0.1px 미만.
- 원래1280으로 복귀한 **8/8조건의 높이가 첫1280과 같음**. 측정값이 min-height로 되먹임돼 커진 상태로 고정되지 않음.
- 전체 관찰의 헤더 실측 범위61~347.734375px. 긴 오류/폭에 맞게 커졌다가 줄어듦.
- 짧은 상단 ‘설정’은 전체 표시, 모든 관찰에서 header 조작 폭/높이44px 이상, 가로 overflow0.
- queue0/1은 실제 fake DB backup POST/작업 cancel PATCH로 준비했다. sample off는 같은 빌드의 자기 Next만 중지/재시작하고 실제 서버 환경 MOCK_MODE=false로 확인했다. 화면 문구만 숨긴 대역이 아니다.

원 대조의 오류는 실제 앱 logout 네트워크 rejection이다. 추가 긴 오류는 `/api/auth/logout`의 브라우저 응답만503/LOGOUT_FAILED와 반복된 긴 안내로 주입했다. 원래 AccountMenu의 실패 분기/문구 전체를 사용했으며 실제 Supabase 장애를 만든 것은 아니다. jobs/backups 요청은 그대로 실제 Next API에 전달했다.

소스도 대조했다. ResizeObserver는 header border-box를 부모 전용 변수에 기록하고 min-height는 기존 디자인 토큰만 참조한다. 전역 scroll-margin은 측정 변수 우선/기존 토큰 fallback을 사용한다. 모바일 alert를 normal flow에 놓아 측정 높이에 포함한다. 해제 시 observer disconnect/변수 정리가 명시돼 있다.

## 본문 h1·모바일 제목·메뉴 회귀

`h1-and-menu.json`: normal390 및 긴 오류1280→390→1280→768의 **5개 h1 관찰 모두 전체 가시성 PASS**. 예: 긴 오류390에서 header/occupiedBottom347.734375, h1Top367.734375/h1Bottom396.328125로 오류 배너와 본문이 겹치지 않았다.

메뉴 Enter 열기/닫기 초점, ShiftTab 마지막 설정 링크, Tab 복귀, Escape 후 메뉴 열기 초점 복귀도 실제 키보드로 확인했다. U185 짧은 제목 공간과44px 조작은32회 관찰에 포함했다. 전체 디자인/모든 긴 제목·확대 조합을 새로 수용한 것은 아니다.

정상 logout 후 셸 없는 로그인 화면에서 header 없음, 측정 변수 없음, scroll-margin fallback72px를 확인했다. 셸의 실측 변수가 로그인 화면으로 남지 않았다(`a1-recovery-and-logout.json`).

## A1 polling 오류 보존·backup GET 상태 구분

기존 T192 보고서의 backup GET401 관찰을 정상 API로 간주하지 않았다. 이번 유효 UUID 합성 계정·고정 인증 코드에서는:

1. 전후 원재현과 matrix의 **정상 로그인 backup GET은 모두200**. matrix의8조건별 응답 status를 보존했다. jobs200/cancel200/enqueue202도 따로 기록했다.
2. queue1에서 백업 폴더에 `relative-t196-invalid`를 입력하고 키보드로 저장해 실제 서버의 절대 경로 오류를 받았다.
3. 정상 polling으로 readAt이 바뀐 뒤에도 작업 오류와 입력을 보존했다(`a1-successful-poll.json`).
4. 자기 fake DB app.db만 임시 이름으로 옮겨 실제 startup 읽기503을 만들고 finally에서 복구했다. polling/direct backup GET503, read 오류와 기존 작업 오류·입력·목록3개·마지막 읽은 시각을 유지했다(`a1-offline.json`).
5. 복구 후 키보드 상태 새로고침/direct GET200. read 오류만 없어지고 작업 오류/입력은 유지됐다(`a1-recovery-and-logout.json`).
6. 실제 정상 로그아웃 후 backup GET은 **401**이었다. 이는 의도한 익명 접근 거부이며200으로 바꿔 세지 않았다. 다시 합성 로그인해서 h1/메뉴 검증을 마친 뒤 최종 정상 logout으로 정리했다.

따라서 이번 fixture에서는 로그인200/의도한 DB 장애503/로그아웃401을 분리 확인했다. **작성자 다른 사본의 로그인 중401 원인은 이번 결과만으로 확정하거나 해결됐다고 주장하지 않는다.** 운영 backup/Auth 전체 정상 판정도 아니다. T193의 원보고서/판정을 수정하지 않았다.

## 실행 검사

| 실행 | 실제 결과 |
|---|---|
| `npm.cmd test -- tests/t188-mobile-header.test.ts tests/t180-a2-settings-overview.test.ts tests/t182-auth.test.ts` | exit0, **3파일/52 PASS**, related52.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| 헤더3파일 이전 상태 `npm.cmd run build` | exit0, before-build.log, 같은 fd334a6 Auth 기준의 대조 빌드 |
| fd334a6 파일 복원 후 `npm.cmd run build` | exit0, fixed-build.log, 운영 Next 및 verify-build 통과 |
| 실제 Next/browser 전후·32관찰·h1/메뉴·A1 | 위 개별 JSON/PNG, 전후 원수치와 실제 조작 확인 |
| `node tmp/t196/audit.mjs` | exit0, 전후·32관찰·높이복귀8·h1·A1·ZIP SHA를 재단언, audit.json |
| `node tmp/t196/verify-baseline.mjs` | 748개 tracked blob 일치/차이0 |

lint/type/52는 고정 수정본에서 전후 실험을 하기 전에 실행했다. 이후 이전3파일 대조 및 정확한 복원만 했고, 마지막 blob 검사로 복원을 확인했다. 전체925 등 영향 밖 검사를 반복하거나 작성자 숫자를 독립 수치로 합산하지 않았다. 실제 브라우저 관찰/추가 audit를 Vitest52에 합산하지 않는다.

## 정리·제한·반환

ego TaskSpace34를 finish했다. 자기 harnessPID13480와 Next 자식55928(이전대조)/6716(수정 sample on)/77860(sample off)를 종료했고43274/43275 listener 부재를 확인했다. 공유3013은 PID51032 유지, 공유 .next와 실제 DB를 대상으로 명령을 실행하지 않았다. 도구/패키지/서비스/auth/API/DB 제품 코드·Vercel·push/deploy 변경 없음. 새 fake DB의 canceled/queued 검수 작업은 보존하며 worker·실제 ZIP/렌더를 실행하지 않았다.

사본·원 ZIP·실행기·로그·JSON·PNG는 보존했다. 자동 승인 거절/거절 우회/삭제 재시도는 없다. 물리 휴대폰·스크린리더·전체 확대/폭·운영 계정·실제 메일·운영 Auth/API 정상은 미검증이다. 원 T190 FAIL과 수정본의 이번 PASS는 별도 기준의 보고서로 남긴다.

Master 복사용: T196 fd334a6 고정 독립 재검수 PASS입니다. 같은 T191 Auth/SDK/신규 DB에서 헤더3파일만 이전445로 바꿔113.781 header/105.297 heading 원FAIL을 재현하고, fd 복원 뒤 같은header에서heading163.297 전체가시성을 확인했습니다. sample on/off·queue0/1·normal/긴오류의1280→390→1280→768 총32관찰PASS, 실측변수/scroll-margin 연동·복귀높이8/8·TabShiftTabEnter/초점/6frame안정·44px·모바일제목·h1가시성·A1오류보존503복구를 확인했습니다. 정상로그인backupGET200/의도장애503/로그아웃401을 구분했고 작성자사본401원인해소는 주장하지 않습니다. 관련52/lint/type/전후build/verify PASS, sourceZIP comment fd334a6 및748trackedblob일치. T190/T193/T194 보호, 자기서버·브라우저종료/3013유지/증거보존, 고유보고서 선택commit 반환합니다.
