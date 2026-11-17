# T164 · 재편집 ZIP 소리 원본 안내 UI

| 항목 | 내용 |
|---|---|
| 담당 / 상태 | Codex design · CX-DESIGN-01 / **ready_review**, 구현자 자체검증. 독립검수·전체 제품 완료 아님 |
| 배정 | Master `msg_333fe77eee6b`, 수락 `msg_6fa3e809fa9a` |
| 기준 | 시작 `28dfaf472fa8851b55969051129cbdefa9613607`, T162 `df62033` 보고서5장 실제 preview DTO, T154 S4 |
| 수정 | `components/exports-panel.tsx`, 전용 `exports-panel.module.css`, `tests/t164-export-ui.test.ts`, 이 보고서만 |
| 제외 | export 서비스/writer·공유 helper·schema·DB/migration·render·Player·편집·T125·공용 문서·사용자DB·배포 |

## 최종 동작

실제 `preview.manifestVersion/audioBlocked/backupGrowthBytes/audio[]`를 기존 내보내기 화면에 연결했다. 페이지가 이미 readExports 전체 DTO를 넘기므로 페이지/서비스 수정은 필요하지 않았다.

- 원본별 실제 이름·목소리/배경 음악/효과음·clip 수·기록된 크기, 샘플·보관·권리 기록 여부를 표시한다. 같은 원본 여러 clip은 한 파일로 담고, trim/gain/fade/join은 설정 자료로 남는다고 설명한다. sizeBytes가 null이면 **원본 크기 기록 없음**이다.
- 권리 기록 있음은 사용권 확인이 아니다. 미기록 원본에는 직접 확인 필요를 표시한다. audioBlocked의 실제 problem.message를 안전한 문장으로 표시하며, 민감한 문자열이면 reason별 일반 문장으로 대체한다. 편집의 원본·사용 구간 확인 링크를 제공한다.
- audioBlocked면 현재 묶음 생성과 실패 행의 **새로 만들기**를 같은 이유로 막는다. 기획/검수 게이트·미리보기 준비·저장본·stale/오류·장면 누락도 기존 서버 계약에 맞춰 안내한다. 저장 실패의 기존 retry API/판정은 유지한다. 읽기 뒤 파일이 바뀌어 요청이 거절되는 경우 기존 error 응답 문장을 alert로 표시한다. 새 API code를 가정하지 않는다.
- 예상 ZIP 크기와 **DTO의 백업 증가량**을 별도로 보여 준다. 큰 원본의 예상치 정확도/작성 시간은 미확인이고 실제 ZIP 크기는 생성 뒤 표시한다고 적었다. 원본 크기 기록과 실제 측정치를 혼동하지 않는다.
- ZIP에는 원본·편집 설정이 있으며 합친 소리·완성 MP4·실행 앱이 없고, 앱에 ZIP import 기능도 없음을 설명한다. 다른 도구의 수동 편집/소리 재현 한계, 앱의 백업·복원과의 차이, 미저장 변경 제외와 최종/게시 게이트 유지를 안내한다.
- manifest1은 소리 원본 미포함과 예전 소리 기록의 한계를 표시한다. 과거 행에 현재 preview의 소리/형식을 덧씌우지 않는다. 과거 자료·샘플·실패/재시도·파일 없음·다운로드는 기존 DTO로 유지한다.
- available은 파일 존재일 뿐 현재 무결성 PASS가 아니다. 기존 ZIP 해시는 **만들 때 기록한 ZIP 해시**로 이름을 바꾸고 현재 재검사가 아니라고 설명한다. 새 소리 원본의 sha/client hash·PC 저장 경로는 추가 노출하지 않는다. 파일 목록은 ZIP 내부 상대경로만 표시한다.
- 폴더 요약에서 소리 문제를 장면 파일 없음으로 잘못 세지 않도록 분리했다. 파일별 table에 제목/열 이름을 붙이고 긴 ZIP 이름을 줄바꿈한다. 전용CSS에서 button/link/summary 44px와 summary 초점 표시를 보장한다. 기존 토큰만 사용한다.

## 검증 사본과 실행 기준

공유 `.next`/3013을 쓰지 않았다. `git archive 28dfaf4`를 **D:/starwork/t164-isolated-app**에 풀고 T164 두 제품파일/시험을 복사했다. node_modules는 동일 설치본의 읽기 목적 junction이다. runtime은 이 사본의 `tmp/t164/runtime`이며 고정 s9 ZIP을 검증 추출하고 **사본에서만 9→10 승격**, 가짜 장면 확인/검수 승인을 설정했다. 실제 사용자 자료/DB/키/환경 파일을 복사하지 않았다.

