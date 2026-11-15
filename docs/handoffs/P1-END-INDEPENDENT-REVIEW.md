# P1 종료 독립 검수 · T-001 / T-004

2026-11-16 · 구현에 참여하지 않은 새 Codex 검수자. **제품 판정: 불통과, 열린 필수 수정 2건(F-016-1, F-016-2).** 검수 보고와 캡처 산출은 완료했다. 기존 구현자의 자체 검수 보고를 실행 증거로 대신하지 않았다.

## 기준·격리·변경 범위

- 대상/시작 HEAD: `dee2d0b1b2d78c565f28317542befbf9493db5da`. 시작 `git status --short` 출력 없음.
- 작업 위치: Orca child worktree `C:/Users/Administrator/orca/workspaces/dream-ai-studio/p1-independent-review`.
- 기준: PLAN v2.4, DESIGN v1.4, P1-END-REVIEW 전체, CLAUDE, PROGRESS/REVIEW/QUESTIONS, TEAM T-001/T-004, P1-1~P1-9 인계. QUESTIONS는 Q-001~004 모두 플래너 답변 있음. Q-001 개발 감사 7건과 Q-002 접근성 린트 대체 검증 추적은 유지.
- 추적 파일 변경은 `docs/REVIEW.md`와 본 문서뿐. 코드·플래너 기준·TEAM·PROGRESS 수정, 커밋/푸시/배포/P2 구현 없음.
- 새 DB migrate/seed 후 UI로 새 프로젝트 생성. 과거 DB 복사 없음. worktree의 data/storage/backups와 OS 임시 fixture만 사용했다. source의 실제 data/storage/backups는 읽거나 변경하지 않았다.
- `MOCK_MODE=true`, 서버는 `127.0.0.1:3026`, 복원본 확인 서버는 `127.0.0.1:3027`. 실제 키·개인정보·생성 비용·외부 생성 서비스 사용 없음.
- source에서 허용된 `.tools/ffmpeg/ffmpeg.exe`, `ffprobe.exe`만 실행파일로 사용하고 환경 `FFMPEG_PATH`, `FFPROBE_PATH`로 지정했다. 캡처 11개만 허가된 source `tmp/p1-review`에 복사했다.

## 실행 명령과 기본 검사

```powershell
npm.cmd ci
$env:MOCK_MODE='true'
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd audit
$env:FFMPEG_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe'
$env:FFPROBE_PATH='D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe'
npm.cmd test
npm.cmd run start -- --port 3026
npm.cmd run worker
# 복원본 서버: DREAM_DATA_ROOT=<이번 검수의 OS 임시 복원 폴더>, port 3027
ego-browser skill
ego-browser nodejs -e "await import('file:///.../tmp/p1-review/round01.mjs')"
```

| 검사 | 독립 실행 결과 | 증거(worktree의 tmp/p1-review 아래) |
|---|---|---|
| ci | 종료 0, 265개 설치 | 실행 출력 |
| migrate / seed | 종료 0 / 0, 새 마이그레이션 4개·시드 1개 | 실행 출력 |
| build | 종료 0, 경고 없음, 사적자료·비밀 추적 0 | build.log |
| lint / typecheck | 각각 종료 0, 경고·오류 0 | lint.log, typecheck.log |
| test, 미디어 경로 지정 전 | 종료 0, 23파일·190통과/1건너뜀 | test.log |
| test, 미디어 경로 지정 후 | 종료 0, **23파일·191통과·건너뜀 0** | test-media.log |
| audit --omit=dev | 종료 0, 취약점 0 | audit-prod.log |
| audit 전체 | 종료 1, moderate 7·high 0·critical 0, Q-001 범위 | audit-full.log |

## 직접 수행한 흐름

가상 상품 `독립검수 가상 민트컵`, 프로젝트 ID `01a1dff9-056d-7582-8e3f-03b4339bfdaa`, 9:16·30초·isAd=true.

