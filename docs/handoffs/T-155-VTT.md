# T-155 P2-6 S1+S5: 타임라인 VTT

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_3eacef5c4000 · 계약: `T-154-DELIVERY-CONTRACT.md` 3장(D-1 subtitle만, D-4 SRT 불변 채택)
- 기준: T154 이후 HEAD + 이 변경만이에요. 자체 구현·자체 확인까지이고 **독립 검수 전**이에요.
- 바꾸지 않은 것: 편집 UI, 소리 ZIP, manifest, DB, migration, 패키지, 공용 문서, fixture(T156 담당)

## 바꾼 파일
| 파일 | 내용 |
|---|---|
| `lib/edit/timeline.ts` | `vttCueText` 추가: trim, CRLF·CR→LF, 빈 줄(공백뿐인 줄 포함) 제거, `& < >` escape(그래서 본문의 `-->`는 `--&gt;`). `timelineVtt(text)` 추가: subtitle만 쓰고, 정렬은 startFrame → endFrame → id 순이에요. `WEBVTT\n\n` + `{layer id}\nHH:MM:SS.mmm --> HH:MM:SS.mmm\n{본문}\n`을 빈 줄로 이어 붙여요. 시간은 SRT와 같은 `framesToMs`예요. 자막이 없으면 null을 돌려줘요. UTF-8(BOM 없음), LF만 써요. |
| `lib/services/exports.ts` | `bundleLayout`의 타임라인 분기에서만 `edit/timeline.json` 바로 뒤에 `subtitles/timeline.vtt`(`text/vtt`)를 넣어요. subtitle이 1개 이상일 때만이에요. 타임라인 JSON 파싱은 한 번으로 묶었어요(글꼴 목록과 같은 결과). |
| `tests/p2-6-vtt.test.ts`(신규 4개) | 형식, 프레임↔ms(≤0.5ms, SRT와 같은 값, 0·1·29·30·899·107999프레임 등), escape·줄바꿈·빈 줄·한글·이모지, subtitle만·정렬·겹침·결정적 바이트·없으면 null |
| `tests/jobs.test.ts`(+2) | **실제 가짜 export**(runNextJob → ZIP 작성 → verifyZip → yauzl로 꺼냄)를 확인해요. VTT = 저장 타임라인으로 만든 `timelineVtt`이고, manifest에 mime `text/vtt`와 크기가 맞아요. SRT = 기존 `srtText` 그대로예요. 광고 표기는 빠져요. 자막이 없으면 `subtitles/`가 비어 있어요(timeline.json은 있음). `T155_VTT_DIR`(OS 임시 폴더만 허용)이 있으면 꺼낸 VTT를 저장해요(브라우저 확인용). |
| `tests/p2-3-text-editor.test.ts` | 새 버전 묶음 경로 목록 기대값에 `subtitles/timeline.vtt`를 더했어요. P1 r1 묶음에 VTT가 없다는 단언도 추가했어요. |

## 바이트 불변
- **P1 r1**(`timelineJson` null): 분기 밖이라 VTT가 들어가지 않아요. 기존 `p2-1`의 "r1 묶음 배치 = P1 배치" 시험과 새 단언이 통과해요.
- **SRT**: 함수와 입력이 그대로예요(jobs 시험에서 ZIP의 SRT = `srtText`).
- **이미 만든 export 파일**: 성공 행·파일 불변 트리거와 link 확정에 손대지 않았어요. 다시 만드는 경로도 없어요.
- 타임라인 묶음은 새로 만들 때만 VTT 파일이 하나 더해져요. 그 밖의 파일 바이트는 같아요.

## 검증
- `eslint .` · `tsc` 통과. vitest 전체 **59파일 통과·2 skip, 661 통과·17 skip**. 운영 build + `verify-build`는 안전 사본에서 통과했어요. 공유 `.next`는 다른 세션 dev(3013)가 쓰고 있었어요.
- **브라우저 textTrack 확인**(ego-browser, Chrome 156):
  - 재료: 실제 가짜 export ZIP에서 꺼낸 VTT(사본 `tmp/t155-timeline.vtt`)와 FFmpeg lavfi 합성 30fps 4초 webm이에요. OS 임시 폴더를 127.0.0.1:3155 정적 서버(Range 지원)로 열었어요.
  - 결과:
    - track `readyState` 2, mode showing, cues 2 = subtitle 2개, cue id가 layer id와 같아요.
    - startTime·endTime과 frame/30의 차이: 최대 0.00033초(4프레임 = 0.133). 1ms 이내예요.
    - `getCueAsHTML().textContent`가 원문과 같아요: `A & B <i>x</i> --> 끝 😀\n둘째 줄`, `겹치는 자막`.
    - 시간별 activeCues: 0.1초 0개, 0.5초 1개, **1.5초 2개(겹침)**, 2.7초 1개, 3.5초 0개.
  - 자막이 없는 묶음에 VTT가 없는 것은 실제 ZIP의 manifest와 항목으로 확인했어요(브라우저 대상 아님).
  - 처음 서버가 Range를 지원하지 않아 seek가 되지 않았어요. 그래서 activeCues가 비어 나왔어요. 서버를 고친 뒤 다시 잰 값만 위에 적었어요.

## 따로 구분하는 것 (이번에 하지 않음)
- 렌더한 영상 위 실제 표시 시각(번인 글자)과의 0.2초 비교와 휴대폰 재생은 P2 종료 기준이고, 이번 증거가 아니에요.
- 편집 화면의 VTT 미리보기, 소리 원본 ZIP(S3), manifest v2와 0010(S2), 화면 문구(S4)는 범위 밖이에요.
- 실제 휴대폰·Safari·Firefox의 textTrack은 확인하지 않았어요(Chrome 계열 하나뿐).
- 임시 폴더(VTT 확인 자료, 빌드 사본)는 지웠어요. 다른 세션 서버(3013)에는 손대지 않았어요.
