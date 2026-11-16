# T141 — T140 cleanup 집중 독립 재검수

- 검수자 CX-REVIEW-01(Codex), T140 구현에 참여하지 않음. Master T141 배정에 따라 이 고유 보고서만 작성했다.
- 대상 `a775a472e79ba08bb5073f195816a9774f0ab3aa` 및 `T-140-AUDIO-CLEANUP-TOOL-AUDIT.md`.
- **판정: FAIL — F139-1의 원재현은 해결됐으나 cleanup 완료를 잘못 선언하는 잔여 F141-1(P2)을 오류 주입으로 재현했다.** 정상 DSP 성공과 cleanup 상태의 정확성을 구분한다. 범위 내 검수는 완료했지만 모듈 전체 bounded PASS는 권고하지 않는다.
- 제품·공유 문서·T137 WIP·사용자 자료·설치 도구·기존 증거는 수정하지 않았다. 외부 음원, 사용자 DB, 서버/브라우저 실행 없음.

## 스냅샷·도구·실행

현재 공유 작업공간을 복사하지 않고 `git archive a775a47`로 고정 스냅샷을 만들었다. 이하 E는 `C:/Users/Administrator/AppData/Local/Temp/dream-t141-CY1vKX`이다. archive가 만든 CRLF를 그대로 사용했다. mix/run/profile 및 원본 두 시험의 git show 대비 줄끝 정규화 후 내용 동일을 확인했으며 raw 바이트 동일로 표현하지 않는다(`E/t141-source-hashes.json`). 제품 소스는 사본에서도 수정하지 않았다.

FFmpeg/ffprobe 설치본은 처음/마지막 해시 확인과 복사에만 읽었다. **모든 오디오 시험의 도구 경로는 E/tools의 물리 exe 사본**으로 지정했으며 모듈은 다시 자기 work/tools 사본을 실행했다. 도구 변경 시험의 fail-closed 보호도 실행했다. node_modules만 이전 안전 복사본을 읽는 junction이었다. 추가 시험은 E/tests에만 만들었다.

| 독립 실행 | 결과 |
|---|---|
| 원본14 + 수정19 | **33/33 PASS**, 2파일, 50.72초. `E/t141-original.log` |
| lint | `node node_modules/eslint/bin/eslint.js lib/audio tests/p2-5b-audio-dsp.test.ts tests/p2-5b-dsp-fixes.test.ts --max-warnings 0` exit0 |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit0 |
| 독립 보완5개 | 두 종류 cleanup 동시 실패, primary 객체/상세 보존, 경쟁 파일 보호, work/staging의 false complete 각각 재현. `E/t141-independent.log` |
| 전체 회귀/build | 이번 집중 범위에는 필요하지 않아 반복하지 않음. T140 작성자618/13skip을 이번 독립 실행으로 세지 않음 |

원본 명령은 E에서 FFMPEG_PATH/FFPROBE_PATH를 **E/tools/ffmpeg.exe·ffprobe.exe**로 설정한 뒤 `node node_modules/vitest/vitest.mjs run tests/p2-5b-audio-dsp.test.ts tests/p2-5b-dsp-fixes.test.ts --reporter=verbose`이다. 독립 재현 원문 `E/tests/t141-independent.test.ts`는 같은 도구 사본 경로를 직접 사용하며 `node node_modules/vitest/vitest.mjs run tests/t141-independent.test.ts --reporter=verbose`로 실행했다. 독립5개의 통과는 관찰/결함 재현 assertion 통과이며 제품 PASS 5건이라는 뜻이 아니다.

## F139-1 해결 및 기존 기준 보존 — 직접 확인 PASS

