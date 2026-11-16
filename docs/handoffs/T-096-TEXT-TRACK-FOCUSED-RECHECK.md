# T-096 · P2-3b 저장 수명 집중 독립 재검수

- 담당: Codex 독립 검수 작업자. T094 구현에 참여하지 않음. Task `task_822a246e4eb3`, Dispatch `ctx_68047bb1d427`.
- 대상 / 시작·종료 HEAD: **9333b11db2236736ed34f29b10e867d8b74c42b7**.
- 판정: **FAIL — 새 필수 수정 F096-1(P1).** F093의 원래 네 실패 재현은 이번 직접 시험에서 해결됐지만, 다른 클라이언트가 저장한 더 새 revision을 자기 refresh 결과로 잘못 인수하여 건드리지 않은 글자를 되돌리고, 다음 저장이 정상 CAS로 그 값을 덮어쓰는 결함을 확인했다.
- 허용 변경: **이 보고서만 작성**. 제품·시험·fixture·공유 문서 변경, commit/push 없음. 아래 temp의 시험용 사본/계측은 저장소 변경과 구분한다.
- 읽은 기준: AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 두 역할 문서, PLAN/REVIEW/TEAM, T093의 정확한 F093-1~4, T094, T091, T092, T085/T089 및 관련 구현/시험. 설치한 Next 16.4.6의 output/file tracing 안내 확인. Master가 전달한 T095 B0는 참고이며 이번 독립 PASS를 대신하지 않는다.

## 1. 격리와 독립 자동 검사

보존한 증거 루트:

```text
C:/Users/Administrator/AppData/Local/Temp/t096-review-75aec2e15f6447f7ac721d09311228d2/
```

배정된 child의 실제 checkout 바이트를 새 `app/` 사본에 복사하고 별도 `npm.cmd ci`를 실행했다. `.git`, 기존 node_modules/.next, 사용자 data/storage/backups/.env.local은 사용하지 않았다. 고정 s4 ZIP을 제품 `verifyBackupArchive`로 새 `app/runtime2/`에 추출하고 제품 migrations를 적용했다. 가상 프로젝트의 template snapshot만 현행 메뉴 snapshot으로 보강했다. 이전 검수의 setup 절차를 읽어 이번 새 root에서 직접 실행했으며 이전 runtime이나 검사 결과를 재사용하지 않았다.

| 이번 직접 실행 | 결과 / 증거 |
|---|---|
| `npm.cmd ci` | PASS, `install.log` |
| 원본 TS/TSX 줄바꿈 | **CRLF180 / LF-only0**, `app/crlf.json` |
| `npm.cmd test` | **39 files / 462 passed / 2 skipped / 0 failed**, 24.39s, `tests.log` |
| `npm.cmd run lint` | PASS max-warnings0, `lint.log` |
| `npm.cmd run typecheck` | PASS Next typegen + tsc, `typecheck.log` |
| `npm.cmd run build` | PASS production + verify-build, private data/secret trace 없음, `build.log` |
| child 원본 ↔ production 사본 | app/components/lib/tests/public/scripts/config/package 등 **247개 전부 바이트 동일**, `source-integrity-final.json` |

작성자 T094의 462+2와 **이번 독립 462+2는 별도 실행**이다. 검사 프로세스의 DREAM_DATA_ROOT는 unset, ffmpeg/ffprobe 경로만 `D:/starwork/dream-ai-studio/.tools/ffmpeg/`로 지정했다. fixture 생성 모드는 사용하지 않았다.

초기 robocopy의 전역 디렉터리 제외가 `lib/storage`, `tests/fixtures/backups`까지 누락시켜 첫 검사들이 실패했다. 이는 불완전한 검수 사본 문제였다. tracked 파일을 원본 바이트로 복사한 뒤 위 네 검사를 전부 다시 실행했다. 초기 실패 로그도 `*-incomplete-copy.log`로 보존한다. 시험을 수정하거나 LF로 바꿔 통과시키지 않았다.

운영 서버: 사본 cwd, `DREAM_DATA_ROOT=<root>/app/runtime2`, `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3096`. ego-browser **TaskSpace86, p1만** 사용. 가상 프로젝트 `019b8b74-3f10-7137-8265-68b11d809f0c`.

## 2. 새 필수 수정 F096-1 · P1 · 다른 저장의 revision을 자기 handover로 인수

위치: `components/editing-panel.tsx:32`, `:43`, `:88`, `:95`; `lib/edit/text-ops.ts`의 `afterSave`.

