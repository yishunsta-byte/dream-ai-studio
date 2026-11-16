# T-076 · PLAYER 집중 독립 재검수

- **판정: F073-1 동작 수정 PASS / 전체 검수 FAIL (F076-1 시험 이식성 1건).** 구현에 참여하지 않은 별도 Codex 작업자의 독립 검수다. 작업 자체는 완료했으며 제품 수정은 하지 않았다.
- 제품 기준: `3e24c713cdd7773825bd1f5d58b32373dce5b872` (T075·T074 포함), 2026-11-16 Asia/Seoul.
- task `task_a678c4a15c03`, dispatch `ctx_ef9168b270dd`, worker `term_26392f19-bedc-471d-bf57-36d5b1a28cb7`.
- 허용/실제 변경: `docs/handoffs/T-076-PLAYER-FOCUSED-RECHECK.md` 하나. 제품·시험·고정 fixture·공용 문서·등록 migration 변경, commit/push, 하위 작업자 없음.
- 읽은 기준: AGENTS/common AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, docs/team 역할 지침, T073(특히 7장), T075, T074, T072, 설치 Next lazy-loading 가이드. 일부 초기 PowerShell 출력의 인코딩/잘못된 `.mdx` 경로는 UTF-8 및 실제 `.md` 재조회로 보완했다.

## 1. 격리와 증거

증거 루트 E = `C:/Users/ADMINI~1/AppData/Local/Temp/dream-t076-9d6797b5bf3d44228dad69424c6f9f18`.

새 OS-temp E/runtime에 저장소 s5.zip 가상 백업만 풀고, 해당 사본의 축약 template snapshot만 현재 menus의 유효 snapshot으로 준비했다. 가상 DB 외 실제 사용자 data/storage를 열지 않았다. 정상 child는 npm ci 후 build, 오류 주입은 추적 파일을 바이트 복사한 E/fault-source에만 Composition 함수 첫 줄의 sessionStorage `t076-player-fault === "1"` 조건부 `throw new Error("T076_PLAYER_FAILURE")`를 추가했다. 원본 제품은 그대로다. 사본 node_modules junction은 이 child 설치본만 가리키며 webpack production build를 사용했다.

직접 시작한 서버는 사본 production `127.0.0.1:3276` 및 development `127.0.0.1:3277`뿐이며 모두 E/runtime을 사용했다. ego-browser 새 TaskSpace51, 직접 만든 p1만 사용했다. 브라우저 스크립트 round1~5, browser.json, save.json, dev-events.json, final-browser.json, before/after 모든 표 해시와 로그/PNG를 E에 보존했다. T073의 스크립트 중 prepare/dbsnapshot만 새 E로 복사해 이번 가상 사본에 실행했다.

T073 광범위 독립 근거(424 passed/2 generation skips, lint/type/build, 별도12건, 실제 MP4·비영 trim·scene0·buffering·font·P1/CAS)는 **ad0501b에서 수행된 상속 근거**로 인정한다. 이번에 MP4/trim/scene0를 새로 수행했다고 주장하지 않는다. 변경된 오류/표시 경로를 아래에서 직접 재실행했다.

## 2. 실제 오류 경로

| 경우 | 독립 결과 |
|---|---|
| flag1 최초 mount/page reload | PASS: 오류 안내·다시 불러오기 표시, transport3개 disabled. 초기 body 초점은 그대로이며 자동 초점을 새 요구로 만들지 않음 |
| flag1 상태 재시도 | PASS: 오류/재시도 유지, 초점=다시 불러오기 버튼 |
| flag0 후 재시도 | PASS: Player·글자·활성 transport 복구, 초점 aria-label=`미리보기 · 9:16` |
| flag1 후 16:9 remount | PASS: 오류/재시도와 transport disabled, 초점=16:9 버튼 |
| 1280×1000 및 390×844 오류 | PASS: final-browser.json에서 innerWidth 각각1280/390, 오류/재시도와 disabled 재확인, error-exact1280/390.png |
| 오류 중 글자 편집·명시 저장 | PASS: 두 번째 textarea 수정 후 save enabled; 실제 POST timeline 1건, r2 및 고친 문구 확인. 저장 직후 첫 관찰은 fallback alert=true/retry=false인 과도 시점이므로 안정 상태 근거로 쓰지 않음; 뒤 reload에서 오류/재시도 표시를 기다려 확인했고 round5는 같은 저장본의 새 page-load 오류를 다시 확인 |