1. 빈 등록 폼 제출 → 필수 오류 7개·첫 오류 title 포커스. 가상 값·광고 체크·자료 연결 후 실제 UI 등록. 자료가 먼저 필요하므로 보관함 업로드 후 등록을 마쳤다.
2. 직접 만든 PNG 1080×1920 2장 업로드. 텍스트 내용의 fake.jpg는 “지원하지 않는 형식이에요”로 거절. 권리 메모는 가상·직접 생성임을 명시.
3. 입력 요약 확인란 선택 → 요구 확인 완료.
4. 직접 대본/5개 장면 설명·대사를 작성 → 새 기획 저장 → v1 승인. 확인하지 않은 효능을 자동으로 채우지 않음.
5. 결과 없는 장면 5개 생성 → 각 첫 결과 v1 자동 선택·샘플 표시·이미지 표시 확인 → 장면 확인 완료.
6. 광고 표기는 잠김/삭제 불가, 자막 1개 추가. 0.125→0.125초는 오류·저장 비활성, 0.125→2.5초는 SRT 표시와 저장 성공 → 수정 확인 완료.
7. 보류 선택 시 사유 입력 요구, 빈 사유 저장 차단. 사유 저장 후 보류 1개 표시 → 전체 13개 통과 → 사용자 검수 승인.
8. r8 편집용 묶음 생성 → 실제 브라우저 download 이벤트로 bundle.zip 저장 → 새 unpacked 폴더에 실제 압축 해제. 이후 재검수/내보내기 r13은 키보드 Enter로 실행하고 bundle-keyboard.zip도 실제 다운로드했다.

추가로 가상 MP3/MP4를 UI 업로드하고 브라우저 audio/video 각각 duration=1, paused=false로 실제 재생했다(round33.log). 기존 191개 테스트의 결과만으로 이 흐름을 통과 처리하지 않았다.

## V1~V13 직접 실행 판정

| ID | 판정 | 실행·실제 결과·증거 |
|---|---|---|
| V1 | 통과 | 미승인 시드 프로젝트 production/missing 직접 POST → 409 “기획을 승인해 주세요.”, jobs 16→16. v1-evidence.json. 새 UI 프로젝트에서도 승인 전 동일 409(round08.log). |
| V2 | 통과 | 승인 v1을 수정해 v2 draft·r12 생성, draft 상태 생성 POST 409, v1 전체 행 불변=true. v2 재승인 200. api-evidence.json V2. |
| V3 | 통과 | 장면3만 v2 생성·선택 후 v1 재선택. 다른 4개 선택 포인터·기존 결과 해시 불변=true. 파일 삭제 없음. api-evidence.json V3. |
| V4 | 통과 | 같은 revision/expectedVersionId로 병렬 선택 POST → 200 하나/409 하나, “다른 변경이 먼저 저장됐어요” 안내. api-evidence.json V4. |
| V5 | 통과 | 같은 장면/지연 시나리오 병렬 생성 → 두 응답 동일 jobId, 두 번째 duplicate=true, 해당 jobs 행 1개. api-evidence.json V5. |
| V6 | 통과 | delay:10s 실행·provider_job_id 저장 확인 → **자신의 실제 worker PID 47132 강제 종료** → 새 worker 시작 → 실제 60초 lease 만료 후 성공(시도1→2). DB 시각 강제 변경 없음. provider ID 동일, job.recover pollOnly=true. v6-before.json, v6-after.json. |
| V7 | 통과 | cancel-late 제출·제공자 ID 확인 후 cancel PATCH200. 늦은 결과 succeeded/새 버전·파일 저장, 선택 포인터 전후 동일. /jobs에 “취소 후 도착 · 버전으로 보관했으며 자동 선택하지 않았어요.” 실제 표시. api-evidence.json V7, round29.log/round37.log. |
| V8 | 통과(격리 장애 fixture) | worktree 장면 assets 폴더를 임시 이름으로 옮겨 보존하고 같은 위치에 일반 파일을 둬 쓰기 실패 재현(ACL 변경 없음). STORAGE_FAILED·queued/재시도 상태와 /jobs의 한글 원인 확인. 복구 후 자동 재시도 성공, provider ID 동일·generations 1개. v8-failed.json, v8-evidence.json, round37.log. 원래 assets 폴더 복구 완료. |
| V9 | 통과 | 검수 승인 r12에서 자막 하나 수정 → r13, review locked·approved_revision null, export POST409. 기존 ZIP 전체 행/파일 SHA·manifest와 이전 글자 스냅샷 불변=true. v9-evidence.json. |
| V10 | 통과(디스크는 주입 fixture) | 선택 결과를 격리 위치에 임시 보관해 API404 “파일을 찾을 수 없어요”, 즉시 원위치 복구. ../.env.local 형태 요청404 거절. 별도 Node 프로세스의 fs/promises.statfs만 0으로 주입해 receiveUpload 실제 서비스 실행 → DISK_FULL/507/한글 오류. v9-evidence.json, disk-evidence.log, disk-fixture.mjs. 실제 디스크 고갈·사용자 권한 변경 없음. |
| V11 | 통과 | 실제 ZIP을 새 unpacked 폴더에 풀어 manifest **15/15 파일 해시·크기 일치**, 장면 PNG5개1080×1920, 샘플 장면5개 모두 _SAMPLE, isMock=true, .env·키·PC절대경로 검색0. zip-evidence.json. |
| V12 | 통과(아래 한계 명시) | 실제 수동 백업 성공 → OS 임시 새 위치 inspect200/finish200 → 복원본3027 UI 열기. 프로젝트2/자료11/기획2/장면5/생성10/내보내기1, 모든 자료 파일/hash 정상·integrity ok·FK0·pending0·백업경로 분리. source 업무8테이블 내용 hash 및 11개 자료 파일 hash 전후 동일. 새 목적지에 sentinel을 넣은 실패400에서 source·sentinel 보존·부분 data 없음, 같은 ticket409 후 **재검사·새 ticket으로 복원200**. restore-evidence.json, round30.log. |
| V13 | 부분검증 / 전체 통과 미판정 | 주요14화면×1280/390=28회, scrollWidth≤clientWidth·h1 하나. PC는 Windows 세로 스크롤바 때문에 innerWidth1280/scrollWidth1265인 화면이 있음(가로 넘침 아님). 모바일390/390. 빈 제출 오류·title 포커스, edit→review13개 통과→승인→export 생성→다운로드를 실제 키보드 Enter로 수행. PC/모바일 ConfirmPanel 취소 초기포커스·앞뒤 Tab 순환·Esc·연 버튼 복귀, 모바일 서랍 열기·닫기 확인. layout-evidence.json, round29/31/33/36/37.log. 단, 28회 점검 당시 review는 V9로 잠긴 상태였고, 실제 작성 가능한 검수표의390px 재점검과 등록→끝까지 단일 연속 키보드 흐름은 미검증. |

