# T173 · 저장 화면비 배치와 native hidden 잔여 검증

| 항목 | 내용 |
|---|---|
| 담당 / 배정 | Codex design CX-DESIGN-01 / Master `msg_16a046ab5956`, 수락 `msg_a4e32ac9b1d0` |
| 날짜 / 기준 | 2026-11-17 Asia/Seoul / **44b036a018e018fd4d5120f0e74d79437084850f** 고정 사본 |
| 판정 | **G6 저장16:9·1:1 배치: 아래 가상 행렬 범위 PASS. G4 native hidden: 환경 제약으로 미검증 유지** |
| 수정 범위 | 이 고유 보고서만. 제품/CSS·공용 문서·사용자DB·3013·설치 도구 변경 없음 |

## 1. 검증 환경과 저장본 구분

T171 G4/G6에 대한 독립 실행 증거를 수집했다. 해당 화면 구현은 이번 작업에서 고치지 않았다. 과거 UI 구현 참여 이력(T147/T164)과 별도로, 이번 대상 Player/글자/오디오 편집기에는 변경하지 않았다.

- `git archive 44b036a` → **D:/starwork/t173-isolated-app**. node_modules는 기존 설치본 junction, app 소스는 고정 archive다. 새 패키지/브라우저를 설치하지 않았다.
- runtime: 사본 `tmp/t173/runtime`. 고정 s9 ZIP을 검증 추출하고 **가짜 사본에서만 9→10 승격**했다. 검증 준비에서 project.aspect와 inputs.aspect를 함께 설정하고 timelineService.save로 같은 aspect의 v2 저장본을 만들었다. 사용자DB를 복사·이관하지 않았다.
- 동일 가짜 프로젝트를 순차적으로 16:9→1:1 저장본으로 준비했다. 글자2개(제목/자막), 영상120프레임, 기존 합성 voice/music2clip을 사용했다. 애니메이션은 none, 기본 글꼴/스타일·위치를 유지했다.
- **UI의 비율 버튼을 눌러 만든 증거가 아니다.** 저장된 project/timeline/input의 aspect, DB revision, 미리보기 stage의 aria-label/실제 비율을 각각 대조했다. 두 비율 모두 “미리보기 비율 … · 저장 안 됨” 배지가 없었다.
- 실제 Next webpack dev `127.0.0.1:3173`, ego-browser v2.2.1 TaskSpace33. 공유3013/공유 `.next`를 사용하지 않았다.
- FFmpeg/ffprobe와 pinned Headless Shell158.0.8127.2는 사본 `.tools`에 **물리 복사**해 실행했다. 설치본과 도구 핀은 수정하지 않았다.

## 2. G6 — 실제 글자 편집·저장·미리보기

16:9는1280에서 제목을 **“16:9 저장 배치 확인”**으로 고치고 실제 저장 버튼을 Enter로 실행했다. 1:1은390에서 **“1:1 모바일 저장 확인”**으로 고치고 같은 실제 저장을 실행했다. 두 POST `/timeline` 응답은200이고 실제 DB에 다음 새 저장본이 남았다. viewport를 바꿔도 이 저장본으로 확인했다.

| 저장 aspect | UI 저장 결과 | 실제 stage(1280) | 실제 stage(390) | 안전영역/글자/소리 |
|---|---|---|---|---|
| 16:9 | timeline r5 / content r9 | 360×202.5 | 301×169.3125 | 안전영역 각5%, 제목·자막 둘 다 안쪽, audio card 있음 |
| 1:1 | timeline r7 / content r11 | 360×360 | 301×301 | 안전영역 각5%, 제목·자막 둘 다 안쪽, audio card 있음 |

**4개 aspect/viewport 조합 모두** page 가로 넘침0, audio card의 visible 조작 최소44px, 이름 없는 조작0이었다. 390에서는 원본 듣기·소리/권리 요약이 보이고, 정밀 소리 편집은PC 안내로 남는다. 실제 휴대폰 검증으로 세지 않는다.

Player를 키보드 Home→Shift+ArrowRight로 **frame30(1초)**에 맞춰 제목/자막의 실제 DOM body bounds와 `[data-safe-line]`을 측정했다. 두 폭에서 정규화 위치/크기는 반올림 수준만 달랐다. 안전선은 left/top 약0.05, width/height 약0.90이었다.

| aspect | 제목 body(x,y,w,h), 영상 크기 기준 | 자막 body(x,y,w,h) |
|---|---|---|
| 16:9 | (0.321505, 0.371108, 0.356991, 0.097772) | (0.387927, 0.686292, 0.224137, 0.067405) |
| 1:1 | (0.181178, 0.371108, 0.637630, 0.097772) | (0.321962, 0.686292, 0.356076, 0.067405) |

