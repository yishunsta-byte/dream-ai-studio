# T-137 P2-5C 실제 렌더에 소리 연결

- 담당: CC-DATA-01
- 지시: CX-MASTER-01 msg_8b29f254df9b(배정), msg_c268e5960558(T142 수용 뒤 재개)
- 계약: `docs/handoffs/T-136-AUDIO-RENDER-CONTRACT.md`
- 소리 처리 모듈: T-134 + T-138/T-140/T-142 수정본
- 기준 SHA: `0010443`(재개 시점 HEAD)이에요. 모든 검증은 이 HEAD에 T137 변경만 얹은 공유 작업공간에서 했어요. 작업공간에 다른 진행 중 변경은 없어요(다른 담당의 untracked `T-122` 파일은 건드리지 않았어요).
- 상태: 자체 구현과 자체 검증까지예요. **독립 검수 전이라 PASS나 완료로 주장하지 않아요.**
  - 실제로 들어 보지 않았어요. 측정값만 확인했어요.
  - 화면 배치와 미리 듣기는 D 범위라 하지 않았어요.
  - 바꾸지 않은 것: 발행된 migration 0001~0008, 고정 fixture s4~s7, packages, `.tools`, 공용 문서, 사용자 자료

## 1. 바꾼 파일
| 파일 | 내용 |
|---|---|
| `lib/render/input.ts` | 봉투 A는 이름만 `renderInputSilentSchema`로 바꿨어요(필드·규칙·순서 그대로). 봉투 B `renderInputAudioSchema`를 추가하고 둘을 union으로 묶었어요. `prepareRender` v2 분기: 차단 사유를 전부 모아요(`AUDIO_SOURCE_MISSING` file_missing/not_audio/file_changed/range, `AUDIO_TOO_LONG`, `AUDIO_TOOL_MISSING`). 그 밖에 `checkAudioTools`(ffmpeg 버전 + ffmpeg/ffprobe sha), `audioNeededBytes`(원본 + f32 믹스 2개 + 영상 사본 + 도구 사본 256MB + 16MB), `mixPlan`·`audioModeOf`를 추가했어요. v1 + 소리는 지금처럼 `AUDIO_RENDER_UNSUPPORTED`예요. |
| `lib/db/render-data.ts` | `audioPlanSchema`(none/mix). mix에는 `tools{ffmpeg, ffmpegSha256, ffprobeSha256}`가 들어가요. 그 밖에 `audioPlanIssue`, `renderEnvelope`, `audioVerifyOk`를 추가했어요. 행 검사 사유 3개는 **끝에만** 붙였어요. |
| `lib/db/migrations/0009_render_audio.sql`(신규) · `lib/db/migrate.ts` | 삽입 트리거만 있어요(열·표 변경 없음). `LATER_SQL_STEPS` 9, 검사기는 `checkRenderRows`예요. |
| `lib/render/errors.ts` | `AUDIO_SOURCE_INVALID`·`AUDIO_LOUDNESS_FAILED`·`AUDIO_FAILED`와 문구를 추가했어요(재시도 목록은 그대로). 소리 처리 오류를 렌더 오류로 바꾸는 `audioFailureCode`를 추가했어요(pure라서 child가 import해요). |
| `render/child.ts` · `lib/render/run.ts` | `AudioStart`를 추가했어요. 봉투 B mix는 muted 렌더를 `work/video.mp4`에 쓰고, 같은 child가 `mixAudio`를 실행해요(abort는 기존 cancel/disconnect 경로를 그대로 써요). IPC에 `stage:"audio"`와 `{type:"audio",result}`를 추가했어요. 소리 오류는 처리 모듈 코드를 같이 실어서 보내요. 시간 상한은 `min(10분, 렌더 시작 + 30분 − 30초 − 지금)`이에요. |
| `lib/render/verify.ts` | `VerifyExpect.audio`: `"none"`이면 P2-4와 같은 15개 항목 그대로예요. `"aac"`이면 소리 트랙 1개를 기대하고 형식 4개(codec·LC·48k·2ch)를 더 봐요. `verifyAudio`(worker가 최종 파일에서 직접 확인): 디코드 샘플 = frames×1600, 영상 streamhash가 무음 렌더본과 같은지, normalized이면 ebur128을 다시 재서 -14±1·TP≤-1인지 봐요. 기록 타입은 `RenderAudioRecord`이고, 비유한 값은 null로 명시해요(`finiteOrNull`). |
| `lib/jobs/render.ts` | 실행 직전에 도구 해시를 다시 재요(다르면 `RENDER_INPUT_CHANGED`, 없으면 `AUDIO_FAILED`). 원본은 저장된 경로로 찾고(없으면 `RENDER_INPUT_MISSING`), 절대 경로와 고정 sha로 child에 넘겨요. 필요한 공간에 소리 몫을 더하고, 검사 뒤 `verify_json.audio`를 기록해요. 소리 실패는 `render.audio_failed` 활동 기록에 남겨요(코드와 측정 detail만, 경로 없음). 소리 단계의 자체 시간 초과는 `TIMEOUT`이에요(전에는 cancel로 잘못 갈 수 있었어요). |
| `lib/services/renders.ts` | `RenderView.audioMode`와 `audio`를 추가했어요. aac이면 compose 진행률은 null이에요. `textOnlyChange` 비교에 소리를 포함했어요. 새 blocker 문장을 추가했어요. |
| `components/render-panel/copy.ts` | blocker 문구 4개, 실패 문구 3개, 확인 실패 이유 문구만 바꿨어요. 화면 배치는 바꾸지 않았어요. |
| 시험 | 새 `tests/p2-5c-render-audio.test.ts`(8개), `tests/p2-5c-render-audio-e2e.test.ts`(실제 렌더 4개), `tests/p2-5c-helpers.ts`(s5 사본·합성 소리). 9단계 기대값 조정: `p2-4a-renders-db`, `p2-5a-audio`, `restore`, `backup-service`, `p2-1-timeline`. `p2-4-render-panel`은 view 필드만 맞췄어요. `p2-5a`의 "v2는 렌더 불가" 시험은 새 동작(봉투 B)에 맞게 바꿨어요. |