V12 원본 보존은 사용자 콘텐츠/자료/완료 결과를 뜻한다. source DB에는 검사 ticket·복원 활동 로그 등 정상 관리 기록이 추가되므로 DB 파일 전체 바이트 SHA 동일을 주장하지 않는다. 동일 내용을 8개 업무 테이블 해시와 파일 해시로 대조했다. 복원본은 백업 시점 자료이며 이후 새로 만든 파일까지 포함됐다고 주장하지 않는다.

## R1~R10

| 원칙 | 판정·직접 근거 |
|---|---|
| R1 원본 불변 | 통과. V2 승인 기획 행·V3 기존 결과 파일·V9 기존 ZIP/스냅샷·V12 원본 자료 해시 유지. |
| R2 되돌리기 | 통과. V3 새 파일 삭제 없이 이전 selected_version_id로 재선택, 버전 유지. |
| R3 부분 수정 | 통과. 장면3만 재생성, 다른 4개 선택 불변. 글자 수정 시 기존 생성 결과 유지. |
| R4 샷별 결과 | 통과(P1 범위). 5개 장면이 각 별도 버전·파일로 저장/선택. 실제 P2 합성은 범위 밖. |
| R5 실패·샘플 구분 | 핵심 동작 통과, 표시 결함 F-016-1. CONTENT_REJECTED는 failed·시도1, 선택 불가. 샘플은 썸네일/파일명/ZIP에 표시. 실패 버전에 대기 문구와 사유 누락은 필수 수정. |
| R6 서버 승인 게이트 | 통과. V1/V2 생성 거절, 검수 전 export409, V9 수정 후 export409. |
| R7 공통 화면 | 통과. 메뉴16개 같은 동적 route200·공통 프로젝트 흐름, 분야별 복제 route 없음. route-evidence.json 및 app 구조 확인. |
| R8 미확인 사실 | 통과(가상 샘플). 사실·권리 직접 입력/확인, 기획의 자동 효능 생성 없음. 실제 상품 진실성 검증은 범위 밖. |
| R9 기록 | 통과. generations/provider ID/모델/입력/시간/샘플0원 기록과 선택/승인/취소/복구/백업/복원 activity_log 직접 조회. |
| R10 보호 | 통과(이번 실행). 가상 자료만, loopback 바인딩 직접 확인, 키 형태 git grep0·ZIP 검색0·캡처11장 육안 개인정보/키/절대경로0. 명시적인 백업 위치 설정과 검수 보고 경로는 구분. |

## 디자인 대조와 열린 필수 수정

