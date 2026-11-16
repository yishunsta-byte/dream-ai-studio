# T-136 렌더 오디오 연결 계약 (단계 C 구현 기준)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_2b7a2dd6c7f0 · 기준: T-130 4~7장, T-132(0008·timeline v2), T-134(`lib/audio`)
- 범위: 이 문서만 새로 썼어요. 소스·공용 문서·DB·도구·제품은 바꾸지 않았어요.
- 근거:
  - 아래 내용은 지금 master의 실제 코드를 읽고 정리했어요: `lib/render/{input,run,verify,errors,file-server,props}.ts`, `lib/jobs/render.ts`, `lib/services/renders.ts`, `render/child.ts`, `lib/db/{render-data,migrate}.ts`, `lib/db/migrations/0006·0008`, `lib/backup/archive.ts`, `lib/repo/maintenance.ts`, `app/api/**/renders/**`, `lib/audio/*`
  - 직접 실행해서 확인한 것은 한 가지예요. `-c:v copy`로 결합한 뒤 영상 스트림 패킷 sha256(`-f streamhash`)이 결합 전 무음 MP4와 같았어요. 영상과 소리의 duration도 둘 다 4.000000이었어요(T-134 프로토타입 파일).
- Master 정책을 그대로 따라요.
  - 띄엄띄엄 클릭처럼 기준 밖인 결과는 실패로 처리해요.
  - 기준을 완화하지 않고, TP를 우선해 성공으로 처리하지도 않아요.

## 0. 결론
1. **렌더 최상위 `schemaVersion`은 1로 유지해요.**
   - 기존 무음 형식(이하 **봉투 A**)은 바이트 하나도 바꾸지 않아요.
   - 소리가 있는 v2 타임라인용으로 **봉투 B**를 명시적으로 추가해요: `timeline` v2, `output.audio`, `audioPlan.schemaVersion=1`.
   - 0006의 `schemaVersion IS 1` CHECK는 그대로 둬요. 발행된 0001~0008도 바꾸지 않아요.
2. **새 migration `0009_render_audio.sql`(트리거만)이 필요해요.** 근거는 1.3에 있어요.
3. **소리 처리는 기존 render child 안에서 해요.** 영상 렌더(muted) 다음에 같은 child가 `mixAudio`를 실행해요.
   - 그래서 취소·시간 초과·부모(worker) 종료·자손 프로세스 정리를 지금 경계 그대로 써요. 새 프로세스 관리자는 만들지 않아요.
4. **소리 원본은 파일 서버로 보내지 않아요.**
   - worker가 저장소 원본의 절대 경로와 고정 해시를 child에 넘겨요.
   - `mixAudio`가 attempt 작업 폴더 안으로 **한 번만** 해시하면서 복사해요. worker가 따로 복사하지는 않아요(2.2).
5. 결과 상태는 이렇게 연결해요.
   - 성공: `normalized` / `silent` / `too_short`. 각 상태를 `verifyJson.audio.status`와 RenderView에 그대로 보여 줘요.
   - 실패: 기준 밖이거나 측정할 수 없으면 새 영구 오류 코드로 실패해요.
   - `no_audio`는 렌더 단계에서 생기지 않아요. 준비 단계에서 봉투 B의 `mode:"none"`으로 분기해요.

## 1. 저장 계약

### 1.1 봉투 A: 기존 무음 형식, 바꾸지 않음
- 지금 `renderInputSchema`는 이름만 `renderInputSilentSchema`로 옮기고, 필드·refine·정렬은 그대로 둬요.
  - `timeline`: v1 + `audio.length===0`
  - `output.audio:"none"`
  - `audioPlan` 키 없음
- 이미 저장된 `input_json`과 `input_sha256`은 다시 쓰거나 다시 해석하지 않아요. 기존 무음 성공 MP4, 다운로드, 백업 파일의 바이트와 해시도 그대로예요.
- 쓰는 곳: v1 타임라인 중 소리가 없는 것.

