# T-093 · P2-3b 글자 타임라인 최종 독립 검수

- 담당: Codex 독립 검수 작업자. T090 구현에 참여하지 않음. Task `task_58814ed0ed27`, Dispatch `ctx_07aeaa8488e9`.
- 대상/시작/종료 HEAD: **7d55b96a7b5e3b231623d253d8afaf2e5661060e**.
- 판정: **FAIL — F093-1~4 필수 수정.** 정상 경로는 동작하지만 저장/refresh·cache 수명·입력 오류·복합 조작에서 값 유실 또는 저장 불가가 실제 재현됨. P2-3b 인수 보류.
- 변경: **이 보고서만 작성**. 제품/시험/fixture/공유 문서 수정, commit/push 없음. 자동 검사 green을 제품 인수 PASS로 대체하지 않음.
- 기준: AGENTS, AI_TEAM_RULES, CLAUDE, docs/team 두 역할 문서, PLAN/REVIEW/TEAM, T090, T091, T079 6.4, T033 3.2.1/3.4 1-1·1-2, T085/T089. 설치본 Next 16.4.6 output/file tracing 안내 확인. T092 결과는 Master 메시지 `msg_c471f761bef3`로 참고했으며 독립 실증으로 계산하지 않음.

## 1. 격리·증거·자동 검사

보존한 OS 임시 증거 루트:

```text
C:/Users/Administrator/AppData/Local/Temp/t093-review-0c467a42a9234b7d9007a05202c945c3/
```

