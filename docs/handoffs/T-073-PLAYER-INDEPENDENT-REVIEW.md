# T-073 · P2-2 Player 독립 최종검수

- 판정: **FAIL — 필수 수정 F073-1 1건.** 검수 작업 자체는 완료했다. 구현에 참여하지 않은 별도 Codex 작업자의 독립 실행 결과이며 구현자 자체 검수와 구분한다.
- 대상 제품: `ad0501b161191ce5d965a04d265e24990239c36f` (`ad0501b`). 2026-11-16, Asia/Seoul.
- 작업: `task_ea10b850a124` / dispatch `ctx_9874bc63970e`, worker `term_c9315d8f-d0de-487f-b08c-695e4efe7b63`.
- child: `C:/Users/Administrator/orca/workspaces/dream-ai-studio/p2-2-player-review`.
- 허용 변경/실제 변경: 이 보고서 하나. 제품·테스트·고정 fixture·공용 문서 수정, commit/push, 추가 작업자 없음.
- 읽은 기준: AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 역할 지침, PLAN P2-2/17/18, REVIEW, TEAM 최신 배정, T-067·T-068·T-071·T-072. 설치된 Next 16.4.6의 lazy-loading 가이드도 읽었다.

## 1. 격리·실행·증거

증거 루트 **E** = `C:/Users/Administrator/AppData/Local/Temp/dream-t073-abc1faca1aaa48f2bbf65a9a380325f1` (명령에서 보이는 `ADMINI~1`은 같은 폴더의 Windows 짧은 이름).

- 새 OS-temp `E/runtime`에 저장소의 **가상** s5 ZIP만 풀었다. 고정 fixture의 축약 template snapshot은 production 화면용 유효 menus snapshot으로 **이 사본 안에서만** 교체했다. 이 준비는 제품 결함으로 세지 않았다.
- `fake-projects.mjs`가 같은 사본에 가상 MP4 프로젝트와 장면 0개 프로젝트를 추가했다. 실제 사용자 DB·storage·기존 서버는 열거나 조작하지 않았다. `E/regression`은 저장/CAS용으로 다시 푼 별도 s5 사본이다.
- 정상 제품 production: 이 child에서 `npm.cmd run build`, `next start --hostname 127.0.0.1 --port 3173`, runtime만 `DREAM_DATA_ROOT=E/runtime`.
- 오류/비영 trim 주입: 추적 파일을 바이트 복사한 **E/fault-source**만 사용했다. node_modules는 이 child의 설치본을 가리킨다. 이 복사본의 Composition에 조건부 예외 한 줄, `app/t073-preview/page.tsx` 시험 경로만 추가했다. `next build --webpack` 후 별도 `127.0.0.1:3174`; 정상 제품의 Turbopack 빌드 결과와 구분한다. 두 서버 모두 같은 가상 runtime만 사용했다.
- ego-browser skill v2.2.1 / TaskSpace 47의 **직접 생성한 페이지**만 사용했다. 1280×1000 및 390×844를 각 실행 round에서 명시했다(초기 탐색 round의 기본 viewport 캡처는 양폭 근거에서 제외).
- ffmpeg/ffprobe는 승인된 `D:/starwork/dream-ai-studio/.tools/ffmpeg/*.exe`를 실행 파일로만 읽었다. 루트 사용자 데이터는 접근하지 않았다.
- 증거/재현 스크립트·JSON·로그·PNG·MP4는 E에 보존했다. T071의 16장 캡처를 독립 실행의 대체 근거로 사용하지 않았다.

## 2. 독립 기본 검사

| 명령 | 독립 결과 | 증거 |
|---|---|---|
| `npm.cmd ci` | 267 packages 설치 성공; 기존 moderate 7건 안내 | 기존 lock 변경 없음 |
| `npm.cmd test` | **36 files, 424 passed / 2 generation-only skipped**, exit 0 | E/test.log |
| `npm.cmd run lint` | exit 0, 경고 0 | E/lint.log |
| `npm.cmd run typecheck` | Next typegen + tsc exit 0 | E/typecheck.log |
| `npm.cmd run build` | production Turbopack + verify-build exit 0 | E/build.log |
| `node --conditions=react-server --import tsx E/regression.mjs E` | **별도 독립 검사 12건 PASS** | E/independent-checks.json |