### 1.2 봉투 B: 새로 추가
```ts
renderInputAudioSchema = z.strictObject({
  schemaVersion: z.literal(1),            // 최상위는 1 그대로(0006 CHECK)
  projectId, contentRevision, timelineRevId, timelineRevision, timelineSha256,   // A와 같음
  timeline: timelineV2Schema,             // T-132 v2 그대로
  output: z.strictObject({ codec:"h264", pixelFormat:"yuv420p", colorSpace:"bt709", fps:30, width, height,
    audio: z.enum(["aac","none"]) }),
  durationInFrames, videoFrames, media, fonts, renderer, sample,                 // A와 같음
  audioPlan: z.discriminatedUnion("mode", [
    z.strictObject({ schemaVersion: z.literal(1), mode: z.literal("none") }),   // v2인데 audio:[]
    z.strictObject({ schemaVersion: z.literal(1), mode: z.literal("mix"),
      profile: z.literal("p2-5-local-v1"),
      outputFrames: z.number().int().min(1).max(18000),                         // = durationInFrames
      sources: z.array(z.strictObject({ assetId: z.uuid(), relPath, sha256: hex64, sizeBytes: int≥1,
        durationMs: int≥1, isMock: z.boolean() })).min(1).max(100),             // assetId 오름차순, 중복 없음
      tools: z.strictObject({ ffmpeg: z.string(), ffmpegSha256: hex64 }),      // 요청할 때 잰 값
    }),
  ]),
}).superRefine(/* output.audio==="aac" ⇔ mode==="mix" ⇔ timeline.audio.length>0;
                  mix면 outputFrames===durationInFrames, sources 집합 = timeline.audio의 assetId 집합 */);
renderInputSchema = z.union([renderInputSilentSchema, renderInputAudioSchema]);   // A strict는 audioPlan 키가 있으면 거절해요
```
- `audioPlan.mode:"none"`이 무음 경로에 대한 명시적 분기예요.
  - v2 타임라인인데 `audio:[]`(권리 기록만 있거나 소리를 모두 지운 경우)이면 봉투 B로 `output.audio:"none"`을 만들어요.
  - 결과는 소리 트랙이 0개인 영상이고, 검사도 지금처럼 소리 트랙 0개를 기대해요.
  - v2를 봉투 A로 바꿔 쓰지 않아요. v1으로 낮추면 타임라인 해시 연결이 깨지기 때문이에요.
- v1인데 `audio`가 비어 있지 않은 예전 행은 지금처럼 `AUDIO_RENDER_UNSUPPORTED {schemaVersion:1,audioClips:n}`으로 거절해요.
  - 이 차단 코드는 이제 v1 행에만 써요. v2 행에는 쓰지 않아요.
- 권리 정보(`audioRights`)와 clip 설정은 `timeline` 안에 이미 있고, `timelineSha256`으로 묶여 있어요. `audioPlan`에 따로 복사하지 않아요.
- `sample`은 `media` 중 하나라도 isMock이거나 `audioPlan.sources` 중 하나라도 isMock이면 참이에요. 그러면 파일 이름에 샘플 표시가 붙어요(`renderFileName` 그대로).
- `tools`는 요청할 때 잰 ffmpeg 버전과 sha예요.
  - worker는 실행 직전에 다시 재서 다르면 `RENDER_INPUT_CHANGED`로 처리해요(브라우저 고정과 같은 규칙).
  - 프로필은 `lib/audio/profile.ts`의 `PROFILE_ID`와 같아야 해요.
- 정규형 JSON은 지금처럼 `canonicalJson(schema.parse(input))`으로 만들고, `input_sha256`은 그 텍스트의 sha예요.

### 1.3 왜 0009가 필요한지, 무엇을 넣는지
- **근거:**
  - 0008 시점 앱(T-132 빌드)의 `checkRenderRow`는 최상위 `schemaVersion===1`과 식별자만 읽어요. 그래서 봉투 B 행이 들어 있는 DB나 백업을 **정상으로 받아들여요.**
  - 그 뒤 화면에서는 `renderInputSchema.parse`가 실패해서 `width:0` 같은 잘못된 표시가 나오고, worker는 `RENDER_FAILED`가 돼요. 이것이 "구앱이 새 자료를 오판"하는 경우예요.
  - 0008과 같은 방식으로, 새 journal 항목이 0008 앱에게 "너무 새로운 DB"로 보이게 만들어야 해요.
  - 발행된 0008은 바꿀 수 없어서 새 번호가 필요해요.
