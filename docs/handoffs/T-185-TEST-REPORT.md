# T185 로그인·가입·비밀번호 찾기 및 설정 통합 독립검수

- 담당: Codex(Tester), 구현 비참여 독립검수.
- 날짜: 2026-11-17 KST, 약 17:44~17:58.
- **판정: 검수 완료 / 제품 수용 FAIL. 기존 F184-1·F184-2 모두 재현.**
- 고정 기준: `a278e80d9ae9ed88cfbd4939c5b8fccb3bd23ecf`. 검수 도중 Main에 들어온 후속 변경과 T186 수정은 이 판정에 포함하지 않았다.
- 입력: Master 범위 확정 `msg_6943bec65ecb`, T184 원보고서 `645c77a:docs/handoffs/T-184-PASSWORD-INDEPENDENT-REVIEW.md`, 관련 규칙·코드·테스트.
- 공유 저장소에서 본 검수자가 작성한 파일은 이 보고서 하나다. 제품 코드·공용 상태·의존성·운영 데이터는 수정하지 않았다.

## 격리 및 근거 위치

`D:/starwork/t185-test-a278e80`에 `git archive a278e80`을 풀고 node_modules를 물리 복사했다. 공유 node_modules에 설치나 변경을 하지 않았다. Node `v26.13.0`, npm `11.20.0`, Next `16.4.6`, Vitest `5.1.0`이다.

기준 무결성 검사 `evidence/baseline-integrity.json`: tracked 704개 중 Git blob과 바이트 일치 117개, archive의 CRLF export만 다른 텍스트 587개, 그 외 차이 0개. 따라서 원본 LF 바이트 그대로의 검수가 아니라 Windows CRLF export에서의 실행임을 명시한다. 고정 ZIP·SQL 등 바이트 자료는 별도 수정하지 않았다. 검수 도중 공유 HEAD가 바뀌어도 격리본을 동기화하지 않았다.

실제 SDK·SSR 쿠키·Next proxy·운영 빌드·React 화면을 사용했다. Supabase HTTP 응답만 가상 서버로 대체했다. `owner@example.com`/`outsider@example.com`은 합성 계정이다. 운영 Supabase, 실제 비밀번호 변경, 실제 메일 발송, 사용자 DB 접근은 없다.

- 가상 인증: `127.0.0.1:43194`, Next 운영 실행기: `127.0.0.1:43195`, 외부 출처 재현 페이지: `localhost:43196`.
- fake DB: 격리본 `fake-runtime/data/app.db`, 신규 migration 10개 및 샘플 seed 1개. 사용자 DB를 복사하지 않았다.
- 재현 실행기: 격리본 `tmp/t185/harness.mjs`, `api-check.mjs`, `actual-runner.mjs`, `browser-01.mjs`~`browser-14-finish.mjs`.
- 증거: 격리본 `evidence/`의 로그·JSON·PNG. 실행기는 이 세션에서 새로 작성했다.
- 가상 인증 getUser는 발급한 합성 토큰을 검사한다. 익명 요청을 무조건 통과시키는 대역이 아니다. 정상 logout 후 보호 화면 차단을 별도 대조했다.

## 필수 수정: 기존 실패 재현

### F184-1 유지 · P2 · 외부 폼으로 로그인 세션 생성

위치(고정 기준): `app/api/auth/login/route.ts:13`, `lib/auth/config.ts:51`.

실제 브라우저에서 로그아웃 상태로 `http://localhost:43196`의 text/plain HTML 폼을 열어 버튼을 클릭했다. 목적지는 다른 사이트인 `http://127.0.0.1:43195/api/auth/login`이다.

```html
<form method="post" action="http://127.0.0.1:43195/api/auth/login" enctype="text/plain">
  <input name='{"email":"owner@example.com","password":"ReviewPass185","padding":"' value='"}'>
  <button>Send synthetic cross-site login</button>
</form>
```

결과: 로그인 응답 `{"ok":true}`. 이어 `/account/password`가 로그인 화면으로 이동하지 않고 owner의 새 비밀번호 폼을 표시했다. 쿠키/토큰을 브라우저에 주입하지 않았다. 정상 로그인과 같은 세션이 생성됐다. 원재현은 `browser-02.mjs`, 가상 SDK 호출은 `fake-auth-events.jsonl`로 확인한다.

공격자가 허용 계정의 유효한 자격 증명을 이미 가진 경우의 login CSRF/계정 혼동이다. 허용 목록 우회나 타인의 비밀번호 탈취를 재현한 것은 아니다. 최소 수정: mutation 요청의 출처/CSRF 방어와 JSON Content-Type 검증을 provider 호출 전에 적용한다. 정상 동일 출처 JSON·메일 callback은 별도 회귀검증한다.

