# T-029 · F0171 비교 영역 링크 집중 독립 재검수

2026-11-16 · parent T028/T027 · 구현 미참여 Codex 독립검수자. **집중 재검수 PASS, F-017-1 닫힘 및 F-016-1 잔여 해소. R016의 기타 증거 + R017의 F0162/V13잔여/데이터 직접 통과 + 이번 집중 통과를 합친 P1 최종 독립 PASS로 판정한다.** 은영님 흐름 확인과 디자인 시안 승인은 미완료이며 P2 진입 금지는 유지한다.

## 대상·범위·격리

- 시작/실제 검수 HEAD `a86f8f4c6967718969490e1444110a0ed4d835b3`, 시작 `git status --short` 출력 없음(clean). `git merge-base --is-ancestor b9c926c HEAD` 종료0, 수정 커밋 전체 SHA `b9c926c7b5241d56df7ecc26eb0346610f0d08df` 포함.
- Orca 새 child `C:/Users/Administrator/orca/workspaces/dream-ai-studio/p1-focused-link-recheck`에서 수행. 공통규칙/AGENTS/CLAUDE/PLAN/REVIEW R017/TEAM/역할 지침 및 T-027-INDEPENDENT-RECHECK, T-028-CC-DATA-01, T013/T026을 읽었다. Next 로컬 link 가이드, orchestration 및 ego-browser 스킬/설치버전 가이드를 적용했다.
- 수정 대상은 production-panel의 링크 조건과 compactLinks CSS, 실제 서비스 데이터 기반 render 회귀2건이다. 제품 코드 수정·커밋·푸시·P2 구현 없음. 추적파일 변경은 REVIEW의 새 R018과 본 인계뿐이며 TEAM/PROGRESS/사용자 확인 HTML은 변경하지 않았다.
- 기존 가상 fixture도 복사하지 않았다. 자기 child data/storage에 새 가상 이미지와 프로젝트를 서비스로 생성했다. 원래 실사용 source data/storage/backups 읽기·변경, 과거 fixture/캡처 변경, env/키 복사는 없다. source에 쓴 것은 명시 허용된 새-v3 PNG 두 장뿐이다. ffmpeg 도구 경로만 읽기 지정했으며 이 2건 렌더 검사는 이미지 시나리오다.
- 자기 loopback `127.0.0.1:3046` 서버(실제 listener PID20616)와 새 ego TaskSpace23만 사용. 상시 worker는 실행하지 않고 자기 fixture의 runNextJob만 호출했다. 다른 프로세스/TaskSpace 조작 없음.

## 직접 실행 명령·실제 결과

```powershell
npm.cmd ci
$env:MOCK_MODE='true'
$env:FFMPEG_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe'
$env:FFPROBE_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe'
npm.cmd test -- tests/production-panel-render.test.ts
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node --conditions=react-server --import tsx tmp/p1-review/fixture.ts create
npm.cmd run start -- --port 3046
# 브라우저 UI로 시험 시나리오/새 생성을 요청하고 자기 fixture에서 처리
node --conditions=react-server --import tsx tmp/p1-review/fixture.ts run
node --conditions=react-server --import tsx tmp/p1-review/fixture.ts check
ego-browser nodejs -e "await import('file:///C:/Users/Administrator/orca/workspaces/dream-ai-studio/p1-focused-link-recheck/tmp/p1-review/r05.mjs')"
# 동일 형식으로 r01~r07-finish.mjs, keyboard.mjs는 Tab 드라이버
```

| 검사 | 이번 독립 실행 |
|---|---|
| ci | 종료0, 265개 설치·266개 감사, 기존 moderate7 안내; ci.log |
| targeted render | **1파일 2검사 통과**, 종료0; render-test.log. 실제 서비스 데이터 → react-dom/server, 브라우저 검증과 구분 |
| lint | 종료0, 경고0; lint.log |
| typecheck | 종료0, next typegen/tsc 통과; typecheck.log |
| build | 종료0, 사적자료·비밀 추적 없음; build.log |
| 브라우저 | 새 TaskSpace23 실제 Chromium, r01~r06.log/PNG; 아래 흐름 직접 실행 |

전체223검사를 이번에 반복 실행하지 않았다. Master의 전체26파일223/build/lint 재실행은 TEAM T028의 별도 근거이며 본인 실행으로 합산하지 않는다. 작성자의 과거 코드2실패/수정후2통과는 T028 보고 이력이고, 이번 검수자는 수정후2통과만 직접 실행했다. R017의221검사·F0162·V13 연속 키보드/390 작성가능 검수표·백업 검증도 이번 새 실행이 아니라 이미 통과한 이력이다.