새 배정 child의 원본 CRLF 파일을 `app/`으로 복사(`.git/node_modules/.next/data/tmp/.env.local` 제외), 별도 `npm.cmd ci` 설치. 기존 root 데이터/서버를 사용하지 않음. s4 고정 ZIP을 제품 `verifyBackupArchive`로 **새 runtime2/**에 추출하고 제품 migrations 적용. 가상 DB의 template snapshot만 현행 메뉴 snapshot으로 보강. setup은 이전 T089 스크립트를 읽고 이번 새 경로에 복제해 직접 실행했으며 이전 runtime/검사 결과를 재사용하지 않음.

| 이번 직접 실행 | 결과 / 증거 |
|---|---|
| `npm.cmd ci` | PASS, `install.log` |
| 원본 줄바꿈 | TS/TSX **CRLF180 / LF-only0**, `app/crlf.json` |
| `npm.cmd test` | **39 files / 458 passed / 2 skipped / 0 failed**, 24.74s, `tests.log` |
| `npm.cmd run lint` | PASS max-warnings0, `lint.log` |
| `npm.cmd run typecheck` | PASS Next typegen + tsc, `typecheck.log` |
| `npm.cmd run build` | PASS production + verify-build, private data/secret trace 없음, `build.log` |
| 원본↔사본 파일 바이트 | components/lib/tests/public/config **188개 전부 동일**, `source-integrity.json` |

검사 프로세스의 `DREAM_DATA_ROOT`는 unset. ffmpeg/ffprobe만 `D:/starwork/dream-ai-studio/.tools/ffmpeg/`의 exe를 읽기/실행. fixture 생성 모드 없음. 작성자 T090의 458+2와 **이번 독립 458+2는 별도 실행**.

운영: 사본 cwd, `DREAM_DATA_ROOT=<root>/app/runtime2`, `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3093`. ego-browser **TaskSpace74, p1만** 사용. 가상 프로젝트 `019b8b74-3f10-7137-8265-68b11d809f0c`.

브라우저 시험은 실제 production 번들에서 수행. 실제 POST를 서버에 보낸 후 반환된 Response 전달만 fetch wrapper로 보류. 추가 refresh 시험은 **실제 RSC GET의 반환 전달만** 보류. 앱 코드/서버 응답 본문/timeout 상수는 변경하지 않음. 500만 명시적으로 합성 Response를 사용한 fault injection. rAF 지연은 현재 문서 requestAnimationFrame callback 전달을 보류하고 기존 100ms fallback을 확인한 것임.

## 2. 필수 수정

### F093-1 · P1 · POST 성공 이후 refresh 완료 전의 최신 편집 유실 / 30초 만료 유실

위치: `components/editing-panel.tsx:29`, `:31`, `:40`, `:75`.

재현 A (`browser19.mjs`, `refresh-race-before.json`, `refresh-race-after.json`):

1. 저장할 문구 A를 입력, 실제 POST 응답을 보류.
2. 응답 대기 중 문구 B와 타임라인 +1frame을 입력.
3. POST 응답을 풀되 이어지는 실제 edit RSC refresh 반환을 보류.
4. 아직 표시된 편집기에서 문구 C와 타임라인 +1frame을 더 입력.
5. refresh를 풀면 **C → B, 시작36 → 35, 끝107 → 106**으로 되돌아감. r7 화면은 B가 저장 안 됐다고 표시하지만 최신 C와 한 프레임은 사라짐.

이것은 navigating-away로 초안을 버린 경우가 아님. 같은 화면에서 편집 가능한 동안 한 최신 조작이 잃어버려짐. POST 완료 시점의 `draftRef.current`를 `carried`에 한 번 복사하고, refresh 중 변경을 더 추적하지 않음. `pending`도 refresh 전에 풀려 편집/저장 버튼이 다시 사용 가능함.

재현 B (`browser20.mjs`, `expiry-before.json`, `expiry-after.json`):

- 실제 POST 대기 중 B와 +1frame을 입력하고 POST를 풀음.
- 실제 refresh 전달을 **실제 시간 31초 이상** 지연한 뒤 풀음(Date.now 가속 없음).
- `carriedFor`의 30초 조건 때문에 **B 전체와 타임라인 변경이 사라지고 A 저장값으로**, r8 dirty 표시도 없어짐.

수정/재검수 요구: POST 시작부터 새 기준 editor가 실제 붙을 때까지 최신 초안의 소유권을 유지하거나 편집을 명확하게 제한. TTL을 이용해 아직 살아 있는 사용자의 편집을 버리지 말 것. 양쪽 지연, 연속 저장, 정확한 새 revision/pointer로 후속 CAS 재검증 필요.

### F093-2 · P1 · unmount된 저장의 늦은 응답이 폐기한 초안을 재등장시킴

위치: 같은 파일 `:29~41`, `:75`. 증거 `browser12.mjs` + `browser14.mjs`, `navigation-cache.json`, `stale-resurrected.png`.

1. A를 실제 저장하며 응답 전달을 보류, 저장 중 B 입력.
2. **이전 편집용 묶음 보기** 링크로 export 이동 후 edit 탭으로 돌아옴. 새 editor는 서버의 r6/A를 기준으로 붙음.
3. 새 editor에서 C 입력. 이제 이전 unmount된 editor의 POST 응답을 풀음.
4. 같은 r6 key의 새 editor는 C를 유지하지만 이전 async continuation이 전역 `carried=B`를 남김.
5. 사용자가 **변경 취소**를 눌러 A로 복귀한 것을 확인한 후 export→edit를 다시 이동.
6. **폐기했던 B가 다시 나타남**, dirty + “저장하는 동안 고친 내용은 아직 저장하지 않았어요.”까지 표시.

기존 mounted editor의 effect는 같은 project/revision의 뒤늦은 carry를 정리하지 않으며 `carriedFor`는 요청/예상 응답 revision/pointer/해당 refresh의 소유권 없이 “다른 revision, 같은 project, 30초”만 확인. 취소한 C 대신 오래된 B가 살아나는 명백한 수명 오류.

수정/재검수 요구: 저장 요청과 해당 editor/refresh에 carry를 귀속하고, unmount·취소·다른 방문/프로젝트 이후의 응답과 cache를 무효화. 현재 새 editor의 편집을 덮지 않는지 실제 client navigation과 뒤로가기, 다른 프로젝트 왕복으로 재검증.

### F093-3 · P1/P2 · 시간 오류 상태 수명 두 가지

A. **P1 저장 불가** — 기존 경로에서도 존재하던 결함, 이번 timeline 변경으로 새로 생겼다고 주장하지 않음.

- 위치 `components/text-editor/text-editor.tsx:178`, `components/editing-panel.tsx:48`, `:81`.
- 글자 A 시작 시간에 `bad` → A 삭제 → 선택은 B로 이동, B의 두 시간은 유효.
- 하지만 저장 버튼은 계속 **“시작·끝 시간을 먼저 확인해 주세요.”**로 비활성. 삭제한 A의 `times` 항목이 남아 보이지 않는 오류가 전체 저장을 막음. 되돌리거나 전체 변경을 취소해야 벗어남.
- 증거 `browser6.mjs`, `edge-input.json`의 `remove invalid text`, `removed-invalid-blocks-save.png`. 화면 스냅샷에도 저장 불가 이유와 유효한 B가 함께 남음.

B. **P2 입력 유실** — 새 save-retention이 시간 입력 상태를 보존하지 않음.

- 실제 POST 대기 중 시작 시간 `bad-during-save` 입력 → invalid=true 및 오류 이유 확인 → 응답/refresh 완료.
- raw 입력과 오류가 모두 사라져 정상 시간으로 돌아가고 저장할 변경 없음이 표시됨.
- 증거 `browser11.mjs`, `invalid-save-before.json`, `invalid-save-after.json`(r4→r5). carry 구조에는 draft/선택만 있고 times는 없음.

선택 왕복 자체는 잘못 입력한 raw/error를 유지했고, 해당 clip을 timeline으로 실제 옮기면 시간 오류를 지우고 새 유효 시간을 표시하는 경로는 PASS. 삭제 시 자기 오류만 정리하고, 저장 중 새로 입력한 raw/error는 유실되지 않도록 재검증 필요.

### F093-4 · P1/P2 · 활성 pointer drag와 키/선택 동작이 충돌

위치 `components/text-editor/text-timeline.tsx:62~90`, `:125`; `lib/edit/text-ops.ts` clipKeyAction.

A. **P1 한 프레임 유실** (`browser15.mjs`, `drag-key-race.json`):

- 시작34/끝105인 clip을 pointer로 +60px 끄는 동안(로컬 화면만 변경) → 키를 한 번 누름.
- 실제 초안/접근 이름/SRT에 시작35/끝106이 반영됨.
- pointerup은 오래된 `origin`에서 +63frame을 계산해 시작97/끝168을 덮어씀. 두 조작 합계면98/169여야 하는데 이미 적용한 키 1frame이 사라짐.
- 끄는 동안 이동 키를 받지 않거나, 먼저 drag를 끝내거나, 변경을 일관되게 합쳐야 함. 이미 반영한 키를 조용히 덮는 현재 동작은 불가.

B. **P2 선택 전환 무시** (`browser6.mjs`, `edge-input.json`):

- A drag 중 ArrowDown → B가 선택되고 A는 비선택, 초안은 아직 원래 시간.
- 그 상태에서 pointerup → A가 이동 확정되고 다시 A로 선택/초점이 돌아감.
- 선택 변경이 active drag를 끝내거나 취소하지 않아 이후 release가 다른 동작을 뒤집음. 명시적 selection-change 경계 정리 필요.

단독 pointerup/cancel/escape 경로의 PASS가 이 복합 조작 FAIL을 대신하지 않음.

## 3. 직접 PASS 범위

| 항목 | 실제 결과 / 증거 |
|---|---|
| clip vs ruler vs 입력 우선순위 | clip →1frame, Shift→30frame, Alt 끝만1, Alt+Shift 끝만30; seek 그대로. ruler→1/Shift→30/Home0/End899; clip 값 그대로. textarea Home+Shift→ selection[0,1], clip/seek 불변. `keyboard.json`, `keyboard-final.json` |
| 키 반복·blur·선택 | rAF 보류 중 실제 CDP Input keyDown12개(autoRepeat 포함) → +12frame, 100ms fallback 반영, 늦은 callback 전달 후 추가 이동 없음. blur flush, ↑/↓ 선택, Enter 문구. 처리한 키 window 도달0, Tab만 도달. Space 재생/멈춤 각각1회, 선택/clip 시간 불변 |
| 잠긴 표기 | 키와 실제 HTTP 시간/문구 변경 거절, UI 상태 글, 값 불변. broad 불변 API 조합은 T089 상속 |
| pointer 단독 | 정확히3px는 선택만. +60px drag 중 label/SRT 초안 불변, release 후 +63frame 한 번. Esc/pointercancel/lostcapture rollback, 화면 밖 좌우 release도 길이71 유지하며0/900 clamp. 끝 손잡이 시작4/끝5 최소1frame. `pointer-corrected.json`, `edge-input.json` |
| local-only의 한계 | 관찰한 초안/SRT 및 release 전후 값 비교로 local draft→commit 의미 확인. React callback 호출 횟수의 내부 계측은 하지 않음 |
| 정상 지연 저장 보존 | 실제 POST 응답 지연 중 inspector 문구+timeline30frame 변경 → r2 refresh 뒤 둘 다 남고 dirty, selection 유지. 후속 실제 저장 r3의 요청 revision6 / 새 r2 pointer 사용,200. `save-retention.json`, `save-edge-recovered.json` |
| 실패 유지 | 실제 유효 stale revision1 요청409 후 문구/dirty 유지. 합성500 응답도 문구/dirty 유지. `failure409.json`, `failure500.json`. 첫 revision0 주입은 schema400이므로409 증거에서 제외 |
| noop/CAS/잠금 API | 실제 HTTP noop200 created=false, locked-time400, locked-content400, stale-revision409, stale-pointer409. 각각 모든 DB table 의미 동일. `api-final.json` |
| 1280/390 | 1280 scrollWidth1265,3줄/눈금/경계/선/빗금 확인.390 scrollWidth375, 보이는 clip/slider0. `geometry.json`, `timeline1280.png`, `mobile390.png` |
| C5 | Do Hyeon load 실패 주입→재실패 focus retry 버튼+status, 실패 해제 후 실제 글꼴 성공→선택 글자 `[data-text-heading]` 초점. `c5.json`, `browser18.mjs` |

첫 pointer 스크립트는 viewport/scroll 위치가 맞지 않아 hit하지 못했다. `pointer.json`은 **폐기한 harness 관찰**이며 PASS 근거는 viewport를 각 round에서 지정하고 실제 hover로 scroll한 `pointer-corrected.json`만 사용. 최초 C5 harness는 FontFace.family의 따옴표 때문에 실패를 주입하지 못했으며 그 결과도 PASS로 계산하지 않음. 수정 harness는 실제 실패 상태와 retry를 확인했다. CDP 에뮬레이션/주입은 CLI invocation 사이에 그대로 유지된다고 가정하지 않음.

## 4. 미리보기 쓰기·불변성·상속

- 첫 명시 저장 전, 키/drag/cancel/시간 오류/삭제/모바일 관찰 뒤 **모든18개 sqlite table**의 행을 JSON 정렬해 비교. `db-baseline.json`과 `db-preview.json` hash 둘 다 `6fcd3b7b37e5b4106ca4a9270c36af8750b1d653d0eeab04eeb8d96526e22e24`.
- 같은 구간 fetch wrapper의 mutation 요청 **0**(`geometry.json` wide.writes=[]). 단, 이것은 전체 CDP Network 요청 감사와 동일하지 않음. **요청받은 완전한 CDP writes0는 별도 미실행 갭**으로 남기며 DB 의미 동일+관찰 fetch0만 직접 PASS.
- 실제 명시 저장 뒤 r1 행을 포함한 옛 timeline rows 보존, assets/scene_versions/scenes/project_assets/settings/exports 전체 행 불변. 검수는 locked, edit in_progress, export locked로 무효화. `api-final.json`.
- 최종 DB도 timeline8행까지 증가. 이 증가를 미리보기 쓰기로 계산하지 않음(실제 explicit save7회). `db-final.json`.
- s4 manifest의 storage7파일(기존 ZIP·scene 이미지 포함) 실제 sha256 모두 동일, `storage-integrity.json`. 같은 가짜 데이터에서 원본 r1 JSON·P1 settings·기존 ZIP 보존을 직접 확인.
- T089 대비 변경에서 서버/API/DB/migration/package/assets 변경 없음을 diff로 확인. T085의 실제 review→export-job→ZIP/font/measurement 및 T089의 broad locked-disclosure29요청/글꼴 timeout·race 증거는 **그 대상 버전에서 상속**. 이번 target에서 전체 ZIP 흐름이나 broad font 행렬을 새로 실행했다고 주장하지 않음.

## 5. 남은 검증·해석 한계

- **미실행:** 실제 휴대폰, 실제 screen reader, touch/pen. Pointercancel/lostcapture는 현재 browser의 합성 PointerEvent 주입이며 실제 OS 취소 재현 아님.
- saved16:9/1:1 timeline geometry는 새로 저장해 검증하지 않음. 이번 직접 geometry는 saved9:16의1280/390. 이 갭은 PASS 처리하지 않음.
- back/history, different-project 왕복, 모든 rapid-save ordering, key queue와 delete/unmount/save의 전 조합은 미완료. 같은 프로젝트 실제 export 왕복/remount/cancel/stale-response는 F093-2로 직접 FAIL. 실제 refresh 지연/31초 만료는 F093-1로 직접 FAIL이므로 더 넓은 정상성을 주장할 수 없음.
- T092 C1(영상 끝 label 가림)은 이번 timeline1280 캡처에서도 읽기 어려움. C2 body focus/C3 충돌 후 새로고침 안내는 별도 디자인 피드백이며, 이번 실제409 draft 유지가 새로고침까지 보존된다는 뜻은 아님. 현재 보존은 in-memory라 hard reload로 영속 보존되지 않고 beforeunload는 dirty일 때만 경고한다는 코드 관찰. 실제 reload 확인/취소 UX까지 직접 검증하지 않음.
- 새 서버500를 유발하는 제품 장애 대신 합성 HTTP500으로 UI 오류 분기만 확인. 실제 서버500 및 retry backoff 검증 주장 없음.
- 시험용 fetch wrapper를 여러 번 감쌌으므로 일부 raw request-log 중복은 wrapper 중복 관찰일 수 있음. DB행 증가·서버 revision·실제 응답을 기준으로 저장 횟수를 판단했고 중복 로그를 실제 이중 POST로 판정하지 않음.

## 6. 정리·반환·다음 진입 조건

- 브라우저 TaskSpace74 `finish({keep:[]})` 완료, `browser-cleanup.json`. 자기 loopback3093의 PID59908 command line을 확인하고 종료, 이후 LISTEN 없음. 타 서버/브라우저를 종료하지 않음.
- evidence와 fake runtime은 위 temp에 보존. 원본 child는 이 handoff만 추가. Master에게 보고 후 다른 단계로 진행하지 않음.
- 구현 담당에게 F093-1~4의 각 재현과 대응 회귀 검증을 요청. 특히 **POST+refresh를 하나의 저장 수명으로 처리**, 취소/이탈 이후 전역 cache 소유권, 시간 오류 삭제/보존, active drag의 키·선택 정책이 필요.
- 다음 단계 조건: 필수 수정 반환 후 독립 실제 production 재검수. 자동검사458+2 green이나 T092 B0만으로 종료하지 않음. 독립 검수 완료이며 제품은 FAIL; Master가 통합/재배정한다.

### 플래너·Master 복사용 메시지

> T093 독립 검수 대상7d55b96은 FAIL입니다. 원본CRLF 독립458통과+2skip, lint/type/build 및 정상 지연저장→새기준CAS·실제409/합성500 유지·C5·preview DB전체동일·기존r1/ZIP보존은 확인했습니다. 필수 수정은 F093-1 POST성공후refresh중 최신 문구/시간 및31초만료 유실, F093-2 unmount된 늦은 응답 cache가 변경취소후 옛 초안 재등장, F093-3 삭제한 시간오류가 저장차단/저장중 잘못쓴 시간 유실, F093-4 drag중 키1frame 유실·선택전환뒤 release가 옛 clip 재선택입니다. 보고서 T-093-TEXT-TRACK-INDEPENDENT-REVIEW.md에 재현/실증/갭을 기록했고 자기3093서버·browser74는 종료했습니다. 제품/시험/공유문서 수정이나 commit/push는 없습니다. 필수수정 반환후 독립재검수 전 P2-3b 인수를 보류해 주세요.