## 2. 계약(T-136)과 다르게 한 점 (근거 포함)
1. **봉투 A 판정을 계약보다 좁혔어요.** 트리거와 행 검사는 둘 다 같은 기준이에요: audioPlan이 없는 행은 v2 타임라인이나 `output.audio:"aac"`일 때만 거절하고, 나머지는 0006/0007 규칙 그대로예요.
   - 계약 초안대로 하면 "v1 + 소리 없음 + output none"까지 강제하게 돼요. 그런데 기존 시험이 쓰는 최소 입력 행(0007 시절 규칙으로 정상)이 거절됐어요. "기존 행은 그때 규칙으로 다시 판정하지 않는다"는 원칙에 맞춰 좁혔어요.
2. `tools`에 `ffprobeSha256`을 추가했어요. T-138의 ffprobe 고정을 반영한 거예요.
3. 음량 실패의 측정값은 `verify_json`이 아니라 **활동 기록**(`render.audio_failed`)에 남겨요. 결과 파일이 없는 실패 행의 verify 구조를 늘리지 않기 위해서예요.
4. 소리 단계에서도 DB stage는 `compose`로 둬요(0006 CHECK 그대로). 화면 진행률은 aac일 때 null(불확정)이에요.

## 3. 검증 (공유 작업공간 = `0010443` + T137 변경만)
- `tsc --noEmit` 통과, `eslint .` 통과, `npm run build` 통과("운영 빌드 확인: 로컬 데이터·비밀 설정·영상 만들기 도구 추적 없음")
- vitest 전체: **54파일 통과·2 skip, 628 통과·17 skip.** skip은 e2e 2파일이에요. 이 둘은 따로 켜서 돌렸어요.
- **실제 렌더 e2e**(`DREAM_RENDER_E2E=1`, worker + child + Remotion + 고정 브라우저 + FFmpeg 9.0.2):
  - `p2-5c-render-audio-e2e` 4개와 기존 무음 `p2-4-render-e2e` 9개, **모두 13개 통과**했어요. 봉투 A 회귀는 0건이에요.

