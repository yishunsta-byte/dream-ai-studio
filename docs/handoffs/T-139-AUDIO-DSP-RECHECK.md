# T139 — T138 오디오 DSP 수정 집중 독립 재검수

- 담당 CX-REVIEW-01(Codex), T134/T138 구현에 참여하지 않은 독립 검수자. Master T139 배정에 따른 보고서 한 파일만 작성했다.
- 대상 `93806df117cd1dcf6916d41cec54cbdba0b9d04a`, T138 보고서 및 원지적 T135 F135-1~4/O135-1~2.
- **판정: FAIL — 원지적 재현과 관찰 수정은 통과했지만 commit 후 정리 오류가 성공 반환을 덮는 잔여 필수 결함 F139-1(P2)이 있다.** 검수 과업 완료와 제품 수용을 구분한다. 현재 모듈 전체 bounded PASS를 권고하지 않는다.
- 제품/DSP·공유 문서·도구 설치본·사용자 자료·기존 증거는 수정하지 않았다. 공유 T137 WIP를 읽어 복사하거나 stage/reset/stash하지 않았다.

## 확정 스냅샷·실행

현재 worktree를 복사하지 않고 `git archive 93806df`를 OS-temp에 풀었다. 이하 E는 `C:/Users/Administrator/AppData/Local/Temp/dream-t139-kpAcdB`이다. archive의 저장소 속성에 따라 소스는 CRLF이며 검수 중 재작성하지 않았다. lib/audio 5파일과 두 원본 시험 총7파일은 git show와 줄끝 정규화 후 동일하다. raw bytes 동일이라고 표현하지 않는다(`E/t139-source-hashes.json`). 추가 검수 시험은 E에만 새로 작성했다.

의존성은 이전 안전 복사본의 node_modules를 읽는 junction으로 연결했다. native 도구는 기존 `D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`와 `ffprobe.exe`를 읽었다. 현재 도구 해시의 역사적 차이는 아래 별도 관찰에 명시한다. 모든 음원·영상은 lavfi로 자체 생성한 OS-temp 파일이며 외부 음원·사용자 DB를 사용하지 않았다.

| 독립 실행 | 실제 결과 |
|---|---|
| 원본14 + 새12 | **26/26 PASS**, 2파일, 39.32초. `E/t139-original.log` |
| 집중 lint | `node node_modules/eslint/bin/eslint.js lib/audio tests/p2-5b-audio-dsp.test.ts tests/p2-5b-dsp-fixes.test.ts --max-warnings 0` exit0 |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit0 |
| 추가 독립5개 | ffprobe 실제 사본/기대해시/다음요청, PCM 변경, pinned ffprobe 변경, commit후 정리 실패, 지원하지 않는 link/foreign part 보호를 실행. **5개 관찰 재현**, `E/t139-independent.log` |
| commit후 재현 분리 | 취소 있는 경우와 취소 없는 경우 2개 재현. `E/t139-postcommit.log`, 필터로 제외된4개는 이번 실행에서 재실행하지 않은 것. 오류를 확인하는 assertion 통과를 제품 PASS로 세지 않음 |

원본 실행 명령: E에서 FFMPEG_PATH/FFPROBE_PATH를 위 경로로 설정한 뒤 `node node_modules/vitest/vitest.mjs run tests/p2-5b-audio-dsp.test.ts tests/p2-5b-dsp-fixes.test.ts --reporter=verbose`. 추가 재현 원문은 `E/tests/t139-independent.test.ts`이며 `node node_modules/vitest/vitest.mjs run tests/t139-independent.test.ts --reporter=verbose`, commit후만은 `-t postcommit`으로 실행했다. 변경 범위와 실패 비용에 맞춰 전체611 회귀나 운영 build는 반복하지 않았다. T138의 전체611/13skip은 작성자 보고이며 이번 독립 실행 수가 아니다.

## 원지적 집중 재현 결과

### F135-1 — 제한된 로컬 도구 바인딩 PASS