- **0009의 내용(열·테이블 변경 없음):**
```sql
-- 0009_render_audio.sql (P2-5C): render input envelope B becomes writable. Feature gate + insert guard only.
CREATE TRIGGER render_input_envelope_guard BEFORE INSERT ON renders
WHEN NOT (
  (json_type(NEW.input_json,'$.audioPlan') IS NULL AND json_extract(NEW.input_json,'$.output.audio') IS 'none'
    AND json_extract(NEW.input_json,'$.timeline.schemaVersion') IS 1 AND json_array_length(NEW.input_json,'$.timeline.audio') IS 0)
  OR (json_extract(NEW.input_json,'$.timeline.schemaVersion') IS 2 AND json_extract(NEW.input_json,'$.audioPlan.schemaVersion') IS 1
    AND ((json_extract(NEW.input_json,'$.audioPlan.mode') IS 'none' AND json_extract(NEW.input_json,'$.output.audio') IS 'none'
          AND json_array_length(NEW.input_json,'$.timeline.audio') IS 0)
      OR (json_extract(NEW.input_json,'$.audioPlan.mode') IS 'mix' AND json_extract(NEW.input_json,'$.output.audio') IS 'aac'
          AND json_extract(NEW.input_json,'$.audioPlan.profile') IS 'p2-5-local-v1'
          AND json_array_length(NEW.input_json,'$.timeline.audio') >= 1))))
BEGIN SELECT RAISE(ABORT,'render input envelope differs'); END;
```
- `lib/db/migrate.ts`의 `LATER_SQL_STEPS`에 `{version:9,name:"0009_render_audio.sql"}`을 추가하고, `LATER_SQL_VERIFY[9]=checkRenderRows`(1.4로 확장한 것)를 둬요.
- 테스트 기대값을 조정해요. T-132에서 8단계로 바꿨던 기대값을 같은 방식으로 9단계로 맞춰요. s7 fixture의 migration 목록은 고정이고, 최신 제품 기준만 9가 돼요.
- 0006의 CHECK, 다른 트리거, 이미 있는 행에는 손대지 않아요. 기존 행은 다시 쓰지 않고, 0009의 데이터 검사가 한 번 읽어요.

### 1.4 행 검사기 `checkRenderRow`에 추가할 것
`renderRowReasons`는 **끝에만 추가해요.** 지금 있는 문장과 순서는 그대로 둬요. CLI 진단 문구가 고정돼 있기 때문이에요.
- `"input envelope is not known"`: `renderInputSchema`(A ∪ B)로 전체 파싱이 실패할 때
- `"input audio plan differs from its timeline"`: 1.2의 superRefine 규칙을 어길 때
- `"audio verify record differs"`: 아래 경우
  - `succeeded` 또는 `canceled_late` 행인데 봉투 B·mix에서 `verify_json.audio`가 없을 때
  - `audio.status`가 `normalized|silent|too_short`가 아닐 때
  - `normalized`인데 `accepted!==true`일 때
  - 측정값이 숫자도 null도 아닐 때
  - 봉투 A나 mode none인 행에 `audio` 키가 있을 때
- **봉투 A 행은 지금 규칙만으로 계속 통과해야 해요.** 회귀 시험: s4~s7 fixture를 복원·승격했을 때 `checkRenderRows`가 통과해야 해요.

### 1.5 백업·복원 (코드 변경 없음, 확인만)
- 소리 원본은 `assets.file_path`로 이미 `fileReferences`(maintenance.ts)에 들어 있어요. 소리가 있는 최종 MP4와 늦게 취소돼 보관한 MP4는 `renderFileReferences`에 들어 있어요. 그래서 inventory와 해시 검사는 그대로예요.
- 임시 PCM·통계·무음 영상은 attempt 폴더(`storage/tmp/render-…/`)에만 있어요. `cleanStaleRenderTemps`가 정리하고, inventory에 섞이지 않아요.
- 복원 순서는 지금 그대로예요: `verifyRestoredDatabase`(같은 구조) 또는 staging 승격 직후 → `checkTimelineRows` → `checkRenderRows`(확장).
- **fixture 현황:**
  - 지금 저장소에는 s4~s7만 있고 **s8 fixture는 없어요**(`tests/fixtures/backups`).
  - 단계 C에서는 s7과 0009 직전 DB를 기준으로 시험해요.
    - s7 → 0008 → 0009 승격 뒤 기존 렌더 행의 `input_json`·`input_sha256`·파일 sha가 같은지 확인해요.
    - 0008 상태의 가상 DB(v2 타임라인 + 봉투 A 렌더)를 0009로 올렸을 때도 같은지 확인해요.
  - 새 고정 fixture(s8/s9)를 만들지는 Master가 배정해요. 만들 경우 s4~s7과 같은 build/compare 방식으로 하고, 기존 fixture 바이트는 바꾸지 않아요.

## 2. 실행 계약

