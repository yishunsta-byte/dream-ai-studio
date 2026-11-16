# T157 독립 VTT 검수 — 범위 한정 PASS

- 검수자: Codex 독립 작업자, `term_d50df8a7-2359-457a-afd7-daf3c91280cf`. 구현·T156 fixture 제작에 참여하지 않음.
- 작업: `task_9a4e2ae92f33` / `ctx_320c7a02a436`, 2026-11-17 KST.
- 대상: `0c49badac62f1c79368ccacdc0ce2bbed44c2f9a`; 비교 대상 부모 `927abc8e7b5ab5350ff4dc17e9d1de86a7df9af1`.
- 읽은 기준: AI_TEAM_RULES, CLAUDE, PLAN/REVIEW/TEAM, docs/team 역할 지침, T154 계약과 Master 채택 범위, T155 보고서. 아래 실행은 T155 작성자 자체 확인을 인용한 결과가 아니라 검수자가 새로 수행한 결과다.
- 판정: **subtitle-only VTT·실제 ZIP·native textTrack 및 기존 바이트 보호 범위 PASS. 필수 제품 수정 발견 없음.** 독립 운영 빌드는 환경 경로 문제로 완료하지 못했으므로 빌드 PASS나 전체 P2 완료를 뜻하지 않는다.

## 저장원·격리·변경 범위

공유 작업트리 HEAD는 대상 SHA, 착수 시 `git status --short`는 비어 있었다. `git archive 0c49bad`로 추적 파일만 OS 임시 폴더에 추출했다. 사용자 DB/storage/backups 및 `.env.local`은 복사·열람하지 않았다. 의존성은 `D:/starwork/dream-ai-studio/node_modules`를 읽는 junction 하나만 사용했다. 원본 작업트리에는 이 문서만 새로 작성했으며 제품 코드·발행 migration·기존 fixture·T156 작업 파일은 수정하지 않았다. 공용 PROGRESS/REVIEW/TEAM은 단일 작성자 규칙에 따라 수정하지 않았다.

증거 루트: `C:/Users/Administrator/AppData/Local/Temp/t157-vtt-089fe184974640fca88ea186a7114001` (이하 ROOT). `app/`은 고정 소스 사본, `s4-runtime/`은 고정 s4를 추출·이관한 가짜 DB다. 추가 독립 harness와 부모 exports 모듈은 이 사본에서만 사용한 뒤 ROOT로 옮겼다. 원본 구현을 수정해 통과시키지 않았다.

FFmpeg는 기존 `D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`를 직접 실행하여 lavfi navy 640×360, 30fps, 4초, 무음 VP9 WebM을 생성했다. **도구 물리 복사·내용 변경 없음.** 실행 전후 SHA-256은 동일했다.

| 도구 | SHA-256 |
|---|---|
| ffmpeg | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec` |
| ffprobe (실행하지 않음, 보존 확인) | `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52` |

3013에 접속하거나 해당 서버를 시작·종료하지 않았다. 검수용 HTTP 서버도 만들지 않았다. 브라우저에는 실제 export 추출 VTT와 합성 WebM을 Blob URL로 연결했다.

## 독립 재실행

사본 `app/`에서 다음을 실행했다.

| 실행 | 실제 결과·증거 |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/p2-6-vtt.test.ts tests/jobs.test.ts tests/p2-1-timeline.test.ts tests/p2-1-f065.test.ts tests/p2-3-text-editor.test.ts tests/backup-immutability.test.ts` | **6파일/88시험 PASS**, exit 0, ROOT/related.log |
| `npm.cmd run lint` | PASS, exit 0, ROOT/lint.log |
| `npm.cmd run typecheck` | `next typegen && tsc --noEmit` PASS, exit 0, ROOT/type.log |
| 별도 `tests/t157-independent.test.ts` | **1시험 PASS**, exit 0. ROOT/t157-independent.test.ts 및 independent-preservation.json. 제품 시험과 별도 합계로 89시험 |
| `npm.cmd run build` | exit 1. Turbopack이 외부 junction의 Next 패키지를 workspace 경계 밖으로 판단하여 resolve 실패. ROOT/build.log |
| `node node_modules/next/dist/bin/next build --webpack` | exit 1. C: 사본에서 D: 의존성의 client entry를 `./D:/...`로 해석해 resolve 실패. ROOT/build-webpack.log. `verify-build`는 선행 build 실패로 실행하지 않음 |

