# T-108 렌더 도구 준비·실제 검증 — CC-DATA-01 보고

- 지시: Master msg_32246b8cfd36 (+ msg_f078cee4627a, msg_c148958d0cb3 보완)
- 상태: ready_review (자체 검수, 독립 검수 아님)
- 지킨 것: 앱 DB·UI·worker·API·migrations·Composition 공유 파일 수정 없음. 실제 사용자 data·storage·backups 접근 없음. 렌더 기반 코드(T-105/109/111)와 커밋 분리.

## 1. 패키지
- `npm install --save-exact @remotion/renderer@4.0.543 @remotion/bundler@4.0.543`
  - package.json에 두 줄 추가. 이제 remotion 계열 직접 의존은 remotion·@remotion/player·renderer·bundler 네 개이고 모두 정확히 4.0.543이에요.
  - lock에 필요한 전이 의존 177개가 추가됐어요. 기존 패키지 버전 변경은 0이에요.
- npm 경고: esbuild 0.28.1 postinstall은 allowScripts 밖이라 실행되지 않았어요. 플랫폼 바이너리 @esbuild/win32-x64 0.28.1은 설치됐고, 번들은 그대로 동작해요(아래 smoke). allowScripts는 바꾸지 않았어요.
- npm audit의 moderate 7건은 기존 개발 의존(typescript-eslint→minimatch) 체인이에요. 새 패키지와는 관계없어요.
- 시험 `tests/p2-2-preview.test.ts` 패키지 기대값 수정: 정확히 네 개·4.0.543. 같은 내용으로 확인하는 것:
  - lock의 각 항목 version·license
  - 설치본 package.json
  - LICENSE.md 원문(LF 정규화) sha256 = T-108 대조값
  - 끄거나 범위를 넓혀 허용하지 않았어요.

## 2. 라이선스 대조 (판단 필요 사항 포함)
- remotion·@remotion/player·renderer·bundler: license "SEE LICENSE IN LICENSE.md". 네 파일 모두 같은 Remotion License 원문이에요(sha256 53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09).
  - 회사 사용은 조건에 따라 유료 라이선스가 필요할 수 있는 원문이에요. 사용 자격 판단은 은영님·Master 몫이에요.
  - 렌더 호출은 `licenseKey:null`로 해요. 사용 기록 전송은 없어요(아래 네트워크 0건).
- @remotion/compositor-win32-x64-msvc 4.0.543: license 필드와 LICENSE 파일이 없어요.
  - 들어 있는 ffmpeg는 n7.1이고 빌드 설정에 `--enable-gpl`·`--enable-libfdk-aac`·libx264가 있어요.
  - 해시: ffmpeg.exe 5d1aa370…, ffprobe 66468651…, remotion.exe 6a6e98cb…
  - 앱을 남에게 배포할 계획이 생기면 GPL·fdk-aac 조건 검토가 필요해요. 지금처럼 로컬 PC에서만 쓰면 배포가 아니에요.
- 함께 들어온 기타 라이선스: @remotion/effects UNLICENSED, @remotion/sdk·studio-protocol "Remotion License", mediabunny 계열 4개 MPL-2.0, esbuild 계열 MIT.

## 3. 고정 Headless Shell
- `scripts/remotion/browser-pin.json`: 버전 158.0.8127.2(renderer 4.0.543의 TESTED_VERSION), win64
  - 공식 출처: renderer가 win64에서 받는 주소와 같은 remotion.media의 chromium-headless-shell-win-x64-158.0.8127.2.zip
  - archive: 137,435,497B, sha256 58afb19b…0299a, 19개 항목, 풀면 317,670,418B
  - exe sha256 40fcceff…f652a7, `--version` = "Chromium 158.0.8127.2"
  - LICENSE.headless_shell sha256 cc6e35dc…3d18b
  - Google CfT에 같은 버전의 다른 archive(128,504,099B)가 있어요. 참고로만 기록하고 쓰지 않아요.
- `scripts/remotion/install-browser.ps1`
  - 덮어쓰지 않아요. staging에 푼 뒤 이름을 바꾸고, archive·exe·LICENSE 해시를 확인해요. `-ArchivePath`로 받아 둔 파일도 쓸 수 있어요.
  - 설치 위치: `.tools/remotion-browser/158.0.8127.2`(git 제외)
  - 실제 실행: 첫 설치 약 9초. 다시 실행하면 확인만 해요("already installed and verified", 증거 `tmp/t108-evidence/install-verify.log`).

## 4. smoke 실제 검증 (`scripts/remotion/smoke.mjs`, 증거 `tmp/t108-evidence/`)
- 방식
  - OS 임시 폴더에 최소 composition을 쓰고 @remotion/bundler로 묶어요(앱 Composition 재사용 없음).
  - 고정 브라우저 경로를 명시하고, `chromeMode:"headless-shell"`, `licenseKey:null`, `concurrency:1`, `muted:true`, h264, yuv420p, `colorSpace:"bt709"`로 렌더해요.
  - 앱 `.tools/ffmpeg/ffprobe.exe`로 확인해요.
