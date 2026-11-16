# T-100 · P2-3b 충돌 소유권·전체 복구 자료 최종 독립 집중 검수

- 검수자: Codex 독립 작업자. T094/T097/T098 구현에 참여하지 않음. Task `task_ce3215807f6f`, Dispatch `ctx_7d222feb0135`.
- 대상 / 시작·종료 HEAD: **df094f93aaec15fcfbec4e8ab4b68700a998d20f**. T097 `1bc070e`, T094 `9333b11` 포함.
- 판정: **집중 기능 검수 PASS — F096-1 원래 경합 경로에서 외부 최신본 덮어쓰기 방지, 전체 복구 JSON 보존 확인.** 새 필수 데이터 손실 결함은 발견하지 않았다. 전체 P2 또는 배포 인수를 선언하지 않는다. 아래 실제 native unload 확인 및 일부 화면 측정 갭은 남는다.
- 저장소 변경은 **이 보고서 하나**. 제품/시험/fixture/공유 문서 수정, commit/push 없음. 검수용 OS-temp 사본·계측·가상 DB는 저장소 변경과 구분한다.
- 읽은 기준: AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 역할 문서, PLAN/REVIEW/TEAM, T093 원래 F093-1~4, T094, T096 정확한 F096-1, T097/T098. 설치 Next 16.4.6 output/file tracing 가이드 확인. Master가 전달한 T099 디자인 B0는 참고이며 아래 독립 실증을 대체하지 않는다.

## 1. 격리·실행·원본 검사

보존 증거 루트:

```text
C:/Users/Administrator/AppData/Local/Temp/t100-review-0f23446688ab40209c10bc063ace1ec8/
```

배정 child의 tracked 파일을 실제 checkout 바이트 그대로 새 `app/`에 복사하고 별도 `npm.cmd ci`로 설치했다. 기존 `.next`, node_modules, root 사용자 data/storage/backups/.env.local, 기존 서버를 사용하지 않았다. 고정 s4 ZIP을 제품 `verifyBackupArchive`로 새 `app/runtime2/`에 추출하고 제품 migration을 적용했다. 가상 프로젝트 template snapshot만 현재 메뉴 snapshot으로 보강했다. 이전 T096 setup/DB 비교 스크립트를 읽어 이번 새 root에 복제·직접 실행했으며 이전 runtime/결과를 재사용하지 않았다.

| 이번 독립 실행 | 결과 / 증거 |
|---|---|
| `npm.cmd ci` | PASS, `install.log` |
| 원본 TS/TSX 줄바꿈 | **CRLF180 / LF-only0**, `app/crlf.json` |
| `npm.cmd test` | **39 files / 467 passed / 2 skipped / 0 failed**, 24.93s, `tests.log` |
| `npm.cmd run lint` | PASS, max-warnings0, `lint.log` |
| `npm.cmd run typecheck` | PASS, Next typegen + tsc, `typecheck.log` |
| `npm.cmd run build` | PASS, production + verify-build 로컬 데이터/비밀 추적 없음, `build.log` |
| 원본 ↔ production 사본 | app/components/lib/tests/public/scripts/config 및 관련 설정 **252파일 byte 동일, 차이0**, `source-integrity.json` |

작성자 T098의 **467+2**와 위 **독립 467+2**는 별도 실행이다. fixture 재생성/줄바꿈 정규화/시험 수정 없음. 검사 ffmpeg/ffprobe는 `D:/starwork/dream-ai-studio/.tools/ffmpeg/` 실행 파일을 사용했다.

운영 서버는 새 사본 cwd, `DREAM_DATA_ROOT=<root>/app/runtime2`, `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100`. ego-browser **TaskSpace91 / p1만** 사용했다. 실제 테스트 프로젝트는 `019b8b74-3f10-7137-8265-68b11d809f0c`.

브라우저 하네스는 실제 POST가 서버에서 처리된 뒤 **Response 전달만** 보류하고, 필요한 경우 실제 RSC GET의 전달도 보류했다. 본문/성공 상태/revision/pointer/제품 timeout을 합성하거나 바꾸지 않았다. 외부 작성자는 Node loopback HTTP로 **실제 `/timeline` POST**를 보냈다. fixture 추출 이후 경합을 만들기 위한 DB 직접 수정은 없다.