처음 `npm run lint/typecheck`는 PowerShell의 npm.ps1 실행 정책에 막혀 실제 검사하지 못했다. 위 표는 이후 `npm.cmd`로 정상 실행한 결과만 PASS로 계산한다. Next 설치판의 distDir·CLI 문서에서 build 경계와 공식 `--webpack` 옵션을 확인했다. 두 빌드 실패는 제품 컴파일 성공의 증거가 아니며, 의존성이나 도구를 복제·수정해 우회하지 않았다. 전체 suite와 추가 렌더 행렬은 범위상 재실행하지 않았다. T155의 전체661/17skip·운영 build 보고는 작성자 증거로만 남는다.

## VTT·layout·실제 ZIP

- 순수 함수 4시험: WEBVTT 헤더와 빈 줄, BOM 없음·LF만, 마지막 LF, layer UUID cue ID, `HH:MM:SS.mmm`, start/end/id 정렬과 같은 입력의 결정적 바이트, 겹친 cue 보존을 확인했다. 0·1·2·29·30·31·899·900·1799·17999·18000·107999 프레임을 검사하며 반올림 오차 ≤0.5ms, 1시간 경계까지 확인했다.
- `& < > -->` escape, CRLF·CR→LF, 공백뿐인 빈 줄 제거, trim, 한글·이모지 UTF-8을 확인했다. 광고·hook 등 비subtitle 제외, 자막 없음 → helper null을 확인했다.
- 원본 jobs 시험을 `T155_VTT_DIR=ROOT`로 독립 실행했다. 새 가짜 DB에서 저장·검수·request·runNextJob·실제 ZIP 작성·verifyZip·yauzl 추출까지 수행했고, VTT mime/UTF-8 크기·저장 timeline과의 일치·SRT 기존 함수 바이트 일치가 통과했다. subtitle 없는 실제 ZIP에는 SRT/VTT 모두 없고 timeline.json은 있었다.
- 추가 독립 harness는 s4에서 이관된 실제 timeline 자료로 v1 및 빈 audio의 v2 layout을 각각 검사했다. 새 VTT 한 항목을 제외한 전체 항목·순서·본문·파일 경로는 부모 `exports.ts` 결과와 같았다. 두 버전 모두 subtitle을 제거하면 VTT가 없었다. 실제 소리가 들어간 v2 ZIP은 이번 범위 밖이다.

## P1/r1·SRT·기존 성공 export 보호

1. 고정 s4를 OS-temp로 추출하고, 기존 성공 export ZIP에 verifyZip을 수행했다. 최신 migration 이관·timeline/layout 읽기·목록 읽기 뒤에도 성공 행 전체와 ZIP Buffer 전체가 같고 verifyZip이 다시 통과했다. 1,809바이트, SHA-256 `d3e0ece1169b093d4bc0918afcb9fa5bf9646e375de1c11bb4459d016fcf1ffc`.
2. 같은 고정 입력으로 P1 current와 이관 r1 layout이 같고 VTT가 없음을 확인했다. 부모 exports와 현재 exports의 layout도 전체 일치했다. 이 layout으로 만든 실제 ZIP 두 개를 각각 verifyZip·yauzl로 재열어 manifest 포함 모든 entry 바이트를 비교했다. 두 ZIP 전체도 이번 실행에서 동일했다: 각 2,068,741바이트, SHA-256 `31e0e6486969181ab8e3a252dbf505c3215f9ccc19fd506d50205b902e10b85d`. 이 생성 비교에는 selected 장면을 비운 text/font 10항목 layout을 썼으며, 장면 포함 실제 export는 원본 jobs 시험이 보완한다.
3. jobs의 실제 ZIP 수정 후 보존, 성공 행 변경 거부, 취소·stale·lease 경쟁·저장 재시도 검증과 backup-immutability 시험도 독립 통과했다. SRT 함수 자체 diff는 없고, 기존 r1의 0.125초 바이트와 새 timeline의 프레임 반올림 규칙 모두 해당 회귀에서 유지됐다.
4. 원본 `tests/fixtures/backups`와 `lib/db/migrations`에 대한 `git diff --exit-code 0c49bad -- ...`는 0이었다. 기존 파일 보존을 확인한 것이며 진행 중 T156 신작 fixture의 독립 수용은 아니다.

## 실제 export 추출 VTT의 native textTrack

