# T-101 · P2-4 PC 렌더 구현 준비 설계 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 지시 | Master `msg_8a53f06b4650`, 입력 `msg_b4f3171b0371`(T-102 위치·동시성 결정) |
| 제품 기준 | 이 문서는 **설계만** 해요. 제품 코드·패키지·스키마·브라우저 설치는 하지 않았어요(제품 target은 df094f9→aa7aae0 그대로) |
| 읽은 것 | PLAN 3·9·10·11.2~11.4·13·16·18·22장, T-037/T-040(라이선스), T-057, P2-RENDER-PROTOTYPE-GAP, T-102(화면 명세), 현재 코드(jobs·runner·exports·media·storage·timeline·preview·player·review·workflow·migrations·next.config·verify-build) |
| 패키지 확인 | `npm view` / `npm pack`로 공식 tarball만 내려받아 읽었어요(scratchpad, 설치·실행 안 함, 브라우저 안 받음) |

용어: **입력 묶음(snapshot)** = 렌더가 쓰는 모든 입력을 고정한 JSON. **작업 파일 서버** = 렌더 한 번 동안만 127.0.0.1에 뜨는 읽기 전용 파일 제공기.

---

## 1. 패키지·라이선스·실행 환경 (사실)

### 1.1 버전과 무결성 (npm 레지스트리 기준)

| 패키지 | 버전 | integrity (sha512) | 비고 |
|---|---|---|---|
| `@remotion/renderer` | 4.0.543 (2026-11-11) | `/Q0O0X5Tu9Vycka1iK0YeG7WwszHtErCcMdEp2LYKCn7JONoXmh5MG+WD91RI3NIwkM+OdXsqPY04e27bAYhLw==` | 지금 `latest`는 4.0.544예요. **4.0.543로 고정**(remotion·player와 같은 버전) |
| `@remotion/bundler` | 4.0.543 | `D8NjdhQa4X4KXVnQ4hbsjH36MnL0CFTyV0wNJfVdnhKYXmbCZtzv3LnpijGZArxY1q+wh7CXT9eE3WgnnKqaYg==` | webpack 5.105.0·esbuild 0.28.1·`@rspack/core` 2.3.0(기본 꺼짐) 등을 끌어와요 |
| `@remotion/compositor-win32-x64-msvc` | 4.0.543 (renderer의 optionalDependency) | `sdObydvUpSAjOlc9Mz/oJUNFwR9gCL+Gub4Wq0tu5Y1qEv/P4YslO0kuYhknCGIzq2yTKhK5s4MpVD3FVvr35w==` | 압축 10.8MB, 풀면 29.9MB. **`ffmpeg.exe`·`ffprobe.exe`·`remotion.exe`와 DLL 포함**(DLL 이름상 FFmpeg 7.x 추정) |
| renderer 직접 의존 | `execa` 5.1.1, `ws` 8.21.0, `source-map` 0.8.0, `@remotion/streaming`·`@remotion/licensing` 4.0.543 | — | **install/postinstall 스크립트 없음**(세 패키지 모두) |

### 1.2 라이선스

- 네 패키지(`remotion`·`@remotion/player`·`@remotion/renderer`·`@remotion/bundler`)의 `LICENSE.md`가 **바이트 동일**해요. sha256은 `53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09`예요. 지금 설치된 `node_modules/remotion/LICENSE.md`와도 같아요.
  - T-037 8장 ② "버전마다 LICENSE 해시 대조"에 따라 이 값을 기준으로 삼아요.
  - 설치 시험에서 다시 대조해요.