기본 test/lint/typecheck/build 때 `DREAM_DATA_ROOT`는 **unset**했다. FFMPEG_PATH/FFPROBE_PATH만 위 읽기 전용 도구 위치로 지정했다. 생성용 S4_WRITE/S5_WRITE를 켜지 않았다. 기존 검사 424건은 구현자 보고를 옮긴 수치가 아니라 이번 child에서 다시 실행한 수치다. 별도 12건은 Vitest 424건에 포함시키거나 같은 종류의 테스트 수로 합산하지 않는다.

원본 줄바꿈을 바꾸지 않았다. `0005_timeline_revisions.cjs` CRLF 111 / 단독 LF 0, `0005_timeline_shared.cjs` CRLF 40 / 단독 LF 0 상태로 통과했다. SQL 원문은 기존 LF다. 제품·고정 fixture diff 0이며 명령/fixture가 원본을 보존하는 회귀 검사도 통과했다.

## 3. 패키지·라이선스·client 경계

**PASS.** package.json과 lock의 Remotion 항목은 정확히 `remotion@4.0.543`, `@remotion/player@4.0.543` 두 개다. cli/media/renderer 추가 없음. 설치된 두 LICENSE.md는 각각 2,849 bytes, SHA-256 `53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09`로 서로 같고 T037/T067의 승인 버전 기록과 같다. 개인 사용에 대한 기존 Master 판단을 새 법률 판단으로 확대하지 않았다.

설치된 Next 가이드의 client-only `ssr:false` 조건과 loader 경계를 대조했다. **실제 서버 HTML**에는 video 태그 0, stage aria-label 0, 준비 placeholder가 있었다. 원본 정상 빌드 `.next/server`의 NFT 추적 **33개**에서 Remotion 경로 0. 실제 브라우저는 동적 Player와 영상/글자를 렌더했다. 이는 grep만으로 동작을 통과 처리한 결과가 아니다. 근거: E/package-ssr-evidence.json, E/ssr.html, 기본 import-boundary 검사와 아래 브라우저 실행.

## 4. 순수 변환·Composition·실제 영상

| 항목 | 결과/직접 확인 |
|---|---|
| 순수 변환 | **PASS**. 별도 frozen 입력에서 clip from/duration = `(0,30),(30,60),(90,30)`, 영상 trimBefore 30, 전체 120, 글자 from15/duration85. 세 비율 호출 후 입력 JSON 동일. empty/missing 결정과 장면0→null, 시간 형식 예 0/31/254/749/750 확인. E/independent-checks.json |
| 글자 경계 | **PASS**. 실제 Player에서 frame14 없음 → 15 표시 → 99 표시 → 100 없음. 보이는 DOM을 `checkVisibility`로 구분했다. E/browser19.json |
| 가상 MP4 생성 | **PASS**. ffmpeg `testsrc2=size=320x568:rate=30:duration=4`, libx264/yuv420p/faststart. ffprobe 결과 H.264 320×568, 30/1, 4.000초. E/short.mp4와 fake-projects.mjs |
| 정상 앱 영상 | **PASS**. 유효 가상 asset·succeeded video version·scene 선택·timeline row로 정상 production 편집 화면 진입. 이미지 1초 → 영상 2초 → 빈 자리 1초. 4초 원본의 뒤 60프레임을 제외한 clip. 영상 readyState4, muted=true, paused=false, 디코드 15프레임과 화면 패턴을 관찰. 끝은 00:03.29, video가 사라지고 빈 자리. E/browser08.json, real-video1280.png |
| 비영 시작 trim | **PASS(격리 harness)**. P2-2의 현재 host clip 계산은 trimIn0만 공급하므로, OS-temp 경로에서 **동일 제품 PlayerPanel/순수 변환/Composition**에 trimIn30·duration60·trimOut30의 가상 timeline을 넣었다. timeline 00:01.00에서 paused video.currentTime=1.000, 재생 후 >1.3, 3초 경계 뒤 video 제거·빈 자리, 끝 3.29. E/browser18.json, nonzero-trim-video.png. 앱에 trim 편집 UI가 있다고 주장하지 않는다. |
| 390 영상 | **PASS(에뮬레이션)**. 실제 MP4 디코드/무음 재생과 재생 중 Shift+→ seek 후 계속 재생·무대 초점 유지, 가로 넘침0. E/browser26.json, real-video390.png |
| text tail/샘플 | **PASS**. s5 영상9초 이후 글자만 남은 구간, 전체30초/마지막29.29; 샘플 배지 확인. E/browser03.json |