### 2.1 준비 단계 (`prepareRender`, 요청할 때)
v2 타임라인을 거절하지 않고 아래 순서로 판단해요. 차단 이유는 하나만이 아니라 **전부** 모아요.
1. v1 + audio 있음 → `AUDIO_RENDER_UNSUPPORTED`(지금 동작 유지)
2. 영상 clip, 글꼴, 오래된 타임라인(stale), 브라우저 검사는 지금과 같아요.
3. v2 + audio 있음일 때 각 소리 자료는 `jobs.assets`로 찾아요.
   - 행이 없거나 `kind!=="audio"`이거나 `filePath`·`sha256`·`sizeBytes`·`durationMs` 중 하나가 없으면 → `AUDIO_SOURCE_MISSING {reason:"file_missing"|"not_audio", clipId, assetId}`
   - 파일 해시나 크기가 등록값과 다르면 → `AUDIO_SOURCE_MISSING {reason:"file_changed", clipId, assetId}`
   - `sourceInFrame+durationFrames > floor(durationMs×30/1000)`이면 → `AUDIO_SOURCE_MISSING {reason:"range", clipId, assetId}`
   - 보관 처리(archived)된 자료는 파일이 온전하면 막지 않아요. 저장할 때 이미 이어 쓰기가 허용된 자료이고, 영상 media도 보관 여부는 검사하지 않아요.
4. `durationInFrames > 18000`(10분, `MAX_OUTPUT_FRAMES`)이고 소리가 있으면 → `AUDIO_TOO_LONG {frames, maxFrames:18000}`
5. 도구: `lib/audio`의 도구 정보로 ffmpeg 버전과 sha를 재요. 실패하면 → `AUDIO_TOOL_MISSING {}`
6. 저장 공간이 필요한 양(`needBytes`)에 소리용 공간을 더해요(2.4).
7. 막힌 것이 없으면 봉투 B를 만들어요. `sources`는 assetId 오름차순으로 넣고, 같은 자료를 여러 clip이 써도 한 번만 넣어요.

`RenderBlocker` 유니온에 위 4종(`AUDIO_SOURCE_MISSING`·`AUDIO_TOO_LONG`·`AUDIO_TOOL_MISSING`, 그리고 v1 전용이 된 `AUDIO_RENDER_UNSUPPORTED`)을 둬요. `BLOCKER_MESSAGE`와 `copy.ts`에는 한 문장씩만 추가해요.

### 2.2 원본 파일 경로 (중복 사본 없음)
| 대상 | 실제 경로 | 누가 열고 복사하는지 |
|---|---|---|
| 영상·이미지 | `storage/<relPath>` → `work/inputs/m{n}.ext` | 지금처럼 worker의 `recheckInput`이 해시하며 복사해요. 파일 서버가 그 사본을 열어 두고 Remotion에 넘겨요. |
| 글꼴 | `public/fonts/<relPath>` → `work/inputs/f{n}.ext` | 위와 같아요. |
| **소리 원본** | `storage/<relPath>` → `work/audio/dream-audio-*/s{i}.<ext>` | **child의 `mixAudio.copyPinned`가 한 번** 해시하며 복사하고 읽기 전용으로 둬요. 다르면 `SOURCE_CHANGED`예요. 파일 서버와 Remotion은 소리 파일을 받지 않아요(영상은 muted로 렌더). |
| 무음 영상 | `work/video.mp4`(child `renderMedia`의 출력) | child가 sha를 재고 `mixAudio`의 `video` pin으로 넘겨요. `mixAudio`가 다시 복사해서 고정해요. |
| 최종 | `work/out.mp4`(`mixAudio.outputPath`, 이미 있으면 실패) | worker가 검사한 뒤 `projects/<p>/renders/<id>.mp4`로 link해요. |

- worker는 `resolveStoredFile(relPath)`로 구한 **절대 경로**와 `{sha256,sizeBytes}`만 child에 넘겨요.
  - 경로가 storage 밖으로 나가거나 파일이 없으면 child를 시작하기 전에 `RENDER_INPUT_MISSING`이에요.
- `mixAudio.workRoot`는 `work/audio`예요. attempt 폴더 안이라 `removeAll(work)`와 `cleanStaleRenderTemps`로 함께 지워져요.
- 무음 영상과 그 사본은 결합에만 쓰고 공개하지 않아요. 무음 결과 경로(봉투 A·mode none)는 지금처럼 `work/out.mp4`를 그대로 공개해요.