`Handover`는 출발 revision과 owner만 갖고 **성공 응답의 정확한 revision/timelineId를 저장하지 않는다**. 인수 조건은 `from.fromRevision !== data.revision`이며, 새 editor가 그 저장의 실제 도착 revision/pointer인지 확인하지 않는다. `afterSave`는 저장 중 하나라도 바뀌면 이전 전체 Timeline을 새 기준 위에 올린다.

실제 production 재현 (`browser11.mjs`, `browser12.mjs`):

1. 화면은 timeline **r8 / 내용 revision12**. 첫 자막을 A로 고쳐 실제 저장 POST를 보내고, 실제 서버 응답의 브라우저 전달만 보류한다.
2. 자기 저장은 **200, 내용 revision13, timeline r9, id `01a1e487-438b-7476-a65f-9325f064b2bd`**로 완료됐다. 이전 editor에서 첫 자막을 B로 더 고친다. 두 번째 자막은 사용자가 건드리지 않았다.
3. 별도 loopback HTTP 클라이언트가 방금 저장된 revision13/r9 pointer로 **두 번째 자막만** `T096 EXTERNAL newer text KEEP ME`로 저장한다. 실제 서버가 **200, 내용 revision14, timeline r10, id `01a1e487-4603-7618-ab84-0de5e723516f`**를 반환한다. 합성 응답이나 DB 직접 수정이 아니다.
4. 자기 r9 응답을 풀면 refresh는 최신 r10을 읽는다. 새 editor는 r10을 자기 저장의 새 기준으로 인수한다. 첫 자막 B는 남지만, **두 번째 자막도 옛 `자막 둘 — 2.5초`로 돌아가 dirty 표시**가 붙는다. 사용자가 이 글자를 바꾼 적은 없다.
5. 이어서 화면의 저장 버튼을 한 번 누르면 요청은 **revision14 + r10 pointer**를 사용한다. 서버 CAS가 통과해 **200, r11 / 내용 revision15**가 만들어지고, GET으로 확인한 두 번째 자막도 옛 값이다. 다른 클라이언트의 문구를 실제 새 버전에서 덮어썼다.

증거:

- `ownership-before.json`: 자기/외부 실제 200 응답, 외부 요청 Timeline, refresh 전 최신 B.
- `ownership-after.json`: r10을 기준으로 붙었지만 외부 문구 대신 옛 두 번째 자막이 dirty인 화면.
- `ownership-wrong-r10.png`: 그 시점 화면 캡처.
- `ownership-overwrite-persisted.json`: 후속 실제 요청 revision14/r10 pointer, r11 저장 결과와 GET의 옛 두 번째 자막.

**요구:** handover를 자기 성공 응답의 정확한 새 revision/pointer 및 유효한 저장 소유권에 묶고, refresh가 그보다 새 외부 변경을 읽었을 때 이를 조용히 재기준화하지 말아야 한다. 최신 자기 초안을 잃지 않으면서 충돌을 명시하거나, 실제 변경분만 안전하게 처리하는 정책이 필요하다. 이 재현과 정상 dual-hold/31초/취소·이탈/StrictMode 경계를 함께 재검수해야 한다. 단순히 TTL을 되살리는 수정은 해결이 아니다.

## 3. F093 원래 실패의 직접 재검수