전환 검증은 현재 스키마의 **cut**에 한정한다. 아직 구현하지 않은 dissolve 등이나 최종 렌더 자막 오차·음성과의 의미적 싱크·30fps 재생 부드러움까지 통과라고 하지 않는다. 자동화 화면 갱신이 느려 미리보기 시간의 연속성/품질을 정밀 측정하지 않았다.

## 5. production UI·키·읽기 전용 검증

| 항목 | 독립 결과 |
|---|---|
| 시간/키 | **PASS**. stage →→←는 .01/.02/.01, Shift+→ 1.01, End29.29, 끝→ 그대로, Home0. Space 재생/멈춤, 끝에서 재생은0부터. 키 구간 scrollY136 불변(처음 focus에 의한 스크롤은 제외). E/browser03.json |
| 입력 소유권 | **PASS**. textarea에서 End·Space·←→·Shift←·Home은 입력/선택만 바꾸고 time0 유지, 초점 TEXTAREA 유지. 로컬 dirty는 실제 공백 입력 후에만 켜짐. E/browser05.json |
| 비율/초점 | **PASS**. 9:16→16:9→1:1→원래 비율은 시간1.01 유지, 버튼 초점 유지, 복원 뒤9:16 버튼으로 초점 이동. 저장r1·dirty 불변, 저장 안 됨 칩. E/browser03.json |
| Tab | **PASS**. desktop 무대→재생→뒤→앞→비율3→안전영역→장면 아래로(비활성 위로는 빠짐). 390은 안전영역→키보드 사용법→글자 문구; 장면순서 없음. E/browser05/06.json |
| 1280 안전영역 | **PASS**. stage360×640: top76.796875/right43.1875/bottom128/left0. wide360×202.5: top/bottom10.125,left/right18; square360×360: 사방18. spec±1px. |
| 390 크기/안전영역 | **PASS(검수 체크리스트 S10)**. overflow0, preview 버튼 모두 최소44×44, 보이는 입력은 textarea3개만, 순서/종류/크기/색/시간 숨김. stage 실측316×561.765625, top67.40625/right37.90625/bottom112.34375/left0(spec±1px). E/browser06.json, mobile390.png |
| 초점선 | **PASS(시각 확인)**. 무대 바깥 민트 선이 실제 영상 위에서도 보임. real-video1280.png, mobile390.png |
| 시간 오류 | **PASS**. s5 글자2 끝0 입력 시 마지막 유효 1.00·광고/자막 유지, 안내 표시, 저장 비활성. 정상 시간 복구 후 편집/저장. E/browser22.json |
| dirty 미리보기 | **PASS**. 저장 전 문구가 무대에 반영되고 dirty 안내가 켜짐. 비율만 바꿀 때는 안내 없음. |

**네트워크/DB PASS 범위:** E/browser05·06·08·09·10·26의 Network.requestWillBeSent 감시 구간에서 POST 등 쓰기 요청 **0**. 초기 `Page.addScriptToEvaluateOnNewDocument` fetch 래퍼는 다음 round에서 유지되지 않았으므로 근거로 쓰지 않고 CDP Network 기록으로 재검증했다. 브라우저 입력 중 로컬 dirty 변화와 DB 저장은 구분했다.

