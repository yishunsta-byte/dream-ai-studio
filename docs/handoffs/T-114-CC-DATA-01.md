# T-114 P2-4b 실제 렌더 backend — CC-DATA-01 보고

- 지시: Master msg_d55932f8781e (+ msg_7ab73a5ba1b3 F113-1 필수 통합조건), Claude design 요청 msg_7825752669b7(T-102 14장 값)
- 상태: ready_review (자체 검수, 독립 검수 아님)
- 지킨 것
  - DB migrations·s4~s7 fixture·packages·자산 수정 없음. 렌더 화면 제품 UI·편집 진입 버튼 없음(다음 작업).
  - 실제 사용자 data·storage·backups 접근 없음. 모든 실행은 OS 임시 폴더의 가상 s5 사본과 가상 입력이에요.
  - 루트 `.tools`의 고정 브라우저는 바꾸지 않았어요. 실패 주입은 임시 폴더에 복사한 브라우저에만 했어요(전후 sha 동일).

## 1. 바꾼 파일

| 구분 | 파일 |
|---|---|
| 새 | `lib/render/name.ts` 이름 함수 · `tools.ts` 고정 브라우저 확인·소스 해시 · `input.ts` 입력 묶음·시작 전 확인 · `verify.ts` 앱 ffprobe 확인 · `file-server.ts` 작업 파일 서버 · `props.ts` 컴포지션 값 · `run.ts` 자식 프로세스 한 번 실행·격리 · `errors.ts` 오류 코드·문장 |
| 새 | `render/entry.tsx` · `render/render-composition.tsx` · `render/child.ts` (Next 밖, 자식만 번들) |
| 새 | `components/player/composition-core.tsx` (미리보기·렌더 공용 TextView·Chip·fill·FONT) |
| 새 | `lib/jobs/render.ts` runClaimedRender · `lib/services/renders.ts` |
| 새 | `app/api/projects/[id]/renders/route.ts` · `app/api/renders/[id]/cancel/route.ts` · `app/api/renders/[id]/file/route.ts` |
| 수정 | `components/player/timeline-composition.tsx`(core 사용, 동작 그대로) · `lib/services/jobs.ts`(render 분기) · `lib/jobs/runner.ts`(render 분기) · `worker/main.ts`(시작 시 남은 렌더 작업 폴더 정리) · `scripts/verify-build.mjs`(렌더 도구 추적 거부) |
| 시험 | 새 `tests/p2-4-render-units.test.ts` 13 · `tests/p2-4-render-jobs.test.ts` 8 · `tests/p2-4-render-e2e.test.ts` 9(실제 렌더, `DREAM_RENDER_E2E=1`일 때만) · 수정 `tests/build-tracing.test.ts`(+1) · `tests/p2-3-text-editor.test.ts`(TextView 위치만 core로) |

## 2. API (T-101 2.9 그대로) — design 전달용

- `GET /api/projects/[id]/renders` → `{result:{workerOnline, contentRevision, timelineId, check:{ready, blockers[]}|null, renders:[RenderView]}}`
  - `check.blockers[]`는 이유 **전부**예요. 편집 단계가 승인 전이면 `check={ready:false, blockers:[]}`예요.
- `POST /api/projects/[id]/renders` body `{revision, timelineId}` → **202** `{result:{renderId, jobId, existing}}`
  - 화면의 revision·timelineId가 지금과 다르면 409 `{code:"CONFLICT"}`, 아무것도 만들지 않아요.
  - 같은 입력이 아직 대기·진행 중이면 그 렌더를 `existing:true`로 돌려줘요.
  - 막히면 409 `{error, code:<첫 이유>, blockers:[...]}`.
- `POST /api/renders/[id]/cancel` → `{result:{status, changed}}`. 대기 중이면 바로 끝나고, 진행 중이면 처리기가 끝내요.
- `GET|HEAD /api/renders/[id]/file` → `succeeded`이고 `canceled_late=0`일 때만. DB 크기 대조, Range(206·416), `nosniff`, `private, no-store`, `filename*=UTF-8''<표시 이름>`, `?download`면 attachment.
- 오류 몸체: `{error:<쉬운 문장>, code[, blockers]}`.

