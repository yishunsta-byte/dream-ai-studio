# T-027 · P1 종료 독립 재검수 (CX-REVIEW-02)

2026-11-16 · parent T025/P1 종료. **보고 작업 완료 / 제품 최종 독립 FAIL.** 구현 미참여 새 Codex가 직접 실행했다. Master의 `5d7907f`는 참고 자료이며 아래 실행의 대체 증거로 쓰지 않았다. 코드 수정·커밋·푸시·P2 진입은 하지 않았다.

## 기준과 격리

- 시작/검수 HEAD `2fa66b25853d76c25d9c1d4a4a7373994b752ecc`; 시작 `git status --short` 출력 없음(clean). `git merge-base --is-ancestor 8808928 HEAD`, `75c023c HEAD`, `bc895cf HEAD` 모두 종료0. 각각 필수 수정 코드·데이터 보호·UI 통합을 포함한다.
- Orca child worktree `C:/Users/Administrator/orca/workspaces/dream-ai-studio/p1-independent-recheck`에서만 실행. AI_TEAM_RULES/AGENTS/CLAUDE, 팀 역할/배정, PLAN v2.4·DESIGN v1.4 관련 규칙, REVIEW R016, P1-END-INDEPENDENT-REVIEW, T013/T023/T025(실제 결과절 포함)/T021/T022/T026을 대조했다.
- 가상 데이터만 사용. worktree의 새 data/storage/backups 및 OS 임시 `dream-t027-HZkeEd` 복원 fixture만 사용했다. source `D:/starwork/dream-ai-studio`의 실제 사용자 data/storage/backups를 읽거나 변경하지 않았다. source에서는 허가된 ffmpeg/ffprobe 실행파일과 새 캡처 7개의 목적지만 사용했다.
- MOCK_MODE=true. 자기 서버 `127.0.0.1:3036`(PID27244), 복원본 `127.0.0.1:3037`(PID2808), 자기 worker만 실행. ego-browser 새 TaskSpace22만 사용했다. 기존 공유 공간 접근 없음. orchestration/ego-browser 스킬 적용.
- 허용 추적파일 변경은 REVIEW의 새 R017과 이 보고서뿐. PROGRESS/TEAM/사용자 확인 페이지/기존 캡처/제품 코드 변경 없음. 아래 tmp 증거는 추적되지 않는 실행 산출물이다.

## 기본 검사와 명령

```powershell
npm.cmd ci
$env:MOCK_MODE='true'
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd run lint
npm.cmd run typecheck
$env:FFMPEG_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe'
$env:FFPROBE_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe'
# 테스트는 cwd를 임시 root로 바꾸는 fixture가 있으므로 DREAM_DATA_ROOT를 제거하고 실행
Remove-Item Env:DREAM_DATA_ROOT -ErrorAction SilentlyContinue
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd audit
npm.cmd run start -- --port 3036
npm.cmd run worker
# 복원본은 이번 OS임시 copyRoot를 DREAM_DATA_ROOT로 지정하고 port3037
node --conditions=react-server --import tsx tmp/p1-review/runtime.ts <mode>
node --conditions=react-server --import tsx tmp/p1-review/backup-runtime.ts
node --conditions=react-server --import tsx tmp/p1-review/gate-runtime.ts
node --conditions=react-server --import tsx tmp/p1-review/zip-runtime.ts
node --conditions=react-server --import tsx tmp/p1-review/zip-subtitle.ts
Expand-Archive -LiteralPath tmp/p1-review/keyboard-download.zip -DestinationPath tmp/p1-review/unpacked-keyboard
Expand-Archive -LiteralPath tmp/p1-review/subtitle-download.zip -DestinationPath tmp/p1-review/unpacked-subtitle
node tmp/p1-review/hash-unpacked.cjs
ego-browser skill
ego-browser nodejs -e "await import('file:///C:/Users/Administrator/orca/workspaces/dream-ai-studio/p1-independent-recheck/tmp/p1-review/r09.mjs')"
# 동일 방식 r01~r42, helpers.mjs에 Tab 탐색/키보드 입력 드라이버
```