- `preview-before.json` vs `preview-after.json`: 모든 SQLite 표의 전체 행을 JSON 문자열로 직렬화/정렬해 행 수와 SHA-256 비교, **모두 동일**. 비율·재생·키·안전영역·입력 로컬 편집·390 reload 포함.
- 가상 영상 프로젝트 추가 후 `media-before.json` vs `media-after.json`: 정상 영상/실패/폰트/reduced-motion 미리보기 구간의 **모든 표 동일**.
- projects·timeline_revisions·settings·jobs·activity_log 등을 포함하며 행 수만 비교한 것이 아니다. WAL 파일의 바이트 변화와 의미 내용은 혼동하지 않았다.
- 그 뒤 명시적인 저장 시험은 별도이며 API POST를 의도적으로 발생시켰다(browser16,22). 이 요청을 preview-only 0건 안에 숨기지 않았다.

## 6. 오류·대기·폰트·빈 상태

| 항목 | 결과 |
|---|---|
| 실제 asset 오류 | **PASS**. 존재하는 가상 영상 asset 요청을 CDP에서 차단(onError 경로). 장면2 파일 없음 회색 칸, Player 전체 오류로 변하지 않음, 기다림에 갇히지 않고 끝3.29까지 진행. E/browser09.json, video-missing.png |
| 실제 buffering/release | **PASS**. 가상 MP4 GET만 Fetch interception으로 정지: 1.00에서 waiting=true, video readyState0. `Fetch.disable`로 해제 후3.29 도달·waiting=false·멈춤. 실제 spinner 캡처. E/browser25-stall.json, browser25.json, actual-buffering.png. 앞선 continueRequest 시도는 Invalid InterceptionId로 실패했고 그 시도 자체를 통과 근거로 쓰지 않았다. |
| 글꼴 실패 | **PASS**. *.woff2 차단 + cache disabled 후 실제 Pretendard 대체 Callout·글자 chip. 문구 편집을 무대에 반영하고 실제 저장r2 성공. E/browser10/22.json, font-fallback.png |
| reduced motion | **PASS(현재 animation none 범위)**. 실제 matchMedia reduce=true에서 seek1.00→1.01 유지, 불필요한 움직임 생략 안내 없음(G5). 향후 애니메이션의 생략 품질은 미검증. |
| Player 실행 중 실패 | **PASS(이 경로)**. E/fault-source의 조건부 throw로 실제 Remotion error boundary 발생. 오류 안내+reload 버튼/transport 비활성. flag0 후 reload는 정상 무대·활성 transport·seek 복구. 다시 오류를 내고 textarea 수정, 오류 안내가 있는 동안 save enabled, 실제 POST로 가상 프로젝트r2 저장. E/browser16.json, player-runtime-error.png, player-error-editor-usable.png |
| Player 최초 실패 | **FAIL F073-1**, 아래 재현. |
| 장면0 실제 UI | **PASS**. 가상 프로젝트에서 EmptyState 문구·만들기 단계 링크, video0·play 없음, 글자 추가 버튼 사용 가능. 단위 시험만의 근거가 아니다. E/browser19.json, zero-scenes.png |
| 초기 준비 상태 | SSR 준비 placeholder 확인. 장시간 font-checking의 비활성 이유/Tab 상태를 별도 지연 캡처로 완전히 확인한 것은 아님(추가 확인 범위). |

## 7. 필수 수정 F073-1 — 최초 Player 실패가 빈 무대로 숨겨짐

