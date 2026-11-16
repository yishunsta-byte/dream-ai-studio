# T-089 · P2-3a 글자 편집기 집중 독립 재검수

- 담당: Codex 독립 검수 작업자. T086/T087 구현에 참여하지 않음. Task `task_a0bc45b44d25`, Dispatch `ctx_26b8a588299c`.
- 대상: **`1112f7b`**, T086 `ea2956e` 포함. 배정 child의 시작 HEAD는 문서 커밋 `a9ba383`; 대상과 HEAD 사이 components/lib/tests/public/config/package 차이 없음.
- 판정: **집중 재검수 PASS — F085-1/F085-2 종료 가능.** T085의 기존 독립 PASS와 아래 직접 증거를 합치는 범위이며, 전체 P2 또는 배포 승인 아님. T088 C5(재시도 성공 후 body 초점)는 재현되는 작은 후속 사항.
- 저장소 변경: **이 보고서만 작성**. 제품/시험/fixture/공유 문서 수정, commit, push 없음. 공용 진행 문서는 Master가 갱신할 범위.
- 읽은 기준: AGENTS/AI_TEAM_RULES/CLAUDE, docs/team 역할 지침, PLAN/REVIEW/TEAM, T084~T088, 관련 구현·시험. 설치본 Next 16.4.6의 `dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` 확인.

## 1. 격리·재현·자동 검사

증거 루트(보존):

```text
C:/Users/Administrator/AppData/Local/Temp/t089-review-d219c3950fa54bc6ab31d6ce97fd7870/
```

배정된 새 child에서 `git archive 1112f7b`를 위 OS temp에 추출하고 `npm.cmd ci`로 별도 설치했다. 빌드/검사/.next는 전부 이 사본에만 있다. 기존 root 데이터·기존 서버는 사용하지 않았다. 런타임은 고정 s4 ZIP을 **새 `runtime2/`에** 제품 검증기로 추출하고 제품 0005를 적용했다. UI를 위해 이 가짜 DB의 template_snapshot_json만 현행 유효 메뉴 snapshot으로 보강했다. 원본 P1 settings/r1/ZIP은 고치지 않았다.

| 직접 실행 | 결과 |
|---|---|
| `npm.cmd ci` | PASS, 267 packages. 안내된 개발 의존성 moderate 7건을 임의 수정하지 않음 |
| 원본 줄바꿈 | TS/TSX 177개 CRLF, LF-only 0 (`crlf.json`). 시험 파일을 LF로 바꾸지 않음 |
| `npm.cmd test` | **38 files / 449 passed / 2 skipped / 0 failed**, 26.19초 (`tests.log`) |
| `npm.cmd run lint` | PASS, max-warnings 0 (`lint.log`) |
| `npm.cmd run typecheck` | PASS, Next typegen + strict tsc (`typecheck.log`) |
| `npm.cmd run build` | PASS, production build + verify-build, private trace 없음 (`build.log`) |
| 고정 SQL/0005/fixtures | 18파일 모두 child 원본과 **실제 파일 바이트 동일**, Git 정규화 해시도 대상과 일치 (`protected-hashes-final.json`) |