## 2. F096-1 원래 경로를 이번 대상에서 직접 재현

`browser5-original.mjs`, `original-before/after/recovery/next-cas.json`, `original-download.json`, `verify-original.cjs`, `network-cas-validation.json`.

1. 기준 **내용 revision5 / timeline r1 / id `b869b207-ae5f-8b36-8a9e-7709732e8344`**에서 첫 자막을 `T100 OWN A`로 실제 저장. 자기 성공 응답 전달을 보류했다.
2. 실제 자기 응답은 **200 / 내용 revision6 / r2 / id `01a1e4a4-a5ec-7587-a443-1ca7851f3af9`**. 아직 이전 editor에서 첫 자막을 `T100 OWN B LATEST`, 클립 +1frame으로 고쳤다. 둘째 자막은 사용자가 건드리지 않았다.
3. 외부 HTTP 클라이언트가 그 revision6/r2 pointer를 사용해 **둘째 자막만** `T100 F096 EXTERNAL KEEP ME`로 저장했다. 실제 **200 / 내용 revision7 / r3 / id `01a1e4a4-a941-77b3-99b9-089a2cc03631`**.
4. 자기 응답 release → refresh는 r3을 표시했다. **첫 자막 A, 둘째 외부 문구 그대로, dirty 없음**. B와 +1frame은 새 기준에 자동 적용되지 않고 recovery에 남았다. 초점은 복구 상자 wrapper.
5. 복구 내용을 확인하고 명시적으로 닫은 뒤 첫 자막만 다시 고쳐 저장. 실제 요청은 **revision7 + r3의 정확한 id**, 응답 **200 / 내용 revision8 / r4**. 화면 및 실제 GET에서 **둘째 외부 문구 유지**.

**PASS:** T096에서 옛 전체 초안을 외부 r10 위에 올려 다음 정상 CAS로 외부 문구를 덮었던 원래 절차를 이번 실제 HTTP 경합으로 다시 실행했다. 작성자 PASS 보고를 전제하지 않았다. DB CAS만 통과하는 것을 성공 기준으로 삼지 않고, 후속 서버 데이터의 건드리지 않은 외부 필드까지 확인했다.

## 3. 전체 복구 자료의 실제 값·바이트 검증

`browser6~11`, `full-before.json`, `full-after.json`, `full-recovery.json`, `full-download.json`, `full-copy.json`, `mobile-copy/fallback.json`, `mobile-download.json`, `verify-full.cjs`, `verify-matrix.cjs`.

실제 자기 저장 응답을 보류하는 동안 UI로 다음을 고친 뒤, 외부 실제 저장을 더 만들고 자기 응답을 풀었다.

- 첫 자막 문구: 줄바꿈, 따옴표, 역슬래시, 한글, 이모지 포함.
- style: Noto Serif KR / 굵기600 / 크기67 / 노랑, stroke width11, shadow 및 background 전체 객체.
- box: x0.375 / y0.63 / widthRatio0.65. anchor/rotation 등 다른 필드도 전체 비교에 포함.
- animation: slide-up / shake / fade, durationFrames4 / easing 등 전체 객체.
- raw 시간: 시작 **`bad raw " 🧋  `**(끝 공백 둘 포함), 끝 **`00:xx.99`**, 각 error 문자열 그대로.
- 글자 앞으로 이동, 장면 순서 이동, 둘째 자막 삭제, 새 훅 생성/문구 입력, 새 훅 선택.

기대값은 refresh 전에 현재 React root의 TextEditor props에서 **읽기만** 하여 JSON으로 캡처했다(상태 변경/우회 저장 없음). sent는 실제 보내진 요청 Timeline 및 캡처한 보낼 때 선택과 비교했다. 이번 입력에는 trim 차이가 없었다. `assert.deepStrictEqual`로 다음을 확인했다.