- 무료 대상은 개인, 영리 3명 이하, 비영리, 평가 중이에요. 사용자 답 "개인 활동이야"(T-040)에 따라 개인 무료 대상이에요. **추가 질문은 필요 없어요.**
- **새로 확인한 사실 (Master 결정 필요 D-1)**: `renderMedia`에 `licenseKey`를 넣으면 렌더가 성공한 뒤 사용 기록 이벤트를 보내요. `"free-license"`라는 값을 넣어도 마찬가지예요.
  - 보내는 곳: `https://www.remotion.pro`, 이벤트 `cloud-render` (`@remotion/licensing/dist/register-usage-event.js`, `renderer/dist/render-media.js` 580~600줄)
  - `licenseKey: null`이면 아무것도 보내지 않아요(공식 문서 telemetry: "Server-side rendering only sends telemetry when a license key is set"). 라이선스 FAQ에는 무료 사용자의 서버 렌더 telemetry는 "voluntary"라고 적혀 있어요.
  - T-037 8장 ③은 `"free-license"`를 넣는다고 적었는데, 그때는 이 전송이 알려지지 않았어요.
  - 이 앱은 127.0.0.1 로컬 전용이고 외부 전송을 최소화하는 원칙이에요. 그래서 **`licenseKey: null`(전송 없음)을 추천**하고, T-037 ③을 갱신해 달라고 요청해요.

### 1.3 브라우저

- 렌더는 Chrome Headless Shell을 써요. 고정 버전은 `158.0.8127.2`이고(`renderer/dist/browser/get-chrome-download-url.js`), Windows 주소는 `https://remotion.media/chromium-headless-shell-win-x64-158.0.8127.2.zip`예요.
- **기본 동작은 첫 렌더 때 자동 다운로드**예요. `openBrowser`가 `internalEnsureBrowser`를 불러요.
  - 저장 위치는 `process.cwd()`에서 가장 가까운 `package.json` 폴더의 `node_modules/.remotion/chrome-headless-shell/win64/`예요.
  - 즉 **실행 위치에 따라 저장소 아래로 수백 MB가 받아져요.** 크기는 문서·코드에 없어요(미확인).
- 설계 (D-2)
  - **렌더 중 자동 다운로드는 금지해요.**
  - 브라우저는 별도 설치 스크립트로 `.tools/remotion-browser/158.0.8127.2/`에 받아요. 기존 `scripts/install-media.ps1`과 같은 방식이고, 받은 zip은 sha256으로 고정해요.
  - 렌더할 때는 `browserExecutable`에 그 경로를 명시해요.
  - 없거나 버전이 다르면 `RENDER_BROWSER_MISSING`으로 시작 전에 막고, 설치 안내를 보여 줘요.
  - `.tools`는 이미 빌드 추적(verify-build)과 git에서 빠져 있어요.
- 이 스크립트를 실행하는 것(바이너리 내려받기)은 **사용자·Master 승인이 필요해요.** 이번에는 실행하지 않았어요.

### 1.4 실행 위치

- 공식 문서: "You cannot use `@remotion/bundler` inside an API route". `bundle()`은 런타임에 영상마다 부르지 말고 한 번 만들어 다시 쓰라고 해요. Next 안 자체 호스팅은 "not officially supported"예요.
- 설계: **렌더러·번들러는 Next 서버에서 import하지 않아요.**
  - Next 라우트는 작업을 넣고 조회만 해요.
  - 실제 렌더는 `npm run worker`가 띄우는 **렌더 자식 프로세스**에서만 해요(2.3).
  - 그러면 Next 빌드 추적과 `serverExternalPackages`에 영향이 없어요. 대신 tracing 시험을 하나 추가해요(2.9).
- Node: 두 패키지 모두 `engines`가 없어요. remotion v4의 런타임 최소는 16이에요. 앱의 `^22.13 || >=24`면 충분해요.
- ffmpeg
  - 렌더 인코딩은 compositor 패키지의 ffmpeg를 써요(`binariesDirectory` 기본).
  - **검증은 앱의 `.tools/ffmpeg/ffprobe.exe`(9.0.2)로 따로 해요.** 렌더한 도구로 자기 결과를 확인하지 않게 하려는 거예요.

### 1.5 출력 쓰기 방식 (패키지 코드 확인)

- mp4는 임시 파일에 쓴 뒤 `<output>.<uuid>.remotion-in-progress`로 faststart remux하고 마지막에 옮겨요.
  - `overwrite:true`면 `rename`, `overwrite:false`면 `fs.link`예요. 이미 있으면 EEXIST로 끝나지만, **렌더가 끝난 뒤에야 실패해요.**
- 설계: 출력은 **작업 전용 임시 폴더**(`storage/tmp/render-{renderId}-{attempt}/out.mp4`)에만 써요.
  - 검증을 통과하면 앱이 직접 `link`로 최종 위치에 둬요. 기존 `receiveUpload`·export 패턴이고, 덮어쓰기는 없어요.
  - 그래서 렌더러의 overwrite 동작은 최종 파일에 영향을 주지 않아요.

