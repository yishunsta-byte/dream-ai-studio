# T168 T164 UI + T166 writer 통합 독립 검수

- 담당: 독립 Codex `term_96a0a77fd68dd4629abc50360245630f`, task `task_42cfa69a0b1a`, dispatch `ctx_e9ade8f13126`, 2026-11-17 KST.
- 고정 기준: **`3dadf45a38c17251a7d50530832f0dde2b7b4d08`**. T164 보고서 전문·T162 실제 preview DTO·T166 수정·T167 독립 결과·T165 타입 변경을 확인했다.
- 결론: **UI와 수정 writer의 아래 실제 실행 범위는 bounded PASS. 운영 build 추적 검증은 FAIL(F168-1)이므로 전체 통합 수용은 보류한다.** UI 동작 결함이나 writer F163-1 재발은 발견하지 않았다. build 실패를 UI가 새로 일으켰다고 단정하지 않는다.
- 제품/DSP/service/fixture는 수정하지 않았다. 이 고유 보고서만 선택 커밋한다. 구현자 자체 22조합·전체697/19skip·build 증거와 아래 독립 실행은 별개다.

## F168-1 — 물리 도구가 있는 고정 사본의 verify-build 실패 (P1 검증 게이트)

**실제 절차:** git archive 3dadf45를 새 D: 사본에 추출하고 동일 설치 node_modules junction을 만들었다. 요청대로 `.tools/ffmpeg/ffmpeg.exe`와 ffprobe.exe를 설치본에서 **물리 복사**했으며 해시를 대조했다. 제품 소스나 Next config를 고치지 않은 상태에서 아래를 실행했다.

```text
node node_modules/next/dist/bin/next build --webpack
# compile·TypeScript·page generation 성공 후
node scripts/verify-build.mjs
```

- Next 운영 컴파일은 성공했다.
- **verify-build는 exit1**, `빌드 파일 목록에 로컬 데이터나 비밀 설정이 포함되어 중단했어요.`로 거절했다.
- 진단용으로 원래 `privateTrace()`를 호출해 실제 `.nft.json`의 위반 경로를 기록했다. **20개 trace에 40개 참조**, 고유 대상은 아래 도구2개다.
  - `D:/starwork/t168-ui-3dadf45/.tools/ffmpeg/ffmpeg.exe`
  - `D:/starwork/t168-ui-3dadf45/.tools/ffmpeg/ffprobe.exe`
- 예: `.next/server/app/(studio)/page.js.nft.json`, `history/page.js.nft.json`, `settings/page.js.nft.json`, `app/api/backups/route.js.nft.json` 등에 들어갔다.

ROOT/build.log에 원래 컴파일 출력·검증 실패가 있고 ROOT/private-traces.log에 실제 경로40개가 있다. build 전에 가짜 runtime이나 검수 helper를 추가하지 않았으므로 그 추가 파일이 첫 실패를 유발한 것은 아니다. 이 메시지를 실제 사용자 DB/비밀이 trace됐다는 증거로 확대하지 않는다. 이번에 확인한 위반은 **사본의 물리 도구2개**다.

현재 config는 `outputFileTracingExcludes`의 `.tools` 제외를 선언하고 있지만 이 Windows/Next16.4.6/Webpack 실행에서 위 파일이 남았다. 설치판 Next output tracing 문서도 읽었으나 정확한 누락 원인은 확정하지 않았다. config/service 영역은 T164 UI diff가 아니므로 **새 UI 회귀라고 귀속하지 않는다**. T164 작성자의 build PASS와도 차이가 있어 별도 재현·해결이 필요하다.

**요청:** 물리 도구를 둔 실제 지원 배치에서 trace 제외를 검증하고 verify-build가 통과하도록 원인을 해결한다. 검증기 완화·trace에서 파일을 사후 수동 삭제하는 방식으로 통과시키지 않는다. 제품 변경 금지 범위에 따라 검수자가 수정하지 않았다. 현재 운영 build/verify-build를 모두 PASS라고 보고할 수 없다.