### 2.1 blockers (`{code, params}`)
| code | params |
|---|---|
| `RENDER_INPUT_MISSING` | `{reason:"no_timeline"\|"no_scenes"}` 또는 `{reason:"empty_slot"\|"file_missing"\|"file_changed"\|"unsupported_media", sceneId, sceneNumber, sceneTitle}` |
| `FONT_MISSING` | `{family, reason, texts:[{id, preview(20자)}]}` (최대 5개) |
| `TIMELINE_STALE` | `{scenes:[{sceneId, sceneTitle}]}` |
| `RENDER_BROWSER_MISSING` | `{reason:"missing"\|"mismatch", version}` |
| `DISK_FULL` | `{where:"storage", needBytes, freeBytes}` |
| `RENDER_ACTIVE` (새) | `{renderId}` 이 프로젝트에 대기·진행 중인 렌더 |

### 2.2 RenderView (T-102 14장 값)
- 진행: `status`(queued/running/succeeded/failed/canceled), `stage`(prepare/compose/verify), `progress`(compose일 때만 0~1, 그 밖 null), `renderedFrames`, `totalFrames`, `startedAt`, `elapsedSec`, `attempt`, `maxAttempts`(3 = 처음 + 자동 재시도 최대 2), `cancelRequested`
- 대기 이유 `waiting`: `{reason:"worker_off"}` · `{reason:"behind_job", kind}`(앞 작업 종류) · `{reason:"retry_scheduled", at}` · 그 밖 null
- 결과: `timelineRevision`, `contentRevision`, `stale`(내용 revision 또는 현재 타임라인이 다름), `isSample`, `fileName`(받기와 같은 이름 함수), `sizeBytes`, `fileExists`(DB 크기와 같은 파일이 있을 때만 true), `width`·`height`·`fps`·`codec`·`durationSec`·`audioStreams`, `finishedAt`
- 확인: `verify:{result, items:[{item, expected, actual, pass}]}`. 항목은 container·videoStreams·codec·pixelFormat·colorRange·colorSpace·width·height·frameRate·averageFrameRate·frames·durationSec·audioStreams·otherStreams·sizeBytes.
- 취소: `canceledLate`, `cleanupLeft[]`(정리하지 못한 상대경로)
- 실패: `errorCode`, `errorMessage`, `error:{code, retryable, attempts, maxAttempts}`(취소는 null)
- `subtitleMeasure`·`phonePlayback`: 지금은 늘 null(측정 전·확인 전). `textOnlyChange`: 직전 성공과 장면(media·클립·비율)이 같고 글자만 다를 때 true, 비교할 성공이 없으면 null. `etaSec`: 이 PC의 이전 성공(최근 5개) 기록이 있을 때만.
- 작업 목록(`/api/jobs`): 렌더는 `kind:"render"`, 이름 "영상 만들기", `retryable:false`(다시 만들기는 새 요청). 대기 작업마다 `blockedBy`(지금 진행 중인 작업 종류, 없으면 null).

### 2.3 오류 코드
- 이미 T-102에 있는 것: RENDER_INPUT_MISSING, RENDER_INPUT_CHANGED, FONT_MISSING, RENDER_BROWSER_MISSING(+mismatch), RENDER_BROWSER_CRASHED, RENDER_VERIFY_FAILED, RENDER_FAILED, DISK_FULL, STORAGE_FAILED, TIMEOUT, TIMELINE_STALE
- 새로 쓰는 것: **RENDER_CANCELED**(취소), **RENDER_INTERRUPTED**(처리기 중단이 시도 한도까지 반복), **RENDER_ACTIVE**(다른 렌더 진행 중)
- 자동 재시도는 원인으로만: RENDER_BROWSER_CRASHED(브라우저·자식·compositor가 비정상 종료), STORAGE_FAILED(EBUSY·EAGAIN 잠금 경합, 게시 링크 실패). 나머지는 재시도하지 않아요. lease 만료 회수는 다시 처음부터이고 한도에 닿으면 RENDER_INTERRUPTED예요.

## 3. 실행 구조