| 검사 | 실제 결과 / 증거(tmp/p1-review) |
|---|---|
| ci | 종료0, 265패키지 설치·266감사; ci.log |
| 새 migrate/seed | 종료0/0, 새 migration4개·샘플1개; migrate.log/seed.log |
| build | 종료0, 사적자료·비밀 설정 추적 없음; build.log |
| lint/typecheck | 각각 종료0, lint 경고0; lint.log/typecheck.log |
| 첫 test | 종료1, 25파일 중7실패·18통과 / 64실패·157통과. 검수자가 DREAM_DATA_ROOT를 worktree로 고정해 임시 cwd fixture와 충돌한 실행; test.log. 제품 결함으로 단정하지 않음 |
| 환경 정리 후 test | 종료0, **25파일221통과·skip0**, FFmpeg/ffprobe 실제 지정. 미디어 skip0; test-media-clean-env.log |
| audit --omit=dev | 종료0, 취약점0; audit-prod.log |
| audit 전체 | 종료1, moderate7·high0·critical0. 기존 Q001 범위 유지; audit-full.log |

오류 난 드라이버도 보존했다. ego 내부 Node에서 sharp 네이티브 모듈을 불러오다 연결이 끊겨 이미지 생성은 로컬 Node로 옮겼다. 숨은 일반 button 대신 정확한 텍스트로 업로드 버튼을 찾았고, 업로드 완료 전 조기 이동한 첫 시도는 성공으로 세지 않았다. chooser 재실행 뒤 실제 형식 확인/저장 완료를 확인했다. `role=dialog` 대신 실제 `dialog[open]`을 써 ConfirmPanel 대기를 수정했다. queued 작업을 running 문구로 기다린 타임아웃, 같은 값 저장을 내용 수정으로 간주한 fixture 오류도 후속 실제 변경으로 재실행했다. 실패 로그를 성공으로 바꾸지 않았다.

## V13 잔여 · 닫을 수 있음

가상 프로젝트 `01a1e234-74ed-77ec-ad31-0ac0ef6df993` / 제목 “독립 검수 가상 민트컵 긴 제목 원본 보존 확인”.

- 먼저 가상 PNG1080×1920을 UI로 올렸다. Tab으로 버튼에 도달해 Enter로 파일 선택창을 열고 문서화된 `FileChooser.setFiles`로 파일을 전달했다(이 부분은 테스트 드라이버의 파일 전달이며 OS 파일선택창 자체 키 입력 통과로 주장하지 않음). 자료 완료·권리 메모를 확인했다.
- r09~r15는 등록 폼 진입 이후 **DOM click/fill/focus/API 없이** Tab·ShiftTab·Enter·Space·텍스트 키 입력으로 단일 연속 진행했다. evaluate는 활성 요소/화면 읽기만 사용했다. 빈 제출→오류7개/첫 제목 포커스→가상 입력/광고 체크/자료 선택→등록→요구 확인→대본·5개 장면 설명/대사 작성→기획 저장·승인→결과 없는 장면5개 생성(첫 성공 v1 자동선택)→제작 확인→글자 설정 저장→작성 가능한 검수표→보류 사유 빈 값 저장 차단→사유 저장→13개 통과→검수 승인→내보내기→실제 ZIP download 이벤트/파일 저장까지 끝냈다. 첫 ZIP14파일(수동 자막 없음).
- helpers.mjs의 tabTo/tabText/tabLabel은 document.activeElement를 읽으며 Tab만 반복한다. 관찰로 대상을 찾았다는 것을 DOM 클릭으로 완결한 흐름과 혼동하지 않았다.
- **폭 기록 정정:** ego CDP viewport는 다음 CLI round에 자동 유지되지 않았다. 초기 연속 흐름의 기본 폭은1421이었으며 r11의390설정만으로 후속 round를 모바일로 간주하지 않았다. 이 한계를 발견한 뒤 r26 **한 round 안에서 390×844를 지정하고 실제 편집/검수 조작 전체를 다시 실행**했다.
- r26: 수동 자막 끝0/시작0에서 한글 오류와 저장 disabled 확인→2.5초로 수정→저장 r9→검수 이동. 잠기지 않은390검수표에서 보류 버튼→빈 사유 저장 disabled/필수13 미통과 승인 disabled→키보드 사유 입력·저장→13개 통과·승인. scrollWidth375≤innerWidth390(Windows 세로 스크롤바15px). `flow-review-editable-v2.png`는 이 실제 작성 중 화면이다. 메모 textarea와 통과/보류 버튼 사용 가능.
- ConfirmPanel은 r30에서1280×960/390×844 각각 실제 키보드로 열었다. 초기 포커스 취소→ShiftTab 확인버튼으로 순환→Tab 취소로 순환→Esc 닫기→연 보관하기 버튼으로 복귀를 확인. 보관 확정하지 않아 자료 상태는 유지.
- F0162 펼침 summary의 Space, 해시 복사와 다운로드의 Enter도 실행. 모든 보조기기/모든 키 조합/전 화면200% 확대 검증을 뜻하지 않는다.