초기 타입 검사에 기존 `tests/t162-audio-bundle.test.ts:163` TS2352가 나왔다. Master `msg_21f1b18de58a`, `msg_54b25d49882c`에 따라 **T165 `7ef3b7c`의 해당 시험1파일만** 고정 사본에 반영했다. git 정규화 blob은 양쪽 `ae1231df6df5d9b78ec4e9b2eb9b5eaf81616129`로 같았다. 그 외 HEAD/WIP를 덮어쓰지 않았다. 초기 실패는 그대로 보존하고 원인을 확정하지 않는다. Master의 별도 원판 통과와 이 사본의 초기 실패를 서로 대체하지 않는다.

- Node v26.13.0, TypeScript **6.0.3**, Next16.4.6.
- package-lock SHA256(공유/사본 동일): `7d619f2d366052f1ed28b02245292593fb32491f2920e40f9b038daba8c6b2fc`.
- 최종 사본 기준은 **28dfaf4 + T165 시험1파일 + T164 UI/시험**이다. 병행 T163/T166 writer 검수/수정은 이 검증에 섞지 않았다. 특히 T166 `4838017` 서비스 변경은 사본에 가져오지 않았으며 별도 통합검수가 필요하다.

| 실행 명령(격리 사본 cwd) | 실제 결과 |
|---|---|
| `npm.cmd exec vitest run -- tests/t164-export-ui.test.ts tests/t162-audio-bundle.test.ts tests/scene-export-info.test.ts tests/ui-errors.test.ts` | 최종 **29 PASS / 3파일**. ui-errors는 해당 glob 이름의 파일이 없어 추가 집계하지 않음. 새 UI시험7개 포함 |
| `npm.cmd test` | 도구 복사 뒤 **697 PASS / 19 skip / 64파일 통과·2파일 skip**, 약64초. 이때 새 UI시험6개였음. 이후 null 크기 회귀1개 추가 후 위 관련29를 실행. 합성698을 전체실행 결과로 쓰지 않음 |
| `npm.cmd run typecheck` | T165 시험1파일 반영 후, 최종 새 UI시험7개 포함 exit0 (`next typegen && tsc --noEmit`) |
| `npm.cmd run lint` | 최종 exit0 |
| `node node_modules/next/dist/bin/next build --webpack` → 성공 시 `node scripts/verify-build.mjs` | **둘 다 exit0**, 사본의 `.next`만 사용. 운영 추적물에 로컬 데이터/비밀/도구 없음 |
| `git diff --check` | exit0 |

첫 전체시험은 사본에 FFmpeg가 없어 **636 PASS / 20 FAIL / 60 skip, 실패suite4 포함**으로 실패했다. ENOENT와 그 뒤따른 미생성 데이터 접근 실패가 있었으며 이를 제품 통과로 세지 않았다. 설치본을 수정하지 않고 사본 `.tools/ffmpeg/`에 두 exe를 **물리 복사**한 뒤 위 전체시험을 다시 실행했다. 새 download 확인 스크립트의 첫 SQL은 존재하지 않는 size_bytes 열을 읽어 실패했고, 실제 export.file_path의 바이트와 행 sha256을 읽도록 검증 스크립트만 바로잡았다.

설치본/사본의 일치 해시를 확인했고, 설치본은 전체시험 후에도 같다.