## 실제 브라우저 흐름·선택 보존

가상 프로젝트 `01a1e24d-80ff-7523-bdc0-e047a627ce44`, 제목 “독립 집중 검수 가상 민트컵”, 2장면. fixture.ts가 실제 서비스로 새 프로젝트/승인 기획/장면별 성공v1을 만든 뒤 baseline.json을 저장했다. 새 요청은 브라우저 시험 시나리오 선택/첫 장면 생성 버튼으로 등록했으며 처리만 자기 runNextJob으로 수행했다. 대기 시각은 now/sleep 가속 fixture라 실시간 worker 백오프 검증이 아니다.

1. **v1 성공 선택 → v2 CONTENT_REJECTED(최근):** r02/r03. 1280에서 기본 카드/Enter로 펼친 비교 영역 양쪽 실패 상자 모두 “기획 고치기” `/projects/01a1e24d-80ff-7523-bdc0-e047a627ce44/plan`, “자료 바꾸기” `/library` 존재. 기본 카드 “선택한 v1은 그대로예요.”, 비교 영역에도 선택v1 유지. 최근 거절의 두 상자 조건을 직접 관찰했다.
2. **후속 v3 성공:** r04~r06. 버전 순서 성공v3/거절v2/선택성공v1이며 거절 안내는 기본 카드에서 사라지고 펼친 비교 영역에만 정확히1개 남는다. 원인/다음 행동/자동 재시도 안 함과 링크2개가 그 상자 안에 있다. 실패 버전 버튼0, 실패 버전에 되돌리기 없음. 되돌리기는 미선택 성공v3에만1개 있다. 거절 작업 서비스 retry도 실제 거절됨(preservation.json retryRejected=true).
3. **1280×960와390×844에서 두 링크 각각 실제 Tab/Enter 이동:** r05. 매번 produce로 돌아와 첫 비교 summary에만 초기 focus를 허용해 Enter로 펼쳤다. 이후 DOM click/focus 없이 Tab을 보냈다. Tab 순서는 v3 “만들 때의 입력” → 결과 다운로드 → 성공v3 되돌리기 → 실패v2 기획 고치기, 자료 바꾸기는 다음 Tab이다. 각 활성 요소의 태그/글자/href/inNotice를 읽어 trace에 기록했다. 두 폭×두 링크 **4회** Enter 이동 후 정확한 URL과 주요 페이지 정상 콘텐츠(snapshot), 해당 페이지 GET HTTP200을 확인했다. link 도달/이동을 DOM click/focus로 대체하지 않았다. 시나리오 선택/생성 버튼 클릭은 fixture 준비용이며 전체 연속 키보드 흐름 통과로 주장하지 않는다.
4. **레이아웃·접근이름:** 실제 양폭에서 펼친 비교 상자의 scrollWidth=clientWidth, 문서 scrollWidth≤innerWidth. r06의 실패상자390 client/scroll=280/280. 두 링크는 실제 좁은 칸에도 각64.02px×22.39px로 한 줄에 들어가며 잘림/겹침 없음, flex-wrap 선언도 확인했다. 링크가 반드시 줄바꿈돼야 하는 것은 아니며 이번 글자 길이는 한 행에 들어갔다. 브라우저 snapshot에서 접근이름 “기획 고치기”·“자료 바꾸기”인 anchor이며 실제 키보드 초점/Enter 동작을 확인했다. 모든 보조기기 검증을 의미하지 않는다.
5. **보존:** preservation.json에서 selectedPreserved=true, baselineHashesPreserved=true, otherSceneUnchanged=true. baseline의 원본 이미지/선택v1 결과 파일3개(첫 fixture 실패 때 추가된 미사용 가상 이미지까지 포함하면4개)의 실제 SHA를 대조했으며 두 장면의 선택 포인터와 다른 장면 DTO 전체가 동일하다. v2/v3 생성 전후 기존 파일 덮어쓰기 없음.

## 도구 시도·한계