새 시험을 직접 재실행하여 설치본 **사본**의 동일 size/mtime DOS stub 변경, 현재 요청의 고정 tools 사본 실행, 다음 요청 fresh hash, 이전 기대 SHA 거절, pinned ffmpeg 자체 변경 후 실제 두번째 pass 전 STATS_MISMATCH를 확인했다. ffmpeg/ffprobe를 경로·size·mtime 캐시로 믿는 이전 코드는 제거됐다.

추가로 ffprobe도 동일하게 검증했다. 실제 실행 직전에 각 binary 파일의 SHA를 읽어 기록했으며 **9번 모든 실행 경로가 해당 work/tools 내부 사본**, 각 실행 바이트 SHA가 결과 tools의 해당 SHA와 같았다. 첫 loudnorm 뒤 OS-temp의 설치 ffprobe 사본만 변경해도 현재 요청은 이전 사본으로 정상 완료했다. 다음 요청은 새 해시를 보고하고 이전 ffprobeSha256 기대값을 주면 TOOL_CHANGED였다. size와 mtime이 동일하다는 것도 별도 assertion으로 확인했다.

- ffprobe 이전 SHA `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`
- 변경 사본의 다음 요청 SHA `4ccf095cbc27bb595274c1e13145c9e9b762097ec50e8a2897b89cbd01319e27`
- PCM 자체도 첫 측정 후 1바이트를 바꿔 **실제 파일 재해시**가 STATS_MISMATCH를 내고 결과/work가 없음을 확인했다. 같은 변수끼리만 비교하는지 보는 unit 호출로 갈음하지 않았다.
- pinned ffprobe 사본을 첫 probe 후 바꾸면 실제 후속 도구 실행은 가능했지만 게시 직전 TOOL_CHANGED로 차단하고 결과를 남기지 않았다.

이는 신뢰된 로컬 앱/소스/도구 및 작업 폴더 경계에서의 바인딩이다. 다른 프로세스의 적극적 사본 변조를 막는 OS 격리나 확인 사이 변조 후 원복(ABA) 방어는 확인하지 않았고 보장으로 추정하지 않는다.

### F135-2 — commit 전 실패/경쟁 보호 PASS, commit 후 잔여 FAIL은 아래 F139-1

실제 DSP 뒤 `.part`에 PARTIAL-AUDIO를 기록하고 ENOSPC를 주입하면 DISK_FULL이며 목적지·자기 part·work가 없었다. 복사 뒤 part 재해시에서 EIO를 주입하면 TOOL_FAILED/EIO이며 역시 목적지와 part가 없었다. 과거의 “게시 후 목적지 hash에서 EIO”를 그대로 반복한 것은 아니다. 새 설계는 **목적지 이름을 만들기 전 자기 part에서 검증**하므로 대응되는 실패 지점이 바뀌었다.

link 직전 경쟁 sentinel은 OUTPUT_EXISTS, `EXTERNAL-SENTINEL` 바이트 유지였다. link ENOSPC는 DISK_FULL·목적지 없음이었다. 추가로 ENOTSUP link 오류를 주입해 TOOL_FAILED/ENOTSUP·목적지 없음·자기 work 없음과 별도의 `.foreign.part` 내용 보존·원본 SHA 불변을 확인했다. 실제 비-NTFS/하드링크 미지원 볼륨을 사용한 시험은 아니다. 항상 목적지를 지우지 않는 새 코드는 경쟁자 파일 보호와 일치한다.

### F135-3 — 마지막 취소/deadline 및 정상 commit 뒤 취소 의미 PASS

실제 최종 ebur128 반환 직후 abort하면 CANCELED, 결과/part/work 없음이었다. 최종 도구 반환을 절대 deadline+100ms까지 지연하면 TIMEOUT, 결과 없음이었다. `.part`·두 도구 재해시 다음 link 직전 gate가 있고 그 사이 await가 없는 것을 코드로도 확인했다.

정상 link가 끝난 직후 abort하는 새 시험은 accepted=true, 결과 SHA 일치와 결과 보존으로 통과했다. 이는 commit 전 취소와 다른 명시적 의미이며 렌더 호출자의 canceled_late 처리는 후속 연결 범위다. 큰 원본 timeout 시험도 TIMEOUT/원본 SHA 유지/작업 폴더 없음으로 통과했다. 그 시험은 도구 복사·첫 실행 비용도 포함하므로 **실제로 원본 복사 중간에서 만료했다는 단계별 증거**나 대용량 복사의 즉시 응답 시간까지 입증했다고 확대하지 않는다.