## F-016-1 · 대부분 수정 확인, 완전 closed 불가

### 직접 실행 결과

- 선택 성공v1이 있는 장면1에서 실제 UI 시험 시나리오 CONTENT_REJECTED를 골라 새 요청. failed·시도1·retryable false·willRetryAt null. 기본 카드에 한글 원인·다음 행동·기획 고치기/자료 바꾸기 링크2개, “선택한 v1은 그대로예요.” 표시. 버전 비교에도 원인/다음 행동/실패 자리 표시가 나오고 대기 문구·재시도·되돌리기 버튼 없음. 기존 선택5개·baseline 원본 파일 SHA 모두 유지(final-preservation.json).
- `flow-05-fail-card-v2.png`, `flow-fail-v2.png`, `flow-m-scenes-v2.png`, r32.log. 1280/390 가로 넘침 없음. 기능 실패가 샘플 성공으로 바뀌지 않음.
- 저장 실패: **자기 worktree**의 해당 프로젝트 storage 폴더를 보존 이름으로 옮기고 그 자리에 일반 파일을 둬 실제 저장 실패 발생. 원래 자료는 보존했고 나중에 되돌렸다. ACL 변경/실제 디스크 고갈 아님.
- storage-wait-final.json + r24-final.log에서 STORAGE_FAILED·queued·시도1·자동 재시도 시각·취소 버튼을 실제390에서 확인. 시도 시간은 runNextJob의 now/sleep fixture로 +130초씩 진행하여 소진시켰다. 실시간 백오프 대기 검증으로 주장하지 않음.
- storage-failed-final.json + r19-final.log에서 시도3·failed·retryable true 및 접근이름 “장면 2 저장 다시 시도”. 폴더 복구 후 실제 UI 버튼 Enter→동일 job 재시도→성공. 실패/복구 providerJobId가 동일(`mock:1794796923963:6eb2…10d3`), 해당 job generations **1개**, 기존 선택·원본파일SHA 보존. 수동 retry는 attempts를1부터 다시 세는 기존 동작이다. storage-check-final.json.
- queued(장면3 대기1번째), running(장면4 실제 지연 제공자·9초), canceled(장면3 버전2 “취소했어요.”/대기문구 없음), 버전 없음(초기5장면 “아직 만들지 않았어요.”) 직접 확인. r10/r35/r36/r41. running은 별도 run-real.ts의 실제 대기이며 시간 가속 fixture와 구분한다.
- r37/r38은 UI가 queued를 본 뒤 실패하는 새 거절 요청을 관찰. DOM MutationObserver로 실패 Toast 추가 **1회** 확인, 후속 포커스 이동에서도 추가0. observer는 DOM을 읽기만 했다.

### [ ] F-017-1 · 실패 버전 비교에서 기획·자료 링크 누락 (F0161 잔여, 필수)

- 위치: `components/production-panel.tsx:18` JobNotice의 `!compact && copy.links.length>0`. 버전 비교는 compact=true를 전달하므로 링크를 항상 숨긴다.
- 재현: 위 가상 프로젝트의 /produce→첫 장면 CONTENT_REJECTED 실패→“버전 비교·선택” 펼침. r32.log는 기본 실패 section의 링크2개, 펼친 실패 section 링크0개를 직접 측정했다.
- 실제: 비교 상자의 한글 원인/다음 행동은 정상이나 “기획 고치기”·“자료 바꾸기”로 이동할 수 없다. 더 오래된 실패가 기본 카드에서 사라지면 해당 실패의 행동 링크는 비교 영역에 남지 않는다.
- 기대: 이번 T027 명시 조건인 “기본카드/버전비교에 한글원인/다음행동/기획·자료링크”를 두 영역 모두 충족. compact 시각 크기는 유지하더라도 행동 링크를 없애지 말 것. T013 3.2/3.4의 같은 실패상자 및 D6와 대조했다.
- 판정: 기존 F0161의 원인/대기문구/선택보존/저장복구는 통과했지만 **링크 조건 잔여로 F0161 완전 closed 불가**. T026 m1~m4를 차단으로 올린 것이 아니다. 코드 수정은 하지 않았다. 수정 후 오래된 거절 실패의 비교 영역을 키보드로 열어 두 링크/주소·선택보존을 재검수하면 된다.