기본 Pretendard를 읽은 상태에서 측정했고, 단계/글자 오류 alert는 없었다. 1:1 PC 초안의 제목 y를98%로 옮기는 음성 대조에서 **“화면 가장자리(5%)에 너무 붙어 있어요”** inspector 경고가 나타났다. 다시42%로 돌리자 미저장 변경이 없어졌으며 이 대조는 저장하지 않았다. 같은 순간 Player 경고 문구는 false로 관찰됐으나 effect 완료까지 따로 대기/재현하지 않았으므로 별도 Player 결함 판정이나 경고 PASS로 쓰지 않는다.

시각 확인한 캡처(저장소 루트 기준, 비버전 로컬 증거):

- `tmp/t173-review/wide-preview-1280.png`, `wide-preview-390.png`
- `tmp/t173-review/square-preview-1280.png`, `square-preview-390.png`
- `tmp/t173-review/{wide,square}-audio-{1280,390}.png`

PC 가로 화면과 모바일 정사각 화면, 모바일 소리 카드, 아래 실제 render frame PNG를 직접 열어 배치·가독성·줄바꿈을 확인했다. 저장 비율에 따른 글자 잘림·비율 혼동·audio card 넘침의 새 필수 결함은 이 행렬에서 발견하지 못했다. 임의 문구/크기/회전/글꼴 전체 배치의 보장은 아니다.

## 3. 두 저장본의 실제 AAC 렌더

각 UI 저장 뒤 실제 rendersService.request→runNextJob→소유 child Remotion/DSP→검사→게시를 실행했다. stand-in 영상이나 화면 비율만 바꾼 기존 MP4가 아니다. **두 결과 모두 H.264 yuv420p·30fps·120프레임·4초·소리1트랙·verify passed**이며 음량 normalized/accepted true, 실제 I=-14.0 LUFS/TP=-11.5 dBTP/LRA0.1이다. 청취 검수는 하지 않았다.

| 저장 aspect / 크기 | bytes | MP4 SHA256 |
|---|---:|---|
| 16:9 / 1920×1080 | 153,024 | `8daa592691e1dc3d6582bb08c84e1ada0cde2451194d8e9ad440715f9864b644` |
| 1:1 / 1080×1080 | 143,036 | `257a34dae3bd91bb9c71f5327f3364bfa980e385aa0189299cb29949d166157b` |

input_json의 timeline aspect와 새 문구가 실제 DB 저장본과 같고, 복사한 MP4 SHA가 게시 행의 SHA와 같다. 영상/음원의 원본 바이트를 다시 만들거나 고치지 않고 기존 가상 s9 자료를 썼다.

각 결과를 사본 FFmpeg로1초에서 추출했다: `tmp/t173-review/wide-render-1s.png`, `square-render-1s.png`. 흰 glyph(RGB각>220)을 화면 상단60%/하단40%로 나눠 읽은 bbox는 다음과 같고 모두5% 안쪽이었다. 이는 **이 단색 시험 frame의 실제 픽셀 확인**이며 타이밍 측정기·일반 안전영역 검출기가 아니다. DOM body와 glyph의 범위 정의도 다르다.

| aspect | 제목 glyph left/top/right/bottom | 자막 glyph left/top/right/bottom |
|---|---|---|
| 16:9 | 622/414/1297/492 | 748/752/1173/801 |
| 1:1 | 200/414/879/492 | 351/752/731/801 |

재현: 사본에서 `node --conditions=react-server --import tsx tmp/t173/runtime.ts init`(wide), `… aspect square`, 각 UI 저장 뒤 `… render`. `runtime.ts`/Browser round*.mjs/분석 `analyze.mjs`는 이 작업에서 작성한 로컬 증거다. raw record/input/verify는 `{wide,square}-render.json`, 요약은 `render-summary.json`, MP4는 `{wide,square}-render.mp4`에 남겼다. 초기 준비 스크립트의 animation.easing 누락은 스키마가 거절했고 preset 값을 보존하도록 준비 스크립트만 고쳤다. 첫 wide 렌더는 성공했으나 결과를 result.id로 읽은 수집기 오류가 있어 실제 renderId로 다시 읽어 캡처했다. 실패한 준비/수집기를 제품 통과로 세지 않았다.

## 4. G4 — 실제 탭 전환에도 native hidden이 만들어지지 않음

합성 `visibilitychange`, document.hidden/visibilityState override, lifecycle emulation은 **사용하지 않았다**. 사용자 브라우저를 가져오거나 다른 창을 가리거나 새 도구를 설치하지 않았다. 사용한 것은 TaskSpace33의 소유 p1/p2뿐이다.