### 2.3 소유 프로세스·취소·시간 초과·부모 종료
- `ChildStart`에 `audio: null | AudioStart`를 추가해요. 봉투 A와 mode none은 `null`이라 지금 경로와 같아요.
```ts
type AudioStart={ request: Omit<MixRequest,"video"|"outputPath"|"workRoot">;   // outputFrames, audio, audioJoins, sources(절대경로 pin)
  tools:{ffmpeg:string;ffprobe:string};      // 절대 경로. child는 server-only인 lib/media/tools를 import하지 않음
  workRoot:string; videoPath:string; outputPath:string; timeoutMs:number };
```
- child 순서: 지금 단계(bundle → browser → compose)에서 `renderMedia(muted:true, outputLocation: audio? videoPath : output)`를 마친 뒤, audio가 있을 때만 아래를 이어서 해요.
  1. `send({type:"stage",stage:"audio"})`
  2. `mixAudio({...request, video:{path:videoPath,…sha}, outputPath, workRoot}, {signal, timeoutMs, tools})`
  3. `send({type:"audio",result})` → `done`
- `ChildMessage`에 `{type:"stage";stage:"audio"}`와 `{type:"audio";result:ProcessedMix}`를 추가해요. IPC 안에서만 쓰고 DB의 stage enum은 그대로예요.
- **취소:** worker의 `shouldCancel` → IPC `cancel` → child의 cancel 핸들러가 `mixAudio`의 AbortSignal을 abort → `runTool`이 ffmpeg를 끝내고 종료까지 기다려요.
  - 유예 시간 10초가 지나면 지금처럼 `taskkill /T /F`예요.
- **부모 종료:** child의 `disconnect` 처리(지금 있음)가 같은 abort를 부르고, 3초 뒤 `killOwnTree`를 실행해요. ffmpeg는 child의 자손이라 함께 정리돼요.
- **child 종료 뒤:** `runRenderAttempt`의 자손 sweep(`descendants`+`killTree`)이 남은 ffmpeg까지 정리해요.
- **시간 상한:**
  - 렌더 전체는 지금처럼 `RENDER_TIME_LIMIT_MS`(30분)예요.
  - `AudioStart.timeoutMs = min(10분, 30분 − 지금까지 걸린 시간 − 30초)`예요. 0 이하이면 child를 시작하지 않고 `TIMEOUT`이에요.
  - 소리 출력 길이 상한은 2.1의 18000프레임이에요.
- `mixAudio`의 `AudioError`는 child가 `{type:"error",code,detail}`로 보내요. worker는 2.5의 표로 연결해요.

### 2.4 필요한 저장 공간 (요청할 때와 실행 직전에 같은 식)
`need = neededBytes(frames,w,h) + Σmedia + Σfonts + audioNeed`
`audioNeed = Σsources.sizeBytes + 2 × outputFrames×1600×2×4(f32 믹스·사전 감쇠본) + neededBytes 안의 출력 추정치 × 1(무음 영상 사본) + 16 MB`
모자라면 `DISK_FULL`이에요(재시도하지 않음). 실제로 쓰다가 ENOSPC가 나면 `AudioError DISK_FULL` → `DISK_FULL`이에요.

### 2.5 결과·오류 연결
| `mixAudio` 결과 / `AudioError` | renders.status · error_code | 재시도 | verifyJson.audio · RenderView |
|---|---|---|---|
| `normalized` + accepted | succeeded | – | `status:"normalized", accepted:true` |
| `silent`(디지털 무음) | succeeded. 무음 AAC 트랙이고 음량은 맞추지 않아요. | – | `status:"silent", accepted:null`, 측정값 null |
| `too_short`(3초 미만) | succeeded. 음량은 맞추지 않아요. | – | `status:"too_short", accepted:null`, 측정값은 기록만 해요 |
| `LOUDNESS_OUT_OF_RANGE` (예: 띄엄띄엄 클릭 -15.8) | failed `AUDIO_LOUDNESS_FAILED` | 안 함 | 실패 verifyJson에 최종 측정값과 기준을 기록하고, 결과 파일은 없어요 |
| `LOUDNESS_UNMEASURABLE`(-inf) | failed `AUDIO_LOUDNESS_FAILED` | 안 함 | 같음 |
| `SOURCE_UNSUPPORTED`·`SOURCE_TOO_SHORT` | failed `AUDIO_SOURCE_INVALID` | 안 함 | – |
| `SOURCE_CHANGED` | failed `RENDER_INPUT_CHANGED` | 안 함 | – |
| `STATS_MISMATCH`·`TOOL_FAILED`·`INVALID_INPUT` | failed `AUDIO_FAILED` | 안 함 | – |
| `OUTPUT_INVALID`·`OUTPUT_EXISTS` | failed `RENDER_VERIFY_FAILED` / `STORAGE_FAILED` | 안 함 | – |
| `DISK_FULL` | failed `DISK_FULL` | 안 함 | – |
| `CANCELED` | canceled(`stop==="cancel"`) | – | – |
| `TIMEOUT` | failed `TIMEOUT` | 안 함 | – |
| child가 결과 없이 끝남 | `RENDER_BROWSER_CRASHED`(지금 규칙) | 함(최대 3회) | – |