1. 요청(`lib/services/renders.ts`): 시작 전 확인 → 입력 묶음(canonical JSON, sha256) → 한 트랜잭션에서 CAS 재확인·활성 확인 → jobs 행(kind render, idempotency `render:{projectId}:{inputSha}:{seq}`, maxAttempts 3) 다음 renders 행.
2. 입력 묶음 `RenderInputV1`(`lib/render/input.ts`): 저장된 타임라인 원문·timelineSha256, 출력(h264·yuv420p·bt709·30fps·크기·오디오 없음), `durationInFrames=max(영상, 마지막 글자 끝)`, 장면 파일 `{assetId, kind, relPath, sha256, sizeBytes, isMock}`, 글꼴 `{family, relPath, sha256, sizeBytes, weightMin/Max}`, 렌더러 `{remotion 4.0.543, browser 158.0.8127.2, browserSha256, compositionSourceSha256}`, sample. 절대경로 없음.
3. 처리기(`lib/jobs/render.ts`)
   - prepare: 입력 해시 재확인 → 고정 브라우저 sha·소스 해시·모든 장면/글꼴 파일을 **새로** 재요(다르면 RENDER_INPUT_CHANGED, 없으면 RENDER_INPUT_MISSING/FONT_MISSING, 브라우저 다르면 RENDER_BROWSER_MISSING) → 공간 확인 → 작업 폴더 `storage/tmp/render-{id}-{attempt}` → 작업 파일 서버.
   - compose: 자식 프로세스(`lib/render/run.ts` → `render/child.ts`). 진행은 1초에 1번 이하로 행에 써요. 취소·30분 제한은 250ms마다 확인해요.
   - verify: 앱 ffprobe(아래 4장). 통과해야만 다음으로 가요.
   - publish: `projects/{pid}/renders/{id}.mp4`에 link(덮어쓰기 없음; 이미 있으면 같은 해시일 때만 받아들임) → 한 트랜잭션에서 claim 확인 후 succeeded, 또는 그 사이 취소가 왔으면 canceled + canceled_late(파일 보관, 받기·선택 안 함, 백업 목록에는 들어감).
   - 언제나: 파일 서버 닫기, 작업 폴더 삭제, 못 지운 것은 `cleanup_left_json`.
4. 자식(`render/child.ts`): bundle(소스 해시별 `tmp/render-bundle/{sha}`, part 폴더 뒤 rename) → **openBrowser 먼저**(고정 경로, 다운로드 거부) → selectComposition(같은 인스턴스) → renderMedia(h264·yuv420p·**colorSpace bt709**·muted·concurrency 1·licenseKey null·overwrite false·cancelSignal) → 브라우저 닫기.
5. 컴포지션(`render/render-composition.tsx`): 미리보기와 같은 `TextView`(composition-core)와 `textMotion`을 실제 픽셀 크기로 그려요. 장면은 `Img`/`OffthreadVideo(muted, trimBefore)`. 칩·외곽선·빈 자리 표시·측정 경고는 없어요. 글꼴은 고정 파일을 FontFace로 등록하고 쓰는 굵기마다 로드를 확인해요. 실패하면 `cancelRender("FONT_MISSING:…")`.

## 4. 성공 확인 (앱 ffprobe)
- `-count_frames -show_streams -show_format`, 셸 없음. 컨테이너 mp4, 영상 1개, h264, yuv420p, **color_range tv, color_space bt709**, 크기, r/avg 30/1, 프레임 수 정확히, 길이 ±1/30초, 오디오 0, 그 밖 스트림 0, 크기 > 0.
- 실패하면 RENDER_VERIFY_FAILED(재시도 없음). 행에 항목별 기록만 남기고 파일은 게시하지 않아요.
- 참고: 고정 `s6-inputs/render-passed.mp4`는 색 정보 태그가 없어서 이 확인에서 colorRange·colorSpace만 실패해요(시험으로 고정). 통과 시험은 bt709·tv로 표시한 H.264를 임시 폴더에 새로 만들어 써요.

## 5. F113-1 격리 (필수 통합조건)
- 설계: Remotion이 여는 모든 것(번들러, 브라우저, Remotion 파일·프레임 서버, compositor)은 **렌더마다 새로 띄우는 자식 프로세스 안**에서만 살아요. 부모(처리기)는 자식을 믿지 않아요.
  - 취소·30분 제한: IPC cancel → 10초 안에 안 끝나면 자식 트리 `taskkill /T /F`.
  - 자식이 어떻게 끝나든: 부모가 자식의 자손(부모 사슬 + 생성 시각, 재사용 PID 제외)을 찾아 남은 것을 끝내요.
  - 처리기가 죽으면: 자식이 IPC disconnect를 받아 취소 → 3초 뒤 자기 트리(브라우저·compositor 포함)를 끝내요.
  - 브라우저 실행 실패(사전 확인 뒤 사라짐·실행 불가)는 RENDER_BROWSER_MISSING으로 바꿔요.
  - 자식의 TEMP/TMP를 시도별 작업 폴더 안으로 돌려, 강제 종료 때도 브라우저 프로필·프레임 폴더가 작업 폴더와 함께 지워져요.
- 증거(`tmp/t114-evidence/containment.ts`, 결과 `containment-result.json`) — 임시 폴더에 복사한 브라우저(복사본 sha = 고정값)로만 실패 주입:

| 상황 | 결과 코드 | 걸린 시간 | 자식 살아 있음 | 남은 자손 | 부모 TCP 서버 증가 | OS 임시 폴더 새 항목 |
|---|---|---|---|---|---|---|
| 정상 600프레임 | 성공 | 58.4초 | 아니요 | 0 | 0 | 0 |
| 합치는 중 취소 | RENDER_CANCELED | 4.6초 | 아니요 | 0 | 0 | 0 |
| 합치기 시작 직후 취소 | RENDER_CANCELED | 3.0초 | 아니요 | 0 | 0 | 0 |
| 취소 뒤 강제 종료(유예 1ms) | RENDER_CANCELED(트리 종료) | 4.5초 | 아니요 | 0 | 0 | 0 |
| 실행 중 브라우저 종료 | 성공(Remotion이 브라우저를 다시 띄움, 같은 옵션) | 57.6초 | 아니요 | 0 | 0 | 0 |
| 렌더 자식 종료 | RENDER_BROWSER_CRASHED | 5.4초 | 아니요 | 0(부모가 고아 브라우저 정리) | 0 | 0 |
| 브라우저 실행 성공 뒤 selectComposition 실패 | RENDER_FAILED | 3.1초 | 아니요 | 0 | 0 | 0 |
| 처리기(부모) 강제 종료, 트리 아님 | — | 0.5초 안에 비워짐 | 아니요 | 0 | — | 0 |
| 사전 확인 뒤 exe 이름 바꿈 | RENDER_BROWSER_MISSING | 2.9초 | 아니요 | 0 | 0 | 0 |
| exe를 실행할 수 없는 파일로 바꿈 | RENDER_BROWSER_MISSING | 2.8초 | 아니요 | 0 | 0 | 0 |

  - 복사본 사전 확인 sha = 고정값, 실행 뒤 루트 브라우저 sha도 고정값 그대로(`containment-result-all.json` rootBrowserUntouched true). 실패 경로의 detail에 들어간 PC 경로는 증거 파일에서 `<path>`로 가렸고, detail은 DB에 저장하지 않아요.
  - 처음에는 강제 종료 때 Chrome 프로필·프레임 폴더가 OS 임시 폴더에 남는 것을 찾았어요. 자식 TEMP를 작업 폴더로 돌린 뒤 전 시나리오 0이에요. 그 전에 제 시험이 남긴 14개는 시각을 확인하고 지웠어요.

- "exists/hash 재검사로 TOCTOU 해결"이라고 주장하지 않아요. 사전 확인은 사용자에게 이유를 먼저 보여 주는 용도이고, 안전은 위의 자식 격리와 부모의 무조건 정리로 지켜요.

## 6. 네트워크
- Node 쪽: 자식의 `net.Socket.connect`가 loopback 밖이면 거부(RENDER_NETWORK_REFUSED → RENDER_FAILED).
- 브라우저 쪽: `--host-resolver-rules="MAP localhost 127.0.0.1 , MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `--proxy-server=http://127.0.0.1:9`(닫힌 loopback 프록시), bypass는 loopback만. 브라우저가 Remotion에 의해 다시 띄워져도 같은 옵션이 붙어요.
- 실제 CDP·NetLog 감사(`tmp/t114-evidence/netlog-audit.mjs`, 앱 렌더 실제 실행의 Chrome NetLog 전체 이벤트를 종류별로 분류):

| 비율 | NetLog 이벤트 | URL 요청(바깥) | TCP 연결(바깥) | DNS 작업 | UDP 경로 확인 | 바깥 송신 바이트 | 확인 |
|---|---|---|---|---|---|---|---|
| 9:16 | 15,007 | 39 (0) | 4 (0) | 0 | 1 | 0 | passed, 1080×1920, 60프레임 |
| 16:9 | 14,995 | 39 (0) | 4 (0) | 0 | 1 | 0 | passed, 1920×1080 |
| 1:1 | 15,011 | 39 (0) | 4 (0) | 0 | 1 | 0 | passed, 1080×1080 |

  - 입력: 가상 이미지(색 PNG) + 가상 영상(s6 입력 mp4, trimBefore 15) + 글자 3개(Pretendard fade, Noto Sans KR pop, typewriter). 결과 `tmp/t114-evidence/attempt-*-netlog.json`.

  - URL 요청·TCP 연결은 전부 127.0.0.1/localhost예요. DNS 조회 작업 0건.
  - UDP 1건은 Chrome이 IPv6 경로가 있는지 보려고 UDP 소켓을 connect만 해 보는 것(`2001:4860:4860::8888:443`, 결과 -109 ADDRESS_UNREACHABLE)이에요. UDP connect는 패킷을 보내지 않고, 보낸 바이트 0으로 기록됐어요. 바깥으로 나간 트래픽 합계 0.