ROOT/browser-01.mjs를 ego-browser에서 새 TaskSpace 30으로 실행했다. Chrome 156 / Windows의 `<video><track kind="subtitles">`, mode showing, track readyState **2**, duration **4초**였다. cue 2개 = 저장 subtitle 2개이며 ID는 추출한 subtitles.json과 일치했다.

| cue | 실제 시작–끝(초) | frame/30 대비 최대 오차 | getCueAsHTML().textContent |
|---|---|---|---|
| `01a1e694-5c4e-70cb-98b3-d14d7c67ab96` | 0.133–2.500 | 0.333333ms | `A & B <i>x</i> --> 끝 😀` + LF + `둘째 줄`, 원문 일치 |
| `01a1e694-5c4e-70cb-98b3-d7b2fa89418b` | 1.000–3.000 | 0ms | `겹치는 자막`, 원문 일치 |

cue.text는 escape된 VTT 표현을 유지하지만 getCueAsHTML의 텍스트는 리터럴 `<i>`·`-->`·`&`를 복원했다. 각 경계 오차는 요구 1ms 이내였다.

| seek 요청 및 실제 currentTime(초) | activeCues 수 |
|---|---|
| 0.1 | 0 |
| 0.5 | 1 |
| 1.5 | 2 (위 두 ID) |
| 2.7 | 1 |
| 3.5 | 0 |
| 1.5로 뒤로 seek | 2 (같은 두 ID) |

ROOT/browser.log에 수치·ID·텍스트·snapshot이 남아 있다. ROOT/native-overlap.png를 직접 열어 합성 화면 위 두 자막의 동시 표시와 두 줄·리터럴 태그·한글·이모지를 확인했다. 이는 native 자막 표시 증거이며 앱 Player나 Remotion **번인 시각 오차 측정이 아니다**.

## 미검증·정리·다음 조건

- 독립 운영 build/verify-build 완료, Firefox/Safari, 실제 휴대폰, 화면낭독기, 번인 0.2초 비교, 실제 사용자 영상·소리·의미 동기화는 검증하지 않았다. subtitleMeasure/phonePlayback 등 제품 완료 상태를 바꾸지 않았다.
- audio 원본 ZIP·manifest2·0010·새 UI·final 영상 패키지 및 T156 s9 fixture 수용은 범위 밖이다. T154의 SRT 빈 줄 관련 알려진 차이도 수정하지 않았다.
- 브라우저는 별도 마지막 스크립트에서 `finish({keep:[]})` 완료했다. 직접 생성한 FFmpeg와 검사·빌드 프로세스는 종료됐고 ROOT를 명령줄에 가진 node/ffmpeg/ffprobe 프로세스 조회는 0건이었다. 서버·worker 상주 프로세스를 만들지 않았다.
- ROOT 하위 app/s4-runtime/snapshot.zip 정리를 시도했으나 **자동 승인 검토가 삭제 명령의 프로세스 생성 자체를 `blocked by policy`로 거절했다.** 우회·재삭제하지 않았다. 따라서 app/node_modules junction, 가짜 DB, 소스/빌드 사본, snapshot.zip 및 증거가 ROOT에 그대로 남아 있다. 정리 완료로 주장하지 않는다. 이 junction의 대상은 기존 D: 의존성이므로 향후 정리 시 대상 재귀 삭제를 피해야 한다.
- Master는 이 범위의 VTT 동작 검수를 수용할 수 있다. 독립 운영 build PASS가 별도로 필요하면 적절한 같은 드라이브 의존성 환경에서 고정 SHA를 검증해야 한다. 기존 작성자 build를 이번 독립 재실행으로 합산하면 안 된다. 제품 수정 후에는 해당 변경의 영향 검수를 먼저 한다.

## 플래너·Master 전달문

T157 독립 검수는 0c49bad의 subtitle-only VTT·실제 ZIP·native textTrack·P1/r1/SRT/기존 export 바이트 보호 범위 PASS입니다. 관련88개와 별도 독립1개 시험, lint/typecheck가 통과했고 native 최대 오차0.333ms 및 overlap/뒤 seek activeCues2를 확인했습니다. 독립 build는 C: 임시 사본→D: 의존성 junction 경로 제한으로 미완료이며, 번인·휴대폰·audio ZIP·T156은 미검증입니다. 브라우저/생성 프로세스는 종료했지만 자동 승인 검토가 temp 삭제를 거절해 ROOT 자료가 남습니다. 보고서는 작성 완료이며 실제 전달·수신은 Orca worker_done 영수증으로 별도 확인합니다.
