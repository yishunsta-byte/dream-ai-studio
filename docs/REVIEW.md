# 검수 기록

## T059 제한된 동기 코드 이관 계약 독립 PASS (2026-11-16)

원CRLF독립379통과/생성1skip·lint/typecheck/build와실제T054재현·추가25mode/원SQL·s4보존을Master가원문검토해수용했다. T048~T058반환경계·동기제한수정통합완료, 현재SQL K6(T047)와코드계약준비게이트충족. P1사용자두승인도완료다. hostDBnativeasync금지의검토전제/단계별다른clock동등시험한계유지. 실제제품0005source등록/동봉·cwd·CLI/productionNext·오류UI·고정s5는이후P2-1제품통합검증조건이며이번에제품코드를구현했다고주장하지않는다. T060설계검토후구현배정. 상세 handoffs/T-059-SYNC-CODE-MIGRATION-REVIEW.md.

## R-024 · T054 반환 경계 재검수 — 잔여 FAIL (2026-11-16)

독립관련95통과·T052late/deadline재현으로F0521/2범위PASS. nativePromise immediate/queued rejection이거부·rollback후Node프로세스를status1로종료하는F0541실제재현, T055최소수정배정. 상세 handoffs/T-054-CODE-MIGRATION-RETURN-RECHECK.md. 기존SQL K6/P1승인유지, v2수용/제품0005보류.

## R-023 · T052 코드 이관 v2 — FAIL (2026-11-16)

독립원CRLF333통과/생성1skip·lint/typecheck/build, F050수정/entry해시·제한loader는범위PASS. 반환값thenable의host경로microtask가Arollback후B실행때A쓰기와getter/then timeout누락을실제재현(F0521/2)해v2수용FAIL. T053반환경계최소수정배정. 상세 handoffs/T-052-CODE-MIGRATION-V2-REVIEW.md. 기존SQL K6/P1승인유지·0005진입보류. 검수잘못생성fake경로삭제는자동승인policy거부로보존,우회없음.

## R-022 · T050 코드 이관 해시 계약 — FAIL (2026-11-16)

원문/run분리·일반runtimeimport의존누락·암묵SQL현재시각을실제재현해새계약수용FAIL. 기존SQL4호환/fixture변환rollback·snapshot·복원은scopedPASS유지. 독립전체320+1skip은fixtureLF정규화복사본조건부결과며원CRLFcheckout은시험입력1건실패, lint/typecheck/build통과. F0501~4를T051에배정했다. 상세 handoffs/T-050-CODE-MIGRATION-INDEPENDENT-REVIEW.md. 제품0005추가전계약수정·독립재검수필수, P1승인/SQL K6PASS는변경없다.

## T047 현재 SQL K6 독립 PASS·잔여 계약 착수 (2026-11-16)

T047이 b586d66 제품동일기준에서독립98관련검사·실제CLI/1280·390시작안내·원본/fixture보존을확인해F0451/2를닫았다. T045독립전체305/생성1skip·lint/typecheck/build및기존F039/F043통과증거와합쳐현재SQL K6범위PASS를Master가채택했다. T047전체307/production빌드/복원UI를재실행했다고주장하지않는다. 상세 handoffs/T-047-K6-FOCUSED-RECHECK.md. 코드데이터이관소스/hash계약은별도T048구현·검수전미완료,제품0005/타임라인은그뒤배정. 기존P1사용자두승인완료상태유지.

## R-021 · T045 K6 DB 보호 재검수 — scoped FAIL (2026-11-16)

독립305통과/생성1skip·lint/typecheck/build와기존F043/F039실행범위PASS. 잔여F0451 최초없는경로에검사후unknownDB생성시거부전WAL변경/F0452 digest없는legacy사본의동일schema/journal·상이업무데이터확인표현 실제재현. T046최소수정배정, legacy확인근거없으면unconfirmed로결정. 상세 handoffs/T-045-K6-INDEPENDENT-RECHECK.md. 수정후독립재검수전K6수용/0005보류, 미래code이관hash계약미구현조건유지.

## R-020 · T043 K6 수정 독립 재검수 — FAIL (2026-11-16)

독립29파일280통과/생성1skip·lint/typecheck/build, 복원실패후재검사·포커스·저장값해제(F0391)와V_RUN검증(F0394)은실행범위내PASS. 추가F0431 비정규빈journal무사본초기화/F0432 시작점검·거부CLI의rawDELETE→WAL원본bytes변경/F0433 손상머리글사본을확인된사본안내를실제재현해K6수용FAIL. T044수정배정, 수정후독립재검수전0005진입금지. 상세 handoffs/T-043-K6-INDEPENDENT-RECHECK.md, 기존P1완료/승인과별도새변경검수. 현재미검증한계는보고유지.

## R-019 · T039 K6/s4 독립 검수 — FAIL (2026-11-16)

구현 ebd0dff의 독립 검수에서 28파일258통과/생성1skip·lint/typecheck/build, 실제제품s3→s4 및1280/390키보드복원은 통과했다. 수용은 F039-1 terminal실패후재검사UI막힘과 F039-2 nonemptyDB의누락/빈journal 무사본초기화 때문에 FAIL. F1은T041진행, F2와시작안내/V_RUN검증보완은T042순차배정. 수정후독립재검수전K6완료/0005진입금지. 이는 기존P1독립PASS/사용자승인과 별도인 새K6변경검수다. 상세 직접실행범위·한계·증거는 handoffs/T-039-K6-INDEPENDENT-REVIEW.md. 임시fake root삭제자동승인policy거부로자료보존, 자체서버/브라우저종료확인.

## P1 사용자 승인·종료 및 다음 준비 착수 (2026-11-16)

2026-11-16 사용자 승인 전달 msg_4b845849ef02: Claude design 대화창에서 P1 흐름 확인·디자인 시안에 대해 사용자가 직접 “둘 다 승인”이라고 답한 기록을 수신했다. R018 독립 PASS와 함께 P1 종료 조건 충족. 승인 범위는 해당 P1 흐름/시안이며 비용·외부공개·실사용 DB 변경의 포괄 승인이 아니다.

T035 K6/s4 구현을 데이터 담당에게 임시 코딩 위임했고 실제 수락을 받았다. 타임라인0005 전 준비 검증을 우선한다. 과거 아래의 승인 대기 표현은 당시 이력이다. 새 제품 검증은 아직 실행 전이며 기존 P1 검증 범위를 확대해 주장하지 않는다.

## R-018 · T-029 F0171 집중 독립 재검수 (2026-11-16, 구현 미참여 Codex)

**PASS. F-017-1 닫힘 및 F-016-1 마지막 잔여 해소. R016의 기타 증거와 R017의 F0162/V13잔여/데이터 독립 통과, 이번 집중 통과를 합친 P1 최종 독립 PASS로 판정한다. 은영님 흐름 확인·디자인 시안 승인은 미완료이므로 P2 진입 금지 유지.**