- 마지막 실행: exit 0, 29초에 **스스로 종료**(시간 제한에 걸리지 않음), `ok:true`

| 비율 | 크기 | 확인 결과 |
|---|---|---|
| 9:16 | 1080x1920 | h264 · yuv420p · tv · bt709 · 30/1 · 45프레임 · 1.5초 · 오디오 0 · 기타 스트림 0 |
| 16:9 | 1920x1080 | 같음 |
| 1:1 | 1080x1080 | 같음 |

- 취소: 900프레임 렌더를 5%에서 취소했어요. 진행 중 브라우저·compositor 프로세스 6개였고, 취소 뒤에는 프로세스 0·열린 서버 0·출력 파일 없음·임시 조각 없음이에요.
- 실패: 10프레임에서 오류를 내는 composition → "T-108 planned failure"로 거부되고, 프로세스 0·서버 0·출력 없음이에요.
- 브라우저 없음
  - 사전 확인이 `RENDER_BROWSER_MISSING`을 먼저 내요.
  - 같은 경로로 Remotion `openBrowser`를 부르면 바로 명확한 오류가 나요. 다운로드 시도 0, 프로세스 0, 남은 서버 0이에요.
- 자동 다운로드 0: `onBrowserDownload`가 불리면 실패로 처리하는데, 한 번도 불리지 않았어요. `node_modules/.remotion` 캐시도 생기지 않았어요.
- 외부 연결 0
  - Node 연결 가드(루프백 외 거부·기록): 0건
  - 브라우저·compositor 프로세스 TCP 표본 10회: 루프백 외 0건
- 끝난 뒤 남은 고정 브라우저·compositor 프로세스 0, 열린 서버 0, 임시 폴더 삭제 확인

## 5. 멈춤 원인 (이전 600초 넘는 멈춤)
- bundle은 원인이 아니었어요. 약 5초에 끝나요.
- 진짜 원인: 브라우저가 없는 경로로 `selectComposition`을 부른 뒤 Remotion이 연 TCP 파일 서버가 닫히지 않아서 Node가 끝나지 않았어요.
  - `selectComposition`은 브라우저 시작과 파일 서버 시작을 `Promise.all`로 함께 해요. 브라우저 실패로 먼저 거부되면, 늦게 준비된 서버의 정리가 다시 실행되지 않는 목록에만 들어가요(`dist/select-composition.js` 105~134행).
  - 분리 재현(`tmp/t108-evidence/leak-repro.mjs`, 자기 PID로만 실행하고 스스로 종료): 실제 bundle을 쓰면 거부 2초·5초 뒤에도 서버 1개가 남아요. 빈 폴더를 쓰면 0개예요.
- 해결(smoke에 적용, worker도 따라야 할 규칙)
  1. Remotion을 부르기 전에 고정 브라우저 파일 존재와 sha256을 확인해요. 없으면 `RENDER_BROWSER_MISSING`, 다르면 `RENDER_BROWSER_MISMATCH`로 Remotion 호출 없이 멈춰요.
  2. 브라우저 시작 실패를 확인할 때는 파일 서버를 열지 않는 `openBrowser`를 써요.
- 이전 실행에서 남은 임시 다운로드 폴더(434MB)는 내 것임을 확인하고 지웠어요. 남은 프로세스는 없었어요.

## 6. worker 담당에게 넘길 결정 사항 (이번에 앱 코드는 바꾸지 않음)
- `colorSpace:"bt709"`를 반드시 지정해요. 4.0.543 기본값("default")은 JPEG 프레임을 full range로 넣어 `yuvj420p`가 나와요. 처음 smoke에서 세 비율이 모두 이 이유로 실패했어요.
- 브라우저는 항상 고정 경로를 명시하고(null 금지 = 자동 다운로드 금지), 위 사전 확인을 먼저 해요.
- `licenseKey:null`, `concurrency:1`, `muted:true`
- 취소는 `makeCancelSignal`로 해요. 취소·실패 뒤 프로세스와 서버가 남지 않음을 확인했어요.

## 7. 바꾼 파일
- `package.json`, `package-lock.json`
- 새 `scripts/remotion/browser-pin.json`, `install-browser.ps1`, `smoke.mjs`
- `tests/p2-2-preview.test.ts`(패키지 기대값)
- 이 보고서

## 8. 검증
- 전체 vitest 43파일 501 통과 + 4 건너뜀(관련 `tests/p2-2-preview.test.ts` 13개 포함)
- 운영 빌드는 다시 돌리지 않았어요. app·components·lib·worker 어디에도 renderer·bundler import가 없어(0건) 빌드 입력이 바뀌지 않아요. worker 연결 작업 때 빌드로 확인해요.
- tsc·lint 통과(smoke의 타이머는 `node:timers/promises` 사용)
- smoke `ok:true`, exit 0, 29초에 스스로 종료
- 비밀·경로 검사: 스크립트·증거에 PC 경로·이메일 0