---

## 2. 구현 설계

### 2.1 범위 경계 (P2-4 / P2-5)

- P2-4는 **장면 영상·이미지 + 글자 합성, 소리 없음**이에요. 지금 타임라인 저장은 `audio[]`를 거부해요(`lib/services/timeline.ts:52`). T-102에 따라 칩은 "소리 없음 · 다음 단계에서 붙여요"이고, 소리 단계는 보이지 않아요.
- 출력: H.264, `yuv420p`, 30fps, 크기 `PREVIEW_SIZE[aspect]`(1080×1920 / 1920×1080 / 1080×1080), `muted:true`.
- 검증은 **오디오 스트림 0개가 맞는지** 확인해요. 무음 AAC를 억지로 넣어 "소리 있음"처럼 보이게 하지 않아요.
- PLAN 11.4 "ffprobe가 오디오 트랙을 확인해야 성공"은 **P2-5에서 적용**해요. P2-4에서는 "오디오 트랙 없음이 기대값"으로 정직하게 표시해요. **PLAN 문구 확인이 필요해요 (D-3).**
- 유료 클라우드(Lambda 등)는 쓰지 않아요. 로컬만이에요.
- 내보내기: Master 결정대로 **기존 P1 편집용 묶음 ZIP 조건은 바꾸지 않아요.** 완성 영상 MP4 내보내기(ZIP `final/`)는 P2-4 범위 밖이고, 결정 뒤 따로 해요.

### 2.2 입력 묶음 (불변·해시)

렌더 요청 시점에 서버가 만들어서 저장해요. 이 뒤로는 바뀌지 않아요.

```text
RenderInputV1 = {
  schemaVersion: 1,
  projectId, contentRevision, timelineRevId, timelineRevision, timelineSha256,   // timeline_revisions 행 그대로
  timeline: Timeline,                                    // 저장된 timeline_json 원문(파싱 후 canonical)
  output: { codec:"h264", pixelFormat:"yuv420p", fps:30, width, height, audio:"none" },
  durationInFrames,                                      // max(영상 총 프레임, 마지막 글자 끝) = previewProps와 같은 규칙
  media: [{ assetId, kind, relPath, sha256, sizeBytes, isMock }],   // 장면 선택 결과 파일, 저장 경로는 상대경로
  fonts: [{ family, relPath, sha256 }],                  // 쓰인 글꼴만, public/fonts 기준
  renderer: { remotion:"4.0.543", browser:"158.0.8127.2", compositionSourceSha256 },
  sample: boolean
}
inputSha256 = sha256(canonicalJson(RenderInputV1))
```

- 시작 전 확인 (서버, T-102 R-1 순서)
  1. 저장 안 한 변경 → 화면에서 막아요.
  2. 저장된 타임라인 없음 → `RENDER_INPUT_MISSING`
  3. 결과 미선택 빈 자리 → `RENDER_INPUT_MISSING`, PLAN 11.2
  4. 파일 없음 또는 sha 불일치 → `RENDER_INPUT_MISSING`
  5. 글꼴 파일 없음 → `FONT_MISSING`
  6. 타임라인이 지금 선택과 다름 → 기존 `TIMELINE_STALE`
  7. 브라우저 없음 → `RENDER_BROWSER_MISSING`
  - 여러 개면 목록으로 돌려줘요.
  - **검수 승인은 요구하지 않아요.** stale 검수는 안내만 해요.
- CAS: 요청 본문 `{revision, timelineId}`가 프로젝트의 `contentRevision`·`currentTimelineRevId`와 같아야 해요(`assertRevision`과 같은 방식). 다르면 409예요.
- 입력 묶음은 DB 행(2.6)에 JSON으로 저장해요.
  - 자식 프로세스는 **이 JSON만** 받아요. DB를 직접 열지 않아요.
  - 시작할 때 매체·글꼴 파일의 sha256을 다시 재요. 다르면 `RENDER_INPUT_CHANGED`로 실패하고, 재시도하지 않아요.

### 2.3 실행 구조

