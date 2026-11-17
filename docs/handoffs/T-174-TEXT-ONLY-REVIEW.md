# T-174 소리·자막 text-only 재렌더 독립 검수

- 판정: **bounded PASS**. T172의 새 opt-in 원본 시험 4개를 독립 실행해 통과했다. 새 제품 결함은 발견하지 않았다. 샘플 음량 보고값의 0.1 dB 차이는 아래에 별도 기록한다.
- 검수 대상: `86e00fd6f582784149adf0ed4c36cdb9dbfdda4d`, T-172 보고서 전문과 새 `tests/t172-text-only-rerender-e2e.test.ts`. 해당 커밋은 보고서·시험만 추가하며 제품 코드 변경이 없다.
- 작성자의 자체 검수 결과와 이번 실행은 별개다. T173 화면 검수, 전체 P2, 휴대폰·청취 완료 판정은 포함하지 않는다. 수정 파일은 이 보고서 하나뿐이다.

## 고정 소스와 격리

`git archive 86e00fd`를 OS temp의 `t174-render-46edc5aa71d34b4e889d6d67b68b3daf/app`에 풀었다. 원본 시험의 Git blob `db2d171d9dae1771c5470eb91650c4cbb610cbfd`와 사본의 `git hash-object --path`가 동일하다. PowerShell 기본 문자 표시의 깨짐은 UTF-8 Node 읽기로 확인했고 소스를 고치지 않았다.

의존성과 FFmpeg/FFprobe, pinned browser는 `D:/starwork/dream-ai-studio`의 설치본을 **물리 복사**했다. node_modules는 junction이 아니다. 설치·다운로드·도구 파일 수정은 하지 않았다. 설치본 실행 파일의 전후 SHA-256은 동일하다.

