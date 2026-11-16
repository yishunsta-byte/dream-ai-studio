# T144 봉투 B 복원 정합성 — 독립 재검수

- 담당 CX-REVIEW-01(Codex), 수정 작성에 참여하지 않음. task_5b73f67bfc28 / ctx_6e34a570f0df의 `T144 e5eab1f 보고서확인 후 재현검수` 배정.
- 대상 `e5eab1fb67e27518b2c3422ffba27f19bab9b392`와 T144 반환 문서, 원지적 F137-1/2.
- **판정: bounded PASS — F137-1/2 원재현을 닫음. 이번 범위의 새 필수 수정 0건.** 실제 MP4 백업과 finish 경로까지 직접 확인했다. 전체 오디오 기능·모든 복원 공격·전체 P2 완료 판정은 아니다.
- 이 새 보고서만 변경했다. 제품/공유 문서/설치 도구/사용자 DB/기존 증거는 수정하지 않았다.

## 고정 환경과 실행 결과

공유 작업공간을 가져오지 않고 `git archive e5eab1f`를 OS-temp `C:/Users/Administrator/AppData/Local/Temp/dream-t144-recheck-bkZkjV`(이하 E)에 풀었다. archive의 CRLF를 그대로 사용했다. 변경3파일 모두 git show와 줄끝 정규화 후 동일하며 raw 바이트 동일로 표현하지 않는다. migration·fixtures의 commit 전후 변경0도 확인했다(`E/recheck-audit.json`).

검증 도구는 설치본을 **물리 복사**한 E/.tools의 FFmpeg/ffprobe 및 pinned Headless Shell이었다. node_modules는 이전 안전 설치 사본에 대한 읽기 junction이었다. native 도구 설치본을 직접 실행하거나 변조하지 않았다. 모든 DB는 OS-temp 가짜 s5 사본, 음원은 lavfi 합성 pink noise이며 외부 음원/실제 사용자 자료는 사용하지 않았다.

| 실행 | 실제 결과 |
|---|---|
| 새4 + T137 단위8 + backup/restore/s7/render DB 관련 | **73 PASS / 1 generation skip**, 6파일. `E/recheck-original.log` |
| 변경 파일 lint | `node node_modules/eslint/bin/eslint.js lib/db/render-data.ts tests/p2-5c-restore-integrity.test.ts --max-warnings 0` exit0 |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit0 |
| 실제 MP4 독립 보완 | **7/7 PASS**, native render 한 번 + 정상 복원/두 inspect 거절/두 upgrade finish 거절/두 최종 semantic finish 거절. `E/recheck-real.log` |
| 수정 전 대조군 | 실제 c7a0097 archive에 새 시험 파일만 복사해 실행: **1 PASS / 3 FAIL**, exit1. `E/recheck-old-control.log`. 실패는 새 API 부재가 아니라 두 inspect가 거절하지 않고, 허용 밖 -16 기록을 행 검사에서 거절하지 않는 행동 차이였다 |

원본 명령은 E에서 `node node_modules/vitest/vitest.mjs run tests/p2-5c-restore-integrity.test.ts tests/p2-5c-render-audio.test.ts tests/s7-fixture.test.ts tests/restore.test.ts tests/backup-service.test.ts tests/p2-4a-renders-db.test.ts --reporter=verbose`이다. 독립 보완 원문은 `E/tests/review-t144-real.test.ts`, 명령은 같은 runner로 해당 파일을 실행했다. 대조군은 E-control에 따로 두어 대상 원본을 되돌리거나 수정하지 않았다.

전체632/17skip·운영 build·실제13 E2E는 T144 작성자 보고이며 이번에 반복한 수가 아니다. 변경이 row 검사에 한정돼 관련 회귀와 실제 결과 한 건에 집중했다. 이전 T137의 13개 독립 native 렌더 증거와도 구분한다.

## 직접 재현 — F137-1/2 해결

### 1. 실제 worker 결과와 정상 B 백업 보존

가짜 프로젝트를 isAd=false/글자없음/4초로 만들고 4초 합성 pink 음원을 사용했다. 요청→job claim→실제 render child→Remotion muted 영상→DSP/AAC 결합→worker 검증→게시를 실행했다. stand-in MP4가 아니다.

- status=succeeded, 최종 audio **I=-14.3 LUFS / TP=-3.7 / LRA0**.
- 실제 MP4 SHA `2419c763f6c26a49c8f01e3e1693b535f0446b25f6187f607d1ec0f67bd73d02`.
- 새 checkRenderRows를 실제 worker의 전체 기록이 통과했다.
- 실제 backup job이 만든 ZIP을 새 폴더로 inspect/finish했다. input_json·verify_json 원문이 동일하고 MP4 SHA도 원 행과 같았다. 복원 후 checkRenderRows 통과했다.

### 2. 실제 MP4가 든 원지적 변조 ZIP 두 개 — 각각 inspect 거절

정상 결과의 DB 사본에서만 render guard를 잠시 제거한 뒤 원복하고, 두 원지적을 **서로 독립적으로** 만들었다.