- 시작/실제 대상 `a86f8f4c6967718969490e1444110a0ed4d835b3`, 시작 clean. `b9c926c7b5241d56df7ecc26eb0346610f0d08df` ancestor 종료0. 새 child에서 자기 가상 fixture/loopback3046/새TaskSpace23만 사용. 제품 수정·커밋·푸시 없음.
- 직접 실행: `npm.cmd ci` 종료0, `npm.cmd test -- tests/production-panel-render.test.ts` **1파일2검사 통과**, lint/typecheck/build 각각 종료0, lint 경고0·사적자료 추적 없음. 전체223검사는 Master의 별도 실행이며 이번에 반복하지 않았다. 작성자의 과거코드2실패는 T028 보고 이력이고 본인은 수정후2성공을 실행했다.
- 실제 서비스/UI로 v1성공선택→v2 CONTENT_REJECTED→v3성공 재현. 최근v2일 때 기본/비교 양쪽 링크2개, 후속v3 뒤 거절안내는 비교에만1개·링크2개. 거절retry/실패버전되돌리기 없음, 실제서비스retry 거절. v1선택/기존파일SHA/다른장면 전체 불변 확인.
- 1280×960/390×844 각각 비교 summary 초기 focus→Enter→실제Tab으로 “기획 고치기”/“자료 바꾸기” 도달→Enter 이동 **총4회**. 정확한 `/projects/01a1e24d-80ff-7523-bdc0-e047a627ce44/plan` 및 `/library`, 주요 콘텐츠와HTTP200 확인. 링크 도달을 DOM click/focus로 대체하지 않음. 펼친상자/문서 가로넘침없음, 링크접근이름/줄맞춤/잘림없음 확인. SSR만으로 브라우저를 대체하지 않음.
- 새 `flow-fail-v3.png`, `flow-m-scenes-v3.png`만 자기tmp/source tmp/p1-review에 복사, SHA2/2동일·기존18PNG SHA불변·개인정보/키/절대경로없음 직접열람. 서버/TaskSpace종료 및3046해제 확인, 상시worker미실행. 사용자확인HTML/TEAM/PROGRESS 변경없음.

세부 명령·로그·캡처 SHA·도구시도·보존증거·복사용 전달문: [T029 집중 검수 인계](handoffs/T-029-INDEPENDENT-FOCUSED-RECHECK.md). R017의221검사·F0162·V13연속키보드/390작성가능검수표·백업 직접 통과는 **기존 이력**으로 유지하며 이번 전부 재실행으로 과장하지 않는다. 신규 필수수정 없음, T026 m1~m4 비차단권장 유지. 실대용량/디스크고갈/실사용자ACL/전원차단/적대적Windows경합/모든보조기기·전면200%확대/네트워크볼륨성능 미검증 한계 유지.

**Claude design/플래너 전달 복사문:** clean a86f8f4(b9c926c 포함)에서 T029 직접 렌더2건·lint/typecheck/build와 실제1280/390 비교링크 Tab/Enter·정확URL/200·선택/해시/다른장면보존을 통과했습니다. F0171/F0161잔여를 닫고 기존R016/R017 통과증거와 합쳐 P1 최종 독립PASS로 판정합니다. R018/T029인계와 새-v3캡처두장을 확인하고 은영님흐름/디자인승인을 이어주세요. 이번전체223/백업/ZIP/V13재실행을 뜻하지 않으며 승인전P2금지입니다.



## R-017 · T-027 P1 종료 독립 재검수 (2026-11-16, CX-REVIEW-02)

구현 미참여 새 Codex의 직접 실행이며 자체 검수 아님. 시작/검수 HEAD `2fa66b25853d76c25d9c1d4a4a7373994b752ecc`, 시작 clean. 코드8808928·데이터75c023c·UI bc895cf ancestor 각각 종료0. Orca 격리 child에서 가상 데이터/자기 loopback3036·3037/새TaskSpace22만 사용. Master `5d7907f`는 참고이며 아래 실행을 대체하지 않음.

**보고 작업 완료 / 제품 최종 독립 FAIL. F0162와 V13잔여 closed 가능, 데이터 추가 검증 통과. F0161은 실패 버전비교의 기획·자료 링크 누락(F0171) 때문에 완전 closed 불가.** [전체 실행·증거·한계·캡처·복사문](handoffs/T-027-INDEPENDENT-RECHECK.md).

| 항목 | 이번 직접 결과 |
|---|---|
| ci / 새 migrate·seed | 종료0 / 0·0, 설치265·migration4·가상시드1 |
| build/lint/typecheck | 각각 종료0, 사적자료 추적 없음·lint 경고0 |
| test | 첫 실행은 검수자 DREAM_DATA_ROOT가 임시cwd fixture와 충돌하여64실패/157통과. 해당 환경변수 제거 후 **25파일221통과·skip0**, ffmpeg/ffprobe 실제 지정. 두 로그 모두 보존 |
| audit | 운영 종료0/취약점0, 전체 종료1/moderate7(기존Q001 유지) |
| F0161 | UI 실제CONTENT_REJECTED: 기존성공 선택/파일SHA/다른장면 보존, 기본원인/행동/링크·실패선택/retry불가·대기오표시없음. 실제자기폴더충돌 STORAGE_FAILED→자동대기→시도3소진→UI저장재시도→동일providerID/generation1 성공. 백오프는 now/sleep 가속fixture임을 구분. queued/running/canceled/없음 직접확인, 실패toast1회 |
| F0162 | 생성전폴더/파일수/예상약크기/샘플/자막유무, 실제새ZIP14/15파일 다운로드·완료이름/actualbytes/시각/revision/SHA 대조. chunked로Content-Length없음 기록, 수신bytes/DTOsize/본문SHA·manifest14/14와15/15 hash/size일치, 완료기록불변/수정후export409/실패행·복사·양폭확인 |
| V13잔여 | 등록→ZIP다운로드 단일연속키보드(r09~15; DOMclick/API완결없음), 별도한round390×844에서작성가능검수표/빈사유차단/사유저장/13통과/승인실행(r26). 초기round간viewport미유지문제는분리정정.1280/390확인창취소초점·앞뒤Tab순환·Esc·연버튼복귀확인 |
| T021/22 | 새B1/B2→복원→inherited/local·새local만lastSuccess, marker없는가상행unconfirmed·집계제외. 파일없음경고/disabled/404한글, 기존ZIP재복원hash검증·sourceDB/ZIP/자료목록불변, 원래격리data/storage내목적지거절. 하단목록/옵션실제확인·캡처 |

### [ ] F-017-1 · 실패 버전비교의 행동 링크 누락 (F0161 잔여, 필수)