| 항목 | 직접 결과 |
|---|---|
| `draft` | 캡처한 마지막 Timeline **전체 deep equality**. 모든 style/box/animation/timing/id/kind/locked/speaker/audio/video/순서 필드 포함 |
| `sent` | 실제 보낸 Timeline 전체 equality. 삭제된 글자의 원본도 sent 안에 있음 |
| 신규/삭제 | 새 훅 id/문구/style/animation 포함, 삭제된 둘째 글자는 draft에 없고 sent에 있음 |
| raw/error | 키, 원문, 끝 공백, 오류 문자열 **정확히 동일** |
| 선택 | selectedTextId / selectedAtSend 정확히 동일 |
| 기준 식별자 | projectId, sentFrom revision/timelineId/r, ownSave 정확한 revision/id, shown 외부 revision/id/r 일치 |
| Blob 파일 | 실제 download 이벤트를 먼저 대기하고 `saveAs`한 **실제 Blob JSON = fallback textarea bytes = clipboard API에 전달된 원문 bytes** |
| 390 | 같은 recovery의 실제 Blob 다운로드·복사 인자·fallback textarea **byte 동일** |
| 외부 기준 | 화면은 외부 최신본 그대로, dirty 없음. 삭제/새 훅/모양 등 자기 후속 변경은 화면에 적용되지 않음 |

복구 형식은 `dream-ai-studio.timeline-recovery`, version1, createdAt/note 포함이다. JSON 전체의 배열 순서도 deep equality에 포함했다. 순수 요약 목록만 비교하거나 제품 helper로 기대값을 다시 생성한 시험이 아니다.

### 실제 Windows 클립보드

위 copy sink 검사와 별도로 새 문서에서 **native `navigator.clipboard.writeText`**를 사용했다(`native-copy-before.json`에 `[native code]`). 실제 버튼 클릭 후 성공 status를 확인한 다음, 그때 막 복사한 자기 가상 자료만 `Get-Clipboard -Raw`로 저장했다.

`native-clipboard.json`과 실제 `native-recovery-blob.json`은 **JSON 값 동일**, Windows CRLF를 LF로 바꾸면 **byte 동일**. **원시 byte 동일이라고 주장하지 않는다**(Windows 줄바꿈 변환). `verify-native.cjs`와 `native-copy-validation.json`.

## 4. 단일 변경만 있어도 경고 / 변경 없으면 경고 없음

`browser12-matrix.mjs`, `isolated-trigger-matrix.json`, `matrix-validation.json`. 각 행마다 새 자기 실제 저장 + 다른 실제 외부 저장을 만들었다. 복합 변경의 부수효과를 단일 조건 PASS로 세지 않았다.

| 보낸 뒤 변경 | 직접 결과 |
|---|---|
| style만(크기73) | recovery 표시, 전체 draft/sent/raw/선택 equality PASS |
| raw 시간만 | recovery 표시, Timeline 변경 없어도 raw/error 정확히 유지 PASS |
| 선택만 | recovery 표시, Timeline 동일, 두 선택 id 구분 PASS |
| 글자 순서만 | recovery 표시, 배열 순서 그대로 PASS |
| 장면 순서만 | recovery 표시, video 배열 그대로 PASS |
| 아무 후속 변경 없음 | **복구 상자 없음**, 외부 최신본 표시, dirty 없음 PASS |

## 5. 소유권·저장 수명·회귀

코드도 직접 확인했다. 인수는 projectId가 같고 owner가 다르며, 자기 실제 성공 응답에 저장한 **내용 revision AND timelineId가 둘 다 같은 editor**에서만 한다. 응답 식별자가 없으면 기록을 지운다. 쓰기는 현재 owner만 하며 cleanup도 자기 owner일 때만 지운다. unmounted 응답은 알림/refresh 전에 return한다. posting ref와 busy는 한 editor의 중복 요청을 막는다. 성공 refresh 중에는 최신 draft/times/selection을 계속 추적하고 **TTL 없음**. RecoveryBox에는 fetch/router/setDraft/자동 apply 경로가 없다.

