# T133 — P2-5A 오디오 저장·복원 기반 독립검수

- 검수자: CX-REVIEW-01(Codex), T132 작성에 참여하지 않음. Master T133 배정에 따른 독립검수이며 자체 검수와 구분한다.
- 기준: `aa7b0dbe55fe42ef588a8abd5436d59d774e19a2`(T132), 비교 기준 `8964c8118d59b5a51035f10ea9ac631207b33fbd`.
- 확인 시각: 2026-11-17 03:56 KST. **판정: P2-5A 저장·복원 기반 PASS, 확인된 제품 FAIL/필수 수정 0건.** 오디오 출력·정밀 DSP·P2 전체 완료 판정은 아니다.
- 저장소 변경은 이 새 문서 하나뿐이다. 제품 코드, 공용 상태 문서, 사용자 DB, 고정 fixture, 도구 및 다른 작업자 파일을 수정하지 않았다. 보고서 통합과 최종 수용은 Master 담당이다.

## 범위와 실행 환경

AI_TEAM_RULES, AGENTS, CLAUDE, docs/team/CLAUDE_ROLES, TEAM, PLAN/REVIEW 최신 부분, T130 및 T132 인수인계를 읽고 변경 코드를 검토했다. T130은 설계 제안이며 실제 DSP 완료 기준으로 취급하지 않았다. Next 실행 전 설치본의 CLI/webpack 관련 가이드를 읽었다.

원 작업공간은 node_modules가 없었다. PowerShell의 npm.ps1 실행 정책 거절에 이어 npm.cmd는 vitest/eslint 미설치로 종료했고, npx tsc는 실제 TypeScript가 아닌 임시 tsc 패키지를 선택해 종료했다. 이를 제품 실패나 검사 성공으로 세지 않았다. 전역 정책이나 제품 의존성을 바꾸지 않고 다음 OS-temp 안전 복사본에서 실행했다.

`C:/Users/Administrator/AppData/Local/Temp/dream-t133-c55b5ebc58124a338beb8d069c044389` (이하 E)

추적 파일을 Copy-Item으로 복사하여 작업 파일의 CRLF/바이너리를 유지했다. 처음에는 기존 설치 node_modules를 junction으로 읽었으며, 브라우저 단계에서 드라이브 간 Next 경로 해석 실패가 나와 junction을 unlink한 뒤 같은 설치 내용을 E/node_modules로 물리 복사했다. 원 설치·도구는 수정하지 않았다. FFmpeg/ffprobe는 `D:/starwork/dream-ai-studio/.tools/ffmpeg/` 실행 파일을 명시했다. 모든 DB는 OS-temp의 가짜 s4/s7 사본이고, 추가 오디오 시험은 생성한 48kHz/mono/16bit/440Hz PCM WAV를 사용했다. 업로드하거나 외부 음원을 가져오지 않았다.

## 직접 실행 결과

| 검사 | 독립 실행 결과와 증거 |
|---|---|
| 원본 전체 vitest | **585 PASS / 13 skip**, 51 파일 PASS / 1 파일 skip, 23.24초. `E/t133-suite2.log` |
| T132 새 15개 | 원본 전체 회귀에 포함하여 PASS. 합성 PCM으로 바꾼 임시 시험에서도 같은 15개 PASS |
| 추가 5개 | 실제 구앱 ZIP/DB 거절, 4종 invalid migration rollback, 개별 save 원자 거절, editor 변환·저장/과거 참조 보호, UI용 가짜 데이터 구성까지 **20/20 PASS**(기존 15 포함). `E/t133-extra2.log` |
| 추가 복원 2개 | 실제 s7→s8 복원 및 위조된 v2 audio 참조 백업의 inspect 거절 **2/2 PASS**. 필터로 제외된 20개는 재실행하지 않은 것이며 회귀 skip 수에 합산하지 않음. `E/t133-restore-extra2.log` |
| lint | `node node_modules/eslint/bin/eslint.js . --max-warnings 0` exit 0. 추가 임시 harness를 넣기 전 원본 복사본에서 실행 |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit 0. 추가 시험을 원본으로 되돌린 후 `npm.cmd run typecheck`도 exit 0(next typegen + tsc). `E/t133-typecheck.log` |
| 실제 편집 UI | 127.0.0.1:43133, 자기 가짜 DREAM_DATA_ROOT만 사용. 자막 수정 후 저장 POST 200·새 화면 GET 200·r2→r3·내용 버전6→7. 오디오 관련 5필드 동일. `E/ui-result.json`, `E/ui-saved.png` |
| 빌드/렌더 | 운영 build와 실제 Remotion 렌더 E2E는 이번 검수에서 실행하지 않음. T132의 build 주장을 독립 재실행으로 표현하지 않음 |