- 위치 `components/production-panel.tsx:18`의 `!compact && copy.links.length>0`. 버전비교는 compact=true여서 링크를 숨김.
- 재현: 성공선택이있는장면에서CONTENT_REJECTED 실제요청→버전비교펼침. 한글원인/다음행동·실패자리표시는정상이나기획고치기/자료바꾸기링크가없음. r32.log 직접DOM측정 기본section링크2/비교section링크0, flow-fail-v2.png.
- 기대: T027 명시조건 “기본카드/버전비교에 … 기획·자료링크”를 둘다충족. 오래된실패가비교에만남아도해당행동에키보드로접근가능해야함. compact시각크기만으로행동을제거하지말것.
- F0161 원래원인/대기문구/저장재시도문제는수정확인했지만이잔여때문에완전닫지않음. T026 m1좁은상자/m2코드순서/m3날짜/m4예시이름은기존비차단권장유지. 검수자는코드를수정하지않음.

R1~R10은인계의변경영향표에실제근거/회귀테스트/이번수동미재실행을구분했다. 전체V1~V12수동재검증을새로전부통과했다고주장하지않는다. 실다GB·실디스크고갈·실사용자ACL·전원차단·적대적Windows경합·모든보조기기/전면200%확대·네트워크볼륨성능은미검증유지.

새-v2캡처7개만자기tmp/p1-review와허가된source `D:/starwork/dream-ai-studio/tmp/p1-review/`에SHA동일복사, 기존11개불변. 각설명/viewport/실제치수/개인정보확인/SHA는인계표참조. source실제userdata미접근. TaskSpace22·자기worker/서버종료,격리폴더/백업보존이름원위치복구. 코드/TEAM/PROGRESS/사용자확인페이지수정·커밋·푸시·P2진입없음.

**다음: 코드담당F0171수정→해당비교영역키보드링크·선택보존재검수→최종독립통과. 그후에도은영님흐름/디자인승인대기,자동승인/P2진입금지.**

**Claude design/플래너 전달 복사문:** T-027 독립 재검수를 clean 2fa66b2에서 완료했습니다. build/lint/typecheck·221검사(skip0)·운영감사0, 실제키보드등록~ZIP다운로드·390작성가능검수표·저장실패복구/동일providerID/generation1·백업출처/원본보호·ZIP14/14와15/15 hash를 확인했습니다. F0162와V13잔여는닫을수있지만 실패버전비교에서기획/자료링크를숨기는F0171(F0161잔여)을필수로남겨제품최종독립판정은FAIL입니다. 보고는R017/T-027-INDEPENDENT-RECHECK.md,새-v2캡처7개는source tmp/p1-review에SHA동일복사했습니다. 코드담당은production-panel.tsx:18을수정하고오래된실패의키보드링크·선택보존재검수를요청해주세요. 최종독립통과후에도은영님흐름/디자인승인전P2금지입니다.

위문장은복사용초안이며실제coordinator전송은worker_done영수증으로구분한다.



## R-016 · P1 종료 독립 검수 (2026-11-16, 새 Codex)

대상 커밋: `dee2d0b1b2d78c565f28317542befbf9493db5da`. 시작 git status clean 및 HEAD 일치 확인. 구현에 참여하지 않은 검수자가 Orca 격리 child worktree에서 실행했으며 **자체 검수 아님**.

**제품 판정: 불통과. 열린 필수 수정 2건(F-016-1, F-016-2). V13은 부분검증으로 전체 통과를 주장하지 않는다.** 실행 근거·V1~V13/R1~R10·설계 대조·재현 절차·캡처별 설명은 [독립 검수 인계](handoffs/P1-END-INDEPENDENT-REVIEW.md)에 기록했다.

| 검사 | 이번 검수자의 실제 결과 |
|---|---|
| npm.cmd ci / db:migrate / db:seed | 각각 종료0, 새 DB 마이그레이션4개/가상 시드1개 |
| build / lint / typecheck | 모두 종료0, build 경고0·사적자료 추적0 |
| test | 최초190통과/1건너뜀 → FFmpeg/FFprobe 환경 지정 후 **23파일191통과/건너뜀0** |
| audit --omit=dev / 전체 | 운영0, 전체moderate7·high0·critical0(Q-001 유지) |
| 새 UI 흐름 | 가상 민트컵 등록·PNG2개 업로드/가짜jpg거절·요구확인·기획승인·장면5개생성/선택·광고잠금/자막시간검증·13개검수/보류사유·승인·ZIP 실제다운로드 수행 |
| ZIP | 실제 새 폴더에 풀어 manifest15/15 hash/size 일치, PNG5개1080×1920·_SAMPLE·isMock, .env/키/PC절대경로0 |
| V1~V12 | 직접 API/실제worker/격리fixture로 실행, 통과(장애 주입·실패복원 범위는 인계에 제한 명시) |
| V13 | 주요14화면×2폭 가로 넘침0/h1하나, 오류포커스·PC/모바일ConfirmPanel·편집→다운로드 키보드 동작 확인. 작성가능 검수표390px 및 등록부터 단일 연속 키보드 전흐름은 미검증이므로 부분검증 |

V6는 실제 지연 생성 중 자신의 worker PID47132 강제종료·재시작 후 실제60초 lease 만료를 기다렸고, 동일 provider_job_id·pollOnly=true·시도2 성공을 확인했다(DB시각 조작 없음). V8은 worktree 폴더/파일 충돌로 STORAGE_FAILED를 만들고 /jobs 원인 문구·저장 재시도/동일providerID·generation1개를 확인했다. V10 디스크 부족은 별도 Node 프로세스에서 statfs만0으로 주입한 격리 fixture이며 실제 사용자 권한/디스크 변경이 아니다.

V12는 새로 만든 실제 백업을 OS임시 새 폴더에 복원하고3027서버에서 열었다. 프로젝트2/자료11/기획2/생성10/내보내기1, 자료hash정상·integrity ok/FK0/pending0·백업경로 분리. 원본8업무테이블hash·11자료파일hash 보존. 목적지에 sentinel을 넣어 실제복원거절400·source/sentinel보존·부분data없음 확인, 재검사 후 새ticket복원200. 관리ticket/활동로그는 추가되므로 원본DB전체 바이트hash동일을 주장하지 않는다.

### 열린 필수 수정

- [ ] **F-016-1 · 장면 실패 사유/다음 행동 누락·대기 문구 오표시.** `lib/services/production.ts:20`, `components/production-panel.tsx:19`, `components/result-preview.tsx:7`. fail:CONTENT_REJECTED의 실제 jobs는 failed/attempts1인데 /produce 버전비교는 빨간실패와 “결과를 기다리고 있어요.”를 함께 표시하며 원인·수정안내를 누락. DESIGN D6/5.2 및 PLAN A-4 불충족. 증거 flow-fail.png, api-evidence.json.failure, round28/29.log. 수정 후 거절/저장실패 장면 화면의 원인·다음행동·선택보존 재검수 필요.
- [ ] **F-016-2 · 내보내기 정보 누락.** `components/exports-panel.tsx:9`, `lib/services/exports.ts:32`. DESIGN6.2의 생성전 폴더나무/예상크기, 완료행 실제ZIP파일명/크기가 없다. 다운로드15파일·해시는 정상이나 화면에는 날짜/파일수/SHA/범용다운로드문구만 존재. 증거 flow-08.png, flow-m-export.png, round25/26/36.log. 수정 후1280/390에서 파일명·크기·샘플·revision과 다운로드 실제값 일치 재검수 필요.