| 항목 | 이번 직접 결과 / 증거 |
|---|---|
| F093-1A POST + RSC 양쪽 hold | **PASS(정확히 자기 새 버전이 돌아오는 경우).** 실제 A POST 응답 보류 중 B+1frame, POST를 풀고 실제 RSC 반환 보류 중 C+1frame. r2에서 C와 **시작6/끝77** 유지, dirty/보존 안내. RSC 중 추가 submit은 POST 없음. `dualhold.json`, `browser3.mjs` |
| 후속 새 기준 CAS | **PASS.** r2의 내용 revision6 / 실제 r2 pointer로 다음 저장200, r3. `next-save-cas.json`. 단, 외부 새 버전 혼입은 F096-1 FAIL |
| F093-1B 실제 31초 | **PASS.** 실제 RSC 반환을 **31,513ms** 보류했다. B와 시작7/끝78 및 dirty 유지. Date.now 가속이나 제품 timeout 변경 없음. `slow-before.json`, `slow-after.json`, `browser4/5.mjs` |
| F093-2 unmounted 늦은 응답 | **PASS.** POST hold 중 B → 실제 client export→edit → 새 editor에서 C → 옛 응답 release: C 유지. 변경 취소 뒤 export→edit와 history back/forward에서 서버 저장 A만 보이고 B는 재등장하지 않음. `abandoned-response.json`, `browser8.mjs` |
| 다른 프로젝트 왕복 | **PASS(기존 가상 다른 프로젝트 intake 방문).** POST hold 중 B를 버리고 작업실→다른 프로젝트로 이동, 옛 응답 release 후 돌아오면 서버 A만 보임. 다른 프로젝트로 redirect/초안 부활 없음. `switch-inflight.json`, `different-project.json`, `browser9/10.mjs` |
| F093-3A 지운 글자의 오류 | **PASS.** A와 B에 각각 잘못된 시간을 넣고 A 삭제. B의 `bad-B` 오류는 남아 저장 차단. B만 고치면 삭제된 A 오류가 저장을 막지 않음. `preview-edge.json` |
| F093-3B raw 시간 보존 | **PASS.** 실제 POST hold 중 `bad-during-post`, 실제 RSC hold 중 `bad-latest-refresh`. r5에서도 최신 raw 입력과 aria-invalid=true/시간 오류·저장 차단 유지. `raw-invalid-save.json`, `browser6.mjs` |
| F093-4A drag + 키 | **PASS.** 실제 mouse drag +60px 중 →/Shift+→/Alt+→/↓/Enter/Space는 초안/선택을 바꾸지 않음. release는 drag만 반영(4/75→67/138), 다음 정상 →는68/139로 한 프레임 반영. `preview-edge.json` |
| F093-4B 선택 변경 | **PASS.** drag 중 다른 clip으로 focus/선택 변경 뒤 release해도 이전 clip 이동/재선택 없음. 선택 B 유지. 같은 파일 |
| drag + 시간/취소/삭제 | **PASS.** drag 중 시간 끝을3초로 바꾼 값, 변경 취소로 돌아간 저장값, 삭제된 글자의 부재가 release 뒤 유지됨. 삭제 뒤 다음 글자 선택 유지. 같은 파일 |
| pointercancel/lostcapture | **PASS(합성 이벤트).** 실제 mouse drag 도중 각 PointerEvent를 주입한 후 release: 원래 시간, 이후 정상 조작 가능. 실제 OS 취소/터치·펜의 검증은 아님 |

저장 중 취소는 disabled이고 이유가 표시됐다. 원래 F093-2의 late response/cache 부활은 닫을 수 있는 실증이지만, **다른 새 revision까지 인수하는 더 넓은 저장 소유권 문제는 F096-1로 열려 있다**.

## 4. 연속 저장·실패·비동기 queue·React 경계

- **빠른 double/triple submit PASS:** 같은 event turn의 click×2 + requestSubmit가 POST **1건**만 만들었다. 최초 dual-hold와 별도 r6 시험에서 확인. `triple-submit.json`의 delta=1, `browser3/7.mjs`.
- **noop PASS:** 바깥 공백만 추가한 UI 저장은200/created=false, r6 그대로. 공백이 dirty로 남는 기존 동작은 T094가 명시한 한계이며 이번 신규 회귀로 분류하지 않음. `noop.json`.
- **실제409 PASS:** 외부 유효 저장 뒤 이전 기준 p1에서 저장 → 실제409, 초안/dirty 유지, **activeElement가 role=alert**, 새 충돌 안내. `real409.json`. 추가 실제 stale-revision409에서1280 화면/초점을 `focus409.json`·`focus409.png`로 확인.
- **합성500 PASS(오류 UI 분기만):** 자기 browser fetch에서만 HTTP500 Response를 반환. 초안/dirty 유지, 오류 문구와 alert 초점. `injected500.json`. 실제 서버500나 backoff 검증으로 주장하지 않음.
- **async rAF → 실제 save PASS:** rAF callback 전달을 보류한 상태에서 clip → 후 실제 저장 버튼 click. blur flush가 반영된 **시작7/끝78**이 실제 POST에 들어가 r13으로 저장됐다. 보류 callback을 늦게 전달해도 추가 프레임 이동 없음. `raf-save.json`, `browser14.mjs`.
- **async rAF → cancel PASS:** pending key 후 실제 변경 취소 click,100ms fallback 이후와 늦은 callback 전달 뒤 모두 저장값7/78·dirty없음. `raf-cancel.json`.
- **async rAF → unmount PASS(앱내 이탈은 초안 폐기 정책):** pending key가 있는 문서에서 export로 이동 후 늦은 callback 전달, edit 재방문은 저장값7/78이며 초안/cache 부활 없음. `raf-unmount.json`, `browser14/15.mjs`. 이 때 한 pointer click은 rAF hold가 scrolling까지 방해하여 실패했고, 새 관찰 뒤 링크에 focus+Enter로 이동했다. 해당 실패 click을 성공으로 계산하지 않았다.