- fixture 첫 create는 usageRights에 허용 enum 대신 설명 문자열을 넣어 입력 검증에 거절됐다(fixture-create.log). 자기 tmp fixture만 `직접 촬영`으로 고쳐 두 번째 create 성공했다. 첫 시도의 자기 가상 이미지 행/파일은 보존했으며 제품 오류로 판정하지 않는다.
- 첫 fullPage 캡처는 키보드 스크롤 위치에 고정 헤더가 중간에 나타나 가독성이 낮았다. 최종 캡처는 **동일 실제 UI에서 스크롤을 맨 위로 돌린 뒤 재촬영**했다(r06). 이미지 편집·합성 없음. 링크 도달은 이 스크롤 조작 이전에 실제 Tab으로 검증했다.
- PowerShell이 ego console 출력을 stderr NativeCommandError 형태로 감쌌지만 ego 종료0이며 실제 navigation/측정/PNG를 얻었다. 실패를 숨기거나 SSR로 브라우저를 대체하지 않았다.
- 전체 V1~V13·백업/ZIP/스토리지 복구의 과거 통과 흐름을 이번에 재실행하지 않았다. 실대용량·실디스크고갈·실사용자ACL·전원차단·적대적 Windows 경합·모든보조기기/전면200%확대·네트워크 볼륨 성능은 기존 미검증 한계를 유지한다.

## 새 캡처·정리

자기 `tmp/p1-review/`와 허가된 `D:/starwork/dream-ai-studio/tmp/p1-review/`에 아래 두 새 파일만 복사. 대상 파일이 없음을 먼저 확인했다. SHA2/2 동일, source 기존 PNG18개(원본11/-v2 7)의 전후 SHA18/18 불변. 최종 PNG 두 장을 직접 열어 가상 자료만 있으며 개인정보·키·PC 절대경로가 없음을 확인했다. fullPage 문서 폭은 세로 스크롤바15px를 제외한 값이다.

| 파일 | viewport / PNG 치수·내용 | SHA256 |
|---|---|---|
| flow-fail-v3.png | 1280×960 / 1265×3049, v3성공·v2실패비교 두링크·v1선택됨·다른장면 | `0a1b424ed22e23461fa9e5919095c8d104cdab0126e89408ddb2979966df09a2` |
| flow-m-scenes-v3.png | 390×844 / 375×4551, 동일 비교영역 세로배치·두링크·v1선택 | `c5ad6e55919b70603a7950984d6b7d6c9bd67c23116fd9ee8874d1078676546d` |

TaskSpace23은 r07-finish.mjs의 finish({keep:[]}) 완료. 자기 서버 세션66568에 Ctrl-C를 보내 종료1로 끝냈고 이후3046 listen 없음 확인. 상시 worker는 처음부터 실행하지 않았다. 자기 가상 fixture/로그는 증거로 보존한다.

## 판정·다음 조건

필수 수정 추가 없음. **F0171 닫힘, 따라서 F0161의 마지막 잔여도 닫힘.** R017에서 독립 직접 통과한 F0162/V13잔여/추가 데이터와 R016의 나머지 증거를 이번 결과와 합쳐 **P1 최종 독립 PASS 가능, 본 검수 판정 PASS**다. 이를 이번에 전체223·전체V1~V13을 다시 통과했다는 뜻으로 사용하면 안 된다. T026 m1~m4는 기존 비차단 권장이고 이번 필수로 올리지 않는다. 은영님 사용자 흐름 확인·디자인 승인 완료 전 P2 진입 금지.

**Claude design/플래너 전달 복사문:** T029 집중 독립 재검수를 clean a86f8f4(b9c926c 포함)에서 완료했습니다. 직접 렌더2건·lint/typecheck/build와 실제1280/390 비교영역 Tab/Enter 네 번 이동·정확URL/HTTP200·v1선택/파일SHA/다른장면 보존을 통과해 F0171 및 F0161 잔여를 닫고, R016/R017 기존 통과 이력과 합친 P1 최종 독립 PASS로 판정합니다. 이번에 전체223/백업/ZIP/V13 전체를 반복했다고 주장하지 않으며 기존 미검증 한계를 유지합니다. R018/T-029-INDEPENDENT-FOCUSED-RECHECK.md와 source tmp/p1-review의 새 flow-fail-v3.png·flow-m-scenes-v3.png를 확인하고 은영님 흐름/디자인 승인을 이어 주세요. 그 승인 전 P2 금지입니다.

문서/복사문 작성과 실제 전달은 구분하며 Master 회신은 worker_done 영수증으로 확인한다. Claude design 직접 수신/통합을 주장하지 않는다.