### F135-4 — 실제 영상 길이와 정상 스트림 보존 PASS

소리4초에 실제 영상2초(60프레임), 6초(180프레임), 25fps/100프레임을 각각 넣어 VIDEO_MISMATCH·결과 없음·원본 SHA 유지를 직접 실행했다. 정상4초 30fps는 videoCheck.frames120, 최종 AAC 재디코드192000샘플, 원본과 결과의 독립 streamhash 동일, audio/video duration 모두4.000000이었다. 임의로 -shortest로 잘라 성공시키지 않는다.

원본 정상5초 시험도 I=-13.8/TP=-10.1/LRA1.2, AAC LC 48k/2ch, 디코드240000샘플, initialPadding1024, 상관 지연0샘플 및 원본 SHA 유지로 통과했다. 결과 MP4 SHA `34f54e0fecfb9ecb13f9a5f9cd1662fb6198f62f29e05f443b8e32a61e9a9dcb`, 영상 stream SHA `61590dba273f68b3d9e27776500650ccc3590c48dedad196a87c22c1045fb7c1`이다. 일반 VFR/복잡한 타임스탬프까지 검증한 것은 아니다.

### O135-1/O135-2 및 기존 정책 PASS

자체 생성한 두 audio stream M4A는 SOURCE_UNSUPPORTED로 거절했다. onWork가 예외를 던져도 결과와 work가 없었다. 원본14개의 trim/gain/fade/equalPower/music-only duck 및 silent voice 음악 지속·silence/too_short/no_audio·작은 소리 측정 불가·실제 child 취소/timeout·원본 불변이 통과했다. 프로필 p2-5-local-v1 및 I=-14±1/TP≤-1 기준은 변경되지 않았고 sparse click LOUDNESS_OUT_OF_RANGE 실패를 유지했다. 실제 청취·명료도·pumping 품질은 주장하지 않는다.

## 필수 잔여 F139-1 · P2 — commit 후 cleanup 오류가 성공 반환을 덮음

- 위치: 대상 `lib/audio/mix.ts:218` hard link, :219 committed=true, :220 return, **:227 finally의 rmSync(work)**. 마지막 rmSync는 committed 여부와 무관하게 예외를 밖으로 던진다.
- 재현 방법: 합성4초 음원으로 실제 도구 복사·믹스·정규화·최종 검증·part 재해시까지 수행한다. link seam은 **실제 linkSync**를 호출하고 그 이후 work 디렉터리를 지우는 rmSync에만 지속 EBUSY를 주입한다. 설치 도구·파일 내용을 위조하거나 제품 소스를 수정하지 않았다. 자기 part unlink는 정상으로 두었다.
- **취소 없이도** 호출은 raw Error/EBUSY로 reject했고, commit된 결과98104바이트는 검증된 part와 동일한 SHA `549844f42af3d241617f08fe56fd01fd16b4182fb8d74e720ba71b4c8ad0f468`로 남았다. parts0/workLeft1이었다. 고유 로그 `T139_POST_COMMIT_NO_CANCEL {committed:true,aborted:false,errorCode:EBUSY,errorName:Error,outputMatchesVerified:true,...}`.
- link 후 abort도 함께 발생한 경우 역시 raw EBUSY reject + 같은 정상 결과 보존이었다(`T139_POST_COMMIT_FAILURE`). 따라서 취소가 원인인 실패가 아니라 **정리 오류가 이미 확정된 성공 반환을 덮는 것**이다. 성공 결과의 소유권과 경로 존재는 commit 후인데 호출자는 실패만 받으며 재시도는 OUTPUT_EXISTS에 걸린다.
- 실제 OS 잠금/디스크 고장을 만든 것이 아닌 명시적 fs 오류 주입이다. 오류가 날 수 있는 cleanup 호출과 finally의 반환 덮기 자체는 실제 제품 경로다. 파일 시스템에 오류가 있을 때 무조건 삭제 성공을 보장하라는 요구가 아니다.
- 최소 수정 필요: commit 전 실패와 commit 후 정리 미완료를 분리한다. commit 뒤에는 이미 검증·게시한 결과의 성공/소유권을 일반 실패로 바꾸지 말고 정리 미완료를 별도 상태/경고·재정리 정보 등 명시적인 방식으로 전달한다. 성공 파일을 지워서 해결하거나 정리 완료를 허위 보고하면 안 된다. commit 전 오류 원인도 cleanup 예외로 덮지 않도록 같은 경계를 점검할 필요가 있다.
- 재검수 조건: 정상 commit, commit 후 취소, commit 후 work 정리 EBUSY(취소 유/무)가 모두 확정 결과/보고 의미와 일치해야 한다. 원래의 part ENOSPC/hash EIO/link 실패/경쟁 sentinel 및 자기 파일만 정리하는 보호를 유지해야 한다.