원래 T073의 빈 무대/활성 transport 결함은 이번 실패 조건에서 재현되지 않았다. 실패/재시도 버튼과 초점은 browser.json의 retryFault/recovered/aspectFault에 기록했다. 새 오류를 고치는 동안 글자 저장 기능이 살아 있음을 실제 가상 저장으로 확인했다.

**React 개발 경고 별도 확인 PASS(실행 범위 한정):** 동일 임시 사본을 `next dev --webpack`으로 실행하고 egoAutomated.disable + Runtime.enable 후 console 이벤트를 수집했다. 개발 모드 최초 실패→실패 재시도→flagclear 복구→비율 remount 실패를 실행했다. console17건에 주입한 T076_PLAYER_FAILURE가 있어 감시가 작동함을 확인했고 `Cannot update a component` 경고0건이었다(E/dev-events.json). production console의 침묵으로 개발 경고 부재를 판정한 것이 아니다. 모든 편집 조합/React 향후 버전의 부재를 보증하지 않는다.

## 3. 미리보기의 쓰기 없음

**PASS.** 명시 저장 전 round2 Network.requestWillBeSent에서 GET/HEAD/OPTIONS 외 요청0건. before.json vs after.json은 SQLite sqlite_master의 **모든 표 전체 행**을 JSON 직렬화/정렬한 count+SHA256으로 비교했고 모두 동일했다. 초기 실패·재시도·복구·비율·키 seek·안전 영역·1280/390·page reload를 포함한다. 저장 이후 POST1건은 별도 save.json에 기록했으며 preview-only 0건에 합치지 않았다. 단순 파일 바이트/WAL 또는 표 행수만 비교한 결과가 아니다.

## 4. T074 표시 재검수

**PASS(아래 측정/실제 캡처 범위).** bright1280/390.png의 실제 가상 이미지(밝은 녹색 영역과 검은 letterbox) 및 tail1280/390.png의 어두운 글자-only 바탕, empty390.png를 직접 캡처했다. bright1280, tail390 이미지를 도구로 열어 안전영역 점선과 흰 광고 글자의 실제 표시를 확인했다. 빈 자리/글자-only 슬롯의 배경은 rgb(36,59,83), 흰 글자 rgb(255,255,255), 슬롯 안내는 sidebar-muted다. 무대 외곽 민트 초점선과 안전영역의 붉은 채움/점선이 밝은 이미지·어두운 슬롯 모두에서 보인다. 모든 가상 이미지 종류의 대비 평가로 확대하지 않는다.

| 폭/비율 | stage W×H | top / bottom / left / right CSS px |
|---|---|---|
|1280 /9:16|360×640|76.796875 /128 /0 /43.1875|
|1280 /16:9|360×202.5|10.125 /10.125 /18 /18|
|1280 /1:1|360×360|18 /18 /18 /18|
|390 /9:16|301×535.109375|64.203125 /107.015625 /0 /36.109375|
|390 /16:9|301×169.3125|8.453125 /8.453125 /15.046875 /15.046875|
|390 /1:1|301×301|15.046875 /15.046875 /15.046875 /15.046875|

spec 9:16 top12%/bottom20%/right12%, 그 외5%에 모두 ±1px 내. CSS border2px/outline1px이며 outline 때문에 위치가 밀리지 않았다. 이번 Windows classic scrollbar 환경의 모바일 stage는301px로 T074 작성자의316px와 다르며 실측을 그대로 남겼다. 가로 양의 overflow 없음. 390에 PC 제한 안내1개, 제거 대상 "휴대폰에서는 문구만 고쳐요."0개. 실제 휴대폰 검증은 아니다.