```text
Next 라우트 ──(작업 넣기, 조회, 취소 요청)──> SQLite jobs/renders
worker/main.ts (기존 루프, 전체 동시 1, lease 60s / heartbeat 20s 그대로)
  └ runClaimedRender(job)
      ├ 입력 묶음 읽기·파일 sha 재검사 (단계: 준비)
      ├ 작업 파일 서버 열기 (127.0.0.1:임의 포트, 32바이트 토큰 경로, 묶음에 있는 파일만, GET만)
      ├ child_process.fork("render/child.ts", { execArgv: tsx, windowsHide:true, IPC })
      │    ├ bundle 캐시 확인/생성 (2.4)
      │    ├ openBrowser({browserExecutable, chromeMode:"headless-shell"})
      │    ├ selectComposition({id:"DreamTimeline", inputProps})
      │    └ renderMedia({codec:"h264", outputLocation: 작업 임시폴더/out.mp4, muted:true,
      │         cancelSignal, onProgress→IPC(1초에 1번 이하), licenseKey:(D-1), concurrency:(D-5),
      │         timeoutInMilliseconds:60_000, logLevel:"warn"})
      ├ 진행 IPC → renders.progress 갱신 (worker 쪽, 1초에 1번 이하)
      ├ 파일 확인 (단계: 확인, 퍼센트 없음) — 2.5
      └ 커밋: link → 행 succeeded (한 트랜잭션), 임시 폴더 정리
```

- worker 이벤트 루프는 렌더에 막히지 않아요. 무거운 일은 자식 프로세스가 하고, 기존 20초 heartbeat가 계속 돌아요(lease 60초 유지).
- 자식 프로세스 수명
  - `process.on("disconnect")`가 오면 `cancel()` 뒤 종료해요. worker가 죽으면 자식도 끝나요.
  - 브라우저는 자식이 연 것만 닫아요.
- 시간 제한은 PLAN 9장의 **render 30분**이에요. 기존 `job.{id}.startedAt` 기준이라 재시도를 넘어서 세요. 넘으면 취소와 같은 절차를 밟고 `TIMEOUT`이에요.

### 2.4 컴포지션 재사용과 번들

- 지금 `TimelineComposition`(`components/player/timeline-composition.tsx`)은 그대로 렌더에 쓸 수 없어요.
  - `"use client"`, `@/` 별칭을 써요.
  - 앱 CSS 변수(`--bg-sunken`, `--font-pretendard` 등)에 기대요.
  - 미리보기 전용 칩·외곽선·빈 자리 표시가 있어요.
  - 상대 URL `/api/assets/{id}`를 써요.
- 설계
  1. **공용 순수 부분을 분리해요.** `TextView`·`textMotion`·`fontStack` 계산과 장면 배치를 `components/player/composition-core.tsx`로 옮겨요. CSS 변수가 아니라 값을 직접 써요. `TimelineComposition`(미리보기)과 `RenderComposition`(렌더)이 같은 core를 써요.
     - 미리보기 결과가 바뀌지 않는지 기존 P2-2·P2-3 시험과 스크린샷으로 확인해요.
     - 미리보기 전용 표시는 TimelineComposition에만 남겨요.
  2. 렌더 진입점 `render/entry.tsx`: `registerRoot(Root)`, `<Composition id="DreamTimeline" component={RenderComposition} calculateMetadata={({props})=>({durationInFrames, width, height, fps:30})}/>`
  3. `RenderComposition`
     - 빈 자리나 실패한 파일이 있으면 그리지 않고 **렌더 실패**로 처리해요(`delayRender`→`cancelRender`). 미리보기처럼 빈 자리 표시를 넣지 않아요.
     - 장면 영상은 `OffthreadVideo`, 이미지는 `Img`이고, 둘 다 작업 파일 서버의 절대 URL을 써요.
     - 글꼴은 `FontFace(family, url(작업서버/font/...))` + `delayRender`로 불러요. 실패하면 `FONT_MISSING`이에요.
  4. 번들
     - `bundle({entryPoint:"render/entry.tsx", webpackOverride: @→저장소 루트 별칭, outDir:"tmp/render-bundle/{compositionSourceSha256}", enableCaching:false})`
     - **소스 해시가 같으면 다시 쓰고**, 영상마다 만들지 않아요.
     - `compositionSourceSha256`은 entry와 그것이 import하는 저장소 파일들의 정렬된 해시예요. 입력 묶음에 들어가요.
     - 번들 폴더는 `tmp/` 아래라 git·빌드 추적에서 빠져요.