- `RenderErrorCode`, `RENDER_MESSAGES`에 3개를 추가해요.
  - `AUDIO_SOURCE_INVALID`: "소리 파일을 읽지 못했어요. 편집 화면에서 다른 파일을 골라 주세요."
  - `AUDIO_LOUDNESS_FAILED`: "소리 음량을 기준(-14 LUFS)에 맞추지 못했어요. 소리 구성을 확인해 주세요."
  - `AUDIO_FAILED`: "소리를 합치지 못했어요."
- `RENDER_RETRYABLE`은 바꾸지 않아요.
- **`silent`·`too_short`를 성공으로 둔 근거:**
  - 사용자가 고른 소리가 실제로 그대로 들어간 파일이에요.
  - 잡음을 넣거나 소리를 키워서 "-14를 맞췄다"고 하지 않아요.
  - 화면에서는 "음량을 맞추지 않음"을 따로 표시해요.
  - 실패로 바꿀지는 Master 판단 사항이고, 그래도 이 계약의 다른 부분은 그대로예요.

### 2.6 검사·공개 (worker)
1. `verifyStaged(media,fonts)`(지금 그대로)
2. `verifyRender(out.mp4, expect)` — `VerifyExpect`에 `audio:"none"|"aac"`를 추가해요.
   - `none`이면 항목이 지금과 똑같아요(`audioStreams` 기대값 0). 봉투 A의 verifyJson 바이트 구조도 그대로예요.
   - `aac`이면 `audioStreams:1`로 바꾸고, 다음 항목을 **추가**해요:
     - `audioCodec "aac"`, `audioProfile "LC"`, `audioSampleRate 48000`, `audioChannels 2`
     - `audioDecodedSamples = durationInFrames×1600`(정확히 같아야 함)
     - `audioInitialPadding`(기록만, 판정하지 않음)
     - `videoStreamSha256`(결합 전 `work/video.mp4`와 결합 뒤 영상 패킷의 `-f streamhash -hash sha256`이 같아야 함)
     - `loudnessIntegrated`(normalized일 때만 판정, -14±1), `truePeak`(normalized일 때만 판정, ≤-1)
   - 음량 값은 **최종 파일을 다시 디코드해서 ebur128로 잰 값**이에요. child가 잰 값과 worker가 다시 잰 값을 둘 다 기록하고, 판정은 worker 값으로 해요.
   - `durationSec` 항목은 지금 허용 오차(1/30초)를 유지해요. AAC 패딩은 1024샘플(21ms)이라 그 안에 들어와요. 실제 파일의 영상·소리 duration은 같았어요.
3. 비유한 값 처리: `FinalMeasure`와 `loudness` 값 중 -inf/NaN은 **명시적으로 `null`** 로 저장해요.
   - T-134의 `mixAudio`는 지금 silent의 truePeak를 -Infinity로 돌려줘서 JSON에서 `null`이 돼요.
   - 단계 C에서 타입을 `number|null`로 고쳐서 우연히 바뀌는 일에 기대지 않아요.
4. 해시를 재고 link로 공개하는 방식, 같은 트랜잭션에서 row·job을 끝내는 방식, 늦은 취소(`canceled_late`) 보관은 **지금 코드 그대로**예요. 이미 있는 경로면 해시가 같을 때만 받아들이는 규칙도 같아요.
5. `verify_json` 모양: `{result, items, probe, audio?}`. `audio`는 봉투 B·mix에만 있어요:
```ts
audio:{ mode:"aac"; profile:"p2-5-local-v1"; tools:{ffmpeg:string;ffmpegSha256:string};
  status:"normalized"|"silent"|"too_short"; accepted:boolean|null;
  target:{integrated:-14;truePeak:-2;range:7;tolerance:1;truePeakMax:-1};
  sources:{assetId:string;sha256:string;channels:1|2;decodedSamples:number}[];
  mix:{sha256:string;samples:number;peak:number};
  loudness:null|{preGainDb:number;inputI:number;inputTp:number;inputLra:number;inputThresh:number;targetOffset:number;normalizationType:"linear"|"dynamic";outputI:number|null;outputTp:number|null};
  final:{integrated:number|null;range:number|null;truePeak:number|null};      // worker가 최종 파일에서 다시 잰 값
  childFinal:{integrated:number|null;range:number|null;truePeak:number|null};
  output:{decodedSamples:number;initialPadding:number|null;videoStreamSha256:string} }
```

