# T-138 P2-5B DSP 필수 결함 수정 (T-135 F135-1~4, O135-1·2)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_6730ed97ea2d · 검수 원문: `docs/handoffs/T-135-AUDIO-DSP-REVIEW.md`
- 기준 SHA: `2b4595aa99f930c721c92e7f91e6838fcd539cb7`(지시 시점 HEAD). 이 HEAD의 `lib/audio`는 T134 `bfb5984`와 같아요.
- 바꾼 파일:
  - `lib/audio/mix.ts`
  - `lib/audio/run.ts`: 오류 코드 2개 추가
  - 새 시험 `tests/p2-5b-dsp-fixes.test.ts`
  - 이 보고서
- 바꾸지 않은 것:
  - 기존 시험 `tests/p2-5b-audio-dsp.test.ts`
  - 프로필 값과 기준(-14 LUFS ±1, TP ≤ -1, 클릭 실패 정책)
  - 공용 문서, 도구 설치본, 사용자 자료
- T137 WIP 4파일(render-data·migrate·errors·0009)은 공유 작업공간에 그대로 두고 stage하지 않았어요. reset이나 stash도 하지 않았어요.
- 상태: 자체 수정이에요. **독립 재검수 전이라 완료나 PASS로 주장하지 않아요.**
- 실제로 들어서 확인하지 않았어요. 모든 판단은 합성 신호를 측정한 결과예요.

## 1. 수정 내용
| 항목 | 수정 |
|---|---|
| F135-1 도구 고정 | 크기·수정 시각 캐시를 없앴어요. 요청마다 FFmpeg와 ffprobe를 작업 폴더의 `tools/`로 **해시하면서 복사**하고, 모든 실행은 이 사본으로 해요. 사본은 읽기와 실행만 가능하게 둬요. 호출자가 `tools.ffmpegSha256`·`ffprobeSha256`를 주면 사본 해시가 같아야 하고, 다르면 `TOOL_CHANGED`예요. 두 번째 pass 직전에는 ffmpeg 사본을 **다시 읽어서 해시**하고 `checkSecondPass`로 비교해요(전에는 같은 변수끼리 비교했어요). 게시 직전에는 두 사본을 다시 해시해요. 결과의 `tools`에 `ffprobeSha256`을 추가했어요. |
| F135-2 게시 | 결과를 목적지 옆에 이 호출만의 임시 파일 `.<이름>.<무작위>.part`(배타 생성)로 복사해요. 복사한 뒤 다시 읽어서 해시가 같은지 확인해요. 그다음 **hard link로 목적지 이름을 붙이는 순간이 commit 지점**이에요. 이름이 이미 있으면 link가 실패해서 덮어쓰지 않아요(`OUTPUT_EXISTS`). commit 전에 실패하면 이 호출이 만든 임시 파일만 지워요. 목적지 경로의 파일은 어떤 경우에도 unlink하지 않아요. |
| F135-3 마지막 취소·기한 | 마지막 비동기 작업(임시 파일과 도구 재해시)이 끝난 뒤, link 직전에 동기로 signal과 절대 deadline을 확인해요. 그 사이에 await는 없어요. **commit 전에 취소되거나 기한이 지나면 결과가 없어요.** commit 뒤에 온 취소는 결과를 되돌리지 않고, 늦은 결과로 다룰지는 호출자가 정해요(렌더 worker의 `canceled_late` 규칙). |
| F135-4 영상 길이 | 영상을 주면 고정 사본에서 다음을 확인해요: 영상 스트림이 정확히 1개, `r_frame_rate` 30/1, 패킷 수(`-count_packets`)가 `outputFrames`와 같음. 아니면 `VIDEO_MISMATCH`로 실패해요. `-shortest`로 자르거나 늘리지 않아요. 결합한 결과도 영상 패킷 수와 패킷 데이터 해시(`-f streamhash`)가 원래 영상과 같아야 하고, 아니면 `OUTPUT_INVALID`예요. 결과에 `output.videoCheck{frames,streamSha256}`을 추가했어요. |
| O135-1 | 소리 스트림이 정확히 1개인 파일만 받아요. 2개 이상이면 첫 스트림을 몰래 쓰지 않고 `SOURCE_UNSUPPORTED`예요. |
| O135-2 | `onWork` 호출을 정리 범위(try) 안으로 옮겼어요. callback이 예외를 던져도 작업 폴더를 지워요. |
| 복사·스캔 취소 | 원본 복사, 도구 복사, PCM 스캔, 해시 읽기가 모두 signal과 deadline을 따라요(`AbortSignal.any`+`timeout`). 멈추면 원인에 따라 `CANCELED` 또는 `TIMEOUT`이에요. |