## F-016-2 · closed 가능

- 생성 전 폴더 나무·파일수·예상 약2.4MB/추정 설명·샘플 표시 확인. 첫 묶음14파일·자막없음, 추가 수동 자막 후15파일·subtitles/manual.srt 포함. 펼친 파일 목록도1280/390에서 측정했고 가로 넘침 없음(r42:1265≤1280,375≤390).
- r8 새 ZIP 브라우저 다운로드: `editing-01a1e235-f4fe-7104-ac8a-0bac0bf57fac_SAMPLE.zip`, **2,413,544bytes**, SHA `3bc4b7720d92dee79211048a32d337af43941bfbf321d637c6055a54e3f7efea`.
- 수동 자막 포함 r10 새 ZIP 브라우저 다운로드: `editing-01a1e23c-14b8-707f-ab4d-9d0f523915d5_SAMPLE.zip`, **2,414,554bytes**, SHA `c160096569919679b836b4fd94f8a58272a6da9de7bca6e654deb2d30ad52d23`.
- 각 완료행 파일명/실제크기/만든시각/revision/샘플/SHA앞8자 확인. suggestedFilename = filename* = 실제 저장한 본문에 대응하는 DTO파일명. 디스크 증거는 고정 증거이름 keyboard-download.zip/subtitle-download.zip으로 saveAs했으므로 OS 증거 파일명 자체를 suggestedFilename과 같다고 주장하지 않는다.
- 실제 HTTP는 **Transfer-Encoding: chunked, Content-Length 없음**. 브라우저 저장 바이트·별도 실제HTTP수신bytes·DTOsizeBytes·DBSHA·본문SHA가 모두 같음. 직접 route 단위검사의 Content-Length 통과와 구분한다(zip-verification.json/zip-subtitle-verification.json).
- 두 ZIP을 각각 새 폴더에 실제 해제. 제품 verifyZip 외에도 별도 Node crypto로 manifest **14/14 및15/15 전 파일 hash/size**를 독립 대조. 텍스트 항목의 키/PC절대경로 검색0. 완료 ZIP/manifest/DB행은 목록/다운로드 조회 전후 불변(readUnchanged=true).
- 실제 내용 변경 r9→r10 후 검수 전 export HTTP409를 확인. 재검수 후, 요청된 ZIP의 장면 파일을 자기 보존 이름으로 잠시 옮겨 실제 EXPORT_INVALID 실패행 생성→원본 파일 복구. 실패행 한글 이유/다음 행동·새로 만들기·다운로드 없음,390 넘침없음. 이후 새 묶음 성공. 기존 완료 ZIP/manifest/DB행은 그대로(preserved=true). gate-export-failure.json/r28.log.
- 전체 복사는 PC 및390에서 키보드 Enter로 성공 Toast 확인(r15/r31). 실패 시 fallback은 코드와 테스트 근거이며 브라우저의 clipboard 실패 자체는 주입하지 않았다.

## T021/22 데이터 추가 판정 · 통과(명시한 fixture 범위)

- backup-runtime.ts로 새 B1 `01a1e237-e2df-768b-92e9-89f1389090e6`, B2 `01a1e237-e371-767b-a8cd-df39512e43cf` 생성/검증→B2를 새 OS임시 restored로 복원. 파일검증9개. 복원 직후 B1 inherited/available/restorable, B2 inherited/RESTORE_INTERRUPTED·선택불가, lastSuccess/lastFailure null.
- 복원본 새 백업 `01a1e237-e475-718a-a310-04297a703a88`은 local이고 lastSuccess는 이 ID만. 백업 시험 시각은 +1시간씩 now fixture 사용(시각 자체의 실시간 정렬 검증 아님).
- 기존 B1을 같은 PC에서 다른 새 폴더 again으로 재복원: ZIP내용 검증을 실제 통과. 원래 worktree DB전체SHA/기존ZIP SHA·mtime/storage 전체목록 전후동일 sourceUnchanged=true. 새 관리 활동은 복원본 DB에 남는다.
- 원래 worktree data/storage 안 목적지 모두 INVALID_INPUT 한글 거절. source 실제 사용자 폴더를 대상으로 시험하지 않았다.
- 자기 B1 ZIP을 보존 이름으로 옮겨 파일없음 재현: 기록 succeeded/검증이력 유지, available=false/restorable=false, inspect BACKUP_NOT_FOUND·404·한글. UI 목록 경고 및 옵션 disabled, 정상 local 옵션 enabled. 최종 B1 원위치 복구.
- 복원본에 marker 없는 가상 실패 기록 하나를 추가한 fixture는 unconfirmed/집계 제외. 기존 marker와 inherited 목록은 변경하지 않았다. UI 상태 새로고침 후 “출처 확인 안 됨” 및 마지막 성공/실패 제외 설명 실제 확인. legacy 전체 복원 시나리오는 독립 실행221검사의 backup-origin14검사에도 포함되며, 이 추가 화면 fixture와 구분한다.
- 설정 하단 전체 백업 목록(local/inherited/unconfirmed/파일없음)과 복원 선택영역을 실제1280/390에서 확인. 상단만 보고 판정하지 않았다. r22/r33/r34/r40 및 flow-backup-list-v2.png. 스크린샷에는 경로 입력이 화면 밖/고정헤더 위에 있어 PC 절대경로가 보이지 않음.