## 3. API 응답 형태 (경로·상태 코드 그대로, 필드만 추가)
- `GET /api/projects/:id/renders` → `200 {result:{workerOnline,contentRevision,timelineId,check:{ready,blockers}|null,renders:RenderView[]}}`(그대로)
- `POST /api/projects/:id/renders` body `{revision,timelineId}` → `202 {result:{renderId,jobId,existing}}`
  - 오류는 `{error,code,blockers?}`이고 상태 코드 409/404/400/503은 그대로예요.
  - 소리 출력 방식은 **저장된 타임라인으로만** 정해요. 요청 body로 바꿀 수 없어요(strict 스키마 그대로).
- `POST /api/renders/:id/cancel` → `{result:{status,changed}}`(그대로)
- `GET|HEAD /api/renders/:id/file`(그대로)
  - succeeded이고 `!canceledLate`일 때만 줘요. 늦은 취소, 실패, 없는 경우는 404 `NOT_FOUND`예요.
  - 파일 크기가 다르면 409, 파일이 없으면 503이에요.
- `RenderBlocker` 추가:
```ts
|{code:"AUDIO_SOURCE_MISSING";params:{reason:"file_missing"|"not_audio"|"file_changed"|"range";clipId:string;assetId:string}}
|{code:"AUDIO_TOO_LONG";params:{frames:number;maxFrames:18000}}
|{code:"AUDIO_TOOL_MISSING";params:{}}
// AUDIO_RENDER_UNSUPPORTED: params.schemaVersion은 이제 1만
```
- `RenderView` 추가 필드(기존 필드의 의미는 그대로):
```ts
audioMode:"none"|"aac";                              // 입력 봉투에서 읽음. 봉투 A는 "none"
audio:null|{ status:"normalized"|"silent"|"too_short"|null;   // null = 아직 측정 전(queued/running/실패)
  accepted:boolean|null; integrated:number|null; truePeak:number|null; range:number|null;
  target:{integrated:-14;tolerance:1;truePeakMax:-1}; profile:"p2-5-local-v1"; ffmpeg:string; clips:number; hasMusic:boolean };
// progress: audioMode "aac"면 compose 동안 null(불확정 표시, T-130 5장). "none"은 지금처럼 프레임 비율
// textOnlyChange: 비교할 때 timeline.audio·audioJoins와 audioPlan.sources도 "장면" 쪽에 포함(소리가 바뀌면 false)
```
- `audioStreams`는 지금처럼 probe 값을 그대로 줘요(봉투 B·mix 성공이면 1).
- `subtitleMeasure:null`과 `phonePlayback:null`은 그대로 둬요.

## 4. 단계 C 수정 파일·순서·완료 조건
| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `lib/audio/mix.ts` | `FinalMeasure`·`loudness`의 비유한 값을 null로, 타입은 `number|null`. 동작은 그대로 |
| 2 | `lib/render/input.ts` | 봉투 A 이름만 옮기고 B 추가, union, `prepareRender` v2 분기, blocker 4종, 필요한 공간 |
| 3 | `lib/db/migrations/0009_render_audio.sql`(신규) · `lib/db/migrate.ts` | 트리거, LATER_SQL_STEPS 9, verify |
| 4 | `lib/db/render-data.ts` | 1.4 사유 3개를 끝에 추가하고 검사 |
| 5 | `lib/render/errors.ts` | 코드 3개와 문구 |
| 6 | `render/child.ts` · `lib/render/run.ts` | `AudioStart`, stage `audio`, `{type:"audio"}` 전달, abort 연결 |
| 7 | `lib/render/verify.ts` | `expect.audio`, 추가 항목, streamhash, ebur128 다시 재기 |
| 8 | `lib/jobs/render.ts` | 도구 다시 확인, 절대 경로 pin, workRoot, 2.5 연결, verifyJson.audio |
| 9 | `lib/services/renders.ts` · `components/render-panel/copy.ts` | RenderView 필드, blocker·오류 문구(문구만. 화면 배치는 D) |
| 10 | 시험(아래), 보고서 | |

