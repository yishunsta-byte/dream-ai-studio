# T137 오디오 렌더 연결 — 독립 검수

- 검수자 CX-REVIEW-01(Codex), 구현에 참여하지 않음. task_a8082c7ccd78 / ctx_547e58a95b81, Master의 `T137 c7a0097 독립 검수·미검증항목포함 검증` 배정.
- 대상 `c7a0097cbe020cca847f03c481c1f958a88eb5fd`, T137 반환 문서 및 T136 계약. 제품 파일은 수정하지 않고 이 새 고유 보고서만 반환한다.
- **제품 판정 FAIL: 복원 정합성 필수 수정 F137-1/2(P2).** 정상 실제 렌더와 광범위한 보완 시험은 통과했지만, 독립적으로 재포장한 두 잘못된 백업이 각각 inspect·finish·checkRenderRows를 통과했다. 검수 완료와 제품 수용은 구분한다.

## 확정 스냅샷·직접 실행

`git archive c7a0097`를 OS-temp `C:/Users/Administrator/AppData/Local/Temp/dream-t137-review-1Drlma`(이하 E)에 풀었다. 공유 작업공간/WIP를 복사하거나 checkout/reset/stash하지 않았다. archive가 만든 CRLF를 그대로 사용했고 변경21파일 모두 git show와 줄끝 정규화 후 동일함을 확인했다. 원시 바이트 동일로 표현하지 않는다. 발행 migration0001~0008 및 tests/fixtures 총29파일은 대상 commit의 전후 git blob 변경0이다(`E/review-evidence/source-and-tools.json`).

