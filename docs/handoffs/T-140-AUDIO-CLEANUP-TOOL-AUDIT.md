# T-140 commit 뒤 정리 결함 수정(F139-1)과 설치 FFmpeg 변경 조사

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_668d2df0712a · 검수 원문: `docs/handoffs/T-139-AUDIO-DSP-RECHECK.md`
- 기준 SHA: `2de5e0fee5945c879ca1a08ec75b8e8ba8f1d8fb`(지시 시점 HEAD, `lib/audio`는 T138 `93806df`와 같아요)
- 바꾼 파일: `lib/audio/mix.ts`, `lib/audio/run.ts`, `tests/p2-5b-dsp-fixes.test.ts`, 이 보고서
- 바꾸지 않은 것:
  - 기존 시험 `tests/p2-5b-audio-dsp.test.ts`
  - 프로필, 음량 기준, 실패 정책
  - 공용 문서와 사용자 자료
- T137 WIP 4파일은 stage하지 않았고, reset이나 stash도 하지 않았어요.
- 상태: 자체 수정이에요. **독립 재검수 전이라 PASS로 주장하지 않아요.**

## 1. 설치 FFmpeg 변경 조사

### 1.1 사실(직접 확인)
| 항목 | 값 |
|---|---|
| 조사 시작 시 설치본 `ffmpeg.exe` | SHA `e957ce65…4815ad`, 105,423,872바이트, 수정 시각(UTC) 2026-09-19T01:42:18 |
| 원래 패키지 `ffmpeg-9.0.2.zip`(SHA `60f46726…2047ba`) 안의 `bin/ffmpeg.exe` | SHA `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`. T135 기록과 같아요. |
| 설치본과 원래 바이트의 차이 | 딱 1바이트예요. 오프셋 0x50(DOS stub)이 원래 `0x97`, 바뀐 값 `0x69`이고, 이건 XOR 0xff예요. |
| 설치본 `ffprobe.exe` | SHA `f0d36ecb…9a65c52`예요. 패키지 안의 ffprobe와 같아서 바뀌지 않았어요. |
| 조사 때 실행 중이던 ffmpeg/ffprobe 프로세스 | 0개 |

### 1.2 추정(변경 주체): 내 T138 검증 실행일 가능성이 높아요. 확정은 아니에요.
근거는 코드와 실행 기록이에요.
- T138 때 "수정 전 코드에서 새 시험이 실패하는지" 확인하려고, 기준 사본의 `.tools/ffmpeg`를 **실제 설치 폴더에 junction으로 연결**한 채 새 시험을 돌렸어요.
- 그 시험 중 "고정 사본 자체가 바뀌면…" 시험은 `flipStub(binary)`로 **실행된 binary 경로**의 0x50 바이트를 XOR 0xff하고, 크기와 수정 시각은 되돌려요.
- 수정 후 코드에서 이 경로는 작업 폴더의 사본이에요. 하지만 수정 전 코드는 설치 경로를 그대로 실행하므로, junction을 거쳐 **설치본 자체가 바뀌어요.**
- 바뀐 내용(0x50 XOR ff 한 번, 크기·시각 그대로, ffprobe는 그대로)이 이 동작과 정확히 같아요. loudnorm 첫 pass는 ffmpeg로만 돌리기 때문이에요.
- 확정하지 못하는 이유: 파일 변경 시각을 따로 기록해 두지 않았어요. 수정 시각도 시험이 되돌려 놓아서 근거로 쓸 수 없어요.

### 1.3 복구(지시 조건대로)
1. 바뀐 설치본을 바이트 그대로 백업했어요: `tmp/t140-evidence/ffmpeg.exe.before-restore.e957`(커밋하지 않음, SHA `e957ce65…`).
2. 별도 파일에서 0x50만 되돌린 후보를 만들었어요. 후보의 **전체 SHA가 `3256173f…8edec`와 정확히 같았고**, 패키지에서 꺼낸 exe와도 바이트 비교(`cmp`)로 완전히 같았어요.
3. 실행 중인 ffmpeg/ffprobe가 0개인 것을 확인한 뒤 설치본을 후보로 바꿨어요. 수정 시각은 원래 값으로 유지했어요.
4. 다시 해시했어요: ffmpeg `3256173f…8edec`, ffprobe `f0d36ecb…`. 둘 다 패키지 기록과 같아요.
5. 이번 작업의 모든 시험이 끝난 뒤에도 두 해시가 그대로였어요. 무료 도구를 새로 받거나 환경을 바꾸지 않았어요.

### 1.4 재발 방지(시험)
- `flipStub`는 경로를 실제 경로로 풀어서 **이 시험의 OS 임시 폴더 안이 아니면 바꾸지 않고 오류를 던져요**(fail closed). junction을 거친 설치 경로도 풀어서 막아요.
  - 이 보호를 확인하는 시험도 넣었어요. 설치 ffmpeg/ffprobe 경로를 주면 거절하고, 설치본 해시가 그대로예요.
- 시험 파일 전체가 시작할 때와 끝날 때 설치 ffmpeg/ffprobe 해시가 같아야 해요(`afterAll`).
- 이번 안전 사본에서는 `.tools/ffmpeg`를 junction이 아니라 **exe 사본**으로 넣었어요.
- 새로 복사한 exe를 실행한 직후에는 백신 검사가 잠깐 파일을 잡아서 쓰기가 실패할 수 있었어요(1/4회). 그래서 시험의 `flipStub` 쓰기만 EBUSY/EPERM/EACCES일 때 다시 시도하게 했어요. 제품 코드는 바꾸지 않았어요.