R1~R4/R6~R10은 이번 가상실행 범위에서 위반 발견 없음. R5는 실패/샘플 핵심 상태 구분은 지켰지만 장면 실패 안내 F-016-1이 열려 있어 디자인 전체 통과가 아니다. 토큰외 색상검색0·Pretendard/OFL·16분야/2업무route200·운영/dev/ui404·queue호환 확인. 실브라우저200% 전화면/보조기기/실대용량/실디스크고갈/전원차단/동일권한 적대적 폴더교체는 미검증으로 남긴다.

T-004 원본 캡처11장은 worktree `tmp/p1-review/`와 허가된 `D:/starwork/dream-ai-studio/tmp/p1-review/`에 있다. flow-01~08 및 flow-fail은1280×960, flow-m-scenes/export는390×844. 개인정보·키·절대경로없음 육안확인, 양쪽SHA11/11동일. 각 설명은 인계표 참조. source의 실제data/storage/backups에는 접근하지 않았다.

코드/플래너기준/TEAM/PROGRESS 수정·커밋·푸시·배포·P2구현 없음. 자신의 서버3026/3027와 worker 종료·포트해제, ego-browser taskSpace13종료. 보고서 작성과 coordinator전송/플래너수신은 구분한다. TEAM T-001/T-004 취합·구현담당 수정요청은 coordinator에게 회신한다.

**다음 조건: F-016-1/2 수정 재검수와 V13 남은 범위 검증 → 최종 독립검수 통과 → 은영님 흐름확인. 그 전 P2금지, 디자인승인도 대기.**

**플래너 전달용 복사문:** T-001/T-004 독립검수를 대상 dee2d0b의 격리본에서 실행했습니다. build/lint/typecheck·23파일191검사·운영감사0, 새 가상 UI흐름/ZIP15파일해시·실제worker중단복구·새폴더복원/원본보존을 확인했습니다. 제품은 불통과이며 F-016-1 장면실패안내, F-016-2 내보내기정보누락 2건이 열려 있고 V13 전체연속키보드/검수표390px은 미검증입니다. 보고는 REVIEW R-016 및 handoffs/P1-END-INDEPENDENT-REVIEW.md, 원본캡처11장은 D:/starwork/dream-ai-studio/tmp/p1-review입니다. 수정 후 해당항목과 V13 재검수를 요청하고, 독립검수통과+은영님흐름확인 전 P2로 넘어가지 마세요. 디자인승인도 대기입니다.



## R-015 · P1-9 자체 검수 (2026-11-16)

자체 검수(독립 검수 아님). T-007~T-010 구현 협업 포함. SQLite WAL backup API·인벤토리/ZIP·DB참조·신규 staging/ticket/정규화/rename/replay, 불변 감사/백업과 REPLACE 보호, 설정·읽기기록·큐·경로 DTO·외부 빌드 추적을 대조했다. 필수수정 F-007-1~3은 회귀 검사와 함께 닫았다. build 경고0/사적추적0·lint/typecheck·191검사·운영감사0. 실제 fixture에서 자동/수동백업→검사→새폴더복원→별도서버열기, 양쪽14파일해시/13asset2plan9generation 보존·pending0/분리경로/integrity ok/FK0 확인.1280/390 설정·기록 넘침0. 현재 사용자 DB 교체/초기화 없음. 상세 handoffs/P1-9.md와 T-007~T-010. 실다GB/디스크고갈/전원차단 및 적대적 동일권한 Windows 경합 한계는 남는다. 최종 독립검수와 사용자 흐름·디자인 확인은 대기이며 P2 금지.


## R-014 · P1-8 자체 검수 (2026-11-15)

후속 필수 수정 F-014-1(닫힘): T-005 읽기 교차 확인 중 DESIGN6.6의 읽기 전용 SRT 미리보기와 시간 칸 옆 오류가 빠진 것을 발견했다. EditingPanel에 실제 수동 시간 기반 SRT와 끝≤시작의 정확한 한글 오류/aria-invalid·설명 연결·저장 차단을 추가했다. 브라우저에서0.125→0.125 거부,2.5 복원 후 `00:00:00,125 --> 00:00:02,500` 표시·변경없음·390px 넘침0 확인. tmp/p18-srt-*.png. build/lint/typecheck·기존119검사 통과. 기준 파일은 수정하지 않았다.

자체 검수(독립 검수 아님). 대상 정적 글자/검수/ZIP 서비스·화면·워커·0003. PLAN v2.4 보완·DESIGN v1.4 P1 기준. build/lint/typecheck·119테스트, 운영감사0/개발moderate7·빌드자료추적0. 필수 표기 보호·스냅샷/파일 불변·현재revision 검수·보류 사유·승인 게이트·ZIP 재열기/해시·실패/취소/오래된작업/워커복구 동시성 확인. 실제 격리 UI에서 편집→13개 검수→승인→내려받기, 새폴더압축해제15파일해시·수동SRT·샘플/사용권 확인. r13→r14 문구 수정시 생성9건/이전ZIP/manifest 불변·새내보내기409, 새검수미확인 후 재승인/별도ZIP을 재현했다.1280/390px 넘침 없음, PC7단계도 내부넘침0. 실제다GB 부하시험은 하지 않았다. 필수 수정 없음. P1-9 진행하며 독립검수는 P1-END-REVIEW 절차로 별도 담당이 수행한다. T-002 승인 조건 구현/테스트 반영. 인계 docs/handoffs/P1-8.md.

## R-013 · P1-7 자체 검수 (2026-11-15)

자체 검수(독립 검수 아님). 대상 production 선택/재확인/묶음 서비스·API·장면카드/미디어 미리보기, 보관 자료 참조 유지·셸 실패 카운트. build/lint/typecheck·102테스트 통과, 운영감사0·빌드자료추적0. 원본/다른장면 보존·복원포인터·revision/CAS·재확인·누락파일·단계무효화를 검사했다. 실제 브라우저 이미지·영상/무음 재생 및 선택/복원, 동시 HTTP200/409, 첫 장면 v4 생성 후 기존 v1/다른4개/해시 보존, 결과 없는1개만 생성·장면 확인 완료,1280/390px 넘침 없음. 필수 수정 없음. 인계 docs/handoffs/P1-7.md, P1-8 진행. 실제AI·내보내기 검수는 아직 아님.

## R-012 · P1-6 자체 검수 (2026-11-15)

자체 검수(독립 검수 아님). 대상 jobs/provider/worker와 작업 API·화면·셸 카운트·저장/시작 점검. PLAN v2.4·DESIGN v1.2. build/lint/typecheck·95테스트, 운영 감사0·빌드 자료추적0. 두DB연결에서 중복 제출/claim, 재시작 poll·lease 만료·예전 워커 쓰기 거부, 재시도/취소·늦은 결과/저장 실패를 검사했다. 실제 프로세스 PNG/MP4/WAV의 규격·해시 일치, 중단/강제lease만료 후 동일제공자ID 복구, 거절1회·일시오류30초후성공·늦은결과선택안함을 재현했다. 실제60초 대기는 수행하지 않았으며 제어된 시각 테스트와 구분해 기록했다. 브라우저 대기 취소·워커 꺼짐·카운트·1280/390px 넘침 없음. 필수 수정 없음. P1-7 진행; 실제AI/최종내보내기 통과 의미 아님. 인계 docs/handoffs/P1-6.md.