### F184-2 유지 · P2 · 로그아웃 실패를 비밀번호 변경 완료 흐름으로 숨김

위치(고정 기준): `app/api/auth/logout/route.ts:5`, `components/auth/new-password-form.tsx:30`~31.

SDK logout 500 재현 (`browser-03.json`):

1. 로그인된 실제 새 비밀번호 폼에서 합성 비밀번호 변경을 제출했다.
2. 가상 인증의 updateUser는 성공, logout만 500으로 응답하게 했다.
3. 앱은 `/login?notice=password`로 이동해 “비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.”를 표시했다.
4. 같은 브라우저로 `/account/password`를 다시 열자 원래 URL과 보호된 비밀번호 폼이 유지됐다.
5. logout을 정상 204로 돌려 같은 흐름을 수행하자 `/login?next=%2Faccount%2Fpassword`로 이동했다.

별도 앱 logout 네트워크 실패 (`browser-13.json`): 실제 페이지의 fetch 중 `/api/auth/logout`만 Promise rejection으로 주입했다. password API·SDK updateUser는 실제 경로와 가상 인증 서버를 사용했다. 이때도 성공 안내로 이동하고 기존 보호 화면 접근이 가능했다. 이는 클라이언트 네트워크 예외 처리의 주입 검증이며 실제 회선 장애를 발생시킨 것은 아니다. 페이지를 다시 연 뒤 정상 logout하면 `/settings`가 로그인으로 차단됐다.

최소 수정: SDK signOut 오류를 응답에 반영하고, 전역 종료 실패 시 로컬 세션 종료 여부를 구분한다. 폼은 logout 응답/네트워크 실패를 확인하고 비밀번호 변경 성공과 세션 종료 실패를 분리해 안내해야 한다. 쿠키 제거·보호 API 차단·재시도까지 원재현과 정상 대조로 확인한다. T186 수정 여부는 이 보고서에서 판정하지 않는다.

## 지정 API 경계: PASS

실제 Next 서버 HTTP 관찰 45건은 `evidence/api-results.json`에 보존했다. 자동 단언 45개라는 의미는 아니다.

| 확인 | 실제 결과 |
|---|---|
| 미인증 password/backups | 401 `AUTH_REQUIRED` |
| 미인증 settings | 307 `/login?next=%2Fsettings` |
| 허용 owner 로그인 | 200, SDK가 만든 실제 SSR 쿠키 사용 |
| login/signup/reset/password 각각 null·배열·문자열·숫자·깨진 JSON | 20개 모두 400 `BAD_REQUEST` |
| 잘못된 비밀번호·허용 밖 이메일 로그인 | 400 `INVALID_CREDENTIALS` |
| owner 가입·reset | 200, 가상 provider만 호출 |
| 허용 밖 가입·reset | 열거 방지용 같은 200 안내, 가상 provider 호출 증가 0 |
| reset 요청 뒤 익명 password 변경 | 401, reset 요청만으로 세션이 생기지 않음 |
| 외부 URL·//·탭·역슬래시 next + forged forwarded host | callback 307 Location `/`, 외부 이동 없음 |
| 정상 내부 next | callback 307 `/settings?x=1` |
| 만료 token·알 수 없는 OTP type | 307 `/login?error=link` |
| 허용 밖 recovery callback | `/login?error=forbidden`; signOut 실패로 세션이 남아도 보호 API는 계속 403 |
| 허용 밖 실제 세션의 backups/password | 403 `AUTH_FORBIDDEN`; settings는 forbidden 로그인으로 이동 |
| owner backups·신규 가상 backup 요청 | 200 / 202 |

## 설정·백업 actual runner: PASS

`SettingsPanel`을 테스트용 화면으로 교체하지 않고 실제 settings 페이지와 API를 사용했다.