- **정상:** normalized/accepted=true, cleanup complete=true/left=[], 실제 work/part 없음.
- **commit 뒤 work EBUSY, 취소 유/무:** 실제 link 뒤 결과 성공이 유지되고 검증 결과 SHA와 파일 SHA가 같다. cleanup complete=false, 이름만 있는 work1개를 보고하며 실제 남은 work와 일치한다. 정리 실패가 더 이상 raw EBUSY로 성공 반환을 덮지 않는다.
- **commit 뒤 staging EBUSY:** 성공 파일이 유지되고 cleanup.left에 staging1개가 나온다. 남은 hard-link 이름을 제거해도 게시 파일 SHA는 유지된다.
- **commit 전 primary 오류 + work EBUSY:** VIDEO_MISMATCH/CANCELED가 그대로 유지되고 cleanup complete=false이다. 결과 파일은 생기지 않는다. 정상 정리라면 같은 VIDEO_MISMATCH에 cleanup complete=true가 붙는다.
- **추가 독립 확인:** work와 staging 둘 다 EBUSY여도 정상 결과는 성공이며 두 이름을 정확히 보고했다. onWork에서 직접 만든 `AudioError(SOURCE_CHANGED, primary message, primary detail)`를 던지고 work EBUSY를 주면 **같은 error 객체 identity와 code/detail**가 보존되고 cleanup만 추가된다. 경쟁자 sentinel을 만든 뒤 link 실패 + work/part 양쪽 EBUSY를 주면 OUTPUT_EXISTS, sentinel 바이트 그대로, 두 cleanup 이름 보고였다.
- **원4 수정 기준:** 도구 사본/현재 요청 해시/다음 요청 fresh hash/기대 해시 거절/실제 2pass 도구 비교, part 부분쓰기 ENOSPC/hash EIO/link 실패/경쟁 sentinel, 최종 ebur 뒤 취소/deadline 및 정상 commit 뒤 취소 의미, 실제 2초·6초·25fps 거절과 정상 영상 패킷 SHA/샘플 보존이 원본33 재실행에서 통과했다. O135 다중 stream 거절과 onWork 정리도 유지됐다.
- **기존 DSP:** trim/gain/fade/equalPower/music-only duck 및 무음 voice의 음악 지속, 정상 AAC 재측정, 원본 불변, silent/too_short/no_audio/작은 소리 측정 불가 분리가 유지됐다. 프로필 p2-5-local-v1, -14 LUFS±1·TP≤-1, sparse click LOUDNESS_OUT_OF_RANGE 실패 정책을 바꾸지 않았다. 직접 청취나 명료도 판단은 하지 않았다.

## F141-1 · P2 · 삭제 오류 뒤 존재 확인의 false를 “정리 완료”로 확정

위치: 대상 `lib/audio/mix.ts` 마지막 `cleanUp`. rmSync 오류를 모두 무시한 후 `existsSync`가 true인 경우만 left에 넣고, left가 비면 complete=true로 반환한다. 삭제 오류 자체나 존재 확인 실패/불확실 상태를 보존하지 않는다.

독립 재현은 다음과 같다.

1. 자체 생성4초 음원을 실제 도구 사본으로 믹스·정규화·검증하고 실제 linkSync로 게시한다.
2. 대상 work 또는 staging의 삭제에는 EBUSY를 주입한다. **그 삭제 실패 경로에 대한 후속 existsSync만 false**로 모의하여, 접근/조회 실패로 부재를 확정할 수 없는 상황을 모델링한다. 도구 실행/PCM/음량/게시 결과는 모의하지 않는다.
3. mocked existsSync를 쓰지 않는 실제 fs.readdirSync로 남은 이름을 별도 확인한다.

두 경우 모두 다음 결과였다(`T141_FALSE_COMPLETE`, `E/t141-independent.log`).

| 대상 | 반환 | 별도 실제 파일시스템 확인 |
|---|---|---|
| work | normalized, accepted=true, **cleanup={complete:true,left:[]}** | dream-audio 작업 폴더1개가 실제로 남음 |
| staging | normalized, accepted=true, **cleanup={complete:true,left:[]}** | 자기 .part hard-link 이름1개가 실제로 남음 |

게시 파일 SHA는 계속 검증된 SHA와 같았다. 즉 오디오 성공 자체를 뒤집어야 하는 문제가 아니라 **정리 미완료를 완료로 잘못 알리고 재정리 이름도 잃는 문제**다. T140의 “정리를 다 못 했으면 complete=true로 쓰지 않는다”는 계약을 만족하지 않는다.

**증거의 한계:** 실제 Windows ACL/디스크 고장을 발생시킨 시험은 아니다. EBUSY와 확인 불가를 나타내는 false 반환을 명시적으로 주입한 오류 경계 시험이다. 정상적인 단순 EBUSY에서는 existsSync가 true여서 기존33은 정확히 보고한다. 적극적 다른 프로세스/ABA 공격을 가정하거나 OS 격리를 요구하지 않는다. false 확인을 신뢰해 불확실성을 없애는 현재 분기 자체가 위 재현의 대상이다.