검사 프로세스는 DREAM_DATA_ROOT unset. 영상 도구만 `D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `ffprobe.exe`를 읽기/실행했다. fixture 생성 모드는 켜지 않았다. 작성자 T087의 449+2와 **이번 독립 449+2는 별도 실행**이다. Git의 LF blob과 checkout CRLF를 no-filters로 처음 비교한 차이는 변조가 아니며, 위 최종 판정은 실제 child↔사본 바이트 및 Git 필터 적용 비교다.

운영 서버 명령: 사본 cwd에서 `DREAM_DATA_ROOT=<증거루트>/runtime2`, `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3091`. 자기 서버 하나와 ego-browser TaskSpace **69**, p1/p2만 사용했다. 프로젝트 id는 `019b8b74-3f10-7137-8265-68b11d809f0c`.

## 2. F085-2 — 실제 HTTP 서버 불변성 PASS

`http.mts`를 `node --conditions=react-server --import tsx http.mts`로 실행했다. 제품 서비스로 현재 revision/pointer를 읽고 **실제 POST `/api/projects/{id}/timeline`**에 보냈다. 각 요청 앞뒤 sqlite_master의 모든 table(내부 table 포함)을 이름순으로 읽고, 각 행을 canonical JSON으로 정렬한 전체 의미 해시를 비교했다. 타임라인 행 수만 비교한 대체 검증이 아니다.

| 실제 요청 | 기대/실제 |
|---|---|
| 기존 잠긴 광고 28px → 64/white, shadow, animation, time−1frame, Jua/font-weight, id, kind, content, locked 변경 | 각각 **400**, 모든 DB table 의미 해시 불변 |
| 기존 같은 id에 spec disclosure/P1 64 white 모양 적용 | 각각 **400**, DB 불변 |
| 새 spec id로 기존 표기 교체, 제거, 같은 문구 중복 | 각각 **400**, DB 불변 |
| box만 y 변경 | **200**, timeline row 정확히 +1, box 외 canonical 값 동일 |
| 광고 28px를 그대로 carry하고 다른 자막 문구 변경 | **200**, 광고 저장값 보존 |
| 임시 등록값 realisticAi=true: 새 AI 표기 빠짐/짧은 시간/잠금 없음/중복/P1+spec 움직임 혼합/P1+shadow 혼합 | 각각 **400**, DB 불변 |
| 새 AI 표기 spec 정확한 style+animation | **200** |
| 새 AI 표기 P1 정확한 style+animation | 별도 복원 기준에서 **200** |
| 생성된 spec AI→P1 모양, 생성된 P1 AI→spec 모양 | 각각 **400**, 생성 후 불변 |

`http-evidence.json`: **29요청, 그중 23개 거절**. 거절 23개 전부 status=400 및 unchanged=true. 수락 6개는 box/carry/spec/P1/명시적 역사 복원 두 번이다. 원래 r1 JSON·행 hash는 이 과정 및 마지막 검증까지 그대로다.

복원 정책도 확인했다. restore는 전달받은 임의 Timeline을 저장하는 경로가 아니라, 자기 프로젝트의 저장된 fromId 행을 읽고 schema/canonical/hash 및 오늘의 clip/필수 표기 규칙을 검사한다. 과거 행 자신을 baseline으로 삼아 그 행의 옛 모양을 복원하는 것은 의도된 역사 복원이고, 일반 save의 기존 표기 모양 변경 우회와 구분된다.

- 지금 AI가 필수인데 AI 없는 r1 복원: **400**, DB 전부 불변.
- AI 요구를 가짜 등록값에서 해제한 뒤 r1 명시적 복원: **200**. 이것을 현재 요구 누락 우회로 표현하지 않는다.
- `final.mts`: restore에 임의 timeline 필드 추가 **400**, 없는 fromId **404**, stale revision **409**; 모두 DB 전부 불변.
- 소스에서 from.project_id 소유권 검사, readTimelineRow, check, CAS, immutable revision 저장 경로를 대조했다. 임의 DB 변조/트리거 제거를 정상 restore로 인정하지 않음.

## 3. F085-1 — 실제 production 20초·재시도 PASS

ego-browser에서 **원본 production 번들**을 사용했다. `Page.addScriptToEvaluateOnNewDocument`로 자기 문서의 FontFace.load만 감쌌다. Noto Serif KR는 실제 파일/실제 native FontFace.load를 먼저 완료한 뒤 결과 전달을 보류하고, resolve 또는 시험용 reject를 선택했다. timeout 상수/앱 코드/네트워크 파일은 바꾸지 않았다. 이 주입은 느린 파일 전달 및 늦은 실패를 결정적으로 만드는 시험 장치이며 실제 회선 장애 재현을 주장하지 않는다.

| 직접 브라우저 경로 | 결과 |
|---|---|
| Noto Serif KR 실제 load → 전달 보류 | **20,080.7ms**에 앱 timeout 안내, 확인 전·측정 대기. timeout 전용 retry 버튼 없음은 늦은 완료 자동 반영 정책에 맞음 |
| timeout → 늦은 성공 전달 | Player timeout 안내·편집 안내·확인 전 해제, 실제 Noto Serif KR로 TextMeasure 재측정. 긴 문구 실제 높이104px·지금2줄. 초안 유지 |
| 별도 새 문서에서 실제 20초 → 늦은 reject | 약20.4초 문서 시점 timeout 다음 failed 안내와 실행 가능한 “글꼴 다시 불러오기” |
| retry → 다시 reject | **새 FontFace.load 2회째**, failed 안내·버튼 초점·초안 유지 |
| 다시 retry → resolve | **새 FontFace.load 3회째**, 실패 안내·확인 전 해제, 초안 유지 |
| Player+TextMeasure 동시 소비 | 첫 가족 실제 load **1회**. 재시도마다 1회 추가. 원본 두 컴포넌트가 같은 useFontStates와 모듈 faces 캐시 사용 |
| pending Noto→Jua 선택 후 old Noto reject | 최신 Jua loaded/실측 상태 유지, 이전 실패 안내가 새 선택을 덮지 않음 |
| 다시 pending Noto→변경 취소 후 old resolve | 저장된 기본 글꼴 상태 유지, 옛 결과/dirty가 되살아나지 않음 |

직접 증거: `browser7.mjs`/`timeout-actual.json`/`late-ok.json`, `browser10.mjs`/`late-failure-retries.json`, `browser11.mjs`/`font-switch-race.json`. 첫 시도의 native family 따옴표 비교 오류와, CDP document-start 주입이 다음 CLI 라운드의 reload에 남는다고 가정한 시도는 폐기했다. 위 최종 라운드는 새 문서에 주입을 다시 설치해 실제 pending/호출 횟수/시간을 함께 수집했다.

추가 직접 로더 검증: `hook-race.mjs`는 원본 font-loader.ts를 TypeScript 변환하고 **React import만 임시 훅 하네스로 교체**했다. 제품 로직은 그대로이며 저장소 시험에는 추가하지 않았다. 두 소비자 shared cache 1회, 실패 후 연속 retry의 newest attempt=2, timeout 이후 key 전환 뒤 old late callback 무시, unmount cleanup 후 setter 0회를 assert로 확인했다(`hook-race-evidence.json`). 여기의 timer callback 수동 실행은 **벽시계 20초 증거가 아니며**, 실제 20초 PASS는 앞의 production 브라우저 두 경로만 근거로 삼는다. 실제 React 전체 unmount의 모든 순열까지 브라우저에서 재현한 것은 아니다.

**후속 C5 유지:** retry 성공 시 버튼이 사라지며 activeElement가 body가 됨. 재실패는 버튼에 남음. T088의 작은 후속과 일치하며 새 필수 결함으로 승격할 근거는 발견하지 못했다.

## 4. 경고·초점·빈 문구·명시적 저장 PASS

`browser13.mjs`, `warning-focus-empty-final.json`, `browser14.mjs`, `save-focus.json`은 **각 실행 안에서** 1280×900 / 390×844 emulation을 설정했다. 앞 라운드의 viewport 설정이 다음 CLI 라운드에 유지될 것이라 가정한 1409px 자료(`warning-focus-empty.json`)는 최종 양폭 증거에서 제외했다.

| 항목 | 직접 결과 |
|---|---|
| 기존 긴 필수 광고 0~30s, 장면 합계9s | 양폭에서 beyond Callout/광고 목록 경고표식/점선 테 없음, 고정 시간 설명 있음 |
| 잠긴 광고 위치 y93% | 실제 아래 안전 영역 경고, 광고 목록 표식, 점선 테1개. 취소 후 모두 해제 |
| 일반 자막 끝29s | beyond Callout와 해당 목록 표식 유지 |
| 빈 textarea | 양폭 “문구를 적으면 줄 수를 알려 드려요”, “지금0줄” 대신 입력 안내·저장 차단 |
| 변경 취소 | 양폭 최종 activeElement는 `p[tabindex=-1][aria-live=polite]` 저장 상태 글 |
| 실제 UI 저장 | 1280 r8, 390 r9 생성; 각각 저장 상태 글에 초점. 명시적 timeline POST만 1/2건 누적 |
| 화면 | 1280 innerWidth1280/scrollWidth1265(스크롤바), 390/390. 가로 넘침 없음. PNG 직접 열어 확인 |

진짜 기획 길이>영상 길이 조건도 추가했다. `planned-over-video.mts`는 **자기 임시 DB에만** 새 가상 video asset/scene_version 행을 넣고 선택 포인터를 씨드했다. 기존 immutable asset을 갱신하려던 최초 시도는 제품 트리거가 거절했고, 트리거를 지우지 않고 새 행으로 전환했다. 파일은 자기 storage/t089의 FFmpeg 생성 정상 1080×1920·30fps·1초 MP4다. 제품/고정 fixture/r1은 수정하지 않았다.

- active scene 기획 **270frames(9s)**, 현재 clips **150frames(5s)**, 신규 필수 AI 표기 **0~270frames**. 현재 clips와 box를 실제 API로 저장하고 production 화면을 다시 열었다.
- `browser18.mjs`/`planned-over-video-browser.json`: 1280/390 모두 AI 표기 beyond Callout·해당 목록 경고표식·점선 테 없음. 5.267초인 다른 일반 자막의 목록 경고는 그대로 남아 있음(전체 경고목록 0개라는 주장이 아님). 일반 자막을29초로 늘리면 해당 beyond 안내도 유지.
- `browser17.mjs`/`required-lines-warning.json`: 합법적인 box-only 폭5%의 잠긴 AI 표기는 실측 **4줄**, max1줄 경고·목록표식·점선 테1개 유지. 잠금 때문에 진짜 줄 수 경고까지 숨기지 않음. 28px “광고” 두 글자는 폭54px에 실제48.4px로 들어가므로 그 최초 시도는 줄 초과 반례가 아니었음.

미리보기/글꼴 시험 동안 fetch의 비-GET/HEAD 호출을 문서 시작부터 기록했다. **명시적 UI POST 전 모든 글꼴 timeout/retry/전환·경고/취소/빈 문구 조작의 쓰기 요청 0건.** 이 시점의 모든 DB table 의미 해시는 HTTP 검증 종료 직후와 동일(`preview-db-evidence.json`, `bfa37ea1fcfb5c12e45b882e1064f3da203eaf645b0d140e7490164c73ad50e3`). 이후 두 UI 저장 및 명시적 경고 fixture 씨드/HTTP 저장은 이 무쓰기 구간에서 제외했다. 소스에서도 Player/measure가 쓰기 API를 호출하지 않는 점을 대조했다.

## 5. T085에서 상속하는 독립 PASS와 보존

아래는 **b4abd9b 대상 T085의 독립 실증을 상속**한다. 이번에 같은 광범위 작업을 다시 실행했다고 주장하지 않는다. 해당 exporter/Timeline 보존/measurement 핵심 구현은 이번 변경 diff와 대조했고, 새 전체449시험 및 위 변경부 직접 실행으로 보완했다.

- T085 원본 CRLF **442+2skip**, lint/typecheck/build.
- 실제 완결 가짜 프로젝트 → UI edit/save/complete → 수동 review approve → 실제 export job claim/run → ZIP 다운로드. 수동 검수 통과가 광고 적법성/오디오/완성 영상 품질을 자동 증명한다는 의미는 그대로 제외.
- 그 다운로드 ZIP 25,940,497bytes / `f330214f0a77f257792cf142109b2cd7dafbaab52244164785dd63d9903739e3`, raw Timeline DB바이트/hash·used fonts/OFL/manifest 검증, 이후 ZIP 불변.
- full Timeline 편집·lyric raw 보존, 다른 글자 수정 시 숨은 style/animation/공백 값 보존, P1 표시/SRT 호환, CAS/noop/검수 무효화·scene/assets 보존.
- 실제 8글꼴 같은 긴 한글 측정 차이: Pretendard/Noto Sans/Noto Serif/Black Han/Gowun 7줄, Do Hyeon/Jua 6줄, Nanum Pen 4줄. outline/shadow/band/Range와 full-motion 측정 범위도 T085 명시 범위 그대로.
- readable 8종과 selectable=spec∩설치∩OFL 구분, 잘못된 font/weight 거절, 기존 같은 font/weight carry, fallback을 실측 PASS로 사용하지 않음. 이번 전체 시험에서도 missing license/잘못된 OFL/파일0·2개/없는 weight 및 carry 검증 통과. 이번에 모든 폰트/weight/license 장애의 실제 브라우저 순열을 다시 돌리지는 않음.

이번 직접 최종 보존(`final-evidence.json`):

- `checkTimelineRows` PASS, 원래 r1 JSON+hash 그대로: **`711c8622dfe63b3a0fcf96cb117d4551e5df5fc125a2b8a06f0154d38f01e226`**.
- 추출된 기존 export ZIP **1,809bytes**, **`d3e0ece1169b093d4bc0918afcb9fa5bf9646e375de1c11bb4459d016fcf1ffc`** 그대로.
- 고정 s4/s5 ZIP, SQL, 0005, fixture 소스 모두 앞의18파일 byte 비교 통과. 오래된 빌드와 별도 픽셀 diff를 했다는 주장은 없음.

## 6. 정리·한계·반환

- ego TaskSpace69 `finish({keep:[]})` 성공, 자기 p1/p2 모두 정리(`browser-cleanup.json`).
- 자기 3091 서버 exec session47540에 Ctrl+C 후 종료 exit1 확인(인터럽트 종료). `Get-NetTCPConnection -LocalPort 3091 -State Listen` 결과 없음. 타 서버/프로세스는 건드리지 않음.
- 증거·스크립트·임시 가짜 DB/MP4는 위 OS temp에 남겼다. 원본 workspace 변경은 이 보고서뿐이며 commit/push 없음.
- 실제 휴대폰/화면 읽기 프로그램, 저장16:9·1:1 exhaustive 실측, 모든 raster 경계·장문 성능·실제 탭 숨김의 모든 순열은 **미확인 유지**. 390 emulation/훅 하네스를 실제 기기/실제 React 모든 생명주기 검증으로 표현하지 않음.
- C1 sticky 보류와 C5 작은 초점 후속은 유지. 이번 집중 범위에서 새 필수 수정 없음. Master는 T085 광범위 PASS + T089 변경부 PASS + T088 디자인 범위를 합쳐 P2-3a 인수 여부를 기록할 수 있으며 다음 배정/사용자 게이트는 Master 소관.
- 이 보고서와 아래 문구 작성은 prepared 상태다. 실제 반환은 별도 Orca worker_done 영수증으로 구분한다.

### 플래너·Master에게 복사할 메시지

> T089는 1112f7b(ea2956e 포함) 집중 독립 재검수 PASS이며 F085-1/2 종료 가능합니다. 새 격리 사본의 원본 CRLF 전체449통과/2skip·lint/typecheck/build, 실제 HTTP 기존28px non-box 변경400/DB모든테이블불변·box-only200·새AI spec/P1정확모양생성및생성후불변, 실제production20초→lateok재측정 및 latefailed→새retry재실패/성공·초안유지, 경쟁조건·양폭초점/빈문구·진짜기획9초>영상5초 경고구분을 확인했습니다. 명시적 저장 전 쓰기0/DB불변, r1/고정SQL/0005/fixture/옛ZIP바이트 보존이며 T085의 광범위 폰트/값보존/실제complete→review→exportjobZIP PASS는 상속 범위로 구분했습니다. T088 C5의 retry성공후body초점은 작은 후속으로 남고 실제폰/스크린리더 제한은 유지되며, 보고서만 작성하고 자기브라우저·3091서버를 정리했습니다.