| 직접 실행 | 결과 / 증거 |
|---|---|
| 정상 POST + RSC 양쪽 hold | A→POST 중 B+1frame→RSC 중 C+1frame. C와 +2frame 그대로, dirty/보존 안내. 같은 turn click×2/requestSubmit 및 RSC 중 submit에도 POST **1건**. `normal-dual.json` |
| 정상 다음 CAS | 정확한 자기 응답 revision/pointer로 실제200. `normal-next-cas.json`, `verify-cas-network.cjs` |
| 실제31초 | RSC 전달 **31,500ms 실제 대기**, 시간 가속 없음. B+1frame, 최신 raw/error 유지. `real31s.json`, `lifecycle-validation.json` |
| 자기 RSC를 받은 뒤 외부 저장 | RSC는 자기 저장본을 hold → 외부 실제 저장 → RSC release하면 자기 후속 초안 보존. 다음 저장은 **실제409**, 초안 그대로, 초점=role alert, 서버 외부 문구 유지. `external-after-own409.json` |
| abandoned 응답 | A 저장 응답 hold 중 B → client export→edit → 새 owner의 C 입력 → 옛 응답 release: C 그대로. `abandoned-before-cancel.json` |
| cancel/왕복/history | 새 owner C 취소 뒤 export→edit 및 back/forward: 저장 A만, 버린 B/C 재등장 없음. `abandoned-roundtrip.json` |
| 다른 프로젝트 | POST hold 중 B를 버리고 작업실→다른 가상 프로젝트 intake, 옛 응답 release. 다른 프로젝트 URL/heading 변함없음, 돌아오면 저장 A만. `different-project.json` |

`real31s`에서 실제 최종 raw는 `00:00.07raw-slow-latest`였다. 입력 직전 timing 갱신과 fill이 겹친 하네스 결과이며, **보존 기대값은 refresh 전 실제 입력 상태 전체**로 잡아 그 값과 error가 정확히 유지됨을 확인했다. 의도한 짧은 문자열이 입력됐다고 바꿔 보고하지 않는다.

### StrictMode 별도 실제 계측

별도 **자기 `devapp/` 사본**의 editing-panel에 read/setup/cleanup 관찰 로그만 추가했다. production 바이트 동일 사본에는 계측이 없다. 자기3101 `next dev --webpack`, 같은 새 fake DB를 사용했다. `strict-initial/normal/conflict/recovery/dismiss.json`, `strict-validation.json`.

- 첫 mount: **read×2 → setup → cleanup → setup** 실제 확인.
- 정상 dual-hold: 새 내용 revision32의 **read×2가 정확한 자기 revision/pointer를 읽은 뒤**, 이전 revision31 cleanup(owns=true), 새 setup→cleanup(owns=false)→setup. C와 +1frame 유지.
- 외부 충돌: 자기 성공본보다 새 내용 revision34의 read×2가 같은 handover를 읽고 recovery 생성. 그 뒤 이전 cleanup. 외부 최신본/dirty없음, recovery draft와 캡처 기대값 일치, explicit dismiss 초점 확인.
- 모든 가능한 concurrent render/Suspense interleaving의 증명은 아니다. 현재의 읽기 전용 initializer와 owner별 cleanup 경계를 실제 StrictMode 재설정에서 검증했다.
- dev Watchpack의 pagefile/swapfile 등 initial scan EINVAL 및 fixture 이미지 decode 경고는 `devserver.err`에 보존했다. production 저장/복구 결함으로 세지 않았다.

### 상속하는 F093 원래 PASS

`git diff 9333b11 df094f9 -- components/text-editor/text-editor.tsx components/text-editor/text-timeline.tsx`는 비어 있다. text-ops의 기존 liveTimeFields/clipKeyAction/shiftTiming 경계도 수정되지 않았다. **지운 글자 오류가 저장을 막지 않음, 다른 글자의 raw 오류 유지, drag 중 키 차단/선택·시간·취소·삭제 우선순위, rAF late callback 정리**는 T096의 직접 PASS를 해당 버전의 증거로 명시적으로 상속한다. 이번 full recovery에서 raw/delete/new text를 실행한 것을 원래 F093 drag-key 전체 재실행이라고 부르지 않는다. 저장 수명/31초/이탈 경계는 위처럼 이번에 직접 다시 실행했다.

## 6. UI·명시적 폐기·읽기 전용·원본 보존