- F137-1: `verify_json.audio.final.integrated=999`, `truePeak=999`만 변경. 입력 타임라인/MP4는 그대로.
- F137-2: `input.timeline.audio[0].gainDb=-12`만 변경하고 input_sha256을 다시 계산. saved timeline/claimed timelineSha256/정상 verify/MP4는 그대로.

각각 새 backupId·DB digest·inventory·ZIP digest·메타를 맞췄다. 둘 다 실제 inspect에서 **RESTORE_INVALID**, 목적지 없음·`.dream-restore-*`0이었다. 원 ZIP SHA/크기도 전후 동일했다. 새 schema가 두 변조를 실제 파일 포함 경로에서 거절하므로 작성자가 남긴 “stand-in만 사용” 공백을 보완했다.

### 3. inspect 이후 실제 upgrade finish에서 다시 거절

위 두 종류의 잘못된 DB 사본에 대해 가짜 pre-0009 상태(journal8, 0009 trigger 없음)를 만들어, 현재 앱의 업그레이드 복원 경로를 선택했다. 이것은 **실제 구8앱이 발행한 정상 B 백업이라는 주장이 아니라** 구 구조에서 넘어오는 잘못된 행을 검사하는 합성 fixture다.

각 ZIP은 inspect에서 compat=upgrade/from8/to9를 반환했다. finish가 0009를 적용하고 행 검사를 수행할 때 두 경우 모두 **BACKUP_UPGRADE_FAILED**로 거절했다. 목적지·staging 없음, 입력 ZIP SHA/크기 동일이었다. inspect의 선행 거절만 보고 finish를 추정한 것이 아니다.

### 4. 정상 inspect 뒤 최종 semantic 재검사 거절

정상9단계 ZIP의 inspect를 먼저 통과시킨 후, 복원 서비스의 기존 test-only `onStage("upgraded")` hook에서 자기 staging DB에 위 변조를 각각 넣었다. 이후 normalize가 끝나고 새 DB digest를 계산한 뒤의 최종 검사도 두 경우 모두 **RESTORE_INVALID**였다. 목적지와 staging은 남지 않았다.

이 단계에서는 normalize 이후 digest가 변조된 DB를 기준으로 계산되므로, 이전 DB digest가 달라졌다는 단순 해시 차단으로 갈음하지 않고 **새 행 정합성 검사의 재실행**을 확인한다. hook 주입 위치는 두 경우 모두 같은-version9 복원의 “upgraded” 단계 이름이며, 실제8→9 적용 실패는 앞 절에서 따로 실행했다.

## 수정 코드와 회귀 판정

- `renderAudioRecordSchema`의 strict 구조, plan의 두 도구 SHA·sources 1:1, 고정 target, mix/output 샘플 수 및 normalized 최종 I/TP 허용 범위를 확인했다. 새 시험의 16개 단일 필드 변조가 거절됐고 silent/null 정책의 정상 행은 통과했다. raw media를 복원 때 다시 믹스하거나 모든 과거 측정의 진위를 암호학적으로 증명하는 검사라는 뜻은 아니다.
- B의 `canonicalJson(input.timeline)`이 saved timeline 원문과 같고 그 sha도 claimed 값과 같아야 한다. source count만 검사하며 embedded timeline을 놓치던 원지적은 실제 변조 ZIP으로 거절됐다.
- 새 검사는 B에 한정되고 기존 A 판정은 유지된다. 관련 s7·기존 render DB·restore/backup 회귀가 통과했으며 발행 migration/fixture를 수정하지 않았다.
- 프로필 p2-5-local-v1와 -14±1/TP≤-1 기준, silent/too_short의 accepted=null 정책 및 sparse click 실패 정책을 변경하지 않았다. 이번 native seed는 normalized 한 건이며 실제 silent/too_short/전 비율·역할 matrix를 새로 생성한 것은 아니다. 직접 청취·기기 재생·화면 검수는 하지 않았다.

## 도구·자료 정리와 반환

현재 설치본과 검수 사본의 종료 SHA는 FFmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`로 동일했다. 이전 세션의 e957… 기록은 변경하거나 소급하지 않았다.

모든 가짜 DB·합성 원본·MP4·복원 staging은 afterAll에서 제거했다. 자기 관련 Node/FFmpeg/ffprobe/Headless Shell 프로세스0을 확인했다. audit 후 자기 도구/브라우저 사본과 bundle cache를 경로 확인 후 지우고 E 및 E-control 의존성 junction을 unlink했다. E의 소스·로그·검수 harness·JSON 및 대조군 소스는 재현 증거로 보관한다. 설치본·타인 프로세스·기존 증거에는 정리 작업을 하지 않았다.

복사용 전달 메시지: Master께 e5eab1f T144 독립재검수 반환합니다. 관련73/1skip·lint/type 및 실제 MP4 기반 독립7개가 통과했고 F137-1/2의 각각의 변조 ZIP은 inspect에서 거절됐으며 정상 B 행/파일 보존과 upgrade/final finish 재검사 거절까지 직접 확인해 bounded PASS입니다. 수정 전 c7a0097 대조군은 같은 새 시험에서 정상1통과·원지적3실패였고 이번 범위의 새 필수 수정은 없습니다. 고유 재검수 보고서만 통합 검토 부탁드리며 전체 P2·모든 matrix·실제 청취 완료는 주장하지 않습니다.