재현 명령은 E에서 `node node_modules/vitest/vitest.mjs run --reporter=dot`이며, 실행 전에 `FFMPEG_PATH`와 `FFPROBE_PATH`를 위 설치 경로로 지정한다. 초기 미디어 경로 누락 실행은 567 PASS/4 FAIL/27 skip 및 1 suite import FAIL이었고, 실패 원인은 모두 `spawnSync ffmpeg ENOENT`였다. 경로를 명시한 원본 재실행이 위 585/13이다. 설정 없이 성공으로 보고하지 않았다.

추가 harness 원문은 `E/t133-probes.ts.txt`, `E/t133-all-probes.ts.txt`, 구앱 실행 원문은 `E-old/probe.ts`에 남겼다. 제품 tests에는 이 변경을 적용하지 않았다. 초안 harness의 존재하지 않는 project_stages 쿼리, 백업 디렉터리 경계 위반, 성공 백업 변경 시도는 검수 harness 오류였다. 각각 실제 stage_states 사용, 별도 archive 폴더, 새 가짜 backupId/manifest/메타 레코드 생성으로 고쳤으며 제품 guard를 제거하거나 기대 실패를 성공으로 바꾸지 않았다.

## 경로별 근거와 판정

1. **v1/P1 보존 PASS.** v1 schema는 이름을 timelineV1Schema로 분리했지만 기존 정의를 유지했다. 읽기만으로 행을 쓰거나 v2로 자동 승격하지 않는다. 새 v2 왕복은 canonical JSON, sha256, 내용 버전 +1 및 이전 r1 행 동일을 확인했다. v1 재저장도 v1이다. 0008 전에 작성한 nonempty-v1 오디오 행은 이관 후 행 전체가 동일하고 저장·되돌리기는 명시 거절, 현재 버전일 때 렌더도 차단한다. P1 snapshot/SRT/0005 정합성 관련 기존 회귀가 전체 시험에서 통과했다.

2. **v2 저장·복원·CAS·원자 거절 PASS.** `lib/services/timeline.ts:93`은 새/변경 clip의 자료 종류·보관 상태·파일 존재·기록 길이를 검사한다. sourceIn+duration은 floor(duration_ms×30/1000) 이내여야 한다. 스키마는 정수 프레임, D, fade 합, 음악 두 곡 crossfade/세 곡 겹침, role별 duck, 권리 행 정확히 한 줄을 검사한다. 두 CAS 충돌은 쓰기 없이 거절한다. 별도 시험에서 없는 자료/다른 kind/보관/길이 모름/소스 길이 초과/D 초과를 각각 실행하기 전후 timeline 행, project 포인터·버전, stage, append-only audit를 비교하여 전부 동일했다. 기존 작성자 시험의 일부 거절이 뒤따르는 정상 저장과 함께 행 수만 비교하는 약점은 이 개별 비교로 보완했다.

3. **참조·권리 보호 PASS.** `lib/repo/library.ts:14`의 UNION은 project_assets와 모든 timeline revision의 오디오 참조를 프로젝트 단위로 센다. 새 v2를 저장한 뒤 v1로 교체하여 음악이 과거 버전에만 남는 경우도 usage=1이다. 보관된 clip의 원값 보존과 변경 거절을 확인했다. 프로젝트 usesMusic가 true가 아니어도 실제 v2 music이면 필수 x.music-rights 항목이 생성되고 unchecked로 시작하며, 완전한 권리 메모도 자동 승인하지 않는다(`lib/services/review.ts:27`).