### 2.5 파일 확인 (성공 전 필수)

앱 `ffprobe`로 실행해요(`mediaBinary("ffprobe")`, `execFile`, 셸 없음, `windowsHide`, 30초).

```text
ffprobe -v error -count_frames -show_streams -show_format -of json out.mp4
```

| 항목 | 기대값 |
|---|---|
| format | `mov,mp4,...`, `format.duration` 있음 |
| video 스트림 | 정확히 1개, `codec_name=h264`, `pix_fmt=yuv420p`, `width×height = output` |
| fps | `r_frame_rate`·`avg_frame_rate` = `30/1` |
| 프레임 수 | `nb_read_frames = durationInFrames` (정확히) |
| 길이 | `|duration − durationInFrames/30| ≤ 1/30초` |
| audio 스트림 | **0개**(P2-4). P2-5에서 1개·aac·loudness로 바뀜 |
| 그 밖의 스트림 | 0개 |
| 파일 | 크기 > 0, sha256 계산(`fileDigest`) |

- 하나라도 다르면 `RENDER_VERIFY_FAILED`예요.
  - 결과 행은 남기되 **재생·받기 없음**이고, 다시 만들기만 할 수 있어요(T-102 ⑤).
  - 파일은 최종 위치로 옮기지 않고 정리해요. 확인 기록(`verify_json`)은 남겨요.
- 성공 표시는 이 확인을 통과하고 커밋된 뒤에만 해요. 그 전 UI 단계는 "확인 중"이고 퍼센트는 숨겨요(T-102 ③).

### 2.6 스키마 0006 안 (구현 안 함, 제출만)

```sql
CREATE TABLE renders (
  id TEXT PRIMARY KEY,                              -- uuid v7
  project_id TEXT NOT NULL REFERENCES projects(id),
  job_id TEXT UNIQUE REFERENCES jobs(id),
  timeline_rev_id TEXT NOT NULL REFERENCES timeline_revisions(id),
  timeline_revision INTEGER NOT NULL,
  content_revision INTEGER NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  input_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  stage TEXT CHECK (stage IN ('prepare','compose','verify')),
  progress_permille INTEGER CHECK (progress_permille BETWEEN 0 AND 1000),
  frames_total INTEGER NOT NULL, frames_done INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL, name_seq INTEGER NOT NULL,   -- {slug}_{비율}_r{N}[_SAMPLE] + (seq>1 ? -seq)
  is_sample INTEGER NOT NULL CHECK (is_sample IN (0,1)),
  file_path TEXT UNIQUE, sha256 TEXT, size_bytes INTEGER, -- succeeded일 때만
  verify_json TEXT CHECK (verify_json IS NULL OR json_valid(verify_json)),
  canceled_late INTEGER NOT NULL DEFAULT 0,              -- 취소 뒤 끝난 통과 영상(보관만)
  cleanup_left_json TEXT,                                 -- 정리 못 한 임시 경로(상대)
  error_code TEXT, error_message TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE (project_id, timeline_rev_id, name_seq)
);
CREATE UNIQUE INDEX renders_one_active ON renders(project_id) WHERE status IN ('queued','running');
-- succeeded 행의 파일 필드·input 불변 트리거(exports/assets와 같은 방식), 삭제 금지 트리거
```

- 왜 `assets`가 아니라 새 표인가
  - 렌더는 장면 하나가 아니라 타임라인 버전 전체의 결과예요.
  - 진행·확인·취소 상태를 가져야 해요.
  - `assets`의 `origin 'render'`/`role 'final'`은 나중에 ZIP `final/` 등록용으로 쓸 수 있어요(D-4).