**지원 범위와 한계(명시):**
- **로컬 앱 신뢰 경계(T124) 안의 보장이에요.** 보고하는 해시는 실제로 실행한 사본의 바이트에 묶여요. 같은 PC의 다른 프로세스가 작업 폴더의 사본을 바꾸는 것까지 막는 OS 격리는 주장하지 않아요. 해시 확인 사이에 바꿨다가 되돌리는 경우도 막지 못해요.
- 게시 위치는 hard link를 지원하는 같은 볼륨이어야 해요(NTFS의 storage). link를 지원하지 않는 파일 시스템이면 실패하고, 결과도 목적지 파일도 남기지 않아요.
- 비용: 요청마다 도구 사본 약 210MB를 쓰고, 처음 실행할 때 지연이 있어요. 이 PC에서 직접 잰 값은 복사 약 90ms, 새 사본의 첫 실행 약 0.6초(백신 검사로 추정)예요. **T137에서 렌더에 필요한 공간 계산에 이 210MB를 더해야 해요.**

## 2. 검증

### 2.1 새 회귀 시험 `tests/p2-5b-dsp-fixes.test.ts`(12개)
- **수정한 코드(공유 작업공간):** 12개 모두 통과했어요.
- **수정 전 코드(기준 SHA 사본에 이 시험만 복사):** 10개 실패, 2개 통과했어요.
  - 통과한 2개는 "commit 뒤 늦은 취소는 결과 유지"와 "큰 원본 복사 중 기한 → TIMEOUT"이에요. 예전 코드에서도 같은 결과가 나오는, 동작 의미를 고정하는 시험이에요.
  - 실패한 10개 중 일부는 새로 추가한 시험용 연결 지점(`link`), 결과 필드(`videoCheck`), ffprobe 기대 해시처럼 **API가 늘어나서** 실패한 것이에요. 결함 자체의 재현은 T135 원문의 재현과 같은 방식으로 각 시험에 들어 있어요.