4. **0008·구앱 게이트 PASS.** `0008_timeline_audio.sql`은 INSERT guard와 기능 버전만 추가하며 기존 행을 재작성하지 않는다. `lib/db/migrate.ts:26`의 8단계 검사는 checkTimelineRows다. 비교 함수만 호출하지 않고 **T132 이전 실제 소스(HEAD^)를 git archive한 별도 E-old 앱**에서 productMigrations().length=7을 확인했다. 새 서비스가 만든 실제 v2 포함 8단계 백업 ZIP을 그 앱 restoreService.inspect에 넣은 결과 `BACKUP_TOO_NEW`, 목적지 없음이었다. 같은 구앱 checkDatabase는 실제 새 8단계 DB에 ok=false와 버전 불일치 문구를 반환했다. 고유 stdout: `T133_OLD {steps:7,zipSteps:8,code:BACKUP_TOO_NEW,destination:false,startup:{ok:false,...}}`.

5. **invalid 행/이관 rollback PASS.** 7단계 DB에 (a) 없는 audio assetId, (b) audio 아닌 kind, (c) 잘못된 timeline hash, (d) durationFrames=0 행을 각각 직접 넣은 뒤 현재 0008 migrate를 실행했다. 전부 예외이며 timeline 행, 프로젝트 포인터·버전, settings, 저널 및 sqlite_master 전체 정의가 실행 전후 동일했다. 8번 저널과 새 트리거도 남지 않았다. `T133_ROLLBACK missing/kind/hash/shape unchanged`를 기록했다. 검사 함수가 거절한다는 주장만으로 rollback을 갈음하지 않았다.

6. **실제 backup/restore PASS.** 새 v2 음악·음성 및 PCM 파일을 백업 작업이 ZIP으로 만들고 inspect/finish로 새 폴더에 복원했다. 행 전체/canonical bytes/hash와 audio 파일 sha/size가 일치했다. 추가로 고정 s7 ZIP을 현재 8단계 앱으로 inspect/finish하여 upgrade 7→8, 모든 timeline 행 동일 및 원 ZIP 해시 동일을 확인했다. 또 유효 백업 사본의 audio asset kind를 text로 위조하고 DB digest/manifest/inventory/ZIP 메타까지 새로 맞춘 새 가짜 백업은 실제 inspect에서 RESTORE_INVALID로 거절했다. 목적지와 staging이 남지 않았고 입력 ZIP도 동일했다. 단순 ZIP 손상 검사가 아닌 오디오 참조 검사 거절이다.

7. **무음 누락 차단 PASS.** `lib/render/input.ts:74`에서 v2(audio 유/무 모두)와 nonempty-v1은 AUDIO_RENDER_UNSUPPORTED와 input=null로 준비가 끝난다. browser 호출까지 도달하지 않았다. `renderInputSchema` 역시 소리 없는 v1만 허용한다(:31). 렌더 서비스 예외 처리 및 Master가 허용한 copy.ts 한 줄을 diff로 확인했다. DSP 미구현 상태를 무음 성공으로 포장하지 않는다. 실제 오디오 출력 성공을 시험한 것은 아니다.

8. **실제 화면 저장 보존 PASS(한정).** v2를 서비스에서 가짜 프로젝트에 저장하고 기존 수정·조립 화면을 열었다. 실제 자막 목록을 선택·문구 입력·「새 글자 설정 저장」을 클릭했다. 저장 전후 GET 결과에서 schemaVersion/audio/audioJoins/audioMixProfile/audioRights 전부 JSON 동일, schemaVersion=2, timeline r2→r3, 입력한 문구는 `T133 화면 저장 보존 확인`이었다. hydration 이후 실제 이벤트와 저장 응답으로 확인했으며 applyEditView 코드 판독만으로 대체하지 않았다. 스크린샷의 저장됨 r3과 변경 문구도 직접 확인했다. 이 화면에서 오디오를 새로 만들거나 조작하는 UX, 모바일/접근성 전체 검수는 아니다. 기존 s4 가짜 이미지 일부의 decode 경고가 있어 완성 미디어 재생 검수로 확대하지 않는다.

## 기대값 변경 독립 검토

T132의 모든 tests diff를 검토했다. backup-service/restore/CLI 등 “현재 제품” 기대 단계 수를 7→8로 올린 것은 새 migration을 반영한다. 0007의 실패 진단·rollback·s7 고정 스키마를 다루는 시험은 명시적 7단계 목록으로 고정하여 원래 검사의 의미를 유지한다. text-editor의 `.shape` 접근을 timelineV1Schema로 바꾼 것은 판별 합집합으로 바뀐 상위 schema API에 따른 것으로 글꼴 허용/거절 기대값은 유지됐다. 기존 필수 오류 기대를 삭제하거나 느슨하게 바꿔 회귀를 숨긴 근거는 발견하지 못했다.