### StrictMode 실제 계측

production247파일과 별개인 **자기 temp `devapp/`**에 render/effect setup/cleanup 로그만 넣었다. 제품 조건·timeout·인수 로직은 바꾸지 않았다. `reactStrictMode:true` 그대로, 자기 loopback3097의 `next dev --webpack`에서 실행했다. production PASS와 혼합하지 않는다.

- `strict-initial.json`: 실제 **render×2 → setup → cleanup → setup**, 내용 revision17.
- `strict-save.json`: 실제 POST/RSC 양쪽 hold 중 A→B→C와 +1frame. 새 내용 revision18의 **render×2가 saved handover를 읽고**, 그 다음 이전 revision17 cleanup(owns=true), 새 setup→cleanup(owns=false)→setup 순서가 기록됐다. 새 화면 r14에 C/시작8·끝79·dirty/보존 안내와 상태 글 초점 유지.
- 이 관찰에서는 새 render가 읽기 전에 이전 cleanup이 handover를 지우거나, StrictMode 재설정이 최신 초안을 잃는 현상은 없었다. useState initializer는 handover를 읽되 지우지 않는 코드이며, 폐기되는 모든 concurrent render/Suspense interleaving을 증명한 것은 아니다.
- **owner가 다르다 / revision이 다르다**는 검사는 **정확한 기대 도착 revision/pointer** 검사와 다르다. StrictMode 정상 경로 PASS가 F096-1의 실제 반례를 덮지 않는다.

계측 dev의 첫 Turbopack 시도는 자기 node_modules junction이 workspace root 밖으로 해석되어 package resolution 실패였다. CLI가 지원하는 webpack dev로 다시 실행했다. 환경 실패 및 webpack의 Watchpack 파일 스캔 경고 로그도 보존한다. 검증된 production 빌드에는 계측/webpack 변경이 없다.

## 5. 화면·불변성·상속

| 항목 | 직접 확인 |
|---|---|
| 1280 | scrollWidth1265, 글자3줄·눈금·장면 경계·빗금. **영상 끝 label이 눈금 영역에서 읽힘**. `geometry.json`, 직접 열어 본 `timeline1280.png` |
| 390 | innerWidth390 / scrollWidth390, 보이는 timeline clip/slider0. `geometry.json`, 직접 열어 본 `mobile390.png` |
| C2/C3 | 실제409 초점=alert, 초안 보존과 reload 시 유실 안내 표시. `real409.json`, `focus409.json/png` |
| preview CDP Network | 복합 키/drag/시간 오류/삭제/취소 preview 창에서 **Network.requestWillBeSent 17건, 쓰기0**. `preview-network.json`, `network-summary.json`. fetch wrapper만으로0이라 부른 것이 아님 |
| 첫 명시 POST 전 DB | 모든 **18개 table의 전체 행 정렬 JSON 의미 동일**, baseline/preview hash 모두 `b0333ee80c9fcd7715d2c1bd6b1a797e13548e5bb65580cb0f9782d20eb2de74`. `db-baseline.json`, `db-preview.json` |
| HTTP 불변성 | 실제 noop200(created=false), stale-revision409, stale-pointer409, locked-time400, locked-content400 각각 요청 전후18개 table 의미 동일. `api-final.json` |
| 이전 데이터 | 기존 r1 행 포함 원래 timeline rows 보존. assets/scene_versions/scenes/project_assets/settings/exports 전체 행 그대로. `final-preservation.json` |
| ZIP/파일 | s4 manifest의 기존 ZIP·scene 이미지 등 **storage7파일 sha256 전부 일치**. `storage-integrity.json` |
| migrations/fixtures | 원본↔production사본247파일 비교에 포함, 차이0. 원본 fixture/SQL 수정·재생성 없음 |

명시 저장들 뒤 timeline은1→14행이며 바뀐 table은 activity_log/projects/stage_states/timeline_revisions이다. 이 증가는 실제 명시 POST(외부 클라이언트2건과 StrictMode 시험1건 포함)의 결과이며 preview 쓰기로 계산하지 않는다. `db-final.json`, `storage-check.cjs`.

CDP 쓰기0의 직접 창은 `browser2.mjs`의 복합 preview 조작 구간이다. 모든 후속 script/다른 origin/전체 저장 수명의 Network 감사를 주장하지 않는다. geometry까지 관찰한 뒤 첫 명시 POST 전에 DB18개 표 동일을 확인했다. 후속 `page.events()`가 빈 것은 후속 전체 요청0의 증거로 사용하지 않았다.

