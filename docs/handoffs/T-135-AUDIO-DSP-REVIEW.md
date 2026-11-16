# T135 — T134 독립 오디오 DSP 검수

- 검수자 CX-REVIEW-01(Codex), T134 작성에 참여하지 않은 독립 검수자. Master T135 배정에 따라 보고서만 작성했다.
- 대상 `bfb59843b8e6f23f8380d2fca751ebaf60d96c9b`, 보고서 `T-134-AUDIO-DSP.md`, 신규 lib/audio 5파일 및 원본 14개 시험.
- **제품 판정 FAIL / 수정 후 재검수 필요.** 기본 DSP 수치와 원본14개는 PASS지만 도구 해시 고정·실패 게시·마지막 취소/기한·영상 결합 길이에서 아래 4건을 재현했다. 검수 과업은 완료했으며 제품 FAIL을 완료/PASS로 바꾸지 않는다.
- 변경 허용 범위를 지켜 이 문서만 변경했다. 제품/DSP 수정, 사용자 DB, 기존 도구 및 원래 증거 변경 없음. 기준 -14 LUFS ±1, TP≤-1 dBTP는 그대로다. sparse click 기준 완화 요청 없음.

## 환경·검증 방법

현재 worktree에 없는 신규 코드는 `git archive bfb5984`를 OS 임시 경로에 풀어 확보했다. 이하 E는 `C:/Users/Administrator/AppData/Local/Temp/dream-t135-N2oBB4`이다. Git archive는 이 저장소 속성에 따라 CRLF를 출력했다. 검수 중 제품 소스의 줄끝을 수정하지 않았고 5모듈+원본시험 6파일 모두 git show와 줄끝 정규화 후 내용 동일을 확인했다. 원시 바이트 동일이라고 주장하지 않는다(`E/t135-source-hashes.json`). 기존 worktree는 checkout/reset하지 않았다.