- 중요도: **B / P2-2 완료 전 필수**. 기준 T068 2.1 오류·6.1, T072 S1: 미리보기를 띄우지 못할 때 오류 안내와 다시 불러오기가 보여야 한다.
- 관련 위치: `components/player/player-panel.tsx:16` `hiddenFallback=()=>null`, `:26` errorFallback, `:60–65` Player 오류를 부모 useEffect 구독으로만 상태에 전달하는 경로. **원인 추론**은 최초/재마운트 render 오류가 해당 구독 전에 발생해 유실되는 순서 문제이며, 결함 판정 자체는 아래 실제 실행에 근거한다.
- 임시 주입(제품 원본 수정 없음): E/fault-source/components/player/timeline-composition.tsx의 함수 시작에 `if(typeof window!=="undefined" && window.sessionStorage.getItem("t073-player-fault")==="1")throw new Error("T073_PLAYER_FAILURE");` 한 줄을 추가했다. 정상 조건은 제품과 같고 flag1에서만 실제 render 예외다.
- 재현: 3174 가상 영상 프로젝트 열기 → flag1 → 비율 바꿔 Player 재마운트. 이후 flag1 상태로 페이지 reload도 재현. E/browser11.mjs, browser17.mjs.
- **실측**: flag1인데 error=false, reload=false, play button disabled=false. 1.5초 후에도 error=false/reload=false, stage image·video·text layer0, stageText="샘플", time0.00. 오류 대신 빈 무대/샘플/안전영역만 남았다. E/browser17.json, player-initial-failure-blank.png.
- 실행 중 이미 구독된 Player의 오류는 정상 안내·reload가 보인다. 이 경로의 PASS로 최초 실패를 통과 처리할 수 없다. 오류 상태에서 저장한 뒤 새 화면이 처음부터 다시 실패할 때도 안내 없는 무대가 관찰되었다(E/browser16 saved.callout=false/reload=false).
- 영향: 실제 미리보기 초기 렌더 실패 때 사용자가 실패 사실과 재시도 수단을 찾을 수 없다. 글자 편집/저장은 살아 있었으므로 데이터 손상이나 저장 기능 전체 실패라고 확대하지 않는다.
- 수정 요청: errorFallback 자체가 최초 오류를 보이게 하거나, 최초 mount/비율 재마운트/재시도 오류도 부모 상태로 확실히 전달되게 한다. render 중 부모 setState 경고를 새로 만들지 않는 경로를 선택한다.
- 재검수 조건: 최초 오류, 비율 전환 직후 오류, flag1인 상태에서 재시도 실패 모두 안내/재시도 유지; flag0 후 reload 복구; 오류 동안 편집/저장 가능; preview-only 쓰기0/DB 불변 재확인. 제품 수정은 이 작업에서 하지 않았다.

## 8. P1 r1·저장/CAS 회귀

**PASS.** 별도 `E/regression`에서 원래 P1 snapshot과 migrated r1 editView 전체 값 동일, SRT `00:00:00,125 --> 00:00:02,500` 보존; 미리보기는 frame4(0.133초). 변경 저장은 timeline r2/내용 revision+1, r2 SRT0.133, P1 settings 전체 그대로. 낡은 revision과 잘못된 timelineId 각각 CONFLICT, 추가 행 없음; 같은 내용 재저장 created=false. checkTimelineRows와 foreign_key_check 정상. E/regression.mjs, independent-checks.json.

실제 production 화면에서도 저장 전 P1 SRT0.125/5.250, font-fallback 상태의 명시 저장r2 뒤0.133/5.267로 전환됨을 확인했다(E/browser22.json). 이 결과는 P1 시간 원본을 미리보기 편의를 위해 DB에서 바꿨다는 뜻이 아니다. 기존 424건에는 P1 export/bundle/SRT 및 F065 회귀도 포함되어 통과했다. 새 독립 스크립트에서는 최종 ZIP을 새로 제작하지 않았으므로 추가 독립 ZIP 생성 증거로 부풀리지 않는다.

## 9. 미확인·후속 범위