**명시적 상속:** T093의 정상 keyboard/pointer broad PASS(clip/ruler/input 우선순위, 반복/blur, 잠긴 표기, 임계3px·clamp·끝손잡이·Esc 등)는 그 버전의 증거로 이어받는다. 이번엔 변경된 실패/복합 경계를 위 표처럼 직접 재실행했다. T085의 실제 review→export-job→ZIP/font/measurement 및 T089의 broad 잠금 API·font timeout/late/retry/race 증거도 해당 버전의 상속이다. 이번 target에서 전체 ZIP 생성·글꼴 행렬·C5 전체를 새로 실행했다고 주장하지 않는다.

## 6. 갭·하네스 한계·정리

- **미실행:** saved16:9/1:1의 새 저장 기준 deep geometry. 이번 직접 geometry는 saved9:16의1280/390이며 임시 가짜 aspect 수정으로 PASS를 만들지 않았다.
- 실제 휴대폰, 실제 screen reader, touch/pen, OS 실제 pointercancel은 미확인. 합성 이벤트/CDP/desktop resize를 실제 장치 PASS로 표시하지 않는다.
- 브라우저 fault injection은 자기 문서의 실제 POST/RSC **반환 전달 hold**, 합성500, rAF callback 보류/늦은 전달뿐이다. rAF wrapper는 이미 취소된 callback까지 수동으로 늦게 부를 수 있는 강한 하네스이며 실제 브라우저가 취소된 callback을 호출한다고 주장하지 않는다.100ms 제품 fallback/31초 시계는 바꾸지 않았다.
- `browser6`은 raw 오류 보존 뒤 그 오류가 올바르게 저장을 막는 상태에서 다음 저장을 시도해 timeout됐다. `browser7`에서 시간을 유효하게 고친 뒤 triple/noop을 검증했다. `browser13`은 full reload가 이전 CDP 주입을 유지하지 않아 __q가 없어 중단됐고, `browser14`에서 현재 문서에 새로 주입했다. 실패한 하네스 결과를 제품 PASS로 세지 않는다. 모든 script/log를 보존한다.
- production 서버63536은 자신의 부모 PowerShell과3096 명령을 확인해 종료했다. dev Turbopack/webpack 서버도 자신의 temp command line을 확인해 종료했다. `production-cleanup.json`, `server-cleanup.json`, `cleanup-confirmation.json`: **3096/3097 LISTEN0**.
- TaskSpace86 `finish({keep:[]})` 완료, `browser-cleanup.json`. 타 작업의 서버/탭을 종료하지 않았다. 증거·가상 DB·계측 사본은 위 temp에 남겼다.
- 저장소는 이 보고서만 추가. Master가 공용 상태를 갱신할 범위이며 작업자는 다음 마일스톤으로 진행하지 않는다.

## 7. 반환과 다음 진입 조건

독립 재검수 작업은 완료했으나 **제품 인수는 FAIL**이다. F093의 원래 재현 네 건은 위 직접 증거 범위에서 닫을 수 있고, F096-1은 필수 수정으로 남긴다. 작성자의 구조 문자열 시험은 현재의 `다른 revision` 조건을 기대하므로 자동검사462+2만으로 이 결함을 검출하지 못한다. 구현 담당은 정확한 도착 revision/pointer/owner 경계와 외부 저장 혼입 정책을 수정하고, 정상 dual-hold·31초·늦은 응답·raw 오류·drag·StrictMode 회귀 증거를 반환해야 한다. 그 뒤 독립 재검수 전 P2-3b 인수/다음 기능 진행을 보류한다.

### 플래너·Master 복사용 메시지

> T096은9333b11에서 독립 원본CRLF462통과+2skip/lint/type/build와 F093-1~4 원래 재현의 해결, 실제31,513ms RSC보존·취소/이탈/시간오류/drag·CDP쓰기0/DB18표동일·StrictMode 경계를 확인했습니다. 다만 F096-1(P1)로 자기 r9 저장 응답 대기 중 외부가 r10을 저장하면 r10 editor가 옛 전체 초안을 인수하고, 다음 정상 revision14/r10 CAS 저장이 건드리지 않은 외부 문구를 실제 r11에서 덮어쓰므로 제품 판정은 FAIL입니다. T-096-TEXT-TRACK-FOCUSED-RECHECK.md와 보존한 OS temp 증거를 확인해 정확한 도착 revision/pointer/owner 수정을 배정해 주세요; 자기3096/3097·browser86은 종료했고 제품/시험/fixture/공유문서 수정이나 commit/push는 없습니다.