FFmpeg/ffprobe·고정 Headless Shell은 **물리 사본**을 E/.tools에 만들고 시험은 그 경로를 사용했다. 설치본 변경 없음. FFmpeg SHA `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, ffprobe SHA `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`; 종료 시 설치본과 검수 사본이 각각 동일했다. 처음 node_modules는 이전 안전 설치 사본으로의 junction, 운영 빌드 단계에서는 물리 복사로 격리했다. 사용자 DB·외부 음원·실제 개인정보는 사용하지 않았다.

| 독립 실행 | 결과와 고유 증거 |
|---|---|
| T137 단위8 + T132/T134/T142 관련 | **58 PASS**, 4파일. `E/review-focused.log` |
| 실제 기존 무음9 + 신규 오디오4 E2E | **13 PASS**, 463.19초. worker→child→Remotion→FFmpeg→검사→게시→받기 직접 실행. `E/review-real-e2e.log` |
| 보완8개 | gate/실제 효과음·late cancel·6채널·짧음·deadline·child crash·ENOSPC 연결 등. `E/review-independent.log` |
| 보완2개 | 실제 worker 강제 종료/회수, 혼합 변조 ZIP 실제 복원. `E/review-recovery-forgery.log` |
| 보완2개 | voice 단독 too_short/측정 불가, **각 결함만 따로** 넣은 ZIP 실제 복원. `E/review-extra-classification.log` |
| backup/restore/0007 관련 회귀 | **66 PASS / 1 generation skip**, 5파일. `E/review-backup-regression.log` |
| lint / 타입 | 원본 확정 스냅샷에서 `eslint . --max-warnings 0`, `tsc --noEmit --incremental false`, 각각 exit0 |
| 운영 build | 물리 의존성 사본에서 `npm.cmd run build` exit0, 로컬 데이터·비밀 설정·도구 추적 없음 검사까지 PASS. `E/review-build-physical.log` |
| 실제 이전8단계 앱 | parent `0010443c52a7c2eb09e238e93b22e0ac4009c6a9` 소스 별도 archive 실행: 실제 B행 포함 9단계 ZIP은 BACKUP_TOO_NEW, 목적지 없음, 새9단계 DB startup도 ok=false. `E/review-oldgate.log` |

전체 repository 시험을 반복한 것은 아니며 위 집합별 결과를 구분한다. 보완12개는 결함을 재현하도록 만든 assertion도 포함하므로 제품 정상 PASS12로 읽지 않는다. 첫 build는 junction 외부 패키지를 Turbopack이 해석하지 못해 실패했다(`review-build.log`); 설치 내용을 물리 복사하고 원본 소스 그대로 재실행하여 통과했다. 제품 실패로 혼동하지 않는다.

주요 명령은 E에서 `node node_modules/vitest/vitest.mjs run tests/p2-5c-render-audio.test.ts tests/p2-5a-audio.test.ts tests/p2-5b-audio-dsp.test.ts tests/p2-5b-dsp-fixes.test.ts --reporter=verbose`, `DREAM_RENDER_E2E=1` 환경에서 `... run tests/p2-5c-render-audio-e2e.test.ts tests/p2-4-render-e2e.test.ts --reporter=verbose`이다. 보완 재현 원문은 `E/review-evidence/review-t137-independent.test.ts.txt`, worker 보조 원문은 `review-worker.ts.txt`에 보관했다. 실행 당시에는 .ts/.test.ts였고 build에 추가 검수 코드를 포함하지 않도록 증거 위치로 옮겼다. 보완 가짜 프로젝트는 isAd=false·글자없음·영상4초(분류 시험2초)로 구성했으며 원 s5 ZIP은 변경하지 않았다.

## 실제 렌더 및 작성자 미검증 항목 보완

| 항목 | 직접 확인 결과 / 한계 |
|---|---|
| 음악+voice duck ON 9:16 | 30초 성공, worker 최종 **I=-14.1/TP=-4.9/LRA8.2**, child 값 동일, AAC LC 48k/2ch/1트랙, 1440000샘플, 900프레임, 영상 패킷 SHA 보존. 입력 이동 기대24000샘플과 상관 최고 lag24000/score0.9851207 일치, 추가 AAC 지연 없음. 실제 받기 바이트 SHA=행 SHA |
| 형식/비율 | 실제 MP3 stereo44.1k + M4A mono44.1k + WAV 혼합16:9 성공. v2 none 1:1은 0audio stream·verify.audio 없음. 기존 무음 3비율도 직접 회귀 |
| silent / sparse click | silent accepted=null/loudness=null, 최종 TP null. click은 실제 최종 -15.8/TP-2로 AUDIO_LOUDNESS_FAILED, attempts1/결과 없음. -14±1/TP≤-1 정책 그대로 |
| 효과음 단독 | 추가 실제4초 worker/child 렌더 성공·normalized·검사/게시 통과 |
| 세 역할·duck OFF | music+voice+effect 혼합 실제4초 렌더 검증 통과, link 직후 취소를 넣어 canceledLate=true·AAC 파일 보존 확인 |
| voice 단독·2초 | 실제 렌더 succeeded, audio.status=too_short/accepted=null/loudness=null |
| 매우 작은 voice | 실제4초 child 처리에서 AUDIO_LOUDNESS_FAILED·파일 없음·attempts1 |
| AUDIO_TOO_LONG | 가짜 프로젝트18001프레임에서 preflight AUDIO_TOO_LONG{frames:18001,maxFrames:18000} 직접 확인, 전체 영상을 렌더하지 않음 |
| 6채널 / 부족한 실제 소스 | 각 실제 child 렌더 후 AUDIO_SOURCE_INVALID·파일 없음·attempts1. 짧음은 fixture의 duration_ms만 길게 두어 준비를 통과시킨 뒤 실제 디코드 길이로 거절함 |
| 오디오 단계 timeout | 실제 child에 도달하는 audio.deadline만 만료시켜 TIMEOUT·파일 없음·정리 확인. 10분 동안 정상 처리하다 제한이 걸리는 장시간 시험은 아님 |
| child 충돌 | 실제 audio stage 메시지에서 자기 child PID만 SIGKILL. RENDER_BROWSER_CRASHED로 job queued/attempts1/재시도 예약·폴더 정리 확인. 오디오 충돌 뒤 같은 job의 두번째 실제 성공까지는 반복하지 않음 |
| worker 강제 종료/재시작 회수 | 별도 실제 worker를 fork해 audio stage에서 그 worker PID만 종료. IPC disconnect 뒤 실제 child 종료 확인, lease 만료 시각으로 recover하여 queued, cleanStaleRenderTemps로 남은 폴더0. 회수 뒤 새 worker의 전체 재렌더 성공까지는 반복하지 않음 |
| 쓰기 ENOSPC | 기존 DSP 부분쓰기 ENOSPC 회귀 + worker attempt 반환 경계의 DISK_FULL 주입에서 영구 실패/attempts1/파일·폴더 없음 확인. **실제 audio child의 쓰기 syscall에 ENOSPC를 주입한 full E2E는 아님** |
| 중복/CAS | 같은 요청 두 번은 동일 render/job의 existing=true. 다른 창 역할/소리 수정 저장 뒤 이전 revision/id 요청은 CONFLICT |
| 소리만 변경한 stale | 실제 성공 뒤 gain만 수정 저장: 이전 결과 stale=true, 다음 결과 textOnlyChange=false |
| B 백업 | 실제 성공 AAC 행을 실제 backup job으로 ZIP 생성→새 폴더 inspect/finish. input/verify JSON 동일, 출력 파일 SHA 동일, checkRenderRows 통과. 구8앱의 실제 새9 ZIP 거절도 별도 확인 |

T136의 모든 비율×모든 역할×duck 조합 전체를 실행한 것은 아니다. 실제 청취·명료도·pumping·화면 배치/미리듣기·실제 기기 재생은 미검증이다. 무음 A 회귀/다운로드/보관·취소·동작 중 파일 변경은 기존 실제9개에서 직접 확인했다. 수치적 합격을 귀로 들은 품질이나 전체 P2 완료로 확대하지 않는다.

## 필수 F137-1 · P2 — 모순된 audio 검증 기록을 정상 백업으로 복원함

- 위치: `lib/db/render-data.ts`의 `audioVerifyOk` 및 `checkRenderRow`, 복원 경로의 `checkRenderRows`.
- 현재 판정은 mode/profile/status, normalized의 accepted=true, final 값의 유한 여부 정도만 본다. normalized의 final이 실제 허용 범위 안인지, 필요한 검증 세부 구조/값이 입력·기준과 일치하는지 읽어 확인하지 않는다.
- 직접 재현: 실제 성공 B/AAC 렌더를 백업했다. **검수용 사본 DB에서만** immutable guard를 잠시 제거하고 `verify_json.audio.final.integrated=999`, `truePeak=999`로 바꾼 뒤 guard 정의를 원복했다. 입력 타임라인과 파일은 그대로다. 새 backupId로 DB digest·inventory·ZIP digest·메타를 모두 맞춘 새 ZIP을 만들었다.
- 실제 결과: `inspectAccepted=true`, `finishAccepted=true`, `checkRowsAccepted=true`. 복원된 행은 status=succeeded, audio.status=normalized, accepted=true와 999 LUFS/999 dBTP를 동시에 보존한다. `REVIEW_INDEPENDENT_FORGERY {mode:"verify-only",...}`가 고유 증거다. 단순 손상 ZIP 검사가 아니라 정합성 검사의 누락이다.
- 재현은 트리거를 거치지 않은 재포장 백업을 검사한다는 이 함수의 명시 목적과 같은 경계다. 실제 사용자 DB나 원본 백업은 수정하지 않았다. OS/서명 보안이나 모든 악의적 변조 방어를 새로 요구하는 것이 아니다.
- 최소 수정 필요: B mix의 보관 결과 기록을 명시 schema/상호 규칙으로 검증하고 normalized accepted=true라면 현행 final I/TP 수치와 합격 의미가 일치해야 한다. tools/sources/output 등 필수 증거와 audioPlan의 연결도 검증할 범위를 명시해야 한다. silent/too_short의 null 수치와 accepted=null 정책은 보존한다. 이미 발행된 A의 옛 최소 행을 새 규칙으로 재해석하지 않는다.
- 완료 조건: verify-only ZIP을 inspect/finish의 정합성 단계에서 거절하고 목적지/자기 staging이 남지 않아야 하며 정상 B ZIP 및 기존 A 복원은 유지돼야 한다.

## 필수 F137-2 · P2 — B의 실제 embedded timeline이 주장한 timelineSha256에 묶이지 않음

- 위치: `lib/db/render-data.ts:checkRenderRow`의 saved timeline binding. DB행의 sha와 input의 **문자열 timelineSha256끼리**만 비교하며 input.timeline의 canonical 실제 hash와 대조하지 않는다. `renderInputAudioSchema`/audioPlanIssue도 이를 보완하지 않는다.
- **F137-1과 분리한** 새 ZIP 재현: 정상 백업에서 오디오 검증 기록과 실제 MP4는 전혀 바꾸지 않고 `input_json.timeline.audio[0].gainDb`만 -12로 바꿨다. input_json 자체의 input_sha256은 다시 계산하고, 원래 timelineSha256·timeline row·revision/포인터·job 바인딩은 그대로 뒀다. guard 정의를 복구하고 ZIP 전체 digest/메타도 맞췄다.
- 실제 결과: embedded timeline canonical hash는 주장한 timelineSha256과 다른데 `inspect→finish→checkRenderRows`가 모두 수용했다. 고유 로그 `REVIEW_INDEPENDENT_FORGERY {mode:"timeline-only",inspectAccepted:true,finishAccepted:true,checkRowsAccepted:true}`. 별도 DB probe에서도 실제 embedded hash `9bc69c8c…`와 주장한 `26f20010…`가 다르면서 검사가 통과했다.
- 영향: “이 고정 타임라인 버전/해시의 결과”라는 오디오 설정 연결을 복원 후 신뢰할 수 없다. 단지 input JSON의 새 자체 hash가 맞는 것으로 saved timeline 바인딩을 갈음한다. 새 B 계약의 “clip/rights는 timelineSha256으로 묶인다”는 설명과 다르다.
- 최소 수정 필요: 새 B에서는 정규형 input.timeline의 실제 checksum이 주장한 timelineSha256 및 그 saved timeline과 일치하는지 확인한다. 필요하면 관련 job input snapshot checksum과의 연결도 명시한다. 기존 A의 과거 계약을 임의 변경하거나 이미 저장된 행을 다시 쓰지 않는다.
- 완료 조건: timeline-only ZIP의 실제 inspect/finish 거절, 정상 B·A 보존 및 원래 CAS/stale 동작 유지가 필요하다.

## 기대값 변경·보호·정리

기존 시험의 단계 수8→9 변경과 T132의 v2 렌더 차단→B 수용 변경은 새 기능에 따른 기대값이다. v1 nonempty audio 거절은 유지된다. A를 최소 역사 입력까지 허용한 T137의 계약 조정은 보고서에 공개돼 있고 기존 무음9개·0008→0009 행 전체 보존 검사가 통과했다. 위 두 결함을 그 기대값 변경이 직접 숨겼다고 단정하지 않으며, 새 B 복원 정합성 시험이 빠진 것으로 구분한다.

시험별 가짜 DB/음원/영상은 teardown으로 정리했다. 실제 worker/child 종료 시험은 자신의 기록된 PID만 종료했고, 모든 시험 종료 뒤 dream-t137-* 명령줄의 관련 native/Node 프로세스0을 확인했다. 원본/타인 프로세스는 종료하지 않았다. 증거 audit 후 E의 물리 node_modules·도구/브라우저 사본·.next·bundle cache를 경로 검증 후 삭제했고 old-app dependency junction도 unlink했다. E와 E-old의 소스 사본·로그·검수 harness/JSON은 재현 증거로 보관했다. 설치 도구, 고정 fixture, 공유 제품/문서에는 쓰지 않았다.

복사용 전달 메시지: Master께 c7a0097 T137 독립검수 반환합니다. 관련58·backup66/1skip·실제 기존/신규 렌더13 및 lint/type/build가 통과했고 작성자 미검증의 효과음·duckOff·2초voice·6채널/짧음·timeout·child/worker 종료·late cancel·중복/CAS·stale·B백업을 보완했습니다. 그러나 verify-only 999 LUFS/999 dBTP 기록과 timeline-only checksum 불일치 B ZIP이 각각 실제 inspect/finish를 통과하는 F137-1/2(P2)로 제품 판정 FAIL입니다. 고유 보고서만 통합하고 B 복원 정합성 보완 후 재검수 부탁드리며 전체 역할×비율 조합·실제 청취·native child 쓰기 ENOSPC는 미검증으로 유지합니다.