- 상자 등장 직후 focus=상자 wrapper, 실제 마우스 copy/download 뒤 focus=각 버튼. 1280/390 explicit “확인했어요” 뒤 **상자 제거 + 저장 상태 P 초점** 확인. `original-after`, `copy1280`, `download1280`, `full-copy`, `full-download-meta`, `mobile-copy/download-meta/dismiss`, `native-dismiss1280`.
- “다른 창 새 버전”, “후속 변경은 넣지 않았음”, “복사/파일로 받아 필요한 것만 다시 고침”, “자동 저장/적용 안 함”, “닫거나 이동/새로고침하면 다시 볼 수 없음” 문구를 직접 확인했다. 닫힘은 사용자 명시 조작이었다.
- 390: innerWidth390 / document scrollWidth390, textarea client/scrollWidth292, 버튼 각 **294×44**, 세로 배치. `recovery390-geometry.json`, 직접 열어 본 `mobile-fallback-focused.png`.
- 1280: native recovery 샘플은 innerWidth1280 / scrollWidth1265. 직접 열어 본 `native-recovery1280.png`. 다만 full 대량 자료 샘플의 한 측정은 **scrollWidth1329 > 1280**이었다. textarea 자체는 x319/right1224로 viewport 안, focus TEXTAREA였고 복사/받기/닫기 접근은 성공했다. **1280 전체 화면 무넘침을 일괄 PASS로 선언하지 않는다.** 넘친 하위 요소의 원인을 분리하지 않았으므로 후속 레이아웃 점검 대상이다(`recovery1280-geometry.json`, `full-recovery1280.png`).
- beforeunload: dirty가 없는 외부 최신본+복구 상자에서 cancelable beforeunload 이벤트가 **defaultPrevented=true**. explicit dismiss 뒤 false. `unload-before.json`, `native-recovery-geometry.json`, `native-dismiss1280.json`, `mobile-dismiss.json`. 실제 `location.reload()`도 시도했으나 ego 세션에서는 native 확인 dialog를 관찰하지 못하고 reload가 진행했다. **listener 활성/해제는 PASS, 실제 사용자 브라우저의 확인창 표시/취소는 미검증**으로 남긴다. OS 창닫기 PASS로 쓰지 않는다.

| 보존/쓰기 감사 | 직접 결과 |
|---|---|
| preview CDP Network | 읽기 GET positive control 포함 `Network.requestWillBeSent` **4건 / 쓰기0**, `preview-network.json` |
| preview DB | 모든 **18 table 전체 행 정렬 JSON 의미 동일**, baseline/preview hash `021a15479caec06f49e165cc2a13e1e949239a31374d3561c3a6f1916e86f893` |
| recovery CDP Network | 외부 실제 저장까지 끝낸 뒤 자기 응답 release/표시/복사/실제 Blob 다운로드/fallback 동안 **22건 모두 GET / 쓰기0**, `recovery-network.json` |
| recovery DB | 외부 저장 직후부터 복구 조작 뒤 **18 table 전부 의미 동일**, hash `f63889c07ec63660fd35d0ac299f02d7d1e389c2bf7f98fc55d0df46b3384b7c` |
| 원래 r1 | baseline의 timeline row가 final에 byte 문자열 그대로 존재, `final-preservation.json` |
| 고정 SQL/0005/fixture/public | production 사본↔child 252파일 byte equality에 포함, 수정/재생성 없음 |
| 기존 ZIP·assets | s4 manifest **7파일 sha256 전부 일치**, 기존 ZIP 포함, `storage-integrity.json` |
| 관련 tables | assets/scene_versions/scenes/project_assets/settings/exports 전체 행 그대로 |

쓰기0은 위 **정의된 CDP 구간**의 결론이다. 모든 후속 호출/전체 origin의 영구 무쓰기를 주장하지 않는다. explicit browser 저장 및 외부 HTTP 저장은 감사의 쓰기0 구간에서 제외했다. 전체 fake DB의 최종 변경 table은 activity_log/projects/stage_states/timeline_revisions이며, timeline1→34는 명시적 HTTP 저장 결과다. `db-final.json`, `network-cas-validation.json`.

## 7. 하네스 정정·갭·정리