## R-011 · P1-5 자체 검수 (2026-11-15)

자체 검수(독립 검수 아님). 대상: P1-5 planning 서비스/저장소/API/화면, workflow 최신 버전 승인, 디자인 토큰 변경 후속. 기준 PLAN v2.4·DESIGN v1.2. build/lint/typecheck·80테스트 통과, 운영 데이터 추적 없음·운영 감사 0건. 승인 전 제작 차단·수정 후 재승인·원본 보존·동시 저장 충돌·잘못된 참조·트랜잭션 롤백을 검사했다. 격리 브라우저에서 요구 확인→v1 저장/승인→v2 수정/비교/승인, v1 읽기 전용과 오래된 API 409, 1280/390px 넘침 없음을 확인했다. 필수 수정 없음. 인계 docs/handoffs/P1-5.md, 연속 진행 지시에 따라 P1-6으로 이어간다. 실제 AI 생성 또는 P1 종료 검수를 의미하지 않는다.

## R-010 · P1-4 자체 검수 (2026-11-15)

판정: 자체 검수 통과, 독립 검수 아님. F1~F7과 자료·캐릭터 화면 대조. UUID 새 파일·배타 확정·DB 실패/취소 정리, 실제 형식/확장자/디코딩·해시·메타데이터 검사, realpath/junction 경계, 정적 서빙 금지·Range·첨부/nosniff, 메타데이터 전용 링크,6개 고정 설정·참조 검증, 보관/복원 및 프로젝트 연결 유지 확인.

75테스트와 build/lint/typecheck, 운영감사0 통과. AV 테스트는 설치한FFmpeg9.0.2로 실제 실행했다. 운영 브라우저에서 실제PNG/MP3/MP4 업로드·디코딩·재생, 가짜jpg 실행파일 거절, 전체 내려받기 원본 일치,206/416, 사용 중 자료 보관 후GET200·되살리기, 링크/캐릭터 저장을 확인했다.1280/390 넘침 없음. 실제2GB 부하 시험은 미수행으로 명시했다. 업로드 동적 경로의 빌드 추적 경고는 검증된 런타임 경로의 turbopackIgnore와 제외 목록으로 처리, 최종 빌드 경고0/자료 추적0건. 다음P1-5 진행.

## R-009 · P1-3 자체 검수 (2026-11-15)

판정: 자체 검수 통과, 독립 검수 아님. 메뉴별 폼과 API 양쪽의 필수/형식/범위/선택 검증, 준비 분야 차단, 자료 상태·유형 검증을 대조했다. 프로젝트 생성은 템플릿 버전·스냅샷·입력·단계·자료/캐릭터·활동 로그 트랜잭션이며 일부 실패 시 전체 롤백한다. 기존 프로젝트는 메뉴 설정 변경 뒤에도 스냅샷이 보존된다.

실제 운영 브라우저에서 오류7건/첫 오류 포커스, 성공 등록과 단계 이동·작업실 조회, 새로고침·서버 재시작 보존 확인. 직접 API400/409,1280/390 넘침 없음. build/lint/typecheck/test63건 통과, 운영감사0. UI는 이후 단계의 미구현 동작을 준비 안내로 표시한다. 실제 앱DB 대신 격리 폴더에서만 검증했다. P1-4 진행 가능.

## R-008 · P1-2 자체 검수 (2026-11-15)

판정:자체검수통과(독립검수아님). 순수도메인S1~S7과repo/service분리를 대조했다. 테스트57건으로 모든단계시작/실패/재시도,선행미승인차단,기획/검수자동승인거부,승인포인터·스냅샷·로그원자성,새draft버전할당·재승인,현재revision필수검수완전성,변경후자격무효화·완료내보내기불변,동시revision두번째변경차단과롤백을확인했다. build/lint/typecheck통과,운영감사0/개발moderate7. HTTP생성연결은P1-6에서추가검수한다. 다음P1-3진행가능.

### R-007 후속 · 파일 추적 필수 수정 완료

최초 .nft.json 검사에서는 로컬 data/app.db가11개 라우트에 포함되어 있었다. 결과 확인 이전 "없음"으로 남긴 문구를 정정했다. next.config.ts outputFileTracingExcludes 적용 후 재빌드와 전체 경로 정규화 검사에서 data/storage/backups/tmp/.env* 항목0건. build에 scripts/verify-build.mjs 자동 차단 검사를 추가했다. 외부 배포 없음. 이 수정까지 포함해 P1-1 자체 검수 통과.

## R-007 · P1-1 자체 검수 (2026-11-15)

판정: 자체 검수 통과(독립 검수 아님). 대상 PROGRESS P1-1 파일. PLAN7.1의16개 테이블·칼럼을 ORM/실DB로 대조. foreign_keys/WAL, UUIDv7·UTC 기본값, 상태·중복·JSON·정수금액·참조·소유권·불변 제약 테스트. 체크섬 mismatch 거부와 중간 적용 롤백·기존 테이블 보존, DB재연결 데이터 유지 확인.

별도 CLI프로세스에서 migrate2개→seed1개→재seed0개, 사용자 제목 수정 보존 확인. 빈DB 운영화면은 시작점검으로 차단하고 마이그레이션 후 통과.1280/390 넘침없음. build/lint/typecheck/test30건 통과, 운영감사0/개발moderate7. 후속 산출물 검사에서 DB 추적 항목을 발견해 next.config.ts의 outputFileTracingExcludes로 data/storage/backups/tmp/.env를 제외한다. 실제 재빌드 결과로 확인 후 P1-2 진행. 원격 작업·유료API·실제 개인정보 없음.

## R-006 · P0-5 자체 검수 (2026-11-15)

판정: 자체 검수 통과, 독립 검수 아님. 대상 PROGRESS P0-5 파일. DESIGN 10장 셸 목록 대조: 메뉴16+업무공간2, 그룹 순서·준비 단계·현재 위치, 샘플 모드 분기, 폴더 쓰기·디스크 점검 틀 확인. 운영23화면×2폭=46회 가로 넘침 없음/h1 하나, HTTP200. 잘못된 ID와 준비 분야 /new 및 운영 /dev/ui는404. 모바일 서랍 동작과 오류 시 시작 점검 차단을 실제 브라우저로 재현했다.

발견/처리: Turbopack 동적 파일 경로로 전체 프로젝트 추적 → 고정된 3개 저장 폴더 경로로 제한하여 빌드 경고0. 모바일 주 행동 링크 전체 폭과 하위 등록 경로의 분야 현재 위치 표시 보완. 직접 쓰기 실패 재현 시 기존 data 파일 보존 확인. build/lint/typecheck/test19건 통과, 운영 감사0/개발 moderate7. jobs/queue 경로 충돌은 상위 PLAN과 호환 이동으로 해결(Q-004).