공통 부품·토큰 import·로컬 Pretendard/OFL·상태 매핑·샘플 칩·잠김 이유·폼 오류/접근성 속성·ConfirmPanel을 소스와 실제 화면으로 대조했다. `rg -n '#[0-9a-fA-F]{3,8}\b' app components --glob '*.css' --glob '*.tsx'` 결과0. 16분야/2업무공간 HTTP200, 운영 /dev/ui404, /queue→/jobs를 직접 확인했다. 준비 단계 설명과 입력 없음은 기존 기준과 일치한다. 전체 P1 화면은 명확한 공통 셸로 동작하지만 아래 2건 때문에 DESIGN 전체 통과가 아니다.

### [ ] F-016-1 · 실패한 장면의 사유·다음 행동 누락 및 대기 문구 오표시 (필수)

- 기준: DESIGN D6, 5.2 실패 카드, PLAN 8.2 A-4의 사유를 장면 카드에 표시.
- 위치: `lib/services/production.ts:20` 버전 DTO에 job errorCode/errorMessage/retryable이 없음. `components/production-panel.tsx:19`는 상태 칩과 ResultPreview만 렌더링. `components/result-preview.tsx:7`은 asset=null이면 모든 상태에서 “결과를 기다리고 있어요.”.
- 재현: 승인 프로젝트의 장면1에 `fail:CONTENT_REJECTED` 생성 → jobs `01a1dffe-a2a4-73fc-8f55-cb79ef8f4652`가 failed·attempts1·error_code=CONTENT_REJECTED → /produce에서 첫 장면 버전 비교 펼침.
- 실제: v3에 빨간 “실패”와 “결과를 기다리고 있어요.”가 동시에 표시. 요청 거절 사유·재시도 불가·내용 수정 안내가 없음. /jobs에는 원인이 있지만 장면으로 가면 사라진다. 선택하지 않은 최신 실패는 기본 카드에서도 발견하기 어렵다.
- 기대: 실패를 기다리는 상태로 표현하지 않고, 해당 버전/장면에 한글 원인·다음 행동·재시도 여부를 보여 줄 것. 기존 성공 선택은 유지할 것.
- 증거: api-evidence.json.failure, round28.log/round29.log, **flow-fail.png**. 테스트 성공 여부와 별개인 실제 UI 결함.
- 재검수: 거절·저장 실패 각각 장면 화면에서 원인/행동 확인, 대기 문구 없음, 거절 자동 재시도 없음, 샘플/기존 선택 유지.

### [ ] F-016-2 · 내보내기 미리보기·완료 파일 정보 누락 (필수)

- 기준: DESIGN 6.2의 미리보기 폴더 나무·예상 크기, 완료 행 파일명·크기·해시·시각·내용 버전.
- 위치: `components/exports-panel.tsx:9`, `lib/services/exports.ts:32`. 목록 DTO는 fileCount/SHA만 제공하며 ZIP 파일명·sizeBytes가 없다. 다운로드 서비스 `lib/services/exports.ts:70`에는 실제 filename/sizeBytes/title이 존재한다.
- 재현: 정상 검수 승인 r8→편집용 묶음 생성 성공→/export1280/390 열기→실제 다운로드.
- 실제: 화면은 내용 r8/완료/샘플/날짜/“파일15개”/SHA/범용 다운로드 문구만 표시. 다운로드 파일 `editing-01a1dffd-4d6c-72aa-a031-989c58979357_SAMPLE.zip`의 이름·바이트 크기는 완료 화면에 없다. 생성 전 폴더 구조·예상 크기 미리보기도 없다. 파일 자체 다운로드/무결성은 정상.
- 증거: round25.log/round26.log/round36.log, **flow-08.png, flow-m-export.png**, zip-evidence.json.
- 기대/재검수: 이름·실제 크기·시각·해시·기준 revision과 샘플을 완료행에서 함께 확인할 수 있게 하고, 생성 전 포함 폴더·예상 크기를 표시. 1280/390 가로 넘침 없이 다운로드 헤더/실제 ZIP과 이름·크기 일치 확인.

권장: 장면/작업 화면의 모델 `sample-image-v1` 등은 일반 사용자에게 더 쉬운 이름으로 표현할 여지가 있다. 필수 수정과 혼합하지 않는다.

## 캡처 11개와 위치

모든 파일은 실제 ego-browser 원본 PNG이며 편집/합성/가림 처리하지 않았다. 11장 모두 육안 확인, 개인정보·키·절대경로 없음. 원본은 worktree `tmp/p1-review/`, 동일 바이트 복사본은 **`D:/starwork/dream-ai-studio/tmp/p1-review/`**. SHA256을 양쪽 비교해 11/11 동일 확인. `capture-inventory.json`에 해시/치수 기록.