최소 수정 필요: 삭제 오류 뒤에는 `existsSync=false`만으로 부재/완료를 확정하지 않는다. 예를 들어 오류를 구분할 수 있는 확인(lstat 등)을 보호된 try/catch로 수행하여 **ENOENT처럼 부재가 확인된 경우만 완료**, EACCES/EIO 등 확인 불가 상태는 complete=false와 자기 이름/불확실 상태로 보존한다. 또는 삭제 실패 자체를 보수적으로 미완료로 보고한다. 이미 확정된 게시 성공이나 원래 primary 오류를 다시 덮어서는 안 된다.

재검수 조건: work/staging 각각 삭제 실패+확인 불가에서도 false complete가 없고, F139-1의 정상/늦은 취소/EBUSY/primary 오류 보존/경쟁 파일 보호를 모두 유지해야 한다. keepWork로 의도적으로 보관한 work를 삭제 실패로 재분류하라는 요구는 아니다.

## 도구 복구 보고 — 사실과 추정 분리

설치 파일을 읽어 원래 ZIP에서 `tar -xOf`로 꺼낸 Buffer와 **전체 바이트 비교**했다. 새 패키지를 다운로드하거나 설치본을 교체하지 않았다. 현재 결과는 다음과 같다(`E/t141-package-audit.json`).

- 원래 ZIP SHA: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
- 현재 설치본/패키지/검수 도구 사본 FFmpeg 모두 SHA `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`, 105423872바이트, 전체 바이트 동일.
- ffprobe 모두 SHA `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`, 105221120바이트, 전체 바이트 동일.
- 시험 시작/종료 설치본과 원 도구 사본 해시는 각각 위 값으로 동일했다(`E/t141-tools-before.json`, `E/t141-tools-after.json`). 정상 반환과 loudness.stats의 실행 도구 기록도 현재 FFmpeg 사본 SHA와 일치했다.

이는 **현재 복구 결과**에 대한 직접 증거다. T140 담당자가 복구한 행위 자체를 직접 관찰한 것은 아니고 과거 변조 주체/시점도 이번에 확정하지 않았다. T139 당시 실행한 e957… 해시 기록을 현재325…로 소급 교체하지 않는다.

**R141-1 / P3 보고서 숫자 정정 필요:** T140 1.1은 0x50의 “원래0x97/변경0x69/XORff”라고 썼지만 현재 패키지와 설치본의 해당 바이트는 **0x69(105)**다. 이전 T139에서 관찰한 변경 SHA e957…는 그 바이트를 XORff한 **0x96(150)** 상태와 일치한다. 따라서 byte 설명은 원래0x69→변경0x96으로 고쳐야 한다. 전체 SHA 복구 결과가 일치한다는 직접 검증과 이 문구 오기를 분리한다. T140 문서는 허용 범위 밖이라 수정하지 않았다.

## 정리·반환

오류 주입으로 남긴 work/part는 주입 해제 후 자기 temp root에서 정리했다. 모든 합성 음원/영상·모듈 도구 사본·test root는 teardown으로 제거했고, 시험 후 해시 동일을 확인한 E/tools 원 사본도 삭제했다. 설치본에 쓰기/복구 작업은 하지 않았다. 자기 관련 Node/FFmpeg/ffprobe 프로세스0을 명령줄로 확인했다. E의 소스 스냅샷·로그·검수 스크립트·해시 JSON은 증거로 보관하고 node_modules junction은 unlink했다.

복사용 전달 메시지: Master께 T141 집중 독립검수 반환합니다. 고정a775a47·도구 물리사본에서 33/33과 lint/type은 통과했고 F139-1 원재현은 해결됐지만, 삭제 오류 뒤 존재 확인 false를 완료로 확정하는 F141-1(P2)을 work/part 각각 재현하여 제품 판정 FAIL입니다. 현재 설치본은 원래 ZIP과 전체 바이트·SHA가 같고 시험 전후 보존됐으며 과거 실행 SHA는 소급하지 않았습니다. T140 byte 숫자 오기 R141-1도 기록했고 고유 보고서만 통합 및 잔여 cleanup 상태 보완 후 재검수 부탁드립니다.