- 최초3100 시작 직후 접속은 connection refused였다. 서버 Ready 확인 후 **같은 TaskSpace91**에서 재시도했다. 다른 space/runtime으로 우회하지 않았다.
- 잘못된 시간칸 id selector와 subtree snapshot 인수는 실패했다. 실제 DOM 관찰 후 지원 selector로 바꿨다. 실패를 제품 결함으로 세지 않았다.
- 초기 React props 수집은 DOM fiber가 이전 alternate를 가리킬 수 있어 sentLocal 한 값이 stale였다. 현재 root.current를 순회하도록 **읽기 하네스만** 고쳤고, 전체 경합을 재실행했다. sent는 실제 요청과도 비교했다.
- 첫 full/mobile download 저장명과 metadata record 이름이 같아 하네스가 파일을 덮었다. 최초 자료 일부는 `*-first.json`에 보존하고, 새 경합에서 별도 `*-meta.json` 이름으로 **실제 Blob 다운로드를 다시 받아** 검증했다. 사라진 최초 다운로드를 PASS 근거로 쓰지 않는다.
- full 반복의 첫 외부 문구가 이미 같아 실제200/created=false였다. 그 응답을 새 외부 버전으로 세지 않고 응답 보류 상태에서 고유 문구로 실제 새 외부 저장을 만든 후 재현했다.
- full reload 뒤 __q wrapper가 없어 한 navigation script가 중단됐다. 현 문서에 새로 설치한 뒤 실제 이탈/취소/왕복을 다시 실행했다. 제품 코드는 바꾸지 않았다.
- 미실행/상속: T085의 broad 실제 edit→review→export-job→ZIP 및 글꼴/측정, T089의 잠긴 표기 API·font timeout/late/retry/races는 **그 버전의 증거를 명시적으로 상속**한다. 이번에 broad export/font 행렬을 새로 실행한 것은 아니다.
- **saved16:9/1:1 deep geometry, 실제 휴대폰, screen reader, touch/pen, 실제 hidden/OS pointercancel은 계속 미검증.** Desktop390 resize와 합성 이벤트를 실제 장치 PASS로 표현하지 않는다. 위1280 대량 샘플 넘침/실제 native unload 확인도 별도 갭이다.
- 자기 production 부모64924 및 dev 부모53936과 자기 자식 next 서버만 command line/부모관계 확인 후 종료. **3100/3101 LISTEN0**, `owned-server-processes.json`, `cleanup-confirmation.json`. TaskSpace91 `finish({keep:[]})` 완료, `browser-cleanup.json`. 다른 서버/탭을 종료하지 않았다. temp 증거/가상 DB/사본은 보존했다.

## 8. 반환 / 다음 진입 조건

T100 집중 독립 검수는 완료했다. F096-1 원래 경로 및 T098 전체 복구 보존은 위 실증 범위에서 **PASS**, 새 mandatory 수정은 제기하지 않는다. Master가 T099 디자인 결과 및 기존 broad 검증과 합쳐 인수 범위를 결정해야 한다. 공용 상태/다음 마일스톤/제품 코드는 이번 작업자가 갱신하지 않았다. 1280 대량 샘플 넘침과 native unload 확인은 열린 관찰 갭으로 남기고 실제 기기·screen reader·savedwide/square 검증을 완료했다고 표시하지 말아야 한다.

### 플래너·Master 복사용 메시지

> T100은 df094f9에서 독립 원본CRLF467통과+2skip/lint/type/build, F096 실제 자기POST보류→후속편집→외부실제새저장→release 및 다음 정확CAS의 외부문구 보존을 확인했습니다. 전체 draft/sent/raw오류/선택/기준id와 실제Blob·복사인자·fallback byte동일, nativeWindows클립보드의 CRLF정규화후동일, 단일변경5종·무변경무경고, 정상dualhold/실제31,500ms/실제409/이탈취소다른프로젝트/StrictMode, CDP쓰기0·18표동일·r1/ZIP자산보존도 PASS입니다. 집중 기능 판정은 PASS이며 1280대량샘플 scrollWidth1329 관찰과 native unload dialog 미확인, savedwide/square·실기기·screenreader 갭은 유지합니다; 자기3100/3101·browser91은 종료했고 보고서 한 파일 외 변경/commit/push는 없으니 T099 및 상속 broad증거와 통합해 인수범위를 결정해 주세요.