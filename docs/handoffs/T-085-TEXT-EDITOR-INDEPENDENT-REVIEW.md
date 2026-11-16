# T-085 · P2-3a 글자 편집기 최종 독립 검수

- 담당: CX-REVIEW-01 / Codex, 구현에 참여하지 않은 독립 검수.
- 대상: `b4abd9ba0a315fd43d248cdc7b0712db687af4c5` (시작 HEAD와 동일).
- 최종 판정: **FAIL — 필수 수정 F085-1, F085-2.** 자동 검사는 통과했지만 P2-3a 인수 조건을 모두 충족하지 못했다.
- 작업 범위: 제품·시험·고정 fixture·공유 문서 수정 없음. 이 보고서만 작성. 커밋·push 없음.
- 입력: AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 역할 지침, PLAN/REVIEW/TEAM, T079/T080/T081/T082/T083 및 실제 구현·관련 시험. Next 설치본의 output/file tracing 가이드도 읽었다.
- 작업 시각: 2026-11-16 KST. 작성자 T081의 442 통과/2 skip과 아래 독립 실행 결과는 별도 증거다.

## 1. 격리와 증거

증거 루트(삭제하지 않음):

```text
C:/Users/ADMINI~1/AppData/Local/Temp/t085-review-ad5daa8aee4c4ff0962ab2e1484b5714/
```

- 새 child worktree에서 실행. 실제 root userdata·기존 서버를 사용하지 않았다.
- `complete-runtime/`: 새 DB에 제품 마이그레이션 → 제품 서비스로 가상 프로젝트/기획/승인 → mock 이미지 작업/완료 → 글자 초안 저장. 결과 파일이 실제 존재하는 완결된 가짜 프로젝트다.
- `legacy-runtime/`: 고정 S4 ZIP을 OS temp에 추출하고 0005 적용. 브라우저를 위해 **가짜 DB의 프로젝트 template_snapshot_json만** 유효한 현행 메뉴 스냅샷으로 보강했다. 원본 fixture, P1 settings, r1 timeline은 수정하지 않았다. 원래 fixture의 축약 template는 UI용 완전한 snapshot이 아니어서 보강 전 UI는 Zod 오류였으며 제품 결함으로 세지 않았다.
- 운영 서버는 직접 시작한 127.0.0.1:3085(완결 프로젝트), :3086(legacy)뿐이다. ego-browser 전용 TaskSpace 56, p1/p2만 사용했다.
- 종료: TaskSpace `finish({keep:[]})` 실행. 직접 연 서버 두 exec session(49383, 71116)에 Ctrl+C를 보내 종료 exit를 확인했다. 증거·가짜 DB·다운로드 ZIP은 남겼다.
- 주요 증거: `tests-with-ffmpeg.log`, `lint.log`, `typecheck.log`, `build.log`, `crlf-evidence.json`, `zip-and-server-evidence.json`, `locked-http-evidence.json`, `roundtrip-legacy-evidence.json`, `timeout-evidence.json`, `font-measurements-actual.json`, `animation-measure-evidence.json`, `mobile-evidence.json`, `missing-keyboard-evidence.json`, `error-evidence.json`, `r1-visual-evidence.json`.
- 화면: `1280-warning.png`, `1280-moved.png`, `font-timeout.png`, `390-editor.png`, `r1-1280.png`, `save-conflict.png`, `export-success.png`. 1280 경고, 390, r1 캡처를 직접 열어 확인했다.
- temp의 `browser*.mjs`, `setup.mts`, `verify.mts`, `roundtrip-*.mts`, `legacy-reference.mts`, `locked-http.mts`는 재현 절차다. 저장소 시험에 추가하지 않았다.

## 2. 자동 검사 — 독립 실행

| 검사 | 실제 결과 |
|---|---|
| `npm.cmd ci` | PASS, 267 packages 설치. npm의 moderate 7건 안내는 있었고 의존성 변경은 하지 않음 |
| 원본 CRLF 확인 | tracked TS/TSX 176개 모두 CRLF, LF-only 0. 시험 37파일 모두 CRLF |
| `npm.cmd test` (FFmpeg 경로 없이 첫 실행) | 441 passed / 3 skipped. 추가 skip은 환경상 영상 도구 미발견 |
| `npm.cmd test` (허용된 도구 경로 지정) | **37 files, 442 passed / 2 skipped / 0 failed**, 24.89초 |
| `npm.cmd run lint` | PASS, max-warnings 0 |
| `npm.cmd run typecheck` | PASS, Next typegen + tsc |
| `npm.cmd run build` | PASS, Next 16.4.6 production build + verify-build |
| migration/fixture diff | `git diff --exit-code -- lib/db/migrations tests/fixtures` PASS, 변경 없음 |