| 도구 | SHA256 |
|---|---|
| FFmpeg | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec` |
| ffprobe | `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52` |

## 실제 브라우저와 가짜 DB 확인

ego-browser TaskSpace31, **실제 Next 앱(webpack dev, 127.0.0.1:3164)**을 사용했다. 제품 컴포넌트/라우트/API/service가 실제 가짜 DB를 읽었으며 UI mock 응답이나 상태 DTO 주입 페이지가 아니다. 상태는 사본 DB/합성 원본에만 만들어 `tmp/t164/scenario.ts`로 기록했다. SSR 자동시험의 preview-not-ready/민감 오류 문자열 대조만 명시적 주입이며 실제 writer 증거와 구분한다.

1280/390 × 정상v2·누락·샘플/보관/다중역할/권리없음·실제생성성공·v1·검수미승인·저장본없음·원본변경실패·저장실패·재시도성공·문제중재생성차단 = **22조합**. 전 조합 page 가로 넘침0, export panel visible button/link/summary 최소44px, 이름 없는 조작0. 파일 목록을 펼친 두 폭에서도 넘침0. 정상 소리 목록의 desktop/mobile PNG와 샘플/보관/mobile PNG를 실제로 열어 확인했다.

- Enter로 파일 이름 details 열기/닫기, 다음 Tab으로 현재 생성 버튼 초점 이동. Enter로 실제 생성/재시도 요청했다. screen reader/실제폰/200%는 미확인이다.
- UI에서 flags v2 묶음 요청 POST202 → 실제 runNextJob 성공 → 실제 다운로드 링크로 ZIP을 저장했다. 소리2원본(한 원본은 목소리+효과음2clip, 샘플/보관/권리없음)을 포함한 **manifest2**다. 다운로드는 저장 파일과 바이트 전체가 같고 행sha와 일치한다: **2,847,737바이트**, SHA256 `be1cd82743d5ca693dc68ca38f652bf6af445da7c1d190c89ae1f4bfe170b145`. `audio/`2파일과 audio_sources.json 있음, MP4 없음. 이는 이 가짜 한 건의 자체확인이며 T163/T166 전체 writer 판정이 아니다.
- 같은 크기 바이트변경을 만든 실제 작업은 EXPORT_INVALID·retry불가 실패로 표시했다. 원본을 되돌린 뒤에도 실패기록은 남고 새로 만들기가 제공됐다. 원본을 다시 누락시키면 새 생성과 해당 재생성이 모두 차단됐다.
- 내보내기 저장 폴더를 사본에서 막아 실제 STORAGE_FAILED 작업을 만들었다. 막힌 것을 푼 뒤 UI의 “다시 시도” PATCH200 → 같은 작업의 실제 성공을 확인했다. 기존 오래된 실패/취소/성공 묶음은 함께 남았다.
- 정상 화면 로드 뒤 원본을 옮기고 생성 버튼을 눌러 서버 POST409를 직접 받았다. 소리 이름과 찾을 수 없다는 실제 문장이 alert에 표시됐고 새로고침 후 audioBlocked로 생성/재생성이 막혔다. 민감한 PC 경로·원본 해시는 UI에 나오지 않았다.
- v1 전환은 저장 API의 실제 timelineService.save로 했으며 소리 원본0/manifest1을 표시했다. 검수 상태를 needs_approval로 둔 가짜 DB는 canCreate=false, current timeline 포인터를 없앤 대조군은 editSaved=false를 표시했다. 이는 **저장본 부재** 대조이며 다른 창의 미저장 초안을 감지했다고 주장하지 않는다. 다른 창 초안은 포함되지 않는다는 안내만 제공한다.

브라우저 첫 대기는 같은 텍스트가 span/h3에 모두 있어 중단됐다. 같은 TaskSpace에서 snapshot으로 확인하고 명확한 selector를 사용했다. 초기 clip screenshot은 viewport 밖을 흰색으로 캡처해 시각 증거에서 제외했고, 소리 영역으로 실제 스크롤한 viewport 캡처를 새로 확인했다. 가짜 DB 준비 스크립트에서 승인 중복 호출/잘못된 stage 상태/작업 clock 선행 문제를 수정했다. 이 준비 실패를 제품 실패나 통과 횟수로 세지 않았다.

## 증거·보호·다음 단계

로컬 비버전 증거: `tmp/t164-ui/`의 `*-audit.json`(22조합), `keyboard.json`, `request-error.json`, `download-audit.json`, `browser-source-audio.zip`, `normal-audio-{1280,390}.png`, `flags-390.png`, `missing-390.png`, round*.mjs. 재현 준비 스크립트/가짜 DB는 격리 사본 `tmp/t164/`에 남겼다. 기존 T122/T137 미추적 파일과 병행 writer 작업은 건드리지 않았다.

TaskSpace31은 finish keep[]로 종료했고 소유한3164 dev exec 세션만 중지했다. 종료 확인 시3164 listener 없음, 공유3013 PID37252는 그대로 실행 중이었다. 공유 `.next/dev/lock`의 시각/길이는 시작·종료 모두 2026-11-16 00:48:33/107바이트였다. 공유 `.next` 전체 바이트 동등을 측정했다는 주장은 아니다. 사본/증거는 보존했으며 정리완료라고 하지 않는다.

Master께 UI 자체검증 결과를 반환한다. T166 writer 수정의 독립 검수/통합 뒤 **그 기준에서 이 UI도 별도로 재검수**해야 한다. 실제폰·스크린리더·큰 원본 예상치/시간·다른 편집기 재현·백업증가 실측·전체 P2/최종 배포는 이번 완료 주장이 아니다. 제품 게이트 변경·사용자 추가 승인 대기는 없다.

복사용 전달 메시지: T164 S4 UI ready_review 반환합니다. export 컴포넌트/CSS·고유 UI시험·보고서만 변경했습니다. 실제 preview의 원본명/역할/clip수/샘플·보관·권리기록/문제/형식/예상ZIP·백업증가를 연결하고 audioBlocked 생성·재생성 차단, 원본/설정 ZIP·수동편집/import없음·백업복원 구분·권리와무결성 오인 방지·기존게이트를 유지했습니다. 격리 실제 Next3164+가짜s9→10 DB에서 22조합(1280/390) overflow0/44px/이름누락0, 실제 요청·ZIP다운로드·원본변경실패·저장실패UI재시도→성공·POST409를 자체확인했습니다. 관련29·전체697/19skip(이후추가1개는관련시험)·최종lint/type·webpack운영build 통과. 초기TS2352는원인미확정으로기록, T165 7ef3b7c 시험1파일만사본반영. 설치tools·사용자DB·3013/공유.next 보호. T166서비스는미반영이므로writer독립검수/통합뒤UI별도검수부탁드립니다. 전체제품완료/배포아님.