P1-1 진행 가능. DB/워커 등 후속 기능의 통과를 의미하지 않는다.

## R-005 · P0-4 자체 검수 (2026-11-15)

대상: PROGRESS P0-4의 공통 부품·스타일·개발 갤러리·글꼴. 판정: 자체 검수 통과(독립 검수 아님). DESIGN v1.1 10장 목록 모두 구현, 상태 매핑 테스트, 토큰 외 색상 코드 0건, Pretendard 로컬 파일+OFL 포함. 실제 ego-browser에서 1280/390 및 640 CSS px 넘침 없음, 운영 /dev/ui 404 확인.

필수 수정 발견/처리: 네이티브 dialog 역방향 Tab이 body로 빠짐 → 명시적 앞뒤 포커스 순환 추가 후 통과. 작은 글자 대비 부족 → 기존 토큰으로 보완(Q-003). 취소 초기 포커스·Esc/바깥 닫기·원래 버튼 복귀, 폼 첫 오류, Toast 5초 및 수동 종료, Tabs 방향키, reduced-motion 확인. build/lint/typecheck/test 15건 통과, 운영 감사 0. jsx-a11y 미지원은 Q-002 추적.

사용자 연속 진행 지시에 따라 다음 P0-5 진행.

## R-004 · P0-3 자체 검수 및 연속 진행 (2026-11-15)

대상: `13efc42`. 사용자 최신 지시로 단계별 구현·검증·검수 기록을 현재 담당이 계속 수행한다. 별도 담당의 독립 검수가 아닌 자체 검수임을 명시한다.

판정: P0-3 통과. PLAN 6.1의 전체 구조, 오류 경로 표시, server-only 파일 읽기, 시작 점검과 루트 화면 차단, 정상값 복사본 반환을 코드 대조했다. 앞 단계에서 실행한 build/lint/typecheck 및 테스트 14건, 운영 정상·오류 서버 × 1280/390 브라우저 검증 증거를 확인했다. 프로젝트 스냅샷 저장(M-4)은 명시된 P1-3 범위로 유지한다. 현재 메뉴 원본과 기준 문서는 바꾸지 않았다. JSON.parse가 위치를 주지 않는 문법 오류의 파일명만 표시하는 제한은 인계에 기록했다.

다음: P0-4 공통 UI 구현·접근성 확인. 추가 승인 대기 없이 단계별 자체 검증을 완료하고 P0-5로 이어간다.

작성: **검수 담당(Codex)** — PLAN v2.3부터. R-000~R-002는 역할 변경 전 플래너가 작성했다. 플래너는 기준 변경 알림만 남긴다. 형식: 검수 대상 / 재현 절차 / 기대·실제 / **필수 수정** · 권장 · 확인.

---

## R-000 · PLAN v2.1 8장 검토 (2026-11-15)

대상: 구현 담당이 추가한 `PLAN.md` v2.1 8장, `HANDOFF_CODEX.md`

**결과: 채택.** 8장의 정정 사항은 모두 타당하여 PLAN v2.2 본문에 통합했다(부록 형태 폐지).

| 8장 항목 | v2.2 반영 위치 |
|---|---|
| P0~P8 로드맵, M→P 대응, 현재 범위 P0~P1, P1 내보내기는 편집용 묶음 | 2.2, 13장 E-1, 18장 |
| 제품 tokens·prototype·menus.json 부재 | menus.json 작성 완료(6장, `docs/spec/menus.json`). tokens·prototype은 P0-1에서 플래너 작성 |
| menus.json 스키마 요건, 메뉴 수 대조, 프로젝트별 템플릿 스냅샷 | 6.1 M-1~M-5, 6.2 대조표 (16+2 확정) |
| app→services→repo, Node 런타임, 워커 분리·동시 1, 127.0.0.1, 시작 점검 | 3장, 3.1, 4장 |
| 의존성 버전 확인·고정, 스크립트, 시드 비파괴 | 3장, 3.2 |
| 게이트 서버 강제, 기획 버전+장면표 스냅샷 승인 | R6, 5.2 S2·S3 |
| content_revision, 검수 무효화, 내보내기 불변, 단일 선택 기준, 동시 선택 | 5.2 S4·S5, 5.3 |
| 스키마 추가·제약·트랜잭션·UTC·정수 금액+통화·Postgres 이전 검증 | 7장, 5.2 S7, 3장 |
| 큐 트랜잭션 집기·idempotency·입력 스냅샷·재시작 복구·취소 후 결과 | 9장 |
| 제공자 구조화/미디어 구분, submit/poll/cancel, 임시→검증→확정, 저장 실패 구분 | 8.1, 8.2 A-1·A-2 |
| mock 결정적 기본, 시나리오, 무작위 실패는 수동 QA | 8.3 |
| 파일 검증·경로 차단·정적 서빙 금지·링크 메타데이터만 | 10장 F-1~F-7 |
| 내보내기 재검증·manifest 내용·스트리밍·원자 확정 | 13장 E-2~E-5 |
| 백업 일관 스냅샷·인벤토리·놓친 백업·격리 복원·롤백 | 14장 |
| 검증 증거 6항목 | 19장 V1~V13으로 확장 |
| 외부 서비스 정보 미검증, 비용 정산 상태 | 8.4 마지막 문단, 15장 B-3·B-4, `dev-plan.html` 수정 |

**확인 요청 (구현 담당)**
- `HANDOFF_CODEX.md`는 계획·검수 담당을 "user-designated Codex"로 적었다. 이 프로젝트에서 사용자가 지정한 계획·디자인·검수 담당은 **플래너(현재 Claude 세션)**이다. 다른 Codex 세션이 검수에 참여하는지는 은영님 확인 후 PLAN 표지의 역할 칸에 반영한다. 그 전까지는 PLAN.md 표지 기준을 따른다.

**다음**: 구현 담당은 P0-2(프로젝트 생성)를 시작할 수 있다. P0-4·P0-5는 P0-1 디자인 산출물 이후.

---

## R-001 · P0-2 프로젝트 기본 설정 (2026-11-15)

대상: PROGRESS P0-2 항목의 파일 전체 (git 저장소 없음 → 커밋 기준 없음)

**재현한 것 (플래너 PC에서 직접 실행)**

| 확인 | 결과 |
|---|---|
| `npm run lint` | 통과 (경고 0) |
| `npm run typecheck` | 통과 |
| `npm test` | 1파일 3테스트 통과 |
| `npm run build` | 통과, `/`·not-found 정적 생성 |
| `npm audit` | 개발 의존성 중간 등급 7건 (Q-001), 운영 0건 |
| 스크립트 | 3.2의 dev·worker·dev:all·build·start·lint·typecheck·test·db:migrate·db:seed 모두 정의. 미구현 명령은 안내 후 종료 1 — 적절 |
| 바인딩 | dev·start 모두 `--hostname 127.0.0.1` — 적절 |
| 런타임 | 루트 레이아웃 `runtime = "nodejs"` — 적절 |
| 비밀 | `.gitignore`에 `.env*`(예시 제외)·data·storage·backups·tmp 포함 — 적절 |
| 버전 고정 | 직접 의존성 정확 버전 + `save-exact` + lockfile — 적절 |
| 폴더 | PLAN 4장 구조 준비됨 |