- Master 후속 통지 `msg_78f13a661b20`·`msg_af6183bc9dc5`: T072 최종 `63eda92` 및 T074 가독성 보완 `9e94316`이 별도로 반환되었다. **T074는 이번 독립 검수에서 미검증**이며 자동 통합/cherry-pick하지 않았다. 빈 자리·tail 글자 대비, 안전 영역 가시성, 모바일 중복 문구 보완의 작성자 검사·캡처는 T073 독립 PASS로 전환하지 않는다. 이 보고서의 제품 대상과 F073-1 판정은 계속 `ad0501b`이며 후속 집중 검수 여부는 Master가 결정한다.
- **실제 휴대폰 재생: NOT VERIFIED**. 390 ego-browser 에뮬레이션은 기기 검증이 아니다. P2 전체 종료의 실제 기기 조건은 남는다. 이 환경에 기기가 없다는 이유만으로 현재 실행 가능한 P2-2 전체를 blanket block하지 않는다.
- **실제 screen reader: NOT VERIFIED**. DOM의 안정된 stage 이름/aria-live 구조와 키/초점은 확인했지만 낭독 품질을 통과라고 쓰지 않는다.
- **실제 탭 hidden: NOT VERIFIED**. 같은 TaskSpace의 새 p2를 앞에 가져와도 p1 visibilityState가 visible/재생 중이었다. main world에서 hidden getter+visibilitychange를 합성하면 즉시 pause, visible 합성 후1.2초 자동 재생 없음. E/browser20.json. 합성 이벤트 PASS를 실제 탭 숨김 PASS로 바꾸지 않는다.
- 초기 font-checking 장기 대기 UI의 별도 지연 캡처는 남아 있다. buffering은 별개로 실제 네트워크 정지/해제에 성공했다.
- 디자인 참고: 390의 무대 폭은 card 내부 **316px**다. T068의 화면−32px 목표(358px)와 차이가 있지만 S10(넘침/44px/문구 전용)은 통과한다. Claude design이 엄격한 치수 적용 여부를 판단할 수 있게 실측을 남기며, 이 검수에서 새 필수 결함으로 확대하지 않았다.

## 10. 정리·다음 진입 조건·전달

- ego-browser TaskSpace47 `finish({keep:[]})` 완료. 직접 만든 두 페이지 닫음.
- 직접 실행한 Next PID42568(3173), PID51992(3174)만 정지. 두 loopback port LISTEN **0**. E/cleanup.json.
- 증거·가상 데이터·fault-source는 OS-temp에 보존. 기존 서버 종료/사용자 데이터 삭제 없음. 보고서 작성 직전 git status는 clean이었으며 제출 시 이 보고서 하나만 새 파일이다.
- 다음 진입 조건: Master가 F073-1 수정을 담당에 배정하고 해당 실패 경로 독립 재검수 통과 후 P2-2 완료 판정. 실제 기기/스크린 리더/진짜 hidden 및 준비 상태의 남은 검증은 위 범위대로 추적한다. 이 보고서는 T072의 design 승인이나 사용자의 판단을 대체하지 않는다.

**플래너·Master에게 복사할 메시지:**

> T073 독립 검수를 완료했고 제품 ad0501b의 P2-2 판정은 FAIL입니다. 독립 424 passed/2 skipped와 lint/typecheck/build, 추가 검사12건은 통과했고 실제 MP4 전환·비영 trim·장면0·폰트/버퍼·P1/CAS를 실행 확인했습니다. 필수 F073-1은 최초 Player render 실패가 빈 무대로 숨고 오류 안내/재시도 버튼이 없는 문제이며, 보고서7장의 임시 주입 재현과 browser17.json/PNG가 근거입니다. 제품은 수정하지 않았고 보고서 한 파일만 반환합니다. 먼저 오류 전달 경로를 수정하고 최초/재마운트/재시도 실패를 독립 재검수해 주세요. 실제 휴대폰·screen reader·진짜 hidden은 미확인으로 남겼습니다.

이 문구는 복사용 전달문이며 실제 전송/수신과 구분한다. 본 worker는 보고서 경로와 판정을 Orca worker_done으로 제출하며, 그 영수증은 Master의 통합/제품 승인까지 의미하지 않는다.