**완료 조건:**
- 아래 matrix가 실제 앱에서 실행돼 통과해야 해요(worker + child + 실제 FFmpeg + 실제 Remotion).
- 봉투 A 회귀 0건이어야 해요: 기존 시험이 바뀌지 않고, 기존 행·파일의 해시가 같아야 해요.
- lint·tsc·전체 vitest·운영 빌드가 통과해야 해요.
- 독립 검수를 따로 받아요.
- 화면 연결과 실제 청취는 D 범위이고, 하지 않았으면 그렇다고 적어요.

### 시험 matrix (단계 C)
| 분류 | 경우 | 기대 |
|---|---|---|
| 봉투 A 회귀 | 기존 v1 무음 렌더 | input_json·verify 항목 동일, 소리 트랙 0, 기존 성공 파일·다운로드 해시 그대로 |
| mode none | v2 + `audio:[]`(권리만 있음) | 봉투 B none, 소리 트랙 0, `audioMode:"none"` |
| v1 원형 거절 | v1 + audio 있음(예전 행) | `AUDIO_RENDER_UNSUPPORTED {schemaVersion:1}`, 작업 생성 안 함 |
| mix 단독·혼합 | voice/music/effect 단독, 셋 혼합, duck 켬·끔 × 9:16/16:9/1:1 | AAC LC 48k 2ch, 디코드 샘플 정확, 최종 -14±1, TP ≤ -1, 영상 streamhash 결합 전과 같음, 프레임·색 항목 그대로 |
| 원본 형식 | mono/stereo × WAV/MP3/M4A, 44.1k | 성공. 정렬 지연 0 확인(T-134 미검증 항목) |
| 분류 | 디지털 무음 / 2초 영상 / 아주 작은 소리 / 띄엄띄엄 클릭 | silent 성공 / too_short 성공 / `AUDIO_LOUDNESS_FAILED` / `AUDIO_LOUDNESS_FAILED`(기준 그대로) |
| 원본 문제 | 요청 뒤 파일 변경, 삭제, 6채널, 짧은 원본 | `RENDER_INPUT_CHANGED` / `RENDER_INPUT_MISSING` / `AUDIO_SOURCE_INVALID` ×2. 요청 단계에서 보이면 blocker |
| 상한 | 18001프레임 + 소리 | `AUDIO_TOO_LONG` blocker |
| 취소·시간 | compose 중 / audio 단계 중 취소, audio 단계에서 시간 초과, worker 강제 종료 | canceled / TIMEOUT / 다음 worker 시작 때 정리. 남은 ffmpeg·chrome pid 0, attempt 폴더 0 |
| 늦은 취소 | 검사 통과 뒤 취소 | canceled_late, 파일 보관, `/file` 404 |
| 저장 공간 | 준비 단계 부족, 쓰는 중 ENOSPC 주입 | `DISK_FULL`, 재시도 안 함, 정리 |
| 재시도 | child 강제 종료(결과 없음) | `RENDER_BROWSER_CRASHED` 재시도 → 성공하면 같은 공개 규칙 |
| 중복·동시성 | 같은 입력 POST 두 번, 다른 창에서 소리 수정 뒤 POST | `existing:true` 한 작업 / `CONFLICT` |
| stale | 성공 뒤 소리만 수정해 저장 | 예전 결과 `stale:true`, `textOnlyChange:false` |
| DB·복원 | 0009 트리거 거절(어긋난 봉투 4종), s7·0008 가상 DB → 0009 승격, 봉투 B 행이 든 백업 복원, 0008 앱이 0009 DB 거절 | 행 해시 보존, `checkRenderRows` 통과·거절 사유 정확, 너무 새로운 DB 거절 |
| 다운로드 | 소리 있는 성공 파일 | 응답 바이트 sha = 행 sha, 이름 규칙 그대로(샘플 표시 포함) |

## 5. 열린 항목 (Master 판단)
1. `silent`·`too_short`를 성공 + 별도 표시로 할지, 실패로 할지 정해야 해요. 이 문서는 성공 + 표시를 제안해요(2.5 근거).
2. 고정 fixture s8(0008)·s9(0009)를 새로 만들지 정해야 해요.
3. 이미 렌더된 결과를 화면에서 미리 듣는 기능은 D 범위예요. 브라우저 근사 미리듣기를 최종 음량과 같다고 표시하지 않아요.
4. 편집용 ZIP에 소리 원본과 사용 구간이 빠져 있는 문제는 계속 P2-6 범위예요(T-132 메모).