## 2. F139-1 수정: 정리 결과가 처리 결과를 덮지 않게
**계약(`ProcessedMix.cleanup`, `AudioError.cleanup`)**
- `CleanupState = { complete: boolean; left: { kind: "work" | "staging"; name: string }[] }`
  - `name`은 이름만 담아요. 경로, 사용자 정보, 토큰은 넣지 않아요.
  - `work`는 호출자의 workRoot 아래 작업 폴더예요.
  - `staging`은 outputPath 옆의 `.part` 파일이에요.
- **commit(link) 뒤:** 항상 성공 결과를 돌려줘요.
  - 정리에 실패하면 `cleanup.complete=false`와 남은 이름을 함께 돌려줘요.
  - 게시한 파일은 지우지 않아요.
  - 정리를 다 못 했으면 complete=true로 쓰지 않아요. 남은 것이 실제로 있는지 `existsSync`로 확인한 뒤 보고해요.
- **commit 전 실패:** 원래 원인 오류(`VIDEO_MISMATCH`, `CANCELED` 등)를 그대로 던지고, `error.cleanup`에 정리 상태를 붙여요. 정리 중 오류는 원인을 덮지 않아요.
- 정리 함수는 예외를 던지지 않아요. 지우지 못한 이름만 보고해요.
- commit 뒤의 staging 이름은 게시 파일의 두 번째 이름이에요. 그래서 이 이름을 지워도 결과 파일은 그대로예요.
- **호출자(T137) 할 일:**
  - `cleanup.left`의 이름을 나중에 다시 지워요.
  - commit 뒤 취소는 기존 규칙대로 `canceled_late`로 처리해요.
  - 정리가 끝나지 않았다고 결과를 실패로 바꾸지 않아요.

## 3. 검증
### 3.1 새 시험(`tests/p2-5b-dsp-fixes.test.ts`, T138의 12개 + 7개 = 19개)
| 시험 | 확인한 것 |
|---|---|
| 정상 | `cleanup={complete:true,left:[]}`, 작업 폴더 0 |
| commit 뒤 작업 폴더 EBUSY(취소 없음) | 실제 link 뒤 작업 폴더 rmSync에만 계속 EBUSY를 줬어요. 결과는 accepted이고 파일 sha가 결과 sha와 같아요. `complete:false`, 남은 것은 `work` 1개, 이름에 경로 문자가 없고 그 폴더가 실제로 있어요. 주입을 풀면 다시 지울 수 있고, 지운 뒤에도 결과 파일은 그대로예요. |
| 위 + 늦은 취소 | 결과는 같아요(성공과 정리 미완료). |
| commit 뒤 `.part` EBUSY | 결과 파일 sha가 그대로이고, 남은 것은 `staging` 1개예요. 그 이름을 지워도 결과는 그대로예요. |
| commit 전 실패 + 정리 EBUSY | `VIDEO_MISMATCH`와 `CANCELED`(최종 측정 직후 취소)가 원래 코드 그대로 던져지고, `cleanup.complete=false`, 결과 파일은 없어요. |
| commit 전 실패, 정리 정상 | `VIDEO_MISMATCH`와 `cleanup` complete=true |
| 보호 장치 | 설치 경로 flipStub를 거절하고, 설치본 해시가 그대로예요. |

- T138에서 넣은 12개(도구 고정, part ENOSPC, hash EIO, link 실패, 경쟁 sentinel 보존, 마지막 취소·기한, 영상 길이, 관찰 2건)와 기존 14개도 함께 통과했어요. 공유 작업공간 기준 **33/33**이에요.
- 수정 전 코드(기준 SHA 사본에 새 시험만 복사, 도구는 exe 사본)에서는 정리 시험 6개가 실패했어요. 도구 고정 시험 1개도 1회 실패했는데, 원인은 위 백신 잠금이었어요. 재시도를 넣은 뒤 같은 코드에서 6/6회 통과했어요.

### 3.2 전체 회귀(T140만 얹은 안전 사본)
- 기준 SHA를 `git archive`로 OS 임시 폴더에 풀고 `lib/audio/{mix,run}.ts`와 새 시험만 덮었어요. node_modules는 junction(읽기만)이고, 도구는 exe 사본이에요.
- 결과: `tsc --noEmit` 통과, `eslint .` 통과, **vitest 53파일 통과·1 skip, 시험 618 통과·13 skip**
- T137 WIP가 있는 공유 작업공간에서는 전체 회귀를 돌리지 않았어요.
- 끝난 뒤 사본, junction, 패키지 추출 폴더를 지웠어요. 남은 작업 폴더 0, ffmpeg/ffprobe 프로세스 0이에요.

## 4. 미검증·한계
- 실제 OS 잠금과 실제 디스크 오류는 확인하지 못했어요. 시험은 `rmSync`에 오류를 일부러 주입해서만 했어요.
- 남은 이름을 나중에 다시 지우는 일은 T137 worker가 맡아요. 이번에는 계약만 정했어요.
- 설치본 변경 주체는 추정이에요(1.2).
- 신뢰 경계와 비용(도구 사본 약 210MB)은 T138과 같아요.