## R1~R10 변경 영향

| 원칙 | 이번 독립 실행의 근거/판정 |
|---|---|
| R1 원본 불변 | 기존5선택·자료SHA/완료ZIP·manifest·DB행/재복원 source 보존 통과 |
| R2 되돌리기 | 저장복구는 같은 job/providerId로 결과 새 버전 저장, 기존 버전/선택 유지. 기존 선택 되돌리기의 모든 동시성 조합은221회귀에 포함되며 브라우저 전부 재실행은 아님 |
| R3 부분수정 | 실패/저장복구를 해당 장면에만 요청. 다른4장면 선택·원본 보존 통과 |
| R4 샷별 결과 | 장면5개 각각 파일·버전·선택/묶음 경로 확인. P2 합성 범위 밖 |
| R5 실패·샘플 | 실패/대기/취소/없음 구분·저장복구·샘플명/ZIP 통과. 행동 안내 링크 잔여 F0171 때문에 F0161 전체 닫지 않음 |
| R6 승인게이트 | 기획→제작/검수→ZIP 흐름, 실제 내용수정 후 export409 확인. 기존 V1/V2 전체 수동 재실행은 생략, 회귀221통과 |
| R7 공통화면 | 변경된 공통 production/export/settings 패널과 양폭 동일 흐름 확인. 전체16분야를 다시 모두 순회하지 않음 |
| R8 확인된 사실 | 가상 민트색·자기이미지·권리만 직접 입력, 효능/후기 생성 없음. 상품 진실성 외부검증은 범위 밖 |
| R9 기록 | jobs/providerID/generations1/versions/exports/backup origin·restore 기록 직접 조회 |
| R10 보호 | 가상자료·loopback 두 포트·새TaskSpace22, ZIP 텍스트 키/절대경로 검색0, 캡처7장 육안 개인정보/키/절대경로0 |

전체 V1~V12를 새 수동 통과로 재표기하지 않았다. 본 재검수는 변경 영향·원본 보호·F0161/2·V13잔여·추가 데이터 항목이며, 기존 R016의 다른 증거는 이력으로 보존한다.

## 캡처 · 새 7개만 복사

모두 ego-browser의 실제 PNG이며 편집/합성하지 않았다. 자기 tmp/p1-review 원본과 허가된 `D:/starwork/dream-ai-studio/tmp/p1-review/` 새-v2 복사본 SHA7/7 동일. 기존11파일에 쓰기/덮어쓰기 없음. 각 화면 육안으로 가상자료만·개인정보/키/PC절대경로 없음 확인. 아래 fullPage PNG 폭은 Windows15px 세로 스크롤바를 제외한 문서 폭이며 실제 viewport는 명시한1280/390이다. `capture-inventory.json`에 실제 픽셀 치수도 기록했다.