- 프로젝트당 진행 중 1개(Master 결정)는 부분 유일 인덱스로 DB에서 강제해요.
- 같은 입력 해시로 진행 중인 작업이 있으면 그 작업을 돌려줘요(T-102 ⑥).
- 끝난 뒤 "다시 만들기"는 새 행이고 `name_seq+1`예요(`-2`).
- 이름 함수는 `renderFileName(project, aspect, timelineRevision, isSample, seq)` 하나만 두고, 표시·받기·나중 ZIP `final/`이 같이 써요(T-057 R1).
  - slug 함수가 아직 없어요. 규칙은 D-6에서 정해요.
- 백업·복원 (S5→S6)
  - 0006이 들어가면 기존 s5 백업을 복원할 때 0006을 **결정적으로** 적용해야 해요. 빈 `renders` 표와 인덱스·트리거가 생겨요.
  - 이 검증은 별도 작업으로 분리해요.
    - 새 고정 fixture `s6.zip`/`s6.json`(0006 적용, 가상 렌더 행 1개 포함)
    - s5→s6 변환 비교
    - 0001~0005 원문·s4/s5 fixture 바이트 불변
    - 복원 중 실행 중 렌더는 `RESTORE_INTERRUPTED`로 실패 처리(`restore.ts:58`과 같은 방식)
  - 백업에 렌더 mp4를 넣을지는 D-7이에요.

### 2.7 작업 상태·취소·재시도·이전 결과

- jobs 연결
  - `kind:"render"`, `ref_type:"render"`, `ref_id = renders.id`
  - `idempotency_key = render:{projectId}:{inputSha256}:{name_seq}`
  - 고칠 곳
    - `claim`: 지금 `jobs.ts:47`에서 미지원 kind로 거부해요.
    - `runner` 분기: `runner.ts:18` 근처
    - `list` 라벨 "영상 만들기"
    - `recover`·`cancel`·`fail`·`retry`
    - `restore.ts`
- 취소
  1. `cancel_requested_at`을 둬요(기존 방식).
  2. worker가 250ms마다 확인해서 자식에 IPC `cancel`을 보내요.
  3. 자식은 `makeCancelSignal().cancel()`을 부르고 브라우저를 닫아요.
  4. **10초 안에 안 끝나면 `taskkill /PID {child} /T /F`**로 자식·브라우저 트리를 끝내요(자식 PID만 대상).
  5. 임시 폴더를 지워요. 실패한 경로는 `cleanup_left_json`에 상대경로로 남기고, 화면에 "임시 파일을 정리하지 못했어요 + 남은 경로"를 보여 줘요(T-057 R3).
  6. 이미 성공한 예전 렌더 파일은 건드리지 않아요. 시험에서 해시가 같은지 확인해요.
- 취소 요청 뒤 렌더·확인이 이미 끝났으면 → `status canceled`, `canceled_late=1`
  - 통과한 파일은 보관하되 "취소 뒤 끝남"으로 표시해요.
  - 선택·내보내기 대상이 아니에요(PLAN 9장 "늦은 결과는 저장하되 자동 선택 안 함").
- 재시도
  - 결정적 실패는 재시도하지 않아요: `RENDER_VERIFY_FAILED`, `RENDER_INPUT_CHANGED`, `FONT_MISSING`, `RENDER_INPUT_MISSING`.
  - 자동 재시도는 `RENDER_BROWSER_CRASHED`(브라우저나 자식이 신호로 죽음)와 `STORAGE_FAILED`/`DISK_FULL`만 최대 2회예요. 기존 backoff를 써요.
  - 재시도는 새 임시 폴더(`-{attempt}`)에서 처음부터 해요.
- worker가 다시 시작될 때 (lease 만료 → `recover`)
  - 렌더는 처음부터 다시 해요.
  - 시작할 때 `storage/tmp/render-*` 중 진행 중 작업이 아닌 폴더를 정리하고 남은 것을 기록해요.
- 디스크: 시작 전에 `statfs` 여유 공간을 확인해요. 예상은 `frames × 해상도 기준 상한`이고, 부족하면 `DISK_FULL`이에요.

### 2.8 진행률 (서버·화면)

- 단계 (T-102 ②)
  - `prepare`: 파일 재검사, 번들, 브라우저, 컴포지션 선택 — 퍼센트 대신 "준비 중"
  - `compose`: `renderMedia` 진행 — `progress`, `renderedFrames/encodedFrames`
  - `verify`: 퍼센트 없음