| 시험 | 확인한 것 |
|---|---|
| F135-1 ① | 첫 loudnorm 직후 설치본 사본의 DOS stub 1바이트를 바꿔요(크기·시각 그대로). 요청은 accepted, 보고한 해시는 원래 사본 해시이고, **실행한 모든 binary 경로가 작업 폴더의 `tools/` 사본**이에요. 같은 경로로 다음 요청을 보내면 새 바이트의 해시를 보고해요(캐시 없음). 원래 해시를 기대값으로 주면 `TOOL_CHANGED`, 결과·작업 폴더 없음이에요. |
| F135-1 ② | 고정 사본 자체를 첫 측정 뒤에 바꾸면 `STATS_MISMATCH`예요. ffprobe 기대 해시가 다르면 `TOOL_CHANGED`예요. |
| F135-2 ① | 임시 게시 파일에 `PARTIAL-AUDIO`를 쓴 뒤 ENOSPC를 주입하면 `DISK_FULL`이에요. 목적지, `.part`, 작업 폴더가 모두 없고 원본 sha는 그대로예요. |
| F135-2 ② | 임시 게시 파일을 다시 읽을 때 EIO를 주입하면 `TOOL_FAILED(EIO)`이고 목적지와 `.part`가 없어요. |
| F135-2 ③ | link 직전에 경쟁자가 `EXTERNAL-SENTINEL`을 만들면 `OUTPUT_EXISTS`이고 sentinel 바이트는 그대로예요. link가 ENOSPC로 실패하면 `DISK_FULL`이고 목적지가 없어요. |
| F135-3 ① | 실제 최종 ebur128이 끝난 직후 abort하면 `CANCELED`이고 결과가 없어요. |
| F135-3 ② | 최종 ebur128 반환을 deadline+100ms까지 늦추면 `TIMEOUT`이고 결과가 없어요(경과 시간이 timeoutMs보다 큼). |
| F135-3 ③ | link가 끝난 직후 abort하면 결과는 유지돼요(accepted, 파일 sha가 결과 sha와 같음). commit 의미를 고정하는 시험이에요. |
| F135-3 ④ | 10분짜리 원본으로 timeoutMs 1.5초를 주면 `TIMEOUT`이고 작업 폴더가 없고 원본 sha는 그대로예요. |
| F135-4 | 소리 4초에 영상 2초(60프레임), 6초(180프레임), 25fps 100프레임을 주면 모두 `VIDEO_MISMATCH`예요. 결과가 없고 원본 영상은 그대로예요. 4초 30fps 영상이면 `videoCheck.frames` 120, 디코드 192000샘플, 결과의 영상 streamhash가 원본과 같고, 영상·소리 duration이 둘 다 4.000000이에요. |
| O135-1 | 소리 스트림 2개인 M4A는 `SOURCE_UNSUPPORTED`예요. |
| O135-2 | `onWork`에서 예외가 나도 작업 폴더가 남지 않아요. |

### 2.2 기존 시험과 전체 회귀
- 공유 작업공간: 기존 `tests/p2-5b-audio-dsp.test.ts` 14개가 그대로 통과했어요. 정렬·배치·gain·fade·등전력·덕킹·음량·분류·취소·DISK_FULL을 포함해요.
- **전체 회귀는 T138 변경만 넣은 안전 사본에서 돌렸어요.**
  - 사본: 기준 SHA를 `git archive`로 OS 임시 폴더에 풀고, `lib/audio/{mix,run}.ts`와 새 시험만 덮었어요. node_modules와 `.tools/ffmpeg`는 junction으로 읽기만 했어요.
  - 결과: `tsc --noEmit` 통과, `eslint .` 통과, **vitest 54파일 중 53 통과·1 skip, 시험 611 통과·13 skip**이에요.
  - T137 WIP가 있는 공유 작업공간에서는 전체 회귀를 돌리지 않았어요. 거기서 결과가 다르면 그것은 WIP 탓이에요.
- 운영 빌드는 이번에 돌리지 않았어요. `lib/audio`는 아직 앱 어디에서도 import하지 않고, 수정 범위가 이 모듈뿐이라서예요.

## 3. 미검증·남은 것
- 실제 디스크 가득 참과 실제 EIO는 주입으로만 확인했어요.
- 10분 상한 전체를 처리하는 시간과 자원은 재지 않았어요.
- 실제로 들어 보지 않았어요.
- hard link가 안 되는 볼륨에서의 동작은 코드상으로만 실패 처리돼 있고, 실제로 시험하지는 않았어요.
- **T137에 반영할 계약 변경:**
  - 렌더 adapter가 할 일:
    - `tools.ffmpegSha256`·`ffprobeSha256`에 audioPlan 고정값을 넘겨요.
    - `TOOL_CHANGED`는 `RENDER_INPUT_CHANGED`로, `VIDEO_MISMATCH`는 `RENDER_VERIFY_FAILED`로 연결해요.
    - 비유한 측정값은 null로 바꿔요.
  - 필요한 공간에 도구 사본 약 210MB를 더해요.
  - 결과의 `tools.ffprobeSha256`과 `output.videoCheck`를 verifyJson에 기록해요.
  - commit 뒤 취소는 `canceled_late`로 처리해요.