| 파일 | 치수 | 한 줄 설명 |
|---|---|---|
| flow-01.png | 1280×960 | 가상 민트컵 등록 입력과 광고 체크(폭을 맞추어 같은 가상 값으로 등록 폼 재촬영, 추가 등록 없음). |
| flow-02.png | 1280×960 | 실제 업로드한 가상 원본 PNG2개와 권리 메모(업로드 후 목록 재촬영). |
| flow-03.png | 1280×960 | 새 프로젝트 요구 확인과 잠긴 후속 단계. |
| flow-04.png | 1280×960 | 직접 작성해 저장한 기획 v1·대본과 재승인 안내, 승인 전 화면. |
| flow-05.png | 1280×960 | 장면 생성 후 선택 v1·샘플 표시와 제작 흐름. |
| flow-06.png | 1280×960 | 정지 미리보기·안전영역과 잠긴 광고 표기, 추가 글자 설정 저장. |
| flow-07.png | 1280×960 | 13/13 검수 통과와 보류 사유 입력 기록. |
| flow-08.png | 1280×960 | r8 편집용 묶음 완료·샘플·해시·다운로드. |
| flow-m-scenes.png | 390×844 | 휴대폰 장면 카드·버전 수·샘플 표시와 생성 버튼. |
| flow-m-export.png | 390×844 | 휴대폰 r13/r8 완료 묶음·샘플·해시와 내려받기, 이전 내용 표시. |
| flow-fail.png | 1280×960 | CONTENT_REJECTED 실패 버전에 대기 문구가 함께 나오는 F-016-1 증거. |

## 한계·정리·다음 단계

- 미검증: 실제 대용량/다GB 부하, 실제 디스크 전부 고갈, 실제 사용자 ACL, 전원 차단/커널 수준 장애, 적대적 동시 Windows 부모 폴더 교체, 전체 보조기기·모든 키보드 조합 및 실브라우저 200% 확대의 전 화면 검수. 위 항목은 통과 주장하지 않는다. V8은 파일/폴더 충돌 fixture, V10 디스크는 프로세스 한정 statfs 주입임을 구분했다.
- V12 실패는 목적지 변경을 실제 재현한 검증/확정 전 실패·정리·재검사 복구다. OS rename 권한 실패/전원차단을 별도로 재현했다고 주장하지 않는다(기존 restore 테스트는 독립 실행한191건에 포함).
- ego-browser taskSpace13 종료. 임시 fixture는 증거 보존 목적으로 남기며 source 실제 사용자 데이터와 무관하다. 자신의 서버3026/3027(PID44016/16468)·재시작 worker(PID24524)를 종료했고 두 포트 리스닝 해제를 확인했다. 강제 종료했던 이전 worker도 자신의 PID였다.
- 구현 담당에게 F-016-1/2를 돌려 수정 위치·재검증 결과를 REVIEW에 회신하도록 요청한다. 이번 worker는 코드 수정 금지 범위를 지켰다. TEAM T-001/T-004 상태 취합은 coordinator에게 요청한다(본 worker는 TEAM 수정하지 않음).
- **최종 독립 검수 통과와 은영님 흐름 확인 전 P2 금지. 디자인 사용자 승인도 여전히 대기.**

## 플래너에게 그대로 전달할 메시지

T-001/T-004 새 Codex 독립 검수를 대상 dee2d0b의 격리 child worktree에서 수행했습니다. build/lint/typecheck·23파일191검사·운영감사0(전체moderate7), 새 가상 쇼핑숏츠 UI 등록부터 ZIP 다운로드·15파일 해시, 실제 워커 강제종료/동일providerID 복구, 백업/새폴더복원/원본해시 보존·실패복구를 확인했습니다. V13은 전체 연속 키보드/작성가능 검수표390px을 미검증으로 남겼습니다. 제품 판정은 불통과이며 필수 수정 F-016-1(장면 실패 사유 누락·대기 오표시), F-016-2(내보내기 미리보기·파일명/크기 누락) 2건이 열려 있습니다. 보고는 docs/REVIEW.md R-016과 docs/handoffs/P1-END-INDEPENDENT-REVIEW.md, 원본 캡처11장은 D:/starwork/dream-ai-studio/tmp/p1-review에 동일 해시로 복사했습니다. 구현 담당은 2건을 수정하고 해당 항목 재검수를 요청해 주세요. 독립 검수 통과+은영님 흐름 확인 전 P2 금지, 디자인 승인도 대기입니다.

위 문장은 복사용 초안이다. 실제 coordinator 전송은 worker_done 영수증으로 구분하고, 플래너에게 직접 전송하거나 수신 확인했다고 주장하지 않는다.