| 경우 | 결과 |
|---|---|
| 음악(핑크 잡음, 덮킹) + 목소리(44.1k 모노) 9:16, 30초 | 성공. AAC LC 48k 2ch 1트랙, 디코드 1,440,000샘플 = 900×1600, 영상 streamhash가 무음 렌더본과 같음, frames 900. 최종(worker 측정) **-14.1 LUFS / TP -4.9 / LRA 8.2**, child 측정값도 같아요. 1차 측정 -17.19, 2차 출력 -14.01. AAC initial padding 1024. |
| 정렬 지연(상관) | 음악 구간 4만8천 샘플에서 정규화 상관을 쟀어요. 최고점 lag = **24000 = (30−15)×1600으로 기대값과 정확히 같아요**(score 0.985). AAC 지연이 남지 않아요. |
| 받기 | 응답 바이트 sha = 행 sha예요. 다른 저장 파일 바이트는 그대로예요. |
| 형식 혼합 16:9 | MP3 스테레오 44.1k, M4A 모노 44.1k, WAV를 섞어서 성공했어요(normalized, accepted, 채널 [1,1,2]). |
| 소리 없는 v2 1:1 | 봉투 B `mode:"none"`이에요. 소리 트랙 0, `verify_json.audio` 없음, `audioMode:"none"`이에요. |
| 디지털 무음 | `silent` 성공, `accepted:null`, loudness 없음, -14 판정 항목 없음. 최종 integrated -70(ebur128 하한), TP null이에요. |
| 띄엄띄엄 클릭(T-134와 같은 신호) | `AUDIO_LOUDNESS_FAILED`, 파일 없음, 재시도 없음(attempts 1). 측정 `{"integrated":-15.8,"range":7.8,"truePeak":-2}`이고 T-134와 같은 값이에요. |
| 소리 단계 중 취소 | 작업 폴더에 `audio/dream-audio-*`가 생긴 뒤 취소했어요. canceled, 파일 없음, 남은 render 폴더 0, 남은 chrome/remotion/child/ffmpeg/ffprobe 프로세스 0이에요. |
| 요청 뒤 소리 파일 변경 | `RENDER_INPUT_CHANGED`, 재시도 없음이에요. |
| 행 검사 | 모든 e2e 뒤 `checkRenderRows` 통과했어요. |

- **단위·DB 시험**(`p2-5c-render-audio`, 실제 렌더 없음):
  - 0008 상태의 s5 사본에서 요청 서비스로 봉투 A 행을 만들고 0009로 올렸어요. 행 전체가 바이트 그대로이고, 다시 정규화해도 같은 텍스트이고, 행 검사를 통과했어요. 0008 앱은 이 DB를 `too_new`로 판정해요.
  - v1은 봉투 A예요.
  - v2 소리 없음은 mode none이에요.
  - v2 소리 있음은 mix예요: sources가 정렬·중복 없음, 도구 고정, 출력 aac. 요청 행이 트리거와 행 검사를 통과하고, view가 `audioMode:"aac"`, progress null이에요.
  - 파일 변경, 삭제, 구간 초과, 도구 없음을 **한 번에 4개** 모아요. 작업은 만들지 않아요(409).
  - 트리거: 정상 4종은 들어가고, 어긋난 봉투 10종은 거절해요.
  - `renderEnvelope` 사유가 정확해요.
  - 확인 항목: 무음 15개는 그대로이고 aac는 4개를 더해요.
  - 오류 연결표 16가지와 문구를 확인했어요.

## 4. 관찰
- 이번 음악+목소리 경우 loudnorm 2차가 `dynamic`으로 갔어요(측정 LRA 10.5가 목표 7보다 커요). 최종 측정이 기준 안이라 통과로 판정했고, 프로필이나 기준은 바꾸지 않았어요. linear를 강제할지는 Master가 판단할 부분이에요.

## 5. 미검증 (사실대로)
- matrix 중 **실행하지 않은 것:**
  - 렌더 단위 실험: 효과음 단독, 덮킹 끔 각각, 모든 비율 × 모든 역할 조합
  - `AUDIO_TOO_LONG`(18001프레임). 단위 시험이 없고 코드로만 처리돼요.
  - 6채널·짧은 원본의 렌더 단계 `AUDIO_SOURCE_INVALID`. 처리 모듈 시험에서만 확인했어요.
  - 소리 단계의 시간 초과
  - 소리 단계 중 worker 강제 종료와 다음 시작 때 정리
  - 소리 단계 중 child 충돌 → 재시도
  - 쓰는 중 ENOSPC 주입
  - 늦은 취소(소리 포함)
  - 같은 입력 POST 두 번, 다른 창에서 소리 수정 뒤 CONFLICT
  - 소리만 바꾼 stale/textOnlyChange false(코드와 view 비교에만 넣었어요)
  - 봉투 B 행이 든 백업 ZIP의 복원
- s8/s9 고정 fixture는 만들지 않았어요(Master 결정). 가짜 0008 → 0009 승격과 0008 앱의 거부는 시험했어요.
- 실제로 들어 보지 않았어요. 화면 표시와 미리 듣기는 D 범위예요.
- `cleanup.left`(mixAudio가 지우지 못한 이름)는 attempt 폴더 안에 있어요. 그래서 기존 `removeAll(work)`와 `cleanStaleRenderTemps`가 정리해요. 따로 기록하지는 않아요.