기존 안전 복사본의 설치 의존성을 읽는 E/node_modules junction을 사용했다. FFmpeg/ffprobe는 `D:/starwork/dream-ai-studio/.tools/ffmpeg/`의 설치본, FFmpeg 9.0.2 및 SHA256 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`이다. 파일 교체 시험은 OS-temp의 별도 exe 사본에만 수행했다. 모든 입력은 로컬 lavfi/직접 만든 PCM이고 외부 음원·사용자 자료는 사용하지 않았다. 소리를 직접 듣지는 않았으며 합성 측정으로 명료도나 pumping 품질을 주장하지 않는다.

실행 결과:

| 검사 | 결과 |
|---|---|
| 원본 `tests/p2-5b-audio-dsp.test.ts` | **14/14 PASS**, 14.20초. `E/t135-original.log` |
| 모듈·원본시험 lint | `node node_modules/eslint/bin/eslint.js lib/audio tests/p2-5b-audio-dsp.test.ts --max-warnings 0` exit0 |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit0 |
| 17개 AAC 길이 경계, 자체생성 WAV/MP3/M4A와 2개 도구 교체 | 실측 JSON/로그 `E/t135-independent.json`, `E/t135-probe.log`, 재현 `E/probe.ts` |
| 44.1kHz 비주기 chirp/trim/gain/배치/최종 AAC 정렬 | `E/t135-align.json`, 재현 `E/align.ts` |
| 게시 실패·최종 취소·관찰 callback 예외 | `E/t135-failure.log`, 재현 `E/tests/t135-failure.test.ts`, 4/4 관찰 재현. **결함을 확인하도록 작성한 assertion의 통과이지 제품 PASS가 아님** |
| 비유한 PCM·실제 영상 길이 불일치 | `E/t135-boundary.json`, 재현 `E/boundary.ts` |
| 실제 믹스 변경 거절·경쟁 목적지 보호 | `E/t135-binding.json`, 재현 `E/binding.ts` |
| 최종 검사 뒤 deadline 경과 | `E/t135-deadline.json`, 재현 `E/deadline.ts` |

원본 시험 실행은 E에서 FFMPEG_PATH/FFPROBE_PATH를 위 exe로 설정한 뒤 `node node_modules/vitest/vitest.mjs run tests/p2-5b-audio-dsp.test.ts --reporter=verbose`이다. 추가 .ts probe는 `node --conditions=react-server --import tsx <probe이름>.ts`로 실행했다. 별도 4개 실패 주입 시험은 `node node_modules/vitest/vitest.mjs run tests/t135-failure.test.ts --reporter=verbose`이다. 전체599 회귀를 반복하지 않았고 앱에 연결되지 않은 모듈이므로 운영 build/앱 UI/실제 render worker 통합은 실행하지 않았다.

## 통과한 직접 증거

- **trim/sample/gain/fade/equalPower/duck:** 원본14개에서 44.1kHz→48kHz 원본 구간, 정확한 샘플 배치·디지털0 앞뒤, -6dB, tri fade, 두 곡 qsin 제곱합, 목소리 신호에 따른 music만 압축·voice/effect 유지·duckOff·무음/없는 voice에서 음악 지속을 직접 재실행하여 PASS했다. 필터는 검사된 숫자와 고정 단어로 구성되고 shell을 사용하지 않는다. 실제 발화 청취 평가는 아니다.
- **AAC 샘플 약속:** 별도 tone으로 outputFrames=1,2,29,30,31,59,60,61,89,90,91,119,120,121,149,150,151을 모두 실행했다. 최종 재디코드 샘플 수가 각각 frames×1600과 동일하고 initialPadding=1024였다. 89이하는 too_short/accepted=null, 90이상은 normalized/accepted=true로 분리됐다. “AAC padding 때문에 일반 프레임 길이가 틀린다”는 문제는 이 설치 FFmpeg9 경계에서는 재현되지 않았다.
- **압축 소스 경계:** 44.1kHz·정확히2초의 WAV/MP3(libmp3lame)/M4A(AAC)를 직접 생성했다. 모두 48kHz 디코드 96000샘플, 60프레임 구간 수용·61프레임 SOURCE_TOO_SHORT·실패 결과 없음, 원본 SHA 동일이었다.
- **압축 소스 정렬:** 비주기 chirp로 sourceInFrame13, startFrame7, durationFrames40, gain=-6, outputFrames60을 별도 시험했다. 독립적으로 디코드한 소스 PCM을 샘플 인덱스로 자른 기대값과 mix.f32의 최대 절대 오차는 WAV 1.452e-8, MP3 1.059e-8, M4A 1.452e-8이었다. 앞뒤 peak=0, 최종 AAC 96000샘플, 세 형식 모두 최대 상관 지연0샘플(상관≥0.99999918), 원본 SHA 유지였다. 단순 주기 tone의 상관 모호성을 피하려 chirp를 사용했다. AAC pre-echo와 청취 경계까지 보편적으로 0이라고 확대하지 않는다.
- **최종 파일에서 음량 재측정:** 정상5초 영상 결합은 최종 I=-13.8, TP=-10.1, LRA=1.2, AAC-LC/48k/stereo/240000샘플/initialPadding1024, 원본 SHA 유지였다. loudnorm 첫 pass 입력I=-13.79, 두번째 linear, stats.mixSha=원래mixSha였다. 출력 MP4 SHA `34f54e0fecfb9ecb13f9a5f9cd1662fb6198f62f29e05f443b8e32a61e9a9dcb`. 작은 믹스·큰 f32 믹스의 preGain 및 sparse click의 LOUDNESS_OUT_OF_RANGE 실패도 원본 시험에서 PASS했다. 클릭 -15.8을 정책상 허용 성공으로 바꾸지 않았다. LRA7은 처리 target이며 별도 LRA 합격 기준을 임의로 추가하지 않았다.
- **상태·비유한 값:** no_audio는 파일을 만들지 않고 silent/too_short는 accepted=null이다. 게이트 아래 작은 소리는 LOUDNESS_UNMEASURABLE이며 결과 없음. 별도로 NaN 192000샘플의 f32 WAV를 실제 처리하면 mix 스캔 nonFinite=384000으로 OUTPUT_INVALID, 결과 없음이었다.
- **현재 잘 작동하는 바인딩/보호:** 첫 loudnorm 후 실제 mix.f32 한 바이트를 변경하면 STATS_MISMATCH/결과 없음/작업 폴더 없음이었다. 검사 직후 타인이 목적지를 생성하는 경쟁을 주입하면 OUTPUT_EXISTS, `EXTERNAL-SENTINEL` 보존이었다. 기존 파일 무조건 덮어쓰기 문제는 재현되지 않았다.
- **실행 중 취소/timeout 및 일반 실패:** 원본14개의 실제 child 중단은 CANCELED/TIMEOUT이고 모든 관찰 PID가 종료돼 있었으며 작업 폴더·결과 없음이었다. SOURCE_CHANGED/부족 샘플/6채널/잘못된 설정/소리 아님/ENOSPC 분류도 직접 통과했다. 아래 문제는 이 정상 중단 이후의 다른 단계다.

## 필수 수정 — 중요도는 운영 P0/P1/P2/P3 분류

### F135-1 · P2 · 도구 고정 계약이 실제 실행 바이트와 연결되지 않음

- 위치: 대상 `lib/audio/mix.ts:40`의 size+mtime 캐시, :128~129의 checkSecondPass 호출.
- 재현: 설치 FFmpeg를 OS-temp에 복사하고 고정 mtime을 설정했다. 첫 실제 loudnorm 프로세스가 종료된 직후 사본 exe DOS stub의 0x50 한 바이트를 변경하고 size/mtime은 유지했다. 실행 가능한 PE 헤더와 DSP 코드는 변경하지 않았다. 두번째 pass와 결과 검사는 실제 FFmpeg로 계속 실행했다. 같은 경로로 다음 요청도 실행했다.
- 실제: 두 요청 모두 normalized/accepted=true인데 반환·stats 도구 SHA는 `3256173f…8edec`, 실제 실행 경로 파일 SHA는 `b5a026950a4850dbe52d5f44c66e621c09fa72eac8832c123311a79b582e3114`였다. `tool-swap-between-passes`와 `tool-cache-same-metadata-next-call`에 기록했다. 오디오가 달라졌다고 주장하는 시험은 아니며 **보고한 해시가 실행 파일과 다르다**는 직접 증거다.
- 원인: PCM은 fresh hash하지만 ffmpegSha256은 양쪽 모두 이전 tool.sha256 변수를 전달하므로 같은 값끼리 비교한다. 다음 요청도 메타데이터가 같으면 fresh hash하지 않는다. ffprobe 실행 바이트에 대한 동등한 바인딩도 없다.
- 최소 수정 필요: 요청에 쓰는 도구의 실제 바이트 identity를 fresh 확인하고 동일 요청의 측정/두번째 pass/최종 검증에 유지한다. size+mtime 캐시만으로 동일성을 선언하지 않는다. 신뢰된 로컬 앱의 OS 보안 범위를 새로 확대하자는 요구가 아니라 현재 모듈이 주장한 같은-tool/hash 계약의 수정이다. 변경을 거절하거나 실제 고정 사본을 사용한 증거가 있어야 통과한다.

### F135-2 · P2 · 실패한 게시에서 목적지 파일이 남음

- 위치: `lib/audio/mix.ts:149~156`. 불일치 hash인 경우만 unlink하고 복사/게시후 hash 읽기 예외는 work 폴더만 지운다.
- 재현 A(명시적 FS 실패 주입): COPYFILE_EXCL 단계의 파일 연산을 목적지에 `PARTIAL-AUDIO` 13바이트를 만든 뒤 ENOSPC를 던지도록 모의했다. 실제 DSP/최종검증은 그 전까지 정상 도구로 수행했다. 결과 DISK_FULL인데 목적지13바이트가 남고 workLeft=[]였다. 이는 실제 디스크를 채운 시험이 아니며 OS copyFileSync 자체의 내부 정리 성공률을 측정한 것도 아니다.
- 재현 B(명시적 FS 실패 주입): 실제 복사는 완료시키고 게시한 파일의 sha256File이 여는 stream에서 EIO를 던졌다. TOOL_FAILED인데 목적지98268바이트가 남고 workLeft=[]였다. 검증 완료 출력이라도 **호출 실패와 목적지 존재가 동시에 발생**하는 계약 문제다.
- 영향: 호출자가 경로 존재를 성공으로 읽을 수 있으며 재시도는 OUTPUT_EXISTS에 막힌다. A에서는 불완전한 결과가 남을 수 있다.
- 최소 수정 필요: 자신이 만든 게시 파일/인접 staging의 소유권을 추적하고 오류 때 자기 결과를 정리하거나, 검증·취소 확인을 마친 뒤 no-replace 원자 게시로 commit point를 명확히 한다. 이미 존재했거나 경쟁자가 만든 파일을 지우면 안 된다. 두 실패 주입과 sentinel 경쟁 보호를 함께 통과해야 한다.

### F135-3 · P2 · 최종 검사 뒤 취소·deadline이 게시를 막지 못함

- 위치: `lib/audio/mix.ts:144~152`. runTool은 개별 child의 취소/기한을 검사하지만 마지막 run 이후 게이트가 없다.
- 취소 재현: run 래퍼에서 실제 최종 ebur128이 끝난 직후 AbortController.abort()를 호출하고 기존 반환값을 그대로 전달했다. signal.aborted=true인데 normalized/accepted=true 및 output=true였다. 도구 출력 위조나 제품 코드 수정은 없었다.
- 기한 재현: timeoutMs=2000을 주고 마지막 실제 ebur128 반환을 deadline+100ms까지 지연했다. elapsed2121ms, accepted=true, output=true였다. 명시적 단계 경계 지연 주입이며 CPU/디스크를 실제 포화시킨 시험은 아니다.
- 최소 수정 필요: 결과 게시 전의 마지막 비동기 작업 후 AbortSignal/절대 deadline을 다시 확인하고, commit point와 취소가 너무 늦은 경우의 응답 의미를 명시한다. 게시 전 이미 취소/만료된 요청은 결과를 만들지 않아야 한다. 기존 실행중 PID 정리 통과를 유지한다.

### F135-4 · P2 · 선택 영상의 실제 길이를 확인하지 않아 audio가 영상을 늘리거나 부족해짐

- 위치: `lib/audio/mix.ts:138~143`. 최종 video 스트림 개수는 보지만 그 프레임 수·길이는 요청 outputFrames와 비교하지 않는다.
- 실제 합성 파일 재현: outputFrames120(오디오4초)과 직접 생성한 무음 영상60프레임(2초)을 넣었다. normalized/accepted=true, 최종 video2초·audio4초·MP4 format4초였다. 180프레임(6초) 영상을 넣어도 accepted=true, video6초·audio4초·format6초였다. 잘못된 해시나 손상 파일이 아닌 정상 입력 파일이고 원본을 변경하지 않았다.
- 영향: “소리로 영상을 늘리지 않음”, “소리 길이가 영상과 같음”을 반환값만으로 보장할 수 없다. 현재 검사에서 비교하는 것은 실제 영상이 아니라 요청 숫자×1600이다.
- 최소 수정 필요: mux 기능을 유지하려면 실제 pinned 영상/최종 영상 프레임 길이를 요청 D와 대조하여 불일치를 거절한다. 또는 mux 검증을 C 호출자 책임으로 명시하고 그 호출자가 독립적으로 차단하는 계약을 먼저 확정해야 한다. 기준 없이 -shortest를 추가해 잘라서 성공시키라는 요청은 아니다. 현재 standalone mux의 일반 길이 PASS 주장은 한정해야 한다.

## 추가 관찰 — 필수 수정 4건과 구분

- **O135-1 / P3:** 입력 검사의 주석은 one audio stream이라고 하지만 실제 `streams.length`는 0만 거절하고 streams[0]/0:a:0만 쓴다. 직접 만든 2개 audio stream M4A를 넣으면 거절 없이 too_short가 나온다(`E/t135-align.json`). 첫 스트림 선택이 정책이라면 이를 명시하고, 단일 스트림만 지원한다면 정확히1 검사를 추가할 필요가 있다. 임의로 두 스트림을 섞으라고 요구하지 않는다.
- **O135-2 / P3:** onWork callback이 work 생성 후 try 밖(:82)에 있다. callback 예외를 주입하면 raw observer error와 빈 dream-audio 폴더1개가 남는다. 실제 제품 호출자와 연결되지 않은 관찰 옵션이므로 앞의 일반 FS 실패와 같은 중요도로 확대하지 않는다. callback을 cleanup 범위 안으로 넣으면 계약이 명확해진다. 누수 폴더는 시험 teardown에서 제거했다.
- **수명주기 한계(코드 판독):** copyPinned의 pipeline/해시 스캔에는 signal/deadline이 직접 전달되지 않는다. 도구 단계의 중단 PASS가 대용량 복사 중 즉시 취소까지 증명하지는 않는다. 10분 상한 전체 리소스 시험이나 원본 파일을 무제한 읽는 비용은 이번에 수행하지 않았다.

## 반환·정리·다음 진입 조건

T134 원본14 PASS는 유지되지만 위 4건에 대해 수정 위치와 독립 재검증 결과가 돌아오기 전 모듈 전체를 수용하지 않는 것을 권고한다. Master가 별도 신뢰/호출자 계약으로 제한 수용한다면 그 제한을 명시해야 한다. sparse click LOUDNESS_OUT_OF_RANGE는 의도된 정책 실패로 유지하며 이 항목을 버그나 기준 완화 요청으로 분류하지 않았다.

자기 FFmpeg/ffprobe/Node 작업은 종료됐고 `dream-t135-*` 명령줄의 관련 프로세스0 확인. 각 probe의 임시 PCM/WAV/MP3/M4A/MP4, 도구 사본 및 work 폴더는 finally/afterEach로 제거했다. 누수 재현 폴더도 teardown에서 제거했다. 서버·worker·브라우저는 띄우지 않았다. E의 추적 소스 사본·scripts/logs/JSON만 증거로 보관하고 의존성 junction은 unlink했다. 설치 도구나 타인 프로세스를 수정/종료하지 않았다. 실제 사용자 DB 접근, 원본 증거 변경, 제품 수정은 없다.

복사용 전달 메시지: Master께 T135 독립검수 반환합니다. 원본14개와 모듈 lint/type, 합성 trim/fade/crossfade/duck·44.1k WAV/MP3/M4A·AAC padding/정렬은 통과했으나 제품 판정은 FAIL입니다. 도구 실제바이트와 해시 불일치 F135-1, 실패 게시 잔존 F135-2, 최종 취소/deadline 무시 F135-3, 실제 mux 영상길이 불일치 수용 F135-4를 각 재현·중요도·최소수정으로 기록했습니다. sparse click 실패 정책을 유지했고 DSP/제품 파일은 변경하지 않았으며 지정 T135 보고서만 통합 검토 부탁드립니다.