## 격리 환경·보호·저장원

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t168-ui-5ad8f7f279fe414d9720d9a7a9c50542` — 증거·다운로드·가짜 runtime.
- **APP:** `D:/starwork/t168-ui-3dadf45` — 정확한 git archive 소스, 사본 `.next`, 물리 도구2개, 기존 설치 node_modules를 읽는 junction.
- **runtime:** `ROOT/runtime` — 고정 s9 ZIP을 검증 추출하고 **이 사본에서만9→10** 적용, 합성 PCM과 가짜 프로젝트/검수 자료.
- **서버:** 실제 Next16.4.6 `dev --webpack --hostname 127.0.0.1 --port 3168`, `DREAM_DATA_ROOT=ROOT/runtime`. 시작 전3168 listener 없음 확인. 승인 검토가 실패한 운영 build를 배포한 것이 아니라 격리 dev 실행이다.
- **브라우저:** ego-browser TaskSpace32, Chrome156, 실제 라우트/API/컴포넌트/서비스. UI DTO/성공 응답을 mock하지 않았다.
- 공유 작업트리 착수 HEAD는 `24a8db6`, 선행 T157 미추적 문서는 보존했다. 사용자 DB/storage/비밀/.env를 복사하거나 열지 않았고 3013·공유 `.next`에 빌드/삭제 명령을 실행하지 않았다.

가짜 상태 준비는 APP/tmp/t168/scenario.ts, 실제 다운로드 대조는 verify-download.ts에 기록했다. ROOT에도 그 스크립트 사본을 보존했다. sample/archived/roles/rights 상태는 사본의 실제 timelineService.save 및 가짜 asset 행으로 만들었다. null 크기는 가짜 DB에서만 asset guard/CHECK를 일시 우회해 누락 메타데이터를 만들고 다시 원상 복구한 **비정상 메타데이터 표시 대조**다. 정상 업로드가 null을 허용한다고 주장하지 않는다.

## 독립 시험·타입·build 범위

| 실행 | 실제 결과 | 증거 |
|---|---|---|
| `vitest run tests/t164-export-ui.test.ts tests/t162-audio-bundle.test.ts tests/scene-export-info.test.ts` | **3파일/29 PASS**, exit0 | ROOT/related.log |
| `npm.cmd run lint` | PASS, exit0 | ROOT/lint.log |
| `npm.cmd run typecheck` | `next typegen && tsc --noEmit` PASS, exit0 | ROOT/type.log |
| 실제 UI queued export에 late source seam을 연결한 검수 전용 worker 시험 | **1 PASS**, exit0 | ROOT/late-worker-final.log, late-worker.json |
| 운영 Webpack compile → verify-build | compile 성공 / **verify FAIL exit1** | ROOT/build.log, private-traces.log |

위 정적 검사·운영 build는 검수 helper/시험을 추가하기 전 추적 소스로 수행했다. 이후 helper는 격리 APP에만 추가했다. 전체703·제작자의22조합은 반복하지 않았다.

이번 고정 SHA에는 T165의 `manifest2()` 단언/타입 좁히기와 `isAudioFile()`이 이미 들어 있고 해당8시험·typecheck가 통과했다. 최초 제작 사본의 TS2352와 T165가 보고한 깨끗한 설치의 미재현을 서로 대체하지 않는다. 이번에는 원판 df62033을 재설치하여 타입 오류를 다시 재현하지 않았고 그 원인을 확정하지 않는다. 타입 변경은 시험 보증 강화이며 새 서비스 동작 변경이 아니다.

## 실제 브라우저 UI + API + worker

### 정상·크기·권리·샘플·보관·형식

- 1280/390 정상 v2 audio2개에서 실제 원본명·역할·clip수·기록된384KB 크기를 확인했다.
- 같은 voice를 voice+effect로 쓰는 clip2개, sample voice, archived 비샘플 music, voice 권리 기록 있음·music null 권리 상태를 저장하고 두 폭에서 표시했다. 샘플·보관·권리없음 표시가 서로 구분됐다.
- “권리 기록이 있어도 사용권 확인 아님”, “목록은 무결성 PASS 아님”, 같은 크기 변경은 작성 해시에서 실패할 수 있다는 문구를 직접 확인했다.
- v1과 **소리 없는 v2**를 각각 실제 저장한 뒤 두 폭에서 **소리 원본0 / 묶음 형식v1**을 확인했다. 과거 ZIP 행의 내용에 현재 preview의 원본 정보가 덧씌워지지 않았다.
- null source size는 두 폭에서 **원본 크기 기록 없음**으로 표시했고 `기록된 원본 크기 0`으로 표시하지 않았다. actual problem 때문에 생성이 막혔다.
- 예상 ZIP 크기와 백업 증가를 별도로 설명하고 실제 ZIP은 생성 후 표시한다고 했다. 큰 원본 예상 정확도·작성 시간이 미확인임을 숨기지 않았다. 믹스/MP4/실행앱 없음, ZIP import 없음, 다른 도구 수동 재조립, 백업·복원과의 차이도 유지됐다.

### 키보드·터치·가로 넘침

ROOT/audit-summary.json에 **17개 화면 상태/폭 관찰**을 저장했다. 정상/flags/원본누락/null/v1/소리없는v2/재시도성공은 두 폭, 파일 목록 open·late실패·저장실패는390에서 확인했다. 제작자의22조합을 독립 실행했다고 표현하지 않는다.

- 검수한 **export panel**의 visible button/link/summary 최소 높이 모두 **44px**, 44px 미만0, 이름 없는 조작0.
- page 가로 넘침 없음. raw `scrollWidth-innerWidth`는 모든 관찰에서 -15px(세로 scrollbar 폭)이며 양의 가로 넘침이 없었다. 이 raw값을0으로 고쳐 기록하지 않았다.
- summary를 focus하고 **Enter로 열기/닫기**, 다음 **Tab**이 현재 생성 버튼으로 이동함을 확인했다. 이어 Enter로 실제 POST202를 보냈다.
- 실제 저장 실패의 첫 “다시 시도”를 focus하고 **Enter로 PATCH200**, 같은 작업의 성공을 확인했다.
- 정상1280/390 및 flags390 PNG를 직접 열어 읽기·줄바꿈·배지를 확인했다. screen reader/실제 휴대폰 검증은 아니다.

### 늦은 source 변경이 UI에서 허위 완료로 표시되지 않음

UI가 실제 POST202로 만든 export `01a1e6dc-678a-7345-80a8-a0c511285650`의 job을 검수 전용 Vitest worker로 처리했다. 실제 runNextJob과 writeZip을 호출하고 **실제 ZIP 직렬화 직후 source1바이트만 변경**하는 seam을 넣었다. UI 응답·DTO·job 결과를 주입하지 않았다.

worker는 **failed EXPORT_INVALID**, “저장할 때와 달라요”로 종료했다. 화면 새로고침 후 해당 실패 section에 실제 소리 이름·실패 사유·`코드 EXPORT_INVALID`·현재 내용으로 새로 만들기가 보였다. 해당 행을 완료/다운로드 가능으로 표시하지 않았다. 이전 성공 행의 완료 표시는 그대로 별개로 남았다. ROOT/late-ui-failure.json, browser-06.log가 실제 화면 결과다.

T167의 같은 size+**정확히 같은 mtime**, source full digest2회 수치는 선행 독립 증거다. 이번 UI 연결은 그 행렬을 전부 재실행한 것이 아니며, 실제 UI queued 작업 한 건이 수정 writer 실패로 이어지는 연결을 검증했다.

### stale 화면 POST409·audioBlocked 생성/재생성 차단

정상 화면을 읽은 뒤 원본을 사본에서 옮기고 UI의 현재 생성 버튼을 눌렀다. 서버의 실제 **POST409**와 소리 이름/“찾을 수 없어요” 문장을 받은 뒤 같은 문장이 alert에 보였다. ROOT/post409.json에 요청·상태·응답·alert가 있다. code 필드가 없는 기존 API 계약을 가정 없이 처리했다.

새로고침 뒤 audioBlocked가 표시되고 **현재 생성 버튼과 기존 EXPORT_INVALID의 “현재 내용으로 새로 만들기” 모두 disabled**였다. ROOT/blocked-buttons.json. 직접 서버 거부와 최신 DTO의 UI 차단을 각각 확인한 결과다.

### STORAGE_FAILED → UI retry → 같은 작업 성공

UI POST202로 만든 `01a1e6de-639a-7485-b183-5035a2063f44`에 대해 격리 exports 폴더를 보존 이름으로 옮기고 해당 경로를 blocker 파일로 막았다. 새 가짜 job의 max_attempts만1로 두어 첫 실제 실패를 UI에서 명확히 관찰했다. 제품 retry 분류를 고치지 않았다.

실제 worker는 STORAGE_FAILED/failed를 남겼고 UI는 “다시 시도”를 제공했다. blocker를 풀고 원래 폴더를 되돌린 뒤 UI Enter로 **PATCH200**을 보내 같은 job을 재시도했다. 실제 worker가 성공했으며 화면의 같은 export는 완료·정확한 크기·기록된 ZIP 해시·다운로드 링크로 바뀌었다. ROOT/storage-request.json, storage-retry.json, storage-failure.log, retry-success.log, final-ui-audit.json.

## 이번 실제 브라우저 다운로드와 바이트 대조

실제 다운로드 링크와 브라우저 download event로 새 flags ZIP과 기존 v1 ZIP을 저장했다. raw API 텍스트를 ZIP으로 둔 것이 아니다. ROOT/verify-download.ts는 내려받은 Buffer 전체=저장 파일 Buffer·행sha, verifyZip, 모든 entry hash, audio source Buffer, 저장된 timeline_json을 직접 대조했다.

| 이번 다운로드 | 실제 결과 |
|---|---|
| `ROOT/flags-ui.zip` | **2,847,696바이트**, SHA256 `af70fd6d8da09c99ff0f8ab272b8f8afafcd2b43124f5dd2bd9ea9b12d65e109`, manifest2 |
| `ROOT/old-ui.zip` | **1,809바이트**, SHA256 `d3e0ece1169b093d4bc0918afcb9fa5bf9646e375de1c11bb4459d016fcf1ffc`, 기존 manifest1 |

새 ZIP은 audio2원본, voice roles `[voice,effect]`·clip2·sample, music role `[music]`·clip1·archived·빈 권리기록, audio_sources metadata를 담았다. audio Buffer=가짜 저장 원본, 모든 entry SHA=manifest, timeline bytes=manifest가 참조하는 **당시 저장 revision**이었다. **MP4/final 영상 없음**을 직접 확인했다. 현재 revision이 나중에 v1/v2none으로 바뀌었어도 과거 ZIP은 그대로였다. ROOT/download-audit.json.

T167의 정상 backup/restore 및 이전 no-replace/ABA 검수는 선행 증거다. 이번 다운로드 SHA를 T167·제작자 다운로드 SHA와 같다고 주장하지 않는다. 생성 시각/타임라인 ID·clip 추가 등 입력이 다른 한 건이다. 이번에는 UI 다운로드와 현재 저장본의 전체 바이트를 직접 확인한 것이다.

## 민감값·과거 행·최종 게이트

17개 panel 관찰에서 시험 source 전체 SHA 및 PC 경로가 화면에 노출되지 않았다. DTO의 audio 필드는 source SHA/PC 저장 경로를 전달하지 않고 ZIP 상대경로만 표시한다. 과거 성공 ZIP의 hash/복사는 의도된 **만들 때 기록한 ZIP 해시**이며 source hash 노출과 구분한다.

available은 파일 존재라는 문구, 현재 무결성 재검사가 아니라는 문구가 실제 성공 행에 보였다. 이번 정상 다운로드는 서버의 실제 hash 재검사를 통과했지만 available만으로 PASS라고 해석하지 않는다. 민감한 오류 문자열의 일반 문장 대체는 관련 UI 자동시험에서 통과했고 화면의 실제409도 PC 경로를 포함하지 않았다.

최종/게시 게이트가 열리지 않는 안내와 MP4/final 미포함을 확인했다. finishing API에 미지원 `action:final`을 보내 **400** 거절도 확인했다. 이는 모든 최종 배포 권한 행렬을 새로 검증한 것과 다르다. 서비스/최종 게이트 구현 변경은 없었다.

## 검수 준비 실패와 한계

- 첫 old ZIP 클릭은 다운로드 대상이 viewport 밖이라는 Ego 오류로 중단됐다. 같은 TaskSpace에서 snapshot과 실제 위치를 확인하고 scroll 후 다시 다운로드했다. flags ZIP 첫 다운로드는 이미 성공했고 중복 성과로 세지 않았다.
- 그 중단 때문에 새 UI job이 아직 없던 첫 late worker 실행은 seam未실행 단언으로 실패했다. 실제 UI POST202를 확인한 다음의 재실행1 PASS만 통합 결과로 썼다.
- v1/no-audio 관찰 뒤 archived music을 다시 새 참조로 넣으려던 준비는 서버에서 거절됐다. 가짜 원본의 archived 표시를 먼저 해제한 뒤 재저장해 storage retry 상태를 준비했다. 이 준비 오류를 제품 결함이나 UI 통과로 세지 않았다.
- 전체 P2·휴대폰·청취·새 native render·대용량 예상치/timeout·스크린리더·다른 편집기 재현·실제 사용자 DB 이관은 완료 주장이 아니다.

## 종료·불변·잔존

TaskSpace32는 별도 마지막 스크립트의 `finish({keep:[]})`로 종료했다. 소유한 Next exec session2262만 Ctrl-C로 종료했고 **3168 listener 없음**을 확인했다. 공유 **3013은 처음과 같은 PID37252**로 남았다. 마지막 공유 `.next/dev/lock`은 2026-11-16 00:48:33/107바이트였다. 공유 `.next` 전체 바이트 동등을 측정한 것은 아니며 해당 디렉터리에 쓰는 명령을 실행하지 않았다.

설치본/물리 사본의 두 도구 hash는 작업 끝에도 같았다.

- ffmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

`git diff --exit-code 3dadf45^ 3dadf45 -- lib/services/exports.ts lib/media lib/db/migrations lib/export/schema.ts tests/fixtures`는0으로 writer 수정 기준/발행 SQL/fixture는 UI 커밋에서 불변이다. 원본 작업트리는 이 보고서 외 수정하지 않았다.

APP의 정확한 절대 경계와 node_modules junction 대상을 가드하고 junction을 먼저 끊은 뒤 사본만 지우는 명령을 제출했으나 **자동 승인 검토가 프로세스 생성 자체를 `blocked by policy`로 거절했다.** 삭제는 실행되지 않았고 우회하지 않았다. APP의 `.next`·물리 도구 사본·junction과 ROOT의 가짜 runtime/로그/PNG/ZIP/재현 스크립트가 남는다. 서버·브라우저 종료와 파일 삭제 완료를 혼동하지 않는다. 후속 정리는 junction의 공유 의존성 대상을 보호해야 한다.

## Master/플래너 복사 전달문

T168은 3dadf45의 **UI+수정 writer 실행 범위 bounded PASS / 운영 trace 검증 FAIL**입니다. 관련29·추가 UI연결 worker1·lint/type, 실제 Next3168+가짜s9→10에서17개 상태/폭 관찰, POST409/audioBlocked 생성·재생성 차단, late EXPORT_INVALID 실패표시, STORAGE_FAILED UI retry→같은 작업 성공, 실제 새/과거 ZIP 다운로드 바이트를 확인했습니다. F168-1은 물리 복사 도구2개가20개 운영 trace에40번 남아 verify-build가 exit1인 재현이며 UI가 새로 유발했다고 단정하지 않습니다. 운영 build 수용 전 이 경로를 해결·재검증해야 합니다. 브라우저/3168은 종료,3013은 PID37252 유지, APP 삭제는 자동 승인 검토 거절로 미실행되어 증거가 남습니다.
