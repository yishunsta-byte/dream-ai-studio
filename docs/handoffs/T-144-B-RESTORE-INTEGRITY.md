# T-144 봉투 B 복원 정합성 수정 (T-143 F137-1/2)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_2c236331ae29 · 근거: `docs/handoffs/T-137-AUDIO-RENDER-INDEPENDENT-REVIEW.md`(F137-1/2)
- 기준: `c7a0097` + 이 변경만(공유 작업공간, 다른 진행 중 변경 없음). 자체 검증까지이며 **독립 재검수 전**이에요.
- 바꾼 파일: `lib/db/render-data.ts`, 새 시험 `tests/p2-5c-restore-integrity.test.ts`, 이 보고서. migration·fixture·packages·`.tools`·공용 문서는 바꾸지 않았어요.

## 수정
### F137-1 소리 검증 기록
`checkRenderRow`가 봉투 B mix의 보관 파일 행에서 `verify_json`을 다음처럼 읽어요.
- `verify_json.result === "passed"`(결과 파일은 모든 검사를 통과해야 남아요).
- `verify_json.audio`는 정확한 schema(`renderAudioRecordSchema`, strictObject, 유한수 또는 null)로 읽어요. 모르는 필드는 거절해요.
- 입력 `audioPlan`과 연결: 도구 ffmpeg/ffprobe sha가 같고, sources가 plan의 assetId·sha와 1:1로 같아요.
- target은 고정 프로필 값(-14 / TP -2 / LRA 7 / 허용 ±1 / TP 상한 -1)과 같아요.
- 믹스 샘플과 디코드 샘플 = `durationInFrames × 1600`.
- normalized: `accepted:true`, loudness 기록 있음, 3초 이상, peak>0, **최종 integrated가 -14±1 안이고 TP ≤ -1**.
- silent: `accepted:null`, loudness null, peak 0 / too_short: `accepted:null`, loudness null, 3초 미만, peak>0. null 측정값 허용은 그대로예요.
- 실패 이유 문장은 기존 `audio verify record differs` 그대로예요(사유 목록 변경 없음).

### F137-2 입력 안 타임라인
봉투 B 행은 `canonicalJson(input.timeline)`이 저장된 타임라인 판의 `timeline_json`과 바이트로 같고, 그 sha가 `input.timelineSha256`과 같아야 해요. 어긋나면 기존 이유 `input timeline hash differs from the saved timeline`로 거절해요.

### 바꾸지 않은 것
- 봉투 A 행은 예전 규칙 그대로예요(새 검사는 봉투 B에만 적용).
- 트리거·migration·DB 행은 바꾸지 않았어요. 이 검사는 백업 만들기·복원 inspect/finish·이관 검증에서 기존과 같은 자리에서 실행돼요.

## 검증
- 새 시험 `p2-5c-restore-integrity` 4개 통과:
  - 정상 B 백업(실제 backup job으로 생성) → 다른 폴더로 inspect/finish 성공, 행 바이트 그대로.
  - **F137-1 재현**(소리 기록만 999 LUFS/999 dBTP, 사본에서만 guard 제거 후 복원, digest·inventory·메타 맞춘 새 ZIP) → inspect 거절, 목적지 없음, `.dream-restore*` 없음.
  - **F137-2 재현**(입력 타임라인 gain만 -12, input_sha256 재계산) → inspect 거절, 목적지·staging 없음.
  - 행 검사 단독: 16가지 한 군데 변조(허용 밖 -16, TP -0.5, accepted false, 목표 바뀜, 도구·원본 sha, 원본 빠짐, 샘플 수, 모르는 필드, loudness 없음, silent/too_short 모순, result failed, 기록 없음)를 모두 거절하고, 정상 silent(null 측정)는 통과.
  - 수정 전 `render-data.ts`(c7a0097)로 같은 시험을 돌리면 F137-1·F137-2·행 검사 3개가 실패하는 것을 확인했어요.
- 실제 B 재현은 stand-in MP4를 썼어요. 실제 worker가 쓰는 기록이 새 schema를 통과하는지는 실제 렌더 e2e(각 경우 뒤 `checkRenderRows`)로 확인했어요.
- tsc · eslint 통과, vitest 전체 **55파일 통과·2 skip, 632 통과·17 skip**, 실제 렌더 e2e **13/13**(소리 4 + 기존 무음 9), `npm run build` 통과.

## 미검증
- 봉투 B 행이 든 실제 렌더 결과(진짜 MP4)의 변조 ZIP은 독립 검수의 재현 경로를 그대로 다시 돌리지 않았어요(동일 경계를 stand-in 파일로 재현).
- 복원 finish 단계(업그레이드 뒤 재검사) 거절은 inspect에서 먼저 거절되므로 별도로 보지 않았어요.