**판정: 통과** (아래 필수 수정 1건은 P0-3 시작 전에 처리)

**필수 수정**
- [x] **F-001 git 저장소 없음.** PLAN 20.4는 마일스톤 단위 커밋을 요구한다. `git init` → 현재 상태를 `P0-2: 프로젝트 기본 설정`으로 첫 커밋. `tmp/`, `*.tsbuildinfo`가 제외되는지 `git status`로 확인 후 커밋. 원격 저장소 연결·푸시는 하지 않는다(은영님 결정 전). → R-003에서 현재 커밋과 제외 규칙 확인, 닫힘.

**권장**
- `README.md`에 PowerShell에서는 `npm.cmd`를 쓰는 이유 한 줄 유지(이미 PROGRESS에 있음 — README에도 있으면 됨).
- Next가 만든 `AGENTS.md`는 그대로 커밋해도 된다(재생성되는 파일). 내용(로컬 Next 문서 우선 참고)은 따를 것.

**확인 (답변)**
- Q-001 → QUESTIONS.md에 답변.
- `dev:all`이 워커 미구현으로 함께 종료되는 것은 P1-6 전까지 허용. P1-6 완료 기준에 `dev:all` 정상 동작을 포함한다.

**다음**: F-001 처리 후 P0-3(menus.json 로더) 진행 가능. P0-4·P0-5는 P0-1 디자인 산출물(`docs/DESIGN.md`, `docs/design/tokens.css`, `docs/design/prototype.html`) 이후 — 플래너가 지금 작성 중.

---

## R-002 · P0-1 디자인 산출물 완료 (2026-11-15, 플래너)

**만든 것**
- `docs/DESIGN.md` v1 — 원칙 D1~D8, 토큰 표, 앱 셸·반응형, 컴포넌트 명세(Button~ReviewItem), 패턴(게이트·작업 상태·실패 문장·장면 카드·샘플 표시·검수 무효화·확인 패널), 화면→경로 표, 접근성, 문구·용어표, 하지 말 것, **10장 P0-4·P0-5 완료 기준**
- `docs/design/tokens.css` v1 — 값의 유일한 출처
- `docs/design/prototype.html` — 6화면 시안(`#dashboard #menu #new #scenes #review #components`). 보라 점선 상자(`.anno`)와 위쪽 "시안" 띠는 설명용이며 제품에 옮기지 않는다. 열람: https://claude.ai/artifact/JQZB34seWCmC43HZitfztt (로컬 파일은 같은 폴더의 tokens.css를 읽음)

**플래너 확인 (ego-browser)**
- 1280·390 모두 6화면 `scrollWidth = innerWidth` (가로 스크롤 없음)
- 390 서랍: 열기 `aria-expanded=true`, 바깥 누르면 닫힘
- 확인 패널: 열면 취소 버튼 포커스, Esc로 닫히고 연 버튼으로 포커스 복귀
- 확인 중 시안 결함 3건 발견·수정: `[hidden]`이 `display:grid`에 덮여 패널이 늘 떠 있던 문제, 메뉴 닫기 버튼이 PC에서 격자 칸을 차지하던 문제, 휴대폰 버전 비교 버튼 글자 잘림. **구현 시 같은 실수 주의** — `hidden` 속성을 쓰는 요소에 display를 주면 `[hidden]{display:none}`을 함께 둔다

**구현 담당 순서**
1. F-001 첫 커밋 (작성자 정보는 은영님 답변 대기 — 플래너가 전달함)
2. P0-3 menus.json 로더 → PROGRESS 기록 → 검수
3. P0-4 공통 부품 → P0-5 앱 셸. 완료 기준은 DESIGN.md 10장. 경로를 바꾸거나 시안과 다르게 해야 하면 QUESTIONS.md

---

## 알림 · 역할 변경 (2026-11-15, 플래너)

은영님 지정: **검수·테스트는 검수 담당(Codex)**, 플래너는 플랜·디자인만. PLAN v2.3 20.1·20.3, CLAUDE.md 반영.
- 다음 검수(F-001 커밋, P0-3, P0-4·P0-5)부터 R-003 번호로 검수 담당이 작성한다.
- P0-4·P0-5 디자인 대조 기준: `docs/DESIGN.md` 10장 + 시안 https://claude.ai/artifact/JQZB34seWCmC43HZitfztt (로컬: `docs/design/prototype.html`)
- 기준·디자인이 틀렸으면 "플래너 확인 필요" + QUESTIONS.md (PLAN 20.1 7번).

---

## R-003 · F-001 첫 커밋 후속 검수 (2026-11-15, Codex)

**대상:** `220bb3d P0-2: 프로젝트 기본 설정`, `2581232 docs: F-001 첫 커밋 기록`. 작성자 정보 정정으로 이전 인계 시점의 커밋 ID가 바뀌어 현재 로그 기준으로 재확인했다. 기준 PLAN v2.3.

**판정: 통과. F-001 닫힘. 구현 담당은 P0-3 진행 가능.**

| 재현 절차 | 기대 / 실제 |
|---|---|
| `git log -3 --oneline`, 첫 커밋 파일 목록 확인 | P0-2 첫 커밋과 후속 기록 존재 / 일치 |
| `git check-ignore tmp/check.txt data/check.db storage/check.bin backups/check.zip check.tsbuildinfo .env.local` | 모두 제외 / 6개 경로 모두 일치 |
| `git ls-files -- tmp data storage backups '*.tsbuildinfo' '.env' '.env.local'` | 추적 파일 없음 / 없음 |
| `git ls-files lib/storage` | 소스 폴더는 추적 / `.gitkeep` 추적 확인 |
| `git remote -v` | 원격 미연결 / 출력 없음 |
| `npm.cmd run lint` | 오류·경고 0 / 종료 0 |
| `npm.cmd test` | 기존 기본 설정 검사 통과 / 1파일·3건 통과 |
| `npm.cmd run build` | 빌드 성공 / 종료 0, `/`·not-found 생성 |
| 빌드 후 `npm.cmd run typecheck` | Next 타입 생성·strict tsc 통과 / 종료 0 |
| `npm.cmd audit --omit=dev`, `npm.cmd audit` | Q-001 수용 범위 유지 / 운영 0, 개발 moderate 7, high·critical 0 |

필수 수정 없음. 개발 도구 감사 7건은 Q-001의 기존 추적 규칙을 유지한다. 이번 검수는 Git 후속 조치와 기본 검사에 한정하며 화면·P0-3·미구현 DB·워커 통과를 의미하지 않는다. 작업 시작 시 이미 수정 중이던 `docs/DESIGN.md`는 본 검수에서 변경하거나 승인하지 않았다.

