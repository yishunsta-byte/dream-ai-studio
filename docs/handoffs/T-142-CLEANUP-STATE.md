# T-142 정리 상태 확정 보완 (T-141 F141-1, R141-1)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_588c12dbd80d · 검수 원문: `docs/handoffs/T-141-CLEANUP-RECHECK.md`
- 기준 SHA: `c5699ccf8383a66b650c4fc68fca60cc0812bb90`(지시 시점 HEAD, `lib/audio`는 T140 `a775a47`과 같아요)
- 바꾼 파일: `lib/audio/mix.ts`(정리 판정만), `tests/p2-5b-dsp-fixes.test.ts`, `docs/handoffs/T-140-AUDIO-CLEANUP-TOOL-AUDIT.md`(R141-1 숫자 정정 한 줄), 이 보고서
- T137 WIP는 stage하지 않았어요. **독립 재검수 전이라 PASS로 주장하지 않아요.**

## 1. 수정(F141-1)
- 전에는 `rmSync`가 오류를 던져도 뒤이은 `existsSync`가 false면 "지웠음"으로 쳤어요. 이제는 이렇게 판정해요.
  - 삭제 호출이 오류를 던지면 **그 자체로 정리 미완료**예요. 이름을 `left`에 남겨요. 예외는 `ENOENT`뿐이에요. 이때만 이미 없다고 확정해요.
  - 삭제 호출이 정상으로 끝났어도 이름이 아직 있으면 미완료예요.
- work와 staging 모두 같은 규칙이에요(`removed()` 함수 하나).
- 바뀌지 않은 것:
  - commit 뒤에는 성공 결과를 그대로 돌려줘요.
  - commit 전 실패는 원래 원인 오류를 그대로 던지고 `error.cleanup`을 붙여요.
  - 게시 파일은 지우지 않아요.
  - `keepWork`로 일부러 남긴 작업 폴더는 남은 것으로 세지 않아요.
- lstat 같은 추가 확인은 넣지 않았어요(Master 지시).

## 2. 정정(R141-1)
- T-140 1.1의 바이트 값을 고쳤어요: 원래 `0x69` → 바뀐 값 `0x96`이에요.
- 처음에 `cmp -l`의 8진수 출력을 16진수로 잘못 읽었어요.
- 전체 SHA로 복구가 일치한다는 검증은 원래 그대로 유효해요.

## 3. 검증
- 새 시험 2개를 넣었어요.
  - **F141-1:** 삭제에 EBUSY를 주입하고, 같은 이름에 대해 `existsSync`도 false를 돌려주게 했어요.
    - commit 뒤 work: 성공 결과와 파일 sha가 그대로이고, `complete:false`, `work` 이름이 남아요.
    - commit 뒤 staging: 같은 방식으로 `staging` 이름이 남아요.
    - commit 전 `VIDEO_MISMATCH`: 원래 원인 오류가 그대로이고 `complete:false`예요.
  - **keepWork:** `complete:true`이고 작업 폴더가 실제로 남아 있어요.
- 공유 작업공간 DSP 시험: 35/35 통과(기존 33 + 새 2)
- 수정 전 코드(기준 SHA 사본에 새 시험만 복사, 도구는 exe 사본): F141-1 시험은 실패하고 keepWork 시험은 통과했어요. keepWork 시험은 동작 의미를 고정하는 용도예요.
- 전체 회귀(기준 SHA 사본에 T142 `mix.ts`와 시험만 얹음): `tsc` 통과, `eslint .` 통과, vitest 53파일 통과·1 skip, 시험 620 통과·13 skip
- 작업이 끝난 뒤 설치본 ffmpeg `3256173f…`, ffprobe `f0d36ecb…`가 그대로예요. 안전 사본과 junction도 지웠어요.

## 4. 미검증
- 실제 OS 잠금과 실제 파일 시스템 오류는 확인하지 못했어요. 시험은 오류를 일부러 주입해서만 했어요.
- 남은 이름을 다시 지우는 일은 T137 worker가 맡아요.