1. 실제 backup API로 대기 작업을 등록해 2초 polling을 활성화했다.
2. 백업 폴더에 `relative-t185-invalid`를 입력하고 키보드 Enter로 저장해 실제 서버의 절대 경로 오류를 받았다.
3. 정상 polling으로 읽은 시각이 바뀐 뒤에도 작업 오류와 입력값이 유지됐다(`browser-07.json`).
4. 자기 fake DB의 app.db 파일만 임시 이름으로 옮겨 실제 `/api/backups`가 startup 실패로 503을 반환하게 했다. 확인 직후 finally에서 원복했다. 서버 코드나 응답을 mock하지 않았다.
5. read 오류와 작업 오류가 함께 표시되고, 마지막 목록·읽은 시각·입력값을 보존했다. 최초 outage 때 목록 1개, actual runner 후 두 번째 outage 때 목록 2개도 유지됐다(`browser-08.json`, `browser-12.json`).
6. DB 복구 후 상태 새로고침을 키보드로 실행하면 read 오류만 해제되고 작업 오류·입력은 유지됐다(`browser-10.json`).
7. **실제 `lib/jobs/runner.ts`의 `runNextJob`**을 신규 fake DB에서 1회 실행했다. queued backup을 실제 SQLite backup/ZIP 작성/검증까지 수행해 succeeded·restorable 및 worker heartbeat를 기록했다. ZIP 368752 bytes, SHA256 `f512742afba23bd30777eeeb8f0b7049d10aefa757ce2786ad38621c35b1050d`, manifest migration 10개. 독립 `verifyBackupArchive`도 통과했다(`actual-runner.json`).
8. 화면에서 검증 이력과 처리기 최근 응답 표시가 반영되는 것을 확인했다. 기존 작업 오류도 남아 있었다(`browser-11.json`).

상시 `worker/main.ts` 데몬을 켜거나 렌더·외부 AI 실행을 한 것은 아니다. 종료된 검수 DB에는 UI 점검용 두 번째 queued backup이 남아 있으며 서버/worker는 실행 중이지 않다.

## 화면·키보드와 경미한 UI 문제

로그인·가입·비밀번호 찾기·새 비밀번호·settings를 각각 실제 `innerWidth` 1280/390으로 확인했다. 10개 viewport 조합에서 문서 가로 넘침은 없었다. settings의 초기 측정 -15px는 세로 scrollbar 여유이며, 추가 측정 `scrollWidth-clientWidth`는 0이다.

PNG를 직접 열어 레이아웃을 확인했다. auth 입력·주요 버튼이 잘리지 않았고 settings 카드는 모바일에서 세로로 배치됐다. 다만 아래 상단 제목 축소는 별도 관찰이다. `settings-poll-failure-390.png`는 viewport 재설정 후 캡처하여 390 증거에서 제외한다. 실제 390을 캡처 전후 확인한 `settings-poll-failure-exact-390.png`를 사용한다.

- 빈 로그인 제출: 이메일로 focus, aria-invalid 2개.
- 로그인 탭에서 ArrowRight: 회원가입 선택 및 focus 이동.
- 가입 비밀번호 불일치: confirm focus 및 안내. 가입/reset의 가상 성공 안내 확인.
- 비밀번호 보기: 실제 input type=text. Tab으로 로그인 버튼 이동 후 Enter로 next=settings 진입.
- settings 백업 저장·상태 새로고침을 키보드로 실행. 백업 anchor Enter 후 hash=#backup, focusId=backup.
- 모바일 native dialog: 열면 ‘메뉴 닫기’ focus, Shift+Tab으로 마지막 ‘설정’ 링크, Tab으로 닫기 버튼 복귀, Escape 후 메뉴 열기 버튼 focus 복귀(`browser-11.json`). 초기 `browser-10`의 `[role=dialog]` 부재는 native dialog를 잘못 탐색한 관찰이며 접근성 실패로 판정하지 않았다.
- `browser-09`는 백업 anchor가 2개인 모호한 selector로 중단됐다. 상태를 확인하고 새 `browser-10`에서 정확한 accessible name으로 검증했다. 이 실행기 오류를 제품 실패로 세지 않았다.

**U185-1 · P3 · 390px 상단 제목 잘림:** 대기1·샘플 모드·로그아웃을 함께 표시하면 header ‘설정’의 텍스트 폭 24.20px에 비해 crumb 공간이 8.05px로 줄고 overflow:hidden 처리돼 ‘설’ 일부만 보인다. 본문 h1은 정상이며 기능 차단은 없다. 근거 `browser-12.json`, `settings-header-390.png`, `components/studio-shell.tsx:56`, `components/studio-shell.module.css:17`~18. 최소 제안은 좁은 화면에서 crumb 최소 공간을 보장하고 대기 표시를 줄이거나 다음 줄로 배치하는 것이다. 아직 수정하지 않았다.

## 실제 실행한 검사

모두 고정 격리본에서 실행했다. 제품/테스트 단언을 변경하거나 스킵을 추가하지 않았다.