**다음:** 구현 담당이 P0-3(menus.json 로더·zod 스키마·시작 시 검증) 하나만 구현하고 PROGRESS와 인계 문서를 작성한다. 해당 구현 검수 전 P0-4로 진행하지 않는다.

**복사용 전달 메시지:** F-001 검수를 완료했습니다. 현재 커밋 `220bb3d`, 후속 기록 `2581232`와 제외 규칙을 확인했고 build·lint·typecheck·테스트 3건을 통과했습니다. REVIEW R-003에서 F-001을 닫았습니다. 구현 담당은 PLAN v2.3 기준 P0-3 하나만 진행하고 PROGRESS와 단계별 인계 문서를 남겨 주세요. 운영 감사 0건, 개발 moderate 7건은 기존 Q-001대로 추적합니다. 이 메시지는 전달용 초안이며 별도 전송하지 않았습니다.

---

## 알림 · 디자인 v1.1 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림.
- `DESIGN.md` v1.1: 6장 화면표의 마일스톤 번호를 PLAN 18장과 맞춤(장면 P1-7, 검수·내보내기 P1-8, 등록 P1-3 — v1 표기는 틀렸음). menus.json 필드명 정정(`label`, `isAd`·`realisticAi`·`virtualHumanEndorsement`·`usesMusic`). 6.2~6.7 화면 기준 추가. 10장 P0-4에서 SceneCard·ReviewItem 제외(P1-7·P1-8), P0-5에 업무공간·시작 점검 틀 추가. 한국어 줄바꿈 `keep-all` 규칙 추가.
- `prototype.html` 16화면: 준비 단계 분야·업무공간·시작 점검(P0-5), 자료·요구 확인·기획·작업 대기열·수정·조립·내보내기·설정(P1) 추가. 열람: https://claude.ai/artifact/JQZB34seWCmC43HZitfztt
- 시안 자체 결함 수정(제품에 옮기지 말 것): 시안 띠 높이와 위 띠 고정 위치 불일치, 아이콘 회전 표시 오류, 장면 3 "만드는 중" → "대기"(동시 실행 1과 모순이었음).
- 플래너 확인: 16화면 × 1280·390 가로 넘침 0, 화면마다 h1 1개, 13px 미만 글자는 미리보기 안 글자만.

---

## 알림 · 디자인 v1.2 · 토큰 v1.1 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림. Q-002·Q-003·Q-004 답변 완료(QUESTIONS.md).
- `tokens.css` v1.1 (Q-003): `--accent` 민트 600→700(흰 글자 3.28→4.87:1), `--accent-hover` 800, `--accent-press` 900(신설), `--accent-bar` 민트 600(신설·글자 없는 곳만), `--phase-0` 남색 500. 앱이 이 파일을 직접 import하므로 **즉시 반영됨**.
- **구현 후속 1건**: 임시 `var(--accent-hover)` 사용처(`ui.module.css .primary`, `globals.css .action-link`, `studio-shell.module.css .mark`)를 `var(--accent)`로, `primitives.tsx` phase 0 특례를 `var(--phase-0)`으로 되돌릴 것.
- `DESIGN.md` v1.2: 위 토큰 역할, 작업 대기열 경로 `/jobs` 확정(Q-004).

---

## 알림 · PLAN v2.4 연속 진행 방식 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림. 은영님이 직접 지시를 확인해 PLAN 20.1과 CLAUDE.md에 반영했다. 마일스톤마다 자체 검수 기록 후 계속 진행, 작은 질문은 사후 답변, R1~R10에 걸리는 것만 멈춤. P1 종료 판정은 18장 표 그대로(검수 담당 흐름 검수 + 은영님 확인).

---

## 알림 · 디자인 v1.3 — P2 화면 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림. P2 시작 전에 미리 준비한 화면 기준이다. P1 진행에는 영향 없음.
- `DESIGN.md` 6.8 영상 편집(미리보기·글자 편집·타임라인, 휴대폰은 타임라인 숨김), 6.9 영상 만들기·내보내기(파일 확인 통과 전 성공 표시 금지), P2 부품 4종, 10장 P2 화면 완료 기준.
- 시안 `#p2-edit`, `#p2-render` 추가 (1280·390 가로 넘침 0).

---

## 알림 · P1 종료 독립 검수 안내서 (2026-11-15, 플래너)

판정 아님 — 준비 알림. `docs/handoffs/P1-END-REVIEW.md`: P1-9까지 끝나면 검수 담당(Codex)이 격리 복사본에서 수행할 독립 검수 절차(기본 검사 · 흐름 1건 · V1~V13 재현 방법과 증거 · R1~R10·디자인 대조 · 결과 형식). 통과 후 은영님 확인까지 받아야 P2 시작.

---

## 알림 · 디자인 v1.4 — P3 예산·비용 화면 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림. DESIGN 6.10 신설(금액 표시 규칙: 예상 → 예약됨 → 실제/추정/반환됨, 원화 환산 안 함, 실패 청구 그대로 표시), 부품 BudgetMeter·CostTag·CostConfirmPanel, 5.6 비용 확인 = 확인 금액(기본 $1) 이상일 때만 확인 창, 10장 P3 완료 기준. 시안 `#p3-budget`·`#p3-cost` 추가(20화면, 1280·390 확인). P3 범위라 지금 코드 작업은 없음.

---

## 알림 · P2 글자 기준 파일 (2026-11-15, 플래너)

판정 아님 — 기준 변경 알림. `docs/spec/text-presets.json`(글자 종류 8개 기본 모양·위치·움직임, 9:16 안전영역 안 자동 계산 확인), `docs/spec/fonts.json`(OFL 1.1 글꼴 8종 + 설치 시 라이선스 파일 검사 규칙). PLAN 11.3 예시 위치를 안전영역 안으로 고침, T-5·T-6. P2-3에서 사용. 지금 코드 작업 없음.

## P2-1 independent acceptance (2026-11-16)

T065 broad review found F065-1; T069 01f81f9 fixed it. T070 independently confirmed actual inspect/finish rejection, normal P1 SRT byte compatibility, r2 and stale/review/export behavior, 412 passed / 2 generation skips, lint/typecheck/build and 14 focused checks. Master accepts P2-1 within this combined scope. Historical archived membership and snapshot-external appended order are not fully authenticated; see T-070-P2-1-FOCUSED-RECHECK.md. No production deployment or actual-user-data migration is claimed.

## P2-2 independent acceptance (2026-11-16)

Combined T073 broad runtime, T076 changed error/recovery/development warning/visual checks and T078 original-CRLF425 passed/2 generation skips close F073-1 and F076-1. T072 design review and T074 refinements are integrated. Master accepts this local P2-2 scope. Actual phone/screen reader/real hidden and long font-checking delay remain unverified; no deployment, user-data migration or complete P2 claim. Next is P2-3 design preparation T079/T080.