## 7. 검증 결과
- 전체 vitest: 46파일, 523 통과 + 13 건너뜀(기존 4 + 실제 렌더 e2e 9). lint(`--max-warnings 0`)·tsc 통과.
- 실제 렌더 e2e(`DREAM_RENDER_E2E=1`, 가상 s5 사본, 9개 모두 통과, 382초, 로그 `tmp/t114-evidence/e2e-run.log`): 요청 → runNextJob → 자식 → ffprobe → 게시 → 받기 라우트.
  1. 9:16 성공: 900프레임(필수 표기 0~900 유지), 행 해시 = 파일 해시, 앱 ffprobe 통과, s5의 다른 저장 파일 바이트 전부 그대로(새 파일 1개만 늘어남), 작업 폴더·렌더 프로세스 0
  2. 받기: 전체 sha 일치, Range 206·416, 이름 RFC 5987, nosniff, private no-store, 잘못된 id 404
  3. 요청 뒤 편집해도 고정 입력대로 성공·stale 표시, 첫 성공 파일 바이트 그대로, 글자만 바꾼 다음 요청은 textOnlyChange true·다른 이름, 장면 파일을 바꾸면 RENDER_INPUT_CHANGED(시도 1번, 재시도 없음)
  4. 16:9(1920×1080)·1:1(1080×1080) 성공·확인 통과
  5. 확인 실패(강제): 게시 없음, 항목별 기록, 저장 파일 변화 없음, 받기 404
  6. 확인 통과 뒤 취소: canceled + canceled_late, 파일 해시 일치·보관, 받기 404, 백업 파일 목록에는 포함
  7. 합치는 중 취소: 파일 없음, 작업 폴더·렌더 자식 0
  8. 렌더 자식 강제 종료 → RENDER_BROWSER_CRASHED로 대기(시도 1) → 시도 2를 가져간 처리기가 멈춘 상황(lease 만료) → 시작 시 정리가 그 작업 폴더를 지움 → 회수 후 시도 3 성공. 렌더 행 검사 통과, 첫 파일 그대로
  9. 모든 렌더 뒤 OS 임시 폴더 새 브라우저 프로필·프레임 폴더 0, storage/tmp 렌더 폴더 0
- DB 시험(`p2-4-render-jobs`): 입력 결정성·절대경로 없음, blockers 전부(file_missing·file_changed·FONT_MISSING·TIMELINE_STALE·RENDER_BROWSER_MISSING mismatch·DISK_FULL), 빈 자리·타임라인 없음, CAS 409, 중복 요청 existing, RENDER_ACTIVE, claim·원인별 재시도·영구 실패·RENDER_INTERRUPTED·대기/진행 취소·수동 재시도 거부·blockedBy.
- 단위 시험(`p2-4-render-units`): 이름, ffprobe 판정(통과·크기/프레임·yuvj420p·pc 범위·bt601·오디오·프레임률·두 번째 영상), 파일 서버(토큰·색인만·../·%2F·%5C·이중 슬래시·POST 405·Range·크기 409·닫힌 뒤 연결 거부), 컴포지션 값, 오류 분류, 브라우저 네트워크 옵션, 소스 해시 범위, app/components/lib/worker가 렌더러·번들러·render/를 가져오지 않음.
- 빌드: 별도 빌드 복사본에 renderer·bundler·compositor 설치본까지 넣고 `npm run build` 통과. `verify-build`가 렌더 도구 추적을 거부하도록 늘렸고(시험 +1), 실제 .nft.json 36개에서 renderer·bundler·compositor·chrome-headless-shell·render/·.remotion·.tools·tmp/render-bundle 0건(`trace-audit.json`).

## 8. 남은 것·판단 필요
- 렌더 화면 UI·편집 진입 버튼은 다음 작업이에요. 위 2장 값으로 그릴 수 있어요.
- `subtitleMeasure`·`phonePlayback`은 측정 기능이 없어 늘 null이에요.
- 고정 s6 입력 mp4는 색 태그가 없어 지금 기준으로는 "확인 실패" 파일이에요. 시험 이름(render-passed)과 의미가 어긋나지만 fixture는 바꾸지 않았어요.
- 번들 캐시 `tmp/render-bundle/{sha}`는 소스 해시마다 하나씩 쌓여요. 오래된 것 정리는 정하지 않았어요.
- 라이선스 판단(Remotion License 회사 조건, compositor의 GPL·fdk-aac)은 T-108대로 은영님·Master 몫이에요.