| 명령 | 결과·근거 |
|---|---|
| `npm.cmd test -- tests/t182-auth.test.ts tests/t183-cloud-pending.test.ts tests/t180-a1-settings-data.test.ts tests/t180-a2-settings-overview.test.ts tests/maintenance-routes.test.ts` | exit0, 5파일 /57 PASS, focused-tests.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| `npm.cmd run build` | exit0, 운영 Next 빌드 및 verify-build 통과, build.log |
| 최초 `npm.cmd test` | exit1, 699 PASS /68 FAIL /23 skip; 검수용 DREAM_DATA_ROOT를 전체 시험에 전역 전달해 cwd 기반 격리 가정을 위반, full-tests.log |
| DREAM_DATA_ROOT 제거 후 `npm.cmd test` | **exit0, 72파일 PASS /3파일 skip, 767 PASS /23 skip**, 66.30초, full-tests-clean-env.log |
| `node --conditions=react-server --import tsx tmp/t185/actual-runner.mjs` | exit0, 위 실제 backup 실행·ZIP 검증, actual-runner.log/json |

전체 테스트에만 기존 ffmpeg/probe를 프로세스 환경 `FFMPEG_PATH`/`FFPROBE_PATH`로 읽었다. 공유 `.tools`를 변경·설치·복사하지 않았다. 23 skip은 기본 선택 조건이며 `DREAM_RENDER_E2E=1` 렌더 묶음 등을 이번 인증/settings 검수에서 활성화하지 않았다. 최초 전역 root 설정의 실패와 clean-env 재실행을 숨기지 않으며, 최종 성공 숫자가 F184 실패를 닫지 않는다.

## 미검증 및 다음 조건

실제 Supabase email confirmation·암호 정책·메일 수신/템플릿·발송 제한, 실제 사용자 계정/비밀번호 변경, 운영 HTTPS/cookie/배포 설정, 물리 휴대폰·스크린리더는 검증하지 않았다. 합성 token/recovery 성공은 실제 메일 링크 도착의 증거가 아니다. settings의 전체 복원 수명주기·실제 미디어 렌더·상시 worker 데몬도 이번 실행 범위 밖이다.

T186 수정 후에는 새 고정 snapshot에서 F184-1의 provider 호출 전 거부/쿠키 없음과 정상 JSON, F184-2의 global/local 종료·앱 네트워크 실패·재시도·정직한 안내를 집중 재검수해야 한다. Master의 후속 커밋 검사 결과를 a278e80의 PASS로 섞지 않는다.

## 기능 확장 추천 — 미구현 제안

1. P3: 재설정 메일 재요청 대기시간·처리 중 상태를 접근성 안내와 함께 표시. provider rate limit 대응과 중복 클릭 혼란 감소가 목적이다.
2. P3: 설정의 마지막 상태 읽은 시각 옆에 경과 시간과 ‘다시 읽기’를 제공해 오래된 상태를 쉽게 구분한다. 시작 점검 시각과 작업 상태 시각의 의미는 유지한다.
3. P3: 개인정보·경로·token을 제외한 진단 요약 복사 기능. 앱/스키마 버전과 오류 코드·관찰 시각을 지원 문의에 사용할 수 있게 한다.

## 정리·전달

ego TaskSpace21을 finish로 종료했다. 자기 harness PID78864/Next PID79380 및 43194/43195/43196 listener 종료를 확인했다. 공유 3013은 시작/종료 관찰 모두 PID51032로 유지됐으며 공유 `.next`를 대상으로 한 명령은 실행하지 않았다. 격리본·ZIP·증거는 보존했다. 자동 승인 거절은 이 검수에서 발생하지 않았고 거절 우회나 삭제 재시도는 없다.

중간 FAIL은 Master로 실제 전송 `msg_9791e9764a37`, Master 확인 `msg_62b714b2b9c4`를 수신했다. 최종 보고서는 후속 Orca 전송 영수증으로 전달 상태를 확정한다. 제품 push/deploy는 수행하지 않았다.

Master 복사용: T185 a278e80 고정 독립검수를 완료했습니다. 관련57·전체767/23skip·lint/type/build 및 실제 SDK/Next/API·화면·backup runner 검증을 수행했습니다. F184-1 외부 text/plain 로그인 세션생성과 F184-2 logout500/앱 네트워크 실패 후 성공안내·세션잔존을 재현해 제품 수용 FAIL입니다. settings 폴링503/복구와 작업 오류·입력 보존은 PASS이며 U185-1 모바일 header 제목 잘림은 P3 제안입니다. T186은 이 판정에 포함하지 않았으며 후속 고정 snapshot 집중 재검수가 필요합니다. 운영계정·메일·DB·3013 변경 없음, 자기 서버와 브라우저 종료, 증거 보존.