| 파일 | viewport·설명 / 실제 PNG | SHA256 |
|---|---|---|
| flow-08-v2.png | 1280×960 viewport/fullPage · 펼친 미리보기·완료와 실패 묶음 / 1265×3135; 개인정보·키·절대경로 없음 | `b711758ae3511aeaf241c45ad0ca713e7ff0049d791253b535e1ea54df95bc11` |
| flow-m-export-v2.png | 390×844 viewport/fullPage · 긴 파일명/목록/실패행/실제크기 / 375×4068; 개인정보·키·절대경로 없음 | `ab66eed93c049cae40dc3708d511388dd350a3d1d21b46f7249ed5ca715fdf21` |
| flow-fail-v2.png | 1280×960 · CONTENT_REJECTED 기본/버전비교 / 1280×960; 개인정보·키·절대경로 없음 | `20e59a62fd5fdd6f702a3765340fb00a1459381159a1ee3b442813c4205e0eef` |
| flow-05-fail-card-v2.png | 1280×960 · 성공v1 보존·기본 실패카드 / 1280×960; 개인정보·키·절대경로 없음 | `1307c6e967f29ad30c2e1eab169ae8177ff4d3299d9d3cfd428258c148607889` |
| flow-m-scenes-v2.png | 390×844 · 실패상자·한글행동·기획/자료링크 / 390×844; 개인정보·키·절대경로 없음 | `72ea53023e4612f938ff610fdd08feae43dc37e5138fadb1f53c22e0bef3de36` |
| flow-review-editable-v2.png | 390×844 · 작성가능 검수표·textarea/통과/보류 / 390×844; 개인정보·키·절대경로 없음 | `17b78b13802d8b493f2e667cd1b624d72de8b91d9195275cb2aaaae84d0c2b59` |
| flow-backup-list-v2.png | 1280×1400 · 하단 전체목록/출처/파일없음/옵션영역 / 1280×1400; 개인정보·키·절대경로 없음 | `3c8e2ea6e52da719d4ff762bea0130941cfcce77b71f19d7e33ca13db86cccb4` |


## 한계·정리·다음 조건

- 실다GB/실디스크고갈/실사용자ACL/전원차단·커널장애/동일권한 적대적 Windows 폴더교체/네트워크볼륨 성능/모든 보조기기·200% 전 화면은 미검증 유지. 파일/폴더 충돌 및 now/sleep 가속을 실제 OS권한·전원장애 시험으로 표현하지 않는다.
- T026 m1좁은모바일 실패상자/m2jobs코드순서/m3날짜/m4이름예시는 비차단 권장으로 그대로 구분했다. F0171은 이들과 별개인 이번 명시 필수 링크 누락이다.
- Browser TaskSpace22 finish keep[] 완료. 자기 worker 종료, 자기 서버3036/3037 종료. 자기 지연 runner 완료. 모든 storage 보존폴더와 B1 보존ZIP 원위치 복구. fixture/로그/압축해제본은 증거로 남긴다. 타인 프로세스 종료·.next삭제/이동 없음.
- **F0162 closed 가능 / V13 잔여 closed 가능 / 데이터 추가 통과 / F0161 closed 불가(F0171 잔여) / 최종 제품 독립 FAIL.** 보고 작업은 완료다. Master는 코드 담당에게 F0171을 회신하고 해당 영역을 재검수해야 한다. 그 전 P1 최종통과/P2진입 불가.
- 이 문서 작성·복사용 초안과 coordinator 실제 전송은 구분한다. worker_done 성공 영수증은 보고 작업 수신이며 제품 승인/플래너 수신/은영님 승인이 아니다.

## Claude design/플래너에게 그대로 전달할 메시지

T-027 새 Codex 독립 재검수를 clean HEAD 2fa66b2(코드8808928·데이터75c023c·UI bc895cf 포함) 격리 child에서 완료했습니다. build/lint/typecheck·221검사(skip0)·운영감사0, 전체감사moderate7을 직접 실행했고, 등록부터 ZIP 실제다운로드까지 연속 키보드 흐름·390 작성가능 검수표·확인창 포커스·실제 저장실패복구/동일providerID·generation1·백업복원출처/원본보호·ZIP14/14와15/15 해시를 확인했습니다. F0162와 V13잔여는 닫을 수 있으나 실패 버전비교의 기획/자료링크가 compact 조건으로 숨겨지는 F0171(F0161잔여)을 필수로 남겨 제품 최종독립판정은 FAIL입니다. 보고는 REVIEW R017 및 T-027-INDEPENDENT-RECHECK.md이고 새-v2캡처7장은 source tmp/p1-review에 SHA동일 복사했습니다. 코드 담당은 production-panel.tsx:18의 비교영역 링크를 수정하고 오래된 실패의 키보드 링크 접근·선택보존 재검수를 요청해 주세요. 독립 최종통과 뒤에도 은영님 흐름/디자인 승인 전 자동승인·P2진입하지 마세요.