| 도구 | SHA-256 |
|---|---|
| ffmpeg.exe | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec` |
| ffprobe.exe | `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52` |
| pinned browser 158.0.8127.2 | `40fcceffa39380a1188ead560d9dea125d1075284ad56448be0c1282e4f652a7` |

고정 s9 ZIP은 사본 내 fixture에서 읽기만 했다. 실제 시험이 별도 `dream-t172-e2e-*`에 백업을 검증·복원하고 journal 1–9를 확인한 뒤 10으로 migration했다. 그 fake DB의 기존 queued/running 작업만 실패 처리해 렌더 작업의 선점을 막는다. 사용자 DB, 원본 fixture, 공용 `.next`, 사용자 3013 서버를 실행 대상으로 삼지 않았다. 전후 3013 listener는 PID 55956으로 동일했다. Next 서버를 새로 띄우지 않았으며 Remotion의 소유 자식·로컬 파일 제공 경로만 사용했다.

`D:/starwork/dream-ai-studio/tmp/p2-review/samples`의 원본 15개를 이름·크기·SHA-256으로 전후 대조해 모두 동일함을 확인했다. 작성자 MP4/JSON을 읽기 전용 분석 대상으로 OS temp에 복사했으며 기존 샘플에 출력하지 않았다.

## 실행과 실제 단언

격리 app에서 원본 시험을 수정하지 않고 실행했다.

```powershell
# 환경 변수가 없는 기본 실행
node node_modules/vitest/vitest.mjs run tests/t172-text-only-rerender-e2e.test.ts
# 명시적 opt-in, 출력은 존재하지 않는 OS temp 파일
$env:DREAM_RENDER_E2E='1'
$env:T172_SAMPLE_OUT='<review-root>/independent-subtitle-audio.mp4'
node node_modules/vitest/vitest.mjs run tests/t172-text-only-rerender-e2e.test.ts
```

| 검사 | 이번 결과와 범위 |
|---|---|
| 기본 opt-in 차단 | 4 skipped, 1.63초. 브라우저 렌더가 기본 전체 시험에 끼어들지 않음 |
| 명시 opt-in | **4 passed**, 54.97초, 2026-11-17 10:10:49 시작 |
| 1: 자막 추가 | 실제 서비스 request → runNextJob → 소유 렌더 자식 → Remotion/브라우저 → 오디오 믹스·AAC·mux → 검증·게시. success, verify passed, 120프레임, AAC 스트림 1개, 파일 SHA와 DB SHA 일치. 직전 무자막 s9 B와 비교한 요청 시 textOnlyChange=true |
| 2: 첫 문구 수정 | 실제 저장·재렌더 success. 요청과 완료 목록에서 true. 새 `_9x16_r5_SAMPLE.mp4`, 새 SHA. 직전 렌더 stale=true이나 파일 SHA 불변. 두 고정 입력의 media/video/audio/audioPlan 동일, text 상이. revision 등 입력 전체가 동일하다는 의미는 아님 |
| 3: voice gain -4→-6 dB | 실제 success. 요청·완료 목록 모두 false. 원본 오디오 2개 파일 SHA와 assets SHA 일치, `checkRenderRows` 통과. text-only 오판 방지 negative case를 실제 렌더로 확인 |
| 보존 | 각 단계에서 렌더 전 storage inventory의 모든 파일 SHA 불변(s9 A/B MP4·이미지·소리·기존 번들 포함, tmp 제외). scenes/scene_versions/assets/generations/non-render jobs 전체 행 JSON 동일. 신규 render jobs/rows와 timeline revision 생성은 정상 변경 |
| 4: 정리 | storage tmp/render-* 0, 시험 프로세스의 렌더 자식/browser/compositor/ffmpeg/ffprobe 잔존 0 단언 통과 |
| ESLint | 원본 새 시험 `--max-warnings 0`, exit 0 |
| 타입 | 격리 `next typegen` 후 `tsc --noEmit --incremental false`, exit 0 |

제품 변경이 없는 시험·문서 커밋이므로 전체 709개 및 제품 production build는 반복하지 않았다. 위 원본 시험의 네 항목 통과를 확인한 것이며 UI 조작·모든 오류 분기·다른 aspect의 새 검수는 아니다.

## 독립 출력과 작성자 샘플의 대조

새 출력은 **이번 두 번째 렌더의 별도 보관 사본**이다. 시험의 COPYFILE_EXCL 및 JSON `wx`로 기존 파일을 덮어쓰지 않는다. 이번 파일 SHA와 동반 JSON SHA의 일치를 별도 측정했다. 첫 렌더의 파일/행 SHA 일치는 원본 시험의 명시 단언이고, 두 번째 렌더 행 SHA와 보관 파일의 별도 재대조까지 수행한 것은 아니다.

| 항목 | 작성자 기존 샘플을 이번에 읽음 | 이번 독립 생성 출력 |
|---|---|---|
| bytes | 173,416 | 173,711 |
| SHA-256 | `ee81bf182d53c9d5c0954075f20759a3523dec35ab4a1b2e140f2622190cc787` | `99842b7ce50e3ec5f39d93d58acc9cb2e33b40c45043c1493fba39bdeeaadcfd` |
| video | H.264 High, 1080×1920, 30/1, 120 frames, 4.000秒 | 동일 측정값 |
| audio | AAC-LC, 48kHz, 2ch, 4.000秒 | 동일 측정값 |
| ebur128 | -14.0 LUFS, LRA 0.1 LU, sample peak **-11.6 dBFS** | 동일 측정값 |

파일 간 byte identity나 렌더 bit determinism을 요구하거나 주장하지 않는다. 작성자 보고의 기존 샘플 SHA·크기·probe는 이번 읽기와 일치했다. 다만 `ffmpeg -af ebur128=peak=sample -f null -`로 그 동일 SHA 파일을 다시 측정한 표본 최고값은 보고의 -11.5와 **0.1 dB 차이**다. 이 차이를 일치했다고 처리하지 않으며 제품 실패 또는 청취 품질 문제로 추정하지 않는다.

두 JSON 모두 첫 문구 `[가상] 첫 번째 자막 (수정)` 15–55프레임(0.500–1.833333초), 둘째 문구 `[가상] 두 번째 자막` 70–110프레임(2.333333–3.666667초), fade in/out 4프레임이다. 복사한 MP4에서 0.3/1.0/2.0/3.0/3.8초를 직접 추출해 읽었다. 검은 상하 여백, 초록→보라 장면, 자막 없음/첫 자막/없음/둘째 자막/없음이 확인된다. 이는 구간 내부의 다섯 샘플 확인이며 프레임별 경계·fade 곡선 전체의 별도 정확도 검증은 아니다.

## 미검증과 정리·잔존

- 실제 휴대폰 재생·청취·의미 싱크·화면 읽기 프로그램·Firefox/Safari·실배포는 미검증이다. 합성 오디오 측정과 정지 프레임을 해당 PASS로 바꾸지 않는다. T172가 남긴 G-4/G-5/G-6/G-7과 최종 사람 확인 게이트도 닫지 않는다.
- E2E afterAll이 fake DB를 닫고 OS-temp 경계를 확인한 뒤 복원 폴더를 삭제했다. 전후 `dream-t172-e2e-*` 0개, 후속 CIM에서 이번 고유 root를 사용하는 렌더 프로세스 0개다. 별도 GUI 브라우저를 열지 않았다.
- 독립 로그·샘플·측정 JSON/PNG는 `<review-root>`에 남겼다: `default-skip.log`, `optin-e2e.log`, `lint.log`, `type.log`, `measurements.json`, 원본 전후 inventory 및 두 MP4/JSON, 프레임 이미지. 보고서 외에는 커밋하지 않는다.
- OS-temp 안의 고유 app 경로를 검증한 뒤 PowerShell Remove-Item 재귀 삭제를 시도했지만, **자동 승인 검토가 프로세스 실행 전에 `blocked by policy`로 거절**했다. 다른 명령·런타임으로 우회 삭제하지 않았다. 따라서 물리 dependencies/tools/browser 및 snapshot 앱 사본도 같은 root에 잔존한다. 삭제 성공으로 보고하지 않는다.
- 잔존 root의 절대 경로는 `C:/Users/Administrator/AppData/Local/Temp/t174-render-46edc5aa71d34b4e889d6d67b68b3daf`이며, 최종 집계 34,404파일 / 1,401,670,848바이트다. 사본의 `.next`는 typegen 결과이고 사용자 공유 `.next/dev/lock`은 전후 107바이트·2026-11-17 09:31:32로 그대로다.
- 기존 untracked T-157 보고서는 건드리지 않으며 공용 보고·상태 파일도 수정하지 않았다.

## Master 전달문

T174는 86e00fd 원본 opt-in 4개를 격리 물리 사본에서 독립 실행해 4/4 통과한 bounded PASS입니다. 실제 자막 수정 true·새 파일/구파일 보존, gain 변경 false·success·행 검증과 원본 보존을 확인했고, 작성자 샘플의 sample peak만 보고 대비 0.1 dB 차이를 기록했습니다. 휴대폰·청취·T173 UI 게이트는 미검증으로 유지하며, 자동 승인 검토의 삭제 거절로 남은 OS-temp 사본은 보고서 경로대로 잔존합니다.