round2 초기 reload 직후 PNG(initial1280/390)는 브라우저가 viewport를 재설정한 캡처일 수 있어 폭 근거에서 제외했다. **error-exact1280/390.png**는 navigation 뒤 metrics를 다시 지정하고 innerWidth를 기록한 올바른 양폭 근거다. bright/tail은 같은 round에서 각각 metrics를 설정한 뒤 측정/캡처했다.

## 5. 기본 검사와 F076-1

| 명령 | 이번 독립 결과 |
|---|---|
|npm.cmd ci|267 packages 설치, lock diff0|
|npm.cmd test|**36 files: 424 passed / 1 failed / 2 skipped**, test.log|
|npm.cmd run lint|exit0, 경고0, lint.log|
|npm.cmd run typecheck|typegen+tsc exit0, typecheck.log|
|npm.cmd run build|Turbopack+verify-build exit0, build.log|
|임시 fault-source next build --webpack|exit0, fault-build.log|

**F076-1 — CRLF checkout에서 T075 신규 소스 검사 실패.** `tests/p2-2-preview.test.ts:99`가 `function PlayerFailed...{\n  useEffect...`라는 LF 전용 문자열을 `readFileSync` 결과에서 찾는다. 실제 파일은 원래 CRLF이므로 기대 substring이 없고 신규 시험1개가 실패한다. 오류 동작 실패와 구분되는 시험 이식성 결함이며 전체 checks-green 판정 전 수정 필요다. T075 작성자의 **425 passed /2 skipped는 작성자 결과**로 따로 남기고, 이번 독립 결과로 대체하지 않는다. 기존424건은 통과했다.

수정 요청: 시험에서 줄바꿈을 정규화하거나 CRLF/LF 모두 허용하는 assertion을 사용하고 제품/migration CRLF를 보존한 채 재실행한다. 이번 작업은 보고서 전용이라 시험 수정/줄바꿈 변환을 하지 않았다. 실패를 피하려 checkout 전반을 LF로 바꾸지 않았다. git diff/status로 제품·시험·fixture 변경0을 확인했다.

## 6. 한계·정리·다음 조건

- 실제 휴대폰/스크린 리더/진짜 탭 hidden 및 초기 font-checking 장기 대기는 T073의 미확인 범위를 그대로 유지한다. 이번 집중 재검수로 새 PASS를 부여하지 않는다.
- missing-file 슬롯의 오류전환 자체는 T073 broad 근거를 상속하며, T074 공통 Slot의 empty/tail은 직접 관찰했다. 이번에 missing-file 네트워크 차단을 새로 실행하지 않았다.
- TaskSpace51 finish({keep:[]}) 완료, 직접 만든 페이지 종료. pid.txt/dev-pid.txt의 자기 서버만 정지, 3276/3277 LISTEN0 확인. 기존 서버에 접근/종료 없음. 증거·가상 데이터·임시 소스는 E에 보존.
- 다음 조건: Master가 F076-1 시험 수정 후 CRLF checkout의 관련/전체 검사 통과를 확인하면 F073-1 기능과 T074 집중 범위는 이 보고서의 독립 PASS를 사용할 수 있다. 사용자/디자인의 최종 게이트를 대신하지 않는다.

**플래너·Master에게 복사할 메시지:**

> T076 독립 집중 재검수를 완료했습니다. 제품3e24c71의 최초·비율 재마운트·실패 재시도·복구·오류 중 편집/실제 저장과 새 page-load 오류는 PASS이며 개발 모드에서도 부모 render-state 경고0을 확인했습니다. T074 양폭 캡처/안전영역±1px·흰 글자·모바일 안내와 preview-only CDP 쓰기0/모든 표 의미불변도 PASS입니다. 다만 원래 CRLF checkout에서 T075 신규 assertion이 LF를 강제하여 독립 전체 시험은424 PASS/1 FAIL/2 SKIP(F076-1)이고 작성자425+2skip과 다릅니다. lint/type/build는 PASS이며 시험의 줄바꿈 허용 수정 후 green 재확인이 필요합니다. 이 문구는 복사용 초안이며 실제 작업 완료 통지는 Orca worker_done 수신 확인과 구분합니다.