1. p1에서 기존 **원본 듣기**를 열고 snapshot에서 관찰한 native audio 재생 버튼을 Enter로 눌렀다. Player도 Home→Space로 시작했다.
2. 읽기 진단용 visibilitychange/audio play/pause/ended 관찰기를 붙였다. visibilitychange가 발생하면 isTrusted와 실제 state를 기록하도록 했으며 이벤트를 발생시키지 않았다.
3. task.newPage로 p2를 만들고 소유 data 페이지로 이동했다. 실제 tabs 결과는 p1 active=false, p2 active=true였다.

| 관찰 | 전환 전 p1 | p2 활성 후 p1(약179ms 뒤) |
|---|---|---|
| visibilityState / hidden | visible / false | **visible / false** |
| 원본 audio | paused=false, currentTime0 | paused=false, currentTime0.116913 |
| visibilitychange 기록 | 없음 | **없음** |

`native-visibility.json`이 원문이다. 나중의 audio pause는 **4초 끝(ended=true)**에서 발생했고 state는 여전히 visible이었다(`square-safe-negative.json`의 추가 이벤트). 이를 탭 숨김 멈춤으로 인정하지 않는다. 원본 듣기를 닫는 실제 버튼은 마지막에 실행했다.

이 세션의 Ego 소유 탭 전환은 p1의 native hidden 조건을 만들지 못했다. 따라서 **G4는 PASS도 제품 FAIL도 아니다. 미검증 유지**다. 코드에는 Player(`player-panel.tsx:81`)와 원본audio(`audio-editor.tsx:227`)의 hidden→pause listener가 있지만 코드 존재를 실제 실행 증거로 바꾸지 않는다. 합성 이벤트로 대체하지 않았다.

## 5. 보호·정리·남은 범위

전체시험/lint/type/build는 제품 변경 없는 잔여 실행검증이라 반복하지 않았다. 실제 저장2회·렌더2회·4개 viewport 행렬·음성 대조1회·native 탭 전환1회의 직접 결과를 위처럼 구분한다. 렌더는 정상 검증 경로를 완화하지 않았다. 새 필수 제품 수정은 제안하지 않는다.

- TaskSpace33은 finish keep[]로 종료, 소유3173 dev exec만 중지했다. 종료 시3173 listener 없음, 공유3013 PID55956 유지.
- 공유 `.next/dev/lock`의 시작/종료 시각·길이: 2026-11-17 09:31:32 / 107바이트 동일. `.next` 전체 바이트 동등을 측정했다는 뜻은 아니다.
- 기존 next-env.d.ts WIP의 시작/종료 SHA256은 `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`로 같고 그대로 남겼다. T122/T137 미추적 보고서도 보존했다.
- 설치 도구 SHA는 시작/종료 일치: FFmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`, pinned browser exe `40fcceffa39380a1188ead560d9dea125d1075284ad56448be0c1282e4f652a7`(사본 checkBrowser fresh도 같음).
- 사본/가짜 DB/물리 도구 사본/증거는 유지한다. recursive delete를 요청하거나 정리 정책 거절을 우회하지 않았다. 서버/탭 종료와 디스크 정리 완료를 혼동하지 않는다.
- 실제 브라우저 로그에 image EncodingError가 로드/저장 직후 일시적으로 나왔으나 최종 PNG와 두 렌더는 정상 그림/글자를 표시했다. 지속 실패를 재현하지 못했으므로 로그만으로 별도 제품 결함을 단정하지 않았다.

**미검증:** native hidden 자동 멈춤, 실제 휴대폰·스크린리더·음질/스피커 청취·native unload·200%·일반 사용자 프로젝트. 390은 에뮬레이션이다. 두4초 합성 렌더를 전체 P2/모든 배치/배포 완료로 확대하지 않는다. G6의 이 좁은 잔여는 위 증거로 닫는 것을 제안하며 G4와 사람 확인 항목은 남겨야 한다.

복사용 전달 메시지: T173 보고서만 반환합니다. 고정44b036a 격리 실제3173앱+가짜s9→10에서 저장16:9(content9/timeline5)·1:1(content11/timeline7)의 실제 문구편집/POST200 저장,1280/390 네조합 safe5%/두글자안쪽/overflow0/audio44px·이름누락0을 확인했습니다. 두 저장본 실제AAC렌더(1920×1080/1080×1080,4초120f,verifyPASS,I-14/TP-11.5)와1초frame캡처/실제glyph안전범위도 확인했습니다. G6는 이 행렬 boundedPASS 제안. p2활성/p1비활성이어도 p1 visible/hiddenfalse·visibilitychange0/audio계속이어서 G4는미검증유지,합성event대체없음. 제품수정없음/새필수결함없음. 원본/도구/next-envWIP/3013·공유.next보호,33번space종료/3173중지,사본·증거보존. 실제phone/screenreader/청취 미실행·전체제품완료아님.