## 도구 설치본 해시 차이 — 변경 주체/시점 미확정 관찰

이번 첫 정상 시험의 반환부터 설치 FFmpeg SHA가 `e957ce65a69404f7217ee8d52aa30694ccfd3b6481239e1f9202455bbc4815ad`였다. 이전 T135의 `3256173f…8edec`와 다르다. 종료 시 설치본을 읽기만 하여 메모리 Buffer의 0x50 바이트를 XOR 0xff 했을 때 SHA가 정확히 이전 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`가 됨을 확인했다. **설치본에 이 Buffer를 쓰거나 복구하지 않았다.** `E/t139-installed-tool-observation.json`에 기록했다. 어느 세션이 언제 바꿨는지는 독립 확인하지 못했다.

수정전 모듈에 새 시험을 그대로 적용하면 `flipStub(binary)`가 work/tools가 아닌 설치 경로를 받을 수 있는 구조다(코드로부터의 추론). 위 해시 차이만으로 그 실행이 실제 원인이었다고 단정하지 않는다. Master가 설치본 기대 SHA/원래 자료를 확인할 때 참고해야 하며, 이번 실제 테스트가 역사적 설치 SHA와 같은 도구였다고 주장하지 않는다. 모듈이 사용/반환한 **현재 사본의 실제 해시**는 검증했다.

T138의 “수정전10FAIL/2PASS”는 이번에 반복하지 않았다. 그10개 중 새 link seam/videoCheck/ffprobe 기대해시 API가 없어서 실패하는 경우와 실제 이전 결함 재현이 섞였다는 작성자 설명을 유지하며, 이를 독립적인 순수 행동 회귀10건의 증거로 사용하지 않았다. 본 판정은 93806df의 직접 실행과 위 추가 재현에 근거한다.

## 정리·반환

모든 원본/추가 시험의 가짜 음원·영상·tool 사본·part·work는 teardown에서 제거했다. F139-1로 의도적으로 남긴 work도 오류 주입을 해제한 후 자기 test root에서 정리했다. 자기 관련 Node/FFmpeg/ffprobe 프로세스0을 명령줄 경로로 확인했고 서버·브라우저는 띄우지 않았다. E의 추적 소스 사본·검수 스크립트·로그·JSON은 증거로 보관하며 의존성 junction은 unlink했다. 설치본이나 타인 프로세스에는 정리 작업을 하지 않았다.

복사용 전달 메시지: Master께 T139 집중 독립재검수 반환합니다. 확정93806df 안전 스냅샷에서 새12+원본14 및 lint/type은 통과했고 원지적4건과 관찰2건의 수정 재현도 통과했으나, 실제 link commit 뒤 work 정리 EBUSY가 성공 반환을 raw 실패로 덮는 F139-1(P2)을 취소 유/무 모두 재현해 제품 판정 FAIL입니다. 현재 설치 FFmpeg 해시가 T135와 DOS stub1바이트 차이인 관찰도 별도 기록했으며 변경 주체·시점은 미확정이고 설치본을 수정/복구하지 않았습니다. 고유 T139 보고서만 통합하고 commit후 정리 의미를 보완한 뒤 재검수 부탁드립니다.