다만 “s7 시험을 7단계로 고정”하면 현재 8단계 앱의 s7 복원은 그 시험만으로 증명되지 않는다. T132 보고서도 실제 구앱 ZIP 거절 미실행을 인정한다. 이번의 실제 구앱 실행과 s7→8 별도 복원으로 두 공백을 직접 보완했다. 원본 새 시험의 `.wav`는 실제 WAV가 아닌 문자열이었다. 저장 경로 시험에는 유효하지만 실제 음원 품질 근거가 될 수 없으며, 이번 보완에서 실제 PCM으로 바꿔도 기존15개가 통과했다.

## 불변 파일 증거

발행 0001~0007(0005 .cjs/shared 포함) 및 tests/fixtures 추적 파일 총 **28개**에서 HEAD^↔HEAD git blob 차이 0, 원 작업공간↔안전 복사본의 원시 SHA 차이 0이었다. tests/fixtures 자체 수정도 0이다. 고정 ZIP은 전체 시험의 전후 해시 검증을 통과했다. 상세 `E/protected-hashes.json`.

| ZIP | 크기(bytes) | SHA256 |
|---|---:|---|
| s4 | 305588 | 6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392 |
| s5 | 326195 | 5331346f66c4f8ab325c75147202167e0eb595b28d680be4bff9be0595d5e967 |
| s6 | 551206 | d1545435273cfe2971ed1873e76d180b849fee449938dc6303d1e1b75e19b3ad |
| s7 | 555424 | b861d214187bbade08136be9a36a4a8f6909ac900e52bd113ed12e46ec5e503b |

## 남은 범위와 정리

- 필수 수정 요청 없음. 허용된 저장·복원 기반 다음 단계 진입을 막는 재현 제품 FAIL은 없다. 테스트 통과를 오디오 완성으로 표현하지 않는다.
- 샘플 정밀 trim/fade/crossfade/duck/loudness, 최종 AAC decode 검사, 실제 기기/청취·음성 의미 동기화는 후속 DSP/렌더 범위다. duration_ms 기반 길이 검사는 실제 디코드 샘플 수 보장이 아니다.
- 편집용 ZIP의 오디오 원본 미포함/README 안내 부재는 T132가 공개한 후속 P2-6 범위이며 이번에 수정하지 않았다. 전체 백업 ZIP의 오디오 파일 포함/복원과 혼동하지 않는다.
- 실제 사용자 DB 이관/배포, 운영 build 재실행, 실제 렌더 E2E는 주장하지 않는다. 전체 회귀의 13 skip도 숨기지 않는다.
- 자기 개발 서버 두 실행을 각각 해당 exec 세션에서 종료했고 43133 LISTEN 없음 및 E 경로를 사용하는 node 프로세스 없음 확인. ego TaskSpace22는 finish(keep:[])로 종료했다. 시험별 가짜 DB는 afterEach 정리, 별도 UI DB/storage와 .next는 경로 확인 후 삭제했다. 원본/타인 프로세스는 종료하지 않았다. E의 소스 복사본·물리 복사 의존성·로그·harness·스크린샷 및 E-old 소스는 재현 증거로 보관하며, E-old의 원 설치 연결 junction은 unlink했다.

복사용 전달 메시지: Master께 T133 독립검수 반환합니다. aa7b0db의 P2-5A 저장·복원 기반은 확인 범위 PASS이며 제품 FAIL/필수 수정 0건입니다. 원본 전체585/13skip, lint/typecheck, 실제 이전7단계 앱의 새8단계 ZIP/DB 거절, invalid4종 이관 rollback, v2 PCM backup/restore, s7→8 복원, 실제 invalid 참조 ZIP 거절 및 실제 편집 화면 r2→r3 오디오5필드 보존을 직접 확인했습니다. 발행0001~0007·fixtures28개 바이트변경0, 자기 서버/브라우저/가짜DB 정리 완료이며 DSP/오디오 출력/배포/P2전체 완료는 주장하지 않습니다. 지정 T133 문서 한 파일만 통합 검토 부탁드립니다.