ci·시험·lint·typecheck·build 프로세스에서는 DREAM_DATA_ROOT를 unset했다. 영상 도구는 `D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `ffprobe.exe`를 읽기/실행만 했다. fixture 생성 모드는 켜지 않았다. 브라우저·가짜 데이터 재현 프로세스에서만 자기 temp DREAM_DATA_ROOT를 지정했다.

전체 시험에는 새 글자 8종/spec 값, 순수 편집 함수, 잠금·글꼴/굵기 검사, CAS/noop, scene/assets 불변, P1 이관/해시, legacy/new bundle 분기, client import 경계 시험이 포함된다. **442 green이 아래 반례를 커버한다는 뜻은 아니다.**

## 3. 필수 수정

### F085-1 — FAIL: 글꼴 시간 초과 안내에 실행 가능한 재시도가 없다

근거:
- `components/player/player-panel.tsx:63`의 loadFonts effect 의존성은 key/fonts뿐.
- `player-panel.tsx:107` reload는 Player mount만 바꾸며 글꼴·측정 로더를 재실행하지 않는다.
- `player-panel.tsx:138`은 “20초 안에 다 읽지 못했어요. 미리보기를 다시 불러와 보세요.”라고 안내하지만, 정상 Player의 글꼴 실패 상태에는 재시도 버튼이 없다. 기존 “미리보기 다시 불러오기” 버튼은 Player render error일 때만 나온다.
- `components/player/text-measure.tsx:31`에도 독립적인 같은 key/fonts effect만 있다.

운영 재현:
1. p2 새 문서에서 CDP document-start 스크립트로 Noto Serif KR의 실제 FontFace.load 결과 전달만 25초 지연했다. 파일을 바꾸거나 앱 timeout을 줄이지 않았다.
2. **20,382ms**에 앱의 실제 20초 timeout 안내와 “확인 전”이 나왔다. FontFace 시도 1회, 재시도 버튼 **0개**.
3. 약 84초 시점에는 실제 face가 loaded였지만 timeout 안내와 측정 “확인 전”은 남았다.
4. 16:9→9:16으로 Player를 다시 mount해도 시도 수는 1회이고 상태가 회복되지 않았다.
5. **문서 전체 reload** 후에는 정상 로드/측정으로 회복했다. 이는 전용 미리보기 재시도 성공으로 세지 않는다.

기대: 초안을 유지하면서 사용자가 명시적으로 글꼴 로딩과 측정을 다시 시도할 수 있고 성공 시 안내·확인 전이 해제되어야 한다. 파일 실패와 timeout을 구분하는 현재 정책은 유지 가능하다.

수정 요청: font retry 제어와 재시도 토큰을 Player/측정 양쪽에 연결하고 실제 production timeout→retry→성공 및 재실패 경로를 검증한다. 증거: `browser18.mjs`, `browser20.mjs`, `timeout-evidence.json`, `font-timeout.png`.

### F085-2 — FAIL: 기존 필수 표기의 box 이외 값 변경을 서버가 허용한다

근거: `lib/services/timeline.ts:71`의 kept 판정이 false여도 `:72`의 P1 64/white 또는 preset 분기로 다시 통과한다. “새 표기의 초기 모양”과 “이미 저장한 표기의 불변 조건”이 분리되어 있지 않다.

운영 HTTP 재현:
1. 제품 서비스로 만든 프로젝트의 저장된 필수 “광고”는 locked=true, fontSize=38, color=#111111, shadow=null, 시간 0~90이었다.
2. **같은 id·문구·잠금·시간·box를 유지**한 채 fontSize=64, color=#FFFFFF, shadow={color:#000000,opacity:1,blur:100,x:100,y:100}으로 변경했다.
3. 실제 `POST /api/projects/01a1e41f-d221-73f4-9d18-78a6fd2be9db/timeline`에 현재 revision/pointer를 보내자 **HTTP 200**, 새 내용 r9 / 타임라인 r6가 생성되었다.
4. 기대는 400 거절이다. UI에서 해당 칸을 숨기는 것으로 서버 불변 조건을 대신할 수 없다.
5. 별도 rollback probe에서는 box 변경만 저장 가능, 시간 90→89 변경은 거절, 필수 표기 삭제도 기존 전체 시험에서 거절됨을 확인했다.

수정 요청: 기존 필수 표기가 존재하면 box를 제외한 저장값과 반드시 같아야 한다. 신규 표기 생성용 P1/preset 허용 분기가 기존 표기 변경의 우회가 되지 않게 분리한다. 원래 P1 28px 표기를 조용히 38/64px로 바꾸면 안 된다. 기존 값 보존/새 표기/삭제·내용·style·animation·time·id 우회 및 box-only positive를 재검증한다.

증거: `locked-http.mts`, `locked-http-evidence.json` (전체 before/request/response), `verify.mts`, `zip-and-server-evidence.json`. 실제 변경은 자기 temp DB에만 남겼다.

## 4. 편집·측정·화면 검증

| 항목 | 판정과 실제 근거 |
|---|---|
| full Timeline 편집 vs legacy projection | **PASS**. UI에서 subtitle→lyric로 바꿔 저장·다운로드. legacy text_overlays에는 lyric이 없지만 raw timeline.json에는 정확히 존재. 화면 초안은 projection을 편집 대상으로 사용하지 않음 |
| 고치지 않은 숨은 값 보존 | **PASS**. Noto Serif KR lyric의 letterSpacing .4, lineHeight 1.7, align right, band padding 13/9·radius11·opacity.4, shadow, rotation11, typewriter/slide-down/shake·17frames·linear를 저장한 뒤 다른 brand 문구만 UI 수정. 저장 Timeline 전체가 기대 JSON과 canonical byte 비교로 동일 |
| whitespace | **PASS**. 문구를 바꾸면 “  changed only trim  ”→“changed only trim”; 다른 subtitle의 “  untouched whitespace  ”는 그대로. 최초 P1 문구의 바깥 공백도 편집 초안에 유지. 공백만 입력하면 UI 저장 disabled 및 서버 schema 거절 |
| 8 kinds / explicit preset | **PASS(시험+대표 UI)**. 8종 신규 값은 spec과 전체 시험 대조. UI 7개 빠른 모양(표기 제외), 훅 적용 시 style/animation만, box 체크 시 72%→30%. UI subtitle/lyric/brand와 잠긴 disclosure를 실제 다룸 |
| preset undo | **PASS**. 훅 적용 40→104px 후 같은 알림의 되돌리기 104→40px를 실제 확인. 자동 프리셋 재적용 없음 |
| 폰트 registry/선택/굵기 | **PASS**. readable 8종 상수와 spec/설치·OFL 교집합 분리, 8종 실제 로드. 정적 400/가변 범위 로드와 굵기 목록 확인. 미설치/잘못된 굵기 거절, 기존 같은 family/weight carried 허용은 전체 시험으로 확인 |
| 실제 줄 수 차이 | **PASS**. 같은 긴 한글 문구·104px·폭74%에서 Pretendard/Noto Sans/Noto Serif/Black Han/Gowun 7줄, Do Hyeon/Jua 6줄, Nanum Pen 4줄. 실제 FontFace loaded와 Range line-top을 함께 수집 |
| 저장 비율 측정 | **PASS(9:16 저장 프로젝트)**. 16:9 미리보기로 전환해도 off-screen TextMeasure는 1080×1920 유지. 저장 좌표 불변 |
| 외곽선/배경/그림자/Range | **PASS(코드+대표 DOM 측정)**. 같은 TextView, 7px 외곽선은 CSS stroke14px + paint-order, 줄 폭에서14px 차감. band padding이 body DOMRect에 포함, stroke 및 shadow blur/offset을 outer 계산에 더함. Range distinct top으로 줄 수. .4px 자간,40px 크기·padding9/13을 실제 DOM에서 확인 |
| 움직임 전체 측정 | **PASS**. 실제 Player frame0의 typewriter 문자는 “T” 하나였으나 TextMeasure는 “T085 실제 저장 자막” 전체를 측정(1줄). 움직임의 투명/부분 frame을 측정 근거로 사용하지 않음 |
| safe warning / move | **PASS(대표 실행+순수 경계 시험)**. 9:16 y93%에서 아래20% + 7줄 경고. 안으로 옮기기로 y57.6655%, 아래 경고 해제·줄 수 경고 유지, 제목으로 focus 복귀·위치 확인 필요 표시. 별도 shadow/band/회전 예는 오른쪽12% 경고. ±0.5px 허용·최소이동0.25px 여유·1:1/16:9 기준은 순수 함수 시험 |
| missing fallback vs unknown | **PASS**. 자기 p2의 Jua URL을 CDP 차단하면 fallback chip과 “대신 그린 글꼴로는 경고를 판단하지 않아요”, 확인 전. fallback 줄 수를 측정 PASS로 표시하지 않음. 차단 해제·다른 family로 변경 후 재선택하면 실제 Jua loaded로 회복 |
| timeout/retry | **FAIL F085-1** |
| 필수 표기 UI | **PASS(UI 한정)**. 읽기 전용 문구, 고정 시간, 삭제 대신 이유, 위치만 표시. **서버 불변은 FAIL F085-2** |
| keyboard / focus | **PASS(실행 범위)**. textarea ArrowLeft/Space는 입력만 바꿈. invalid 00:01.30은 오류·저장 disabled·마지막 유효 preview 안내. list Tab이 같은 행 앞으로 버튼으로 이동, 이동 명령 뒤 제목 focus. 전체 문서 key handler 없음(코드/시험) |
| 390 | **PASS(브라우저 에뮬레이션)**. innerWidth=scrollWidth=390, 가로 넘침0. 보이는 inspector 입력은 textarea 하나. 모바일 문구 수정 후 취소로 저장값 복귀. 목록 행 높이73.1875px, PC 모양/추가/이동 숨김. 실제 기기 PASS 아님 |
| save error/cancel | **PASS**. 다른 writer 저장 뒤 stale 화면에서 저장→실제409 문구 “다른 변경이 먼저 저장됐어요…”, 초안 “stale draft kept”·dirty 유지. 빈 문구 disabled. 변경 취소는 저장된 “changed only trim”로 복귀 |
| CAS/noop / review invalidation | **PASS**. 같은 JSON created:false/revision 불변. stale revision·pointer는 CONFLICT. 글자 저장 후 edit=in_progress, review/export=locked. scene_versions/assets 및 scene selected id 전후 JSON 동일 |
| c.typos 정직성 | **PASS(허위 측정 PASS 없음)**. 실제 검수 화면 해당 항목 초기 미확인, evidence=null이며 자동 통과 안 됨. 이후 테스트용 수동 승인과 실측 성공을 혼동하지 않음. T079 D-2의 편집 화면 안내 문구는 아직 없음(권장 보완); 현재 코드가 측정 완료를 주장한다는 증거는 없음 |
| client/SSR/fonts tracing | **PASS**. editor 폴더 server imports/fetch 없음, type-only service import는 타입 경계. Player/measure client-only dynamic 경계. 실제 production SSR 성공. verify-build private trace 없음; 해당 page/API nft에 font 자산24파일 포함(Noto 포함) |

증거 해석 주의: `font-measurements.json`은 첫 자동화에서 React 갱신 전에 읽어 같은 값이 나온 **폐기 자료**다. 판정에는 loaded family와 DOM 갱신을 기다린 `font-measurements-actual.json` 8레코드만 사용했다. 이 수집 라운드의 뒤쪽 undo 대기는 잘못된 brand 크기(32) 기대 때문에 실패했지만, font 데이터 저장은 그 전에 완료됐고 undo는 별도 라운드에서 40/104 왕복으로 재확인했다. 이를 제품 실패나 성공 증거로 섞지 않았다.

## 5. 실제 승인→작업→다운로드 ZIP (작성자 gap 종료)

가짜 프로젝트:
- id `01a1e41f-d221-73f4-9d18-78a6fd2be9db`
- mock 이미지 실제 1080×1920 결과1개 선택·produce 완료.
- 브라우저에서 실제 문구/글꼴/kind 변경 후 저장 → 내용 r5 / 타임라인 r2.
- “수정 확인 완료 · 검수로” → 13개 항목을 **가짜 흐름 시험 목적의 수동 통과** → 검수 승인 → 내보내기 화면의 만들기 실행.
- 제품 `runNextJob`이 queued export를 claim하고 `runClaimedExport`로 ZIP 생성/검증/DB 성공 확정. bundleLayout만 호출한 대체 ZIP이 아니다.
- 실제 화면의 다운로드 링크를 키보드 Enter로 실행하고 ego download.saveAs로 `downloaded-r5.zip` 보존, failure=null.

| 검증 | 결과 |
|---|---|
| export id | `01a1e424-4f1b-7440-91f3-7c7f28c10370` |
| 파일명 | `editing-01a1e424-4f1b-7440-91f3-7c7f28c10370_SAMPLE.zip` |
| ZIP bytes | **25,940,497**, SHA256 `f330214f0a77f257792cf142109b2cd7dafbaab52244164785dd63d9903739e3` |
| ZIP 실제 읽기 | 13 manifest 파일 + manifest.json = 14 entries. 모든 파일 size/hash 검증 true |
| raw edit/timeline.json | DB 행 원문과 byte 동일. SHA256 = row.timeline_sha256 = `f3349b05bed678d52c7f8cafad33cda0e7babeea846a85b1629e3d74629c2e53` |
| used fonts | Pretendard + Noto Serif KR 파일/각 OFL 모두 존재, manifest/ZIP/저장소 파일 해시 일치 |
| lyric 보존 | legacy projection에서 제외되더라도 raw timeline의 kind/content/font/box/style/animation 모두 있음 |
| 이후 수정 | 새 버전들 및 필수 수정 재현 후에도 기존 export ZIP hash 불변 |

새 ZIP은 lyric만 있고 subtitle 종류는 없으므로 SRT가 없는 것이 정확하다. SRT 보존 검증은 다음 legacy r1 경로로 따로 했다. 테스트용 수동 검수 승인 13개가 오디오·실제 광고 적법성·완성 영상 품질 PASS라는 의미는 없다.

## 6. P1 r1·옛 ZIP·이전 빌드

- **PASS(byte/service)**: S4 ZIP SHA256 `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392` 그대로. temp 0005 이후 checkTimelineRows 통과.
- r1 timeline SHA256 `711c8622dfe63b3a0fcf96cb117d4551e5df5fc125a2b8a06f0154d38f01e226` 일치. registered migration와 fixture 파일 diff 없음.
- **PASS(대표 UI/DOM)**: legacy 세 글자 문구·28/40/40px, 0 자간(normal computed)·stroke0·배경 투명·shadow none. subtitle 바깥 공백 유지, x44/y74/폭76와 P1 안내/00:00.04 표시 확인. 새 기본56px를 조용히 적용하지 않음. 새 UI 캡처를 확인했고 예전 TextView의 fontSize px 경로와 대조했다. **구빌드를 별도 실행한 픽셀 diff는 하지 않았다.**
- **PASS(legacy layout/SRT)**: migrated r1은 raw timeline.json 없음, Pretendard 기존 경로만 있음, README “P1 편집용 묶음입니다.” 유지. SRT는 P1 reader `editSnapshotSchema.parse(rawSnapshot).layers → srtText`와 byte 동일: 시작125ms / 끝2500ms, 다음 끝5250ms. raw unparsed snapshot의 공백을 직접 srtText에 넣는 잘못된 첫 비교는 정정했으며 `legacy-reference.mts`에 정확한 reference를 남겼다.
- historic ZIP SHA256 `d3e0ece1169b093d4bc0918afcb9fa5bf9646e375de1c11bb4459d016fcf1ffc` 조회 전후 동일. 신규 ZIP도 후속 edit 이후 불변.
- **이전 빌드 제한**: 새 family로 저장한 타임라인/백업은 P2-3 이전 Pretendard-only schema에서 읽을 수 없다. T079/T081의 제한 기록과 실제 enum 변경이 일치한다. downgrade/migration 지원을 구현하거나 검증했다고 주장하지 않는다.

## 7. 미실행·제한·다음 진입 조건

- 실제 휴대폰, 실제 화면 읽기 프로그램: **미확인**. 390 Chromium 에뮬레이션·DOM/키 증거를 대신 PASS로 표현하지 않는다.
- 모든 font/weight/문구/rotation 조합의 raster glyph 경계, 모든 safe border의 실제 픽셀 ±0.5px 비교, 별도 저장16:9/1:1 프로젝트 UI의 exhaustive 확인: **미확인**. 이 보고의 PASS는 표에 명시한 실제 9:16 측정 사례와 순수 정책 시험 범위다. shadow blur 바깥 경계는 구현 정책을 대조했으며 픽셀 알파의 절대 끝점을 증명한 것은 아니다.
- 전체 focus 복귀 표의 모든 add/remove/undo/reorder 조합, 실제 탭 숨김, 긴 프로젝트 성능: **전부 실행하지 않음**. 대표 목록 Tab/입력/안으로 옮기기/취소/저장 오류를 확인했다.
- P2-3b drag/타임라인 클립 키/이력 화면, rendering/audio는 배정 밖. 완성 영상 또는 full P2 PASS 없음.
- c.typos의 추천 안내 문구 추가는 보완 사항이다. 현 화면은 수동 미확인이고 자동 측정 PASS를 주장하지 않아 별도 필수 결함으로 만들지 않았다.
- 필수 F085-1/2 수정 전 인수/다음 마일스톤 진입 **불가**. 수정 후 실제 production timeout→retry와 기존 disclosure non-box 우회 거절을 독립 재검증하고 관련/full 검사를 실행해야 한다.
- 상태 전달: 아래 문안은 복사용 초안이며, Orca worker_done 영수증을 별도 완료 전달로 구분한다.

## 8. 플래너·Master에게 복사할 메시지

> T085 독립 검수 대상 b4abd9b의 최종 판정은 FAIL입니다. 독립 원본 CRLF 전체 442통과/2skip, lint/typecheck/build 및 실제 edit→save→complete→수동 review approve→export job→ZIP download는 통과했고 raw timeline/used fonts/OFL 해시와 legacy SRT·기존 ZIP 보존도 확인했습니다. 필수 F085-1은 20초 font timeout에 실행 가능한 preview/font retry가 없고 loaded 후에도 확인 전이 남는 문제이며, F085-2는 서버의 기존 필수 표기가 64/white 신규 허용 분기로 box 이외 style 변경을 HTTP200으로 받아들이는 문제입니다. CC-DATA-01에 두 건의 수정과 독립 재검증을 배정해 주세요. 실제 휴대폰·화면 읽기 프로그램 및 exhaustive raster 경계는 미확인이고 P2-3b/render/audio는 범위 밖입니다. 보고서는 docs/handoffs/T-085-TEXT-EDITOR-INDEPENDENT-REVIEW.md, 원본 증거는 보고서의 OS temp 루트에 보존했으며 자체 서버·브라우저는 종료했습니다.
## 9. 후속 수신 — T084/T086 범위 구분

Master 메시지 `msg_c3b0a5078cb6`를 T085 완료 전달(`msg_2b3f2943f7c9`) 뒤 수신했다. 이 child에는 T084 보고서 파일이 없어 그 문서 자체를 읽었다고 주장하지 않는다. 메시지의 B1은 위 F085-1의 독립 운영 재현과 겹친다.

B2(잠긴 필수 표기에 끝 시간 수정 불가한 beyond 경고)는 대상 코드에서 추가 대조했다. `text-editor.tsx:41`은 locked 여부 없이 “필요하면 끝 시간을 직접 줄여 주세요.”를 표시하고, `:173`은 locked 표기의 시간 입력을 제공하지 않는다. 기존 가짜 r1은 표기900frames/영상270frames이므로 해당 조건의 자료도 존재한다. 다만 이 후속 수신 뒤 별도 브라우저 재현은 하지 않았으며, 이를 새 독립 runtime PASS/FAIL로 승격하지 않는다. T084의 직접 실행 증거 및 T086 수정·Master 집중 검수와 함께 판단해야 한다.

HEAD는 계속 b4abd9b이며 T086 또는 다른 추가 커밋을 가져오거나 합치지 않았다. 위 T085 broad 검수의 두 필수 수정, 자동 검사·실제 ZIP 결과와 제한은 그대로다.