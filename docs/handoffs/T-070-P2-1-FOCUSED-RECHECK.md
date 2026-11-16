# T-070 · P2-1 집중 독립 재검수

## 판정

**집중 재검수 PASS — F065-1의 원래 재현(고정 s5 가상 사본의 r1 전체 역순)을 T069가 거부한다.** 정상 r1/P1 바이트 호환, r2 프레임 경로, stale 선택, 실제 검수·내보내기 서비스 거부, 오류 미리보기 컴포넌트도 통과했다. 아래 출처 비교 한계는 남는다. 이 판정은 모든 과거 clip 값의 완전한 진위 증명이나 P2 전체 종료 승인 선언이 아니다.

- 담당: Codex 독립 검수 작업자. T069 구현 참여 없음. 기준 HEAD `01f81f9` (T069), 시작 tracked 작업 트리 깨끗함.
- 배정: `task_67e4fee42cd1` / `ctx_72476c1e1e6d`, 회신 대상 Codex Master.
- 수정 허용/실제 수정: 이 보고서 `docs/handoffs/T-070-P2-1-FOCUSED-RECHECK.md` 하나. 제품·테스트·fixture·공용 문서 수정 및 commit/push 없음.
- 선독: AI_TEAM_RULES, AGENTS, CLAUDE, PLAN, REVIEW, TEAM, docs/team/CLAUDE_ROLES, T065 독립 검수 및 T069 인수인계. Orca orchestration skill을 적용했다. 설치된 Next 16.4.6의 output/trace 가이드도 읽었다.
- T065의 독립 407통과/2skip, 전체 build, 1280/390 브라우저, 실제 ZIP 다운로드 및 P1 전후 캡처는 지시대로 상속했다. 이번 수정 지점은 아래 새 실행으로 검증했다.

## 환경·명령·증거

증거 루트: `C:/Users/Administrator/AppData/Local/Temp/dream-t070-541f066065104d1da2af536e43d3f854` (`E`로 표기). 임시 스크립트 `E/focused.test.ts`, `E/vitest.config.mjs`는 저장소 밖에 있다. 실제 DB/ZIP은 각 시험이 새 OS-temp `dream-f065-*` 등에서 만들고 닫은 뒤 자기 경계 안에서 정리했다. root 실제 data/storage/backups 및 기존 서버 접근 없음. 서버/브라우저를 시작하지 않았으므로 종료할 자기 서버도 없다.

| 실행 | 실제 결과 | 증거 |
|---|---|---|
| `npm.cmd ci` | 의존성 없던 독립 child에 설치 성공; package/lock tracked 변경 없음 | 명령 출력 |
| `npm.cmd test` (DREAM_DATA_ROOT unset) | 35파일, 411통과/3skip: media binary 미설정으로 실제 media 1개 추가 skip | `E/all-tests.log` |
| `npm.cmd test` (DREAM_DATA_ROOT unset, 아래 media 경로만 명시) | **35파일 412통과/생성전용2skip**, 414개 | `E/all-tests-media.log` |
| `npm.cmd run lint` | exit 0, 경고 없음 | `E/lint.log` |
| `npm.cmd run typecheck` | exit 0, Next typegen 및 tsc 통과 | `E/typecheck.log` |
| `npm.cmd run build` (DREAM_DATA_ROOT unset) | exit 0, production build·로컬 데이터/비밀 trace 검사 통과 | `E/build.log` |
| `node node_modules/vitest/vitest.mjs run --reporter verbose --config E/vitest.config.mjs` (DREAM_DATA_ROOT unset) | **14통과**: T069 원래 5개를 temp로 옮겨 실제 재실행 + 독립 경계/컴포넌트/finish 9개 | `E/focused.log`, `E/focused.test.ts` |

미디어 실행은 읽기 전용 `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`를 사용했다. 각 시험 내부에서 가상 root를 환경에 지정하는 것은 테스트 설계에 따른 것이며, test/build 명령 시작 시 DREAM_DATA_ROOT는 unset했다. 렌더 증거 저장용 `T070_EVIDENCE=E`만 추가했다.

초기 실행은 node_modules 미설치로 vitest를 찾지 못했고, 독립 추가 실험 첫 회는 내가 연 readonly DB handle을 닫지 않아 temp 정리 EBUSY가 났다. 설치/handle 종료 후 재실행했고 최종 14개가 통과했다. 이 두 실행은 제품 실패 판정이나 통과 근거로 세지 않았다.

## 직접 재현 결과