- worker가 IPC로 받은 값을 1초에 1번 이하로 `renders`에 써요. `GET /api/projects/[id]/renders`는 2초마다 폴링해요(기존 규칙).
- 예상 시간은 **같은 PC의 이전 성공 기록이 있을 때만**(T-102 ⑨) 보여 줘요. `frames_total`과 걸린 시간의 비율로 계산해요.
- "글자만 바뀌었어요 — 장면은 다시 만들지 않아요"
  - 직전 성공 렌더와 `media[]`가 같고 `text[]`만 다를 때만 보여 줘요(판단할 수 없으면 숨김).
  - 렌더는 늘 전체를 다시 합치지만, 장면 **생성**은 하지 않는다는 뜻이에요(PLAN T-1).

### 2.9 라우트·보안·추적

| 라우트 | 동작 |
|---|---|
| `POST /api/projects/[id]/renders` | `{revision,timelineId}` → 시작 전 확인 + CAS → 202 `{renderId, jobId, existing}` |
| `GET /api/projects/[id]/renders` | 행 목록(상태·단계·진행·확인 결과·stale 여부 = `content_revision ≠ project.contentRevision`) |
| `POST /api/renders/[id]/cancel` | 취소 요청 |
| `GET /api/renders/[id]/file` | succeeded이고 `canceled_late=0`일 때만. 크기를 DB와 대조, Range, `nosniff`, `private, no-store`. `Content-Disposition`은 표시 이름(RFC 5987) |

- 작업 파일 서버
  - 127.0.0.1에만 열어요. 토큰 경로는 작업마다 새로 만들어요.
  - 입력 묶음의 `relPath`만 `resolveStoredFile`로 풀어요(F-2 루트 안 확인). 다른 경로는 404예요.
  - 렌더가 끝나면 바로 닫아요.
  - 브라우저에는 이 서버와 번들 서버 외의 주소를 주지 않아요.
- Next 추적
  - 렌더러·번들러·compositor·`.remotion`·`tmp/render-bundle`이 어떤 `.nft.json`에도 들어가지 않는지 `scripts/verify-build.mjs`와 `tests/build-tracing.test.ts`에 검사를 더해요.
  - 렌더 코드는 `render/`(Next 밖)에만 두고, `app/`에서 import하지 않는 정적 시험을 둬요.

### 2.10 바꿀·새로 만들 파일 (구현 단계용 목록)

| 구분 | 파일 |
|---|---|
| 새 | `render/entry.tsx`, `render/render-composition.tsx`, `render/child.ts`, `lib/render/input.ts`(입력 묶음·해시·시작 전 확인), `lib/render/verify.ts`(ffprobe 확인), `lib/render/file-server.ts`, `lib/render/name.ts`(이름 함수), `lib/services/renders.ts`, `lib/jobs/render.ts`(runClaimedRender), `app/api/projects/[id]/renders/route.ts`, `app/api/renders/[id]/cancel/route.ts`, `app/api/renders/[id]/file/route.ts`, `app/(studio)/projects/[id]/render/page.tsx` + `components/render-panel.tsx`(T-102), `lib/db/migrations/0006_renders.sql`, `scripts/install-render-browser.ps1`, `components/player/composition-core.tsx` |
| 수정 | `components/player/timeline-composition.tsx`(core 사용), `lib/services/jobs.ts`, `lib/jobs/runner.ts`, `lib/services/restore.ts`, `lib/db/schema*`/repo, `scripts/verify-build.mjs`, `package.json`(+`@remotion/renderer`·`@remotion/bundler` 4.0.543 정확 고정, `allowScripts` 변경 없음), 편집 화면 진입 버튼 |
| 시험 | `tests/p2-4-render-input.test.ts`(해시 결정성·시작 전 확인 7종·CAS), `tests/p2-4-render-verify.test.ts`(고정 작은 mp4 fixture로 ffprobe 판정 합격·불합격 각각), `tests/p2-4-render-jobs.test.ts`(claim·취소·late·재시도 분류·recover·한 프로젝트 1개 인덱스), `tests/p2-4-render-name.test.ts`, `tests/p2-4-render-tracing.test.ts`, migration 0006·s6 백업 시험(분리 작업) |

---

## 3. 완료 조건 (P2-4)

1. build·lint·typecheck·test 통과. 위 새 시험 포함.
2. **실제 렌더**: 가상 프로젝트(9:16, 이미지 장면 + 영상 장면 + 글자 3개 이상, 움직임 포함)를 실제 headless 브라우저로 렌더해요.
   - ffprobe 표 전 항목이 통과해요.
   - 파일 sha256이 DB와 같아요.
   - 16:9·1:1은 각 1개를 짧게 렌더해요.
3. **자막 오차**: 렌더된 영상에서 글자 시작·끝 프레임을 검출해요(글자 영역 픽셀 변화 측정 스크립트). 타임라인과 비교해 최대 오차 ≤ 0.2초여야 해요(PLAN 18 P2 종료 기준). 측정 기록이 없으면 화면은 "측정 전"이에요.
4. 취소(진행 중 실제 취소 → 자식·브라우저 프로세스 0개, 임시 폴더 0개 또는 남은 경로 표시), 늦은 결과, 확인 실패(일부러 프레임 수가 다른 파일), 재시작 복구를 각각 실제로 실행해요.
5. 이전 성공 파일 해시 불변, `-2` 이름, stale 표시, 두 창 동시 요청 → 작업 1개.
6. CDP 감사: 렌더 중 브라우저 요청이 127.0.0.1 밖으로 0건이에요. `licenseKey:null`이면 외부 전송도 0이에요.
7. T-102 R-1~R-12를 화면에서 확인해요(1280·390, 실제 재생·실제 받기 이름).
8. 휴대폰 실제 재생은 PLAN 18 기준상 실제 기기 증거가 필요해요. 없으면 "확인 전"으로 남기고 P2 종료 판정에서 따로 봐요.

## 4. Master 결정 필요

| ID | 질문 | 추천 |
|---|---|---|
| D-1 | `licenseKey`: `"free-license"`(성공마다 remotion.pro로 사용 이벤트 전송) vs `null`(전송 없음) | **null**. T-037 ③ 갱신 |
| D-2 | 브라우저(Headless Shell 158.0.8127.2) 받기: 렌더 중 자동 vs 별도 설치 스크립트로 `.tools/remotion-browser`에 sha 고정 | **별도 설치 스크립트**. 실행은 사용자 승인 뒤 |
| D-3 | PLAN 11.4 "오디오 트랙 확인"을 P2-4에서는 "오디오 트랙 0개가 기대값"으로 읽기 | 그렇게 읽고 P2-5에서 AAC 확인으로 바꿈 |
| D-4 | 렌더 결과 저장: 새 `renders` 표(0006) vs `assets`에 넣기 | **새 표**. `assets` 등록은 ZIP `final/` 정할 때 |
| D-5 | `concurrency`(브라우저 탭 수): 기본 `min(8, cpu/2)` vs 낮게 고정(예: 2) | PC가 함께 쓰이니 **기본의 절반, 최소 1**. 설정 화면 없이 |
| D-6 | 이름 slug 규칙(한글 제목 → 파일 이름): 한글 유지 vs 로마자 | 한글 유지 + 금지 문자만 `_`. Windows 예약어·길이 80자 제한 |
| D-7 | 백업에 렌더 mp4 포함 여부 | 행만 포함, 파일은 제외(다시 만들 수 있음). "파일 없음" 표시 |
| D-8 | 30분 렌더 동안 다른 작업(생성·내보내기·백업)이 기다림(전체 동시 1 유지) | 유지(Master 결정). 화면에 "영상 만드는 중이라 기다려요" 표시 |
| D-9 | 4.0.544가 latest예요. 4.0.543 유지 | **유지**(remotion·player와 같은 버전) |

## 5. 확인하지 못한 것

- Headless Shell zip의 실제 크기·sha256: 받지 않았어요. D-2 승인 뒤 설치 스크립트에 고정해요.
- compositor의 FFmpeg 정확한 버전(DLL 이름으로 7.x 추정)
- 실제 렌더 속도와 메모리(이 PC): 설치·실행 전이라 모름
- `OffthreadVideo`가 토큰 경로 http 주소로 문제없이 읽는지, Range가 필요한지: 첫 구현 시험에서 확인해요.
- 4.0.544와의 차이: 비교 안 함