1. **전체 역순 s5 및 inspect 거부: PASS.** 고정 s5를 새 temp로 풀고 r1 `video.reverse()`만 변경했다. canonical JSON·timeline_sha256을 함께 갱신했고 원래 `timeline_revisions_update_guard` SQL을 원복했다. sqlite_master의 type/name/sql이 전후 동일하고 readTimelineRow(schema/canonical/hash)는 통과함을 검사했다. DB의 새 digest/size를 manifest에 반영해 ZIP을 새로 만들고, 새 제품 5단계 가상 원본에 backup/meta 기록을 등록했다. 실제 `restoreService.inspect`가 **RESTORE_INVALID**로 거부하며 목적지 `data/app.db`는 없고 ZIP digest는 그대로였다. 이 경우 inspect에서 이미 거부하므로 ticket이 없고 finish까지 도달했다고 주장하지 않는다.
2. **finish 방어 별도 실증: PASS.** 정상 사본 ZIP으로 실제 inspect를 통과해 same 5→5 ticket을 받았다. 제품이 제공하는 `onStage('upgraded')` 시험 hook에서 자기 staging r1을 같은 hash-consistent 역순으로 바꾸고 guard를 원복했다. 실제 finish가 normalize 이후 재검증에서 **RESTORE_INVALID**, 목적지 DB 없음, 원 ZIP 불변을 확인했다. normalize가 DB digest를 다시 계산한 뒤에도 의미 비교가 막는 경로이며, 단순 옛 파일 hash 불일치만 시험한 것이 아니다. 로그 `T070_RESTORE_INSPECT` / `T070_RESTORE_REJECTION` 참조.
3. **호환 reader·검수·내보내기 거부: PASS.** 전체 역순, 클립 ID 하나만 변경, 세 번째 장면을 맨 앞으로 이동한 3종 모두 checkTimelineRows → P1SourceMismatchError, editView → STAGE_LOCKED 및 정확한 mismatch 안내였다. 실제 reviewService.approve 및 exportService.request도 같은 이유로 거부했다. export 검사에는 해당 temp DB에서만 review를 승인 상태로 맞춰 게이트 뒤 경로를 시험했다. 시험 후 원 상태로 돌려 DB snapshot 전후 동일함을 검사했다. editing.get.savedSrt는 null이다.
4. **정상 r1/P1: PASS.** checkTimelineRows 통과, editView id/value/snapshot이 P1 current와 동일. 기존 timeline 회귀의 bundleLayout 실제 text entries 및 manual.srt 문자열 동일 검사도 새 실행에서 통과했다. SRT 시작 **00:00:00,125**, 편집 화면 프레임 표시 0.133과 혼동하지 않았다.
5. **정상 r2: PASS.** 실제 save로 user r2를 만들면 내용 revision 증가, r1 불변, 후속 승인 무효화; editView와 timelineSrt가 같고 **00:00:00,133** 프레임 경로로 전환되는 기존 회귀를 새 실행에서 확인했다.
6. **선택 변경 stale: PASS.** 유효한 다른 선택 결과로 바꾸면 출처 검사는 통과하면서 stale에 해당 scene이 남고 편집 완료/검수 승인을 차단한다. 현재 선택으로 명시 저장하면 user r2가 되고 stale이 풀리며 이전 r1/settings는 보존된다. 출처 검사 때문에 정당한 stale 행 자체가 손상 데이터로 오인되지는 않았다.
7. **실제 미리보기 컴포넌트: PASS.** 변조 DB에서 얻은 exportService.list 결과를 실제 ExportsPanel에 넣고 React renderToStaticMarkup으로 렌더했다(라우터·toast·요청 함수만 시험 shim). 정확한 mismatch 문구가 `role="alert"`로 나오고 잘못된 “글자 설정을 저장하면” 안내는 없다. `E/preview-error.html` 보존. 새 브라우저/양폭 시각 검수는 수행하지 않았고 T065 결과를 상속한다.

## checkP1MigratedRow 비교 범위와 남은 한계

**출처 snapshot이 확정하는 비교는 의미 있다.** 자기 project의 key, derived row/clip ID, revision=1/복원 출처 없음, content_revision/created_at, 프로젝트 aspect/audio 비어 있음, P1 변환 text의 전체 객체, 그리고 video에 존재하는 snapshot-listed scene의 상대 순서 및 그 앞에 unlisted scene을 끼우지 못하게 하는 검사를 한다. text에는 내용뿐 아니라 style/box/timing/animation/locked 등이 포함된다. schema가 fps/schemaVersion/중복 ID 등도 별도로 확인한다. 원래 F065-1의 동일 scene 집합 역순은 여기서 확실히 잡힌다.

그러나 **“옮긴 r1 전체가 당시 결과와 완전히 같다”는 검사로 해석하면 안 된다.** snapshot에는 당시 active membership/선택 clip 데이터가 전부 고정돼 있지 않다. 현재 선택으로 과거 행을 다시 계산하면 정당한 stale 이력을 잘못 거부하므로 host 검사는 그 값을 강제하지 않는다. verifyTimelineMigration은 실제 이관 직후에만 currentClips와 전체 길이/값을 추가 비교한다.

직접 추가한 실험 결과:

| temp 변형 | 출처/checkTimelineRows | editView/stale 및 후속 영향 |
|---|---|---|
| 첫째/가운데 video 삭제, video 전부 삭제 | 통과 | P1 sceneOrder는 원 snapshot, stale에 빠진 active scene 포함. 실제 검수/내보내기 request는 stale로 거부 |
| 첫 clip duration +1 | 통과 | 해당 scene stale. 실제 검수/내보내기 request 거부 |
| 없는 새 scene UUID + key로 계산한 clip ID를 tail에 추가 | 통과 | 새 scene stale. 실제 DB scene 존재/소속 자체를 이 helper가 보증하는 것은 아님 |
| s3를 archived로 만든 사본에서 s3 clip 삭제 | 통과 | stale=[]이고 P1 view는 원 snapshot의 s3를 포함. 당시 migration 전에 archived였던 정상 자료와 현재 provenance만으로 구별할 수 없는 경계 |
| snapshot에는 s1만 있고 0005가 s2/s3를 append한 유효 상태에서 tail s2/s3 순서 교환 | 통과 | stale=[]; view는 snapshot sceneOrder=[s1]. baseline이 verifyTimelineMigration을 통과함도 먼저 확인. append-tail 내부 순서는 snapshot에 없으므로 고정하지 못함 |

마지막 두 경우를 은폐하지 않는다. 특히 추가 장면끼리의 순서는 T069가 이미 고지한 한계이며, 이번에 직접 재현했다. P1 reader는 원 snapshot을 바이트 보존하여 돌려주는 계약이고 0005 자체도 snapshot 밖 active scene을 뒤에 붙이므로, 단순히 snapshot.sceneOrder와 전체 video를 같게 강제하면 정상 이관을 거부한다. 부분삭제를 모두 host 손상으로 판정하거나 append 순서까지 증명하려면 당시 scene membership/정렬/clip provenance를 별도로 보존하는 후속 설계가 필요하다. 이번 집중 판정은 **원래 snapshot이 고정한 장면 순서의 변조 차단 PASS**로 한정하며, 위 범위까지 완전검증이라고 쓰지 않는다. 이 한계를 확대 수용할지의 제품 범위 판단은 Master에게 반환한다.

## 원본 보존·미검증·다음 조건

아래 SHA256은 실행 전후 모두 같고 T065 기록과 일치한다. `E/hash-before.json` / `E/hash-after.json` 비교 차이 0. 0005 entry/helper 원문은 각각 CRLF 111/40개, bare LF 0개였다.

| 대상 | SHA256 |
|---|---|
| SQL1 | ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0 |
| SQL2 | 6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed |
| SQL3 | 9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e |
| SQL4 | 6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3 |
| 0005 entry | 44f6a17e8de93a13cfa43810b7aa8f40a83df7008f3fd6826fc33bc9de13286b |
| 0005 helper | fadb7df745d3404687a03690102868233b33b4613ae5ecf365fe747574e409d7 |
| s4.zip | 6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392 |
| s5.zip | 5331346f66c4f8ab325c75147202167e0eb595b28d680be4bff9be0595d5e967 |

- 별도 새 브라우저, HTTP mutation, 실제 ZIP 다운로드/생성, P1 전후 캡처, arbitrary hostile JS/전원·ACL·대용량 및 Remotion/P2-2는 이번에 재실행하지 않았다. 상속 항목과 직접 실행을 구분했다.
- 제품 수정/미구현 추가 없음. 보고서 작업은 성공이며 제품 판정은 위 제한을 명시한 집중 PASS다. 공용 TEAM/REVIEW 상태 변경과 다음 마일스톤/디자인·사용자 확인 게이트는 Master가 판단한다.
- 작업 종료 전 tracked diff는 이 보고서 하나뿐인지 확인한다. 서버 미시작. 새 증거 파일은 OS-temp에 보존했다.

## Master / Claude design에게 복사할 전달문

T070은 HEAD 01f81f9를 독립 집중 재검수해 F065-1 원래 전체 역순 재현 차단 PASS로 판정했습니다. hash-consistent/manifest 재계산/guard 원복 가상 s5는 실제 inspect에서 RESTORE_INVALID이며, 정상 inspect 뒤 자기 staging을 변조한 별도 finish도 RESTORE_INVALID·목적지 DB 없음입니다. 전체 412통과/생성2skip·lint/typecheck/build 및 temp 집중 14검사, 정상 r1 0.125 바이트호환/r2 0.133·stale·실제 검수/내보내기 거부·컴포넌트 오류 alert를 확인했습니다. 다만 부분삭제/clip 길이는 출처 검사 대신 stale이 막고, archived 삭제 및 snapshot 밖 append-tail 순서는 완전 증명하지 못한다는 범위를 T070 보고서에 명시했으니 제품 전체 정합성 보장으로 확대하지 말아 주세요. 원본 SQL1~4/0005 CRLF/고정 s4s5 해시와 기존 승인 게이트는 보존했고 제품·공용문서 수정/commit/push/기존서버 접근은 없습니다.

전달 상태: 보고서 작성 완료. 실제 Orca worker_done 전송은 보고서 확인 후 수행하며 수신·통합 완료를 이 문서만으로 주장하지 않는다.