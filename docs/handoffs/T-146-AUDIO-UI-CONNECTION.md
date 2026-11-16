# T146 · P2-5 오디오 UI 연결 명세

| 항목 | 내용 |
|---|---|
| 담당 / 날짜 | Codex design · CX-DESIGN-01 / 2026-11-17 Asia/Seoul |
| 배정·수신 | Master msg_179186454978 → 수락 msg_2517c554ea03 |
| 상태 | **ready_review · 현행 계약에 연결하는 구현 준비 명세**. UI 구현/실행 검수 결과는 아님 |
| 읽기 기준 | 시작 HEAD `84208b9db4a7c3f956f516c7a7531e52d4e3b958`, T132/T133·T137·T144 반환/재검수, 현재 코드 |
| 수정 범위 | 이 고유 문서만. 제품·공유 상태·T125 시안·배포·기존 미추적 T122/T137 문서 변경 없음 |

## 1. 수용 범위와 연결 순서

T144 독립 재검수는 `e5eab1f`의 **봉투B 복원 정합성 F137-1/2를 닫은 bounded PASS**다. 실제 MP4 정상 백업/복원과 변조 ZIP 거절 증거가 있으며, UI 배치·미리듣기·청취·실기기 검수의 통과로 확대하지 않는다. T130의 제안보다 **이후 구현된 실제 필드/제약**을 우선한다.

연결은 현재 수정·조립/렌더 화면 안에서 한다. 새 셸·단계·유료 서비스·자동 음악 수집을 추가하지 않는다. T125 3안 선택·배포와 별도다.

권장 순서:

1. **렌더 화면의 사실 표시부터 연결:** 현재 무음 전용 문구를 `audioMode/audio`로 분기하고, AAC compose의 불확정 진행·silent/too_short/실패·기기 재생 음소거를 구분.
2. **편집 화면에 소리 설정 연결:** 기존 timeline v2, CAS, 원시 시간/복구 흐름 안에서 파일 선택·구간·gain/fade/duck/join·권리 기록을 편집.
3. **미리듣기는 약속 범위를 좁혀 시작:** 첫 연결은 '원본 파일 미리듣기' + 최종 렌더 결과 듣기. 현재 무음 Player에 완성된 믹스가 들리는 것처럼 표시하지 않는다. 통합 초안 믹스 미리듣기는 별도 후속 범위로 제안한다.

## 2. 현재 코드에서 바로 연결해야 하는 차이

| 현재 코드 근거 | 연결 필수 사항 |
|---|---|
| `lib/services/renders.ts:RenderView/view`는 `audioMode`, `audio`, AAC compose `progress:null` 제공 | UI가 이 값을 소비. progress null을0/100으로 바꾸지 않음 |
| `components/render-panel/copy.ts:progressCopy`는 compose+progress값이 있는 경우만 처리, 나머지는 '준비 중' | `compose && audioMode==='aac'` 분기를 추가해 '장면·글자·소리 합치는 중'. DB에 없는 세부 audio 하위 단계를 추측하지 않음 |
| `STAGES/stageAnnounce`는 장면과 글자만 설명 | 같은3단계 키 유지, AAC일 때 단계명·live 안내를 소리 포함 문장으로 바꿈 |
| `render-panel.tsx` 만들기 설명·결과 Badge가 무조건 '소리 없는 영상' | 현재 저장본/각 결과의 모드를 따로 사용. 과거 무음 행은 무음으로 유지 |
| 결과 사양은 audioStreams0 이외를 모두 '소리 트랙 확인 전'으로 표현 | 확인된 AAC1트랙/실제 무음 신호/측정 전을 분리 |
| 결과 video는 `controls muted`이고 버튼은 '영상 보기/영상 닫기' | 보기=자동재생 아님을 유지. 파일의 소리 포함과 이 기기의 muted를 구분해 명시적으로 켜기 |
| `RenderView.audio`에는 실패 측정 detail이 없고 실패 값은 활동 기록에 남음 | 실패 LUFS를 보고서·target·0에서 만들어 채우지 않음. 현재 code/문구만 사용 |
| `etaSec`는 프레임과 과거 결과 시간에서 계산 | AAC 전체 처리의 검증된 ETA가 아니므로 첫 UI 연결에서는 AAC 남은 시간 숨김 권장 |
| `editingService.get`은 전체 timeline 초안·실제 project revision을 제공하나 audio source 목록은 없음 | 읽기 전용 오디오 선택 DTO를 별도 추가/주입할 좁은 경로 필요 |
| `text-ops.afterSave/laterChanges/recoveryJson`은 전체 timeline을 보존하고 기타 필드 변화도 감지 | 기존 audio JSON을 잃는다고 단정하지 않음. **새 오디오 원시 입력·선택 상태·친절한 복구 요약**을 추가로 연결해야 함 |

위는 코드 대조 결과다. 이번에 화면을 실행해 새 필수 결함 판정을 한 것은 아니다.

## 3. 렌더 화면 연결 — 실제 DTO 사용

현재 `RenderView`의 관련 필드:

```ts
audioMode: 'none' | 'aac'
audio: null | {
  status: 'normalized' | 'silent' | 'too_short' | null,
  accepted: boolean | null,
  integrated: number | null, truePeak: number | null, range: number | null,
  target: { integrated: number, tolerance: number, truePeakMax: number },
  profile, ffmpeg, clips: number, hasMusic: boolean
}
// 기존 status,stage,progress,verify,fileExists,stale,isSample,
// cancelRequested,cleanupLeft,subtitleMeasure,phonePlayback도 그대로 사용
```

### 3.1 진행 카드

우선순위는 기존대로 취소 요청 → queued 사유/재시도 → running stage다.

| 조건 | 화면 문구·표현 |
|---|---|
| none + compose | 기존 장면·글자 퍼센트/프레임 표시 유지 |
| aac + prepare | '장면·글꼴·소리 파일을 준비하고 있어요.' 준비 단계 |
| aac + compose | '장면·글자·소리를 합치고 있어요.' + '음량을 맞추는 작업이 포함돼요.' **퍼센트 막대/예상 남은 시간 없음**, 경과 시간만 |
| aac + verify | '파일과 소리를 확인하고 있어요.' 불확정 표시. 100% 고정 금지 |
| queued/worker_off | 기존 켜지면 시작 안내. accepted/status가 null이라고 실패로 보이지 않음 |
| cancelRequested | 기존 취소 중 문구·확인 패널. 새 소리 처리를 취소하는 별도 버튼을 만들지 않음 |

live는 단계가 달라질 때만 한 번, 완료/실패는 기존 Toast 한 번. 완료 제목 초점은 기존 카드 안 초점일 때만 이동하고 다른 영역 초점을 빼앗지 않는다. AAC에 같은 compose가 오래 유지돼도 가짜 단계/진행률을 만들어 읽지 않는다.

### 3.2 결과 분기표

| 결과 근거 | 표시 | 재생/받기 |
|---|---|---|
| 성공·verify passed·none·audioStreams0 | '파일 확인 통과', '소리 트랙 없음'. 음량 맞춤 '해당 없음' | 기존 usable 조건 |
| 성공·AAC·normalized·accepted===true | '소리 포함', '음량 기준 충족'. 실제 integrated/truePeak 표시, target과 별도 표기 | 기존 usable 조건 |
| 성공·AAC·silent·accepted===null | '소리 트랙 포함 · 무음 신호', '음량 맞춤 해당 없음'. -14 달성 배지 없음 | **허용**. 정상 구조의 결과를 실패로 낮추지 않음 |
| 성공·AAC·too_short·accepted===null | '소리 포함 · 3초 미만', '짧은 소리라 음량 맞춤 미적용' | **허용**. null을 실패/측정 중으로 오인하지 않음 |
| AAC·status null 또는 측정 기록 없음 | '최종 음량 · 측정 전/기록 없음'. 값 null을0으로 표시하지 않음 | 원래 서버 status/verify/fileExists 조건을 유지. 음량 충족 배지만 금지 |
| AUDIO_LOUDNESS_FAILED | 현행 음량 기준 실패 문구 + 다시 만들기. 허용 범위를 완화하지 않음 | 없음 |
| AUDIO_SOURCE_INVALID/AUDIO_FAILED/RENDER_VERIFY_FAILED | 현행 원인·다음 행동·작은 코드. 실제 값이 없는 경우 일반 이유만 | 없음 |
| canceledLate | 보관·백업만, 자동 선택 없음 | **없음/API404**, 기존 계약 유지 |
| fileExists=false | 파일 없음 오류, 다시 만들기 | 없음 |

`too_short`는 **전체 믹스 출력 길이**에 대한 처리 상태다. 30초 영상 안 목소리 클립이2초라는 이유로 UI가 too_short를 계산하지 않는다. `silent`도 audio 배열이 비었다는 의미가 아니다. 서버 상태를 그대로 사용한다.

수치 표기: finite/null을 명시 검사하고 `value || default`를 사용하지 않는다. '측정값 -14.3 LUFS / 기준 -14±1LU'처럼 target과 measured를 구분한다. 알고리즘/profile/tool 이름은 접힌 세부 정보면 충분하다. 자막 오차·음성/자막 의미 맞춤·실제 휴대폰 확인은 별도이며 기존 null 표시를 바꾸지 않는다.

`cleanupLeft`가 있으면 성공 행에서도 '영상은 만들었지만 임시 파일 정리를 확인해 주세요'라는 비차단 경고를 제안한다. 성공 MP4를 실패로 덮거나 다시 만들기를 자동 실행하지 않는다. DTO에 없는 DSP cleanup.complete/uncertainty 값을 추측하지 않고, 새 '모두 정리 완료' 표시를 추가하지 않는다.

### 3.3 만들기 설명·받기·내보내기

- 현재 `RenderPanel.saved`는 revision/aspect만 있다. render page가 이미 읽는 `editing.base`의 저장본에서 **savedAudioMode/clipCount**를 파생해 명시적으로 전달하는 안을 권장한다. 마지막 성공 행이나 현재 재생기의 mute로 만들기 모드를 정하지 않는다. 지원 불가 v1 audio는 별도 blocker를 유지한다.
- none: '저장한 타임라인으로 소리 없는 영상을 만들어요.' AAC: '저장한 소리 설정을 함께 합쳐요. 이 기기의 재생 음소거는 결과에 영향을 주지 않아요.'
- 현행 '영상 보기'는 영역만 연다. AAC 결과에는 '이 기기에서 소리 켜기'를 제공하거나 명확한 native control 안내를 둔다. 소리 켜기는 사용자 동작에서 video.muted를 바꾸며 최종 파일·timeline을 바꾸지 않는다. 소리 없는 결과에는 활성 소리 켜기 버튼을 만들지 않는다.
- 가상 재생을 만들거나 파일을 자동 재생하지 않는다. user gesture 후 play가 막혔으면 실제 오류/다시 재생 안내. 실제 스피커 음량까지 앱이 보장한다고 하지 않는다.
- '소리는 다음 단계에서 붙여요'라는 사실과 어긋난 고정 설명은 제거한다. 완성 영상 내보내기의 **잠금 자체와 기존 편집용 ZIP 조건은 유지**하고, P2-6 자막 등 남은 범위를 설명한다. 오디오 UI가 생겼다고 최종 내보내기를 자동 해제하지 않는다.

## 4. 편집 화면 — 현행 timeline v2에 맞춘 필드

T130 초안과 달리 실제 필드명은 **audioJoins**이며 권리 항목에 `note`는 없다. 존재하지 않는 필드를 보내면 strict schema가 거절한다.

```ts
// 현재 저장 계약 (타입 이름/세부 범위는 lib/edit/timeline.ts가 기준)
{
  schemaVersion: 2, fps: 30, aspect, video, text,
  audio: [{ id, assetId, role, startFrame, sourceInFrame, durationFrames,
            gainDb, fadeInFrames, fadeOutFrames, duckUnderVoice }],
  audioJoins: [{ fromClipId, toClipId, type:'crossfade', durationFrames,
                curve:'equalPower' }],
  audioMixProfile: 'p2-5-local-v1',
  audioRights: [{ assetId, sourceUrl, planName, createdOn, licenseNote }]
}
```

권장 배치: 기존 편집 저장 줄과 Player를 유지하고 '소리' Card를 글자 편집/타임라인 다음에 추가. 첫 UI는 파형 없이 목록과 구간 막대·텍스트로 충분하다. 측정하지 않은 파형을 꾸며 넣지 않는다.

| UI | 저장 필드/규칙 |
|---|---|
| 파일 선택 | assetId, 새clip id. 초기 역할은 버튼/사용자 선택으로 명시. 파일명으로 voice/music을 확정하지 않음 |
| 역할 | voice/music/effect → 목소리/배경 음악/효과음 |
| 영상 안 시작 / 사용 길이 | startFrame/durationFrames, 30fps 정수. 기존 MM:SS.FF 표시/secondsToFrames 변환 재사용 |
| 원본에서 가져올 시작 | sourceInFrame. sourceIn+duration ≤ floor(durationMs×30/1000). 원본 자르거나 복사 저장하지 않음 |
| 소리 크기 | gainDb -60..12. 기본0=원본과 같음. -60을 완전 무음/0%라고 부르지 않음 |
| 처음/끝 서서히 | fadeInFrames/fadeOutFrames, 합≤사용 길이 |
| 목소리에 맞춰 음악 낮춤 | music만 duckUnderVoice=true 가능. voice/effect는false. 임계값·ratio 등 처리 profile 숫자를 편집 UI에 노출하지 않음 |
| 두 곡 부드럽게 연결 | audioJoins의 서로 다른 music 두clip. B.start=A.end-X. 앞곡 fadeOut/뒷곡 fadeIn은0이어야 함 |
| 연결 길이 | X+앞곡fadeIn<앞곡길이, X+뒷곡fadeOut<뒷곡길이. 양끝 join 합이 중간곡 길이 이상이면 거절. 임의 music 겹침·삼중 겹침 금지 |
| 권리 기록 | asset별1행. sourceUrl/planName/createdOn/licenseNote만. 빈 값은null, 모르면 날짜를 생성/업로드일로 채우지 않음 |

초기 추가는 start0, 사용 길이는 `min(원본의 온전한 frame수, D)`를 명시한다. D는 현행 video/text 기준이며 소리로 늘리지 않는다. 1frame 미만·사용 공간이 없는 경우 이유를 안내한다. 두 번째 music은 앞곡 뒤의 빈 구간에 추가하거나 사용자가 곡 연결을 선택한다. 처음부터 겹치는 잘못된 기본값을 조용히 저장하지 않는다.

join 설정 시 현재 비영(非零)인 해당 fade를 몰래 지우지 않는다. '이쪽 서서히를0으로 하고 연결'처럼 바뀔 두 값과 이동할 다음 곡 시작을 명시한 초안 동작으로 처리한다. 다른 곡/장면/글자 시간을 자동으로 밀지 않는다. 클립 제거는 그클립에 연결된 join과 미사용 asset 권리 행을 함께 초안에서 제거하되, 원본 파일·이전 저장본을 삭제하지 않는다. 같은asset을 다른clip이 쓰면 권리 행은 남긴다.

v1은 읽기만으로 v2로 바꾸지 않는다. 사용자가 소리 추가를 시작할 때 v2 초안을 만들고 audioJoins/profile/rights의 필수값을 함께 초기화한다. 소리 없는 기존v1 텍스트 편집은 기존 경로 유지. 지원하지 않는 nonempty v1 audio는 임의 길이 변환하지 않는다. v2에서 소리를 모두 빼도 해당v2 형태/필수 필드를 유지해 저장한다.

### 4.1 소리 목록 데이터의 최소 추가

현재 `EditingData`에는 전체audio source DTO가 없고, `LibraryData`에는 audio metadata가 있으나 available은 없다. **읽기 전용 loader 확장**으로 아래 값을 기존 editor에 주입하는 안이 작다.

```ts
audioSources: Array<{
  id, title, kind:'audio', mime, durationMs:number|null,
  isMock:boolean, archived:boolean, available:boolean,
  sourceUrl:string|null, rightsNote:string|null
}>
```

- 새 후보는 보관되지 않은 audio만. 현재 저장본에서 쓰는 보관/누락 source도 행 자체는 보여 줘서 조용히 삭제하지 않는다. 기존 carried clip은 보관됐어도 그대로 저장 가능한 예외가 있으므로 frontend가 무조건 reject하지 않는다(`timelineService.checkAudio`). 새/변경clip의 보관·존재 검사와 렌더 해시 검사는 서버가 최종 담당한다.
- available은 파일 존재 정보이며 렌더용 바이트/샘플 검사를 통과했다는 표시가 아니다. 절대경로·소스 해시·임의 필터식을 client form에 노출할 필요 없음.
- 기존 업로드 POST(`/api/assets/upload?filename=...&rightsNote=...`)와 asset GET Range를 재사용. 업로드 완료는 원본 보관 완료이며 timeline 저장/렌더 완료가 아니다. 업로드 후 목록 갱신에도 편집 초안을 유지한다.
- 보관함 rightsNote는 참고 기록이다. 현재 audioRights에 없는 `note` 필드로 넘기지 않고, 사용자가 옮길 위치를 확인한 뒤 licenseNote 등에 기록한다. 권리 메모가 채워졌다고 검수/법적 사용권을 자동 통과시키지 않는다. `usesMusic` 답변과 무관하게 저장된 music이 있으면 기존 review 서비스가 곡별 권리 항목을 추가하는 구현을 유지한다.

## 5. 저장·오류·복구 연결

- 저장 요청은 기존 `POST /api/projects/[id]/timeline`의 `{action:'save',revision,timelineId,timeline}` 그대로. 실제 project revision은 `EditingData.revision` 사용. timeline GET의 `current.contentRevision`을 현재CAS 값으로 대체하지 않는다.
- 서버 응답은 현재 `{error}` 중심이다. T130이 제안했던 code/fieldErrors가 이미 구현됐다고 가정하지 않는다. client-safe schema/audioIssues로 field 오류를 먼저 연결하고 서버 error·HTTP409는 기존 요약/충돌 흐름에 둔다. 새 API가 필수면 별도 좁은 범위로 Master가 배정한다.
- 새 audio form은 기존 editor의 **같은 draft Timeline/dirty/저장 lifecycle**을 사용한다. 별도 자동저장·두 번째 저장 버튼·다른 revision 카운터를 만들지 않는다. 저장 줄은 '영상·글자·소리 설정 저장'처럼 실제 범위를 설명한다.
- 기존 전체Timeline handover/afterSave는 audio JSON도 보존한다. 여기에 audio raw time·오류·selectedAudioId를 소유자와 함께 넘긴다. 저장 도중 audio 추가/제거/role/gain/join/rights 변경을 보낸버전의 응답과 정확히 연결해 **미저장 변경으로 유지**한다.
- 다른 창의 더 새 저장본이 오면 audio 초안을 자동 rebase/덮지 않는다. 기존 JSON 복구에는 전체 draft가 이미 포함되며, 새 원시입력과 오디오 선택/변경요약도 추가한다. '그 밖의 설정'만으로 내용이 사라졌다고 오해하지 않게 '소리 설정 변경' 요약을 제공한다.
- dirty/잘못된 원시시간/저장 중에는 기존 RenderEntry의 렌더 진입을 막고 이유를 연결한다. 기존 렌더가 진행 중인 동안 새 버전을 저장하는 것과, 그 새 버전으로 두 번째 렌더를 시작하는 것은 별도 규칙이다.
- `AUDIO_SOURCE_MISSING`의 clipId/assetId를 source 이름과 매핑하고 '편집의 해당 소리로 가기' 링크를 제안한다. UUID만 사용자에게 이유로 노출하지 않는다. 파일 없음/형식 아님/바이트 바뀜/구간 초과를 구분한다. AUDIO_TOO_LONG은 '소리를 포함한 영상은10분까지'이며 무음 전체 제한이라고 바꾸지 않는다.

## 6. 듣기·키보드·390 범위

**가장 작은 첫 연결:** 원본 한 파일의 native audio controls를 소리 상세 안에 둔다. 제목은 '원본 파일 미리듣기', 설명은 '영상 안 위치·소리 크기·페이드·음량 맞추기를 적용하지 않은 원본이에요'. 이 control을 눌렀다고 무음 Remotion Player와 동기 재생되는 것처럼 표시하지 않는다. 최종 믹스는 저장한 결과의 video에서 듣는다.

원본 선택을 바꾸거나 상세를 닫을 때·페이지 이동·탭 숨김·최종 결과 듣기 시작 시 **자기 소유** 원본audio를 멈춘다. 사용자 gesture 없이 재생하지 않는다. 브라우저에서 재생 불가라도 파일/초안을 지우거나 renderer 실패로 자동 분류하지 않고 '원본 미리듣기를 열지 못했어요'와 다시불러오기/다른파일 안내를 둔다.

통합 초안 믹스 미리듣기를 후속 구현한다면 Player/preview props에 source·trim·gain/fade의 실제 지원 범위를 더하고 버퍼링·seek·pause를 한 시계로 묶어 검증해야 한다. 현재 구현된 DSP의 sidechain/loudnorm과 같다고 약속할 근거는 없다. 이 선택은 별도 UI 작업량이며 T146에서 구현됐다고 하지 않는다.

PC: 오디오 행/필드/빼기/연결 버튼을 키보드로 조작. 기존 Player/텍스트 타임라인 키 소유권을 유지. input/slider/select에 초점이 있으면 ←→/Space를 전역 재생·이동으로 빼앗지 않는다. 이동 후 소리 이름·새 시간은 짧게 알리고 gain 연속 변화나 파형을 매번 낭독하지 않는다.

390: source 목록·원본듣기·현재 소리 요약·권리기록 보기·저장 상태·렌더 결과는 세로 배치. 정밀 source trim/영상 위치/join은 초기PC 한정안 권장, '시작·끝과 곡 연결은PC에서 바꿔요' 제공. 숨긴 timeline 대신 role/파일/영상 안 시작·끝을 글로 표시. 주/보조 조작44px, overflow0, native control이 잘리면 외부 재생·음소거 버튼을 별도로 둔다. 기존 지원 중인 텍스트 편집을 새 오디오 제한 때문에 일괄 막지 않는다.

## 7. 좁은 구현 파일 범위 제안

| 묶음 | 예상 파일 | 경계 |
|---|---|---|
| U1 렌더 상태 연결 | `components/render-panel/copy.ts`, `render-panel.tsx`·고유CSS, render page의 saved 모드 DTO, 관련 화면시험 | 기존 RenderView 사용. DSP/row검사/목표값/렌더 게이트 변경 없음 |
| U2 소리 form/상태 | 새 고유 audio editor component/CSS·순수 form helper, `components/editing-panel.tsx`, 원시입력/복구 연결 helper, 관련 시험 | timeline v2실제계약 그대로. 공용Button 전역 리팩터링·T125셸 변경 제외 |
| U2 읽기 데이터 | `lib/services/editing.ts` 또는 `[id]/[stage]/page.tsx`의 read-only audioSources 주입과 자체 DTO | 목록만 필요. 새업로드/믹스API·DB migration 불필요. 기존 library/repo 재사용 |
| U3 원본 듣기 | U2고유컴포넌트 또는 작은 source audition 컴포넌트 | 최종믹스Player로 이름 붙이지 않음. 통합mix preview는 별도 배정 |

Master가 이 목록에서 단일 작성자/허용파일을 확정해 구현을 배정한다. 이 문서만으로 제품 파일 점유를 가져오지 않는다. 현재 실제 edit route는 `[id]/[stage]/page.tsx`이며 별도 edit/page.tsx를 새로 만들지 않는다.

## 8. 구현 완료·검수 요청

| ID | 직접 확인할 것 |
|---|---|
| V1 | v1무음·v2none·AAC normalized/silent/too_short·실패·late·fileMissing의 분기와 숫자/null 표기. 허용 기준 완화/허위14배지 없음 |
| V2 | 실제 AAC compose에서 불확정/합치는중, none에서는 기존퍼센트. prepare/verify/queued/cancel·live/Toast/초점 보존. AAC ETA0초를 전체완료처럼 표시하지 않음 |
| V3 | 최종 AAC 영상 보기·사용자동작 소리켜기·실제청취. 보기만하면 자동재생 안 함. 기기mute/gain이 저장/다운로드sha에 영향 없음 |
| V4 | v1읽기무변경→사용자오디오추가v2저장. 소리·join·rights 왕복. 기존 글자/장면 편집에서 v2필드 보존 |
| V5 | 잘못된시간/fade/겹침/삼중곡·부족한원본·1frame미만·음악외duck 오류, 실패해도 다른초안/원시입력보존 |
| V6 | 같은asset다중clip의 rights1행, 선택/제거/role변경/join양끝fade 정합성. 원본·이전revision 미변경 |
| V7 | 실제 느린저장중audio추가·gain·join·rights변경, 중복저장, 정확한응답인계, 두창CAS·더새버전·copy/download복구의 전체JSON/원시입력동일 |
| V8 | 업로드취소·목록갱신·보관된기존참조·누락/바이트변경/도구없음/10분초과. source available을렌더검사PASS로 표시하지 않음 |
| V9 | 실제원본듣기 및 source전환/탭숨김/페이지해제/결과듣기 중첩정리, autoplay/unsupported 오류. 모의오류와실제렌더실패 구분 |
| V10 | 1280/390 overflow0·44px·Tab/Enter/Esc·form키 소유·읽을수있는label/이유·새오디오모바일제한. 실제폰/스크린리더/200% 미실행이면미확인 |
| V11 | 기존무음경로·샘플/오래된결과·저장안한진입막힘·기존ZIP/최종내보내기잠금·late404 회귀 |

표시 전환용 주입 행은 UI 증거로 명시하고 실제renderer/DSP 검증으로 세지 않는다. U1/U2 작성자의 자체 QA 뒤 별도 검수자를 배정한다. T144의 독립 수치는 상속 근거로만 인용하고 새UI청취/기기 통과로 쓰지 않는다.

## 9. 구현 배정 전에 정할 두 가지

1. **미리듣기 범위:** 첫배정은 원본 단일듣기+최종결과듣기 권장. 통합초안믹스 듣기까지 포함하면 Player계약·동기·버퍼링 검증을 별도묶음으로 추가해야 한다.
2. **모바일 편집 범위:** 초기 정밀시간/join은PC 한정 권장. 모바일에서도 어떤 form을 바꾸게 할지 명시하고 기존텍스트편집 제한과 섞지 않는다.

나머지 수치/권리/date/범위 규칙은 이미 현재schema/profile로 정해져 있으므로 T130의 이전 질문을 다시 사용자에게 묻지 않는다. 위 둘도 기존권한 안에서 Master가 정할 수 있는 구현분할 선택이며 사용자 반복승인 대기가 아니다.

수행: 최신보고/실제코드 읽기와 명세 작성만. 앱 서버/브라우저/오디오/실사용DB/테스트/배포를 실행하지 않았다. 제품이 바뀌지 않은 문서작업이므로 전체빌드·DSP시험을 반복하지 않았다. 반환 시 이 파일만 선택커밋한다.

복사용 전달 메시지: T146 오디오UI연결 명세 반환합니다. T144 e5eab1f bounded복원PASS와UI미검증을분리했습니다. 현행RenderView audioMode/audio와실제v2(audioJoins/권리4필드)기준으로, AACcompose null→준비중fallback·고정무음문구·result muted·실패측정값미노출 등 연결필수점을 기록했습니다. normalized/silent/too_short/null/none/실패/late의표시분기, 저장본모드DTO·read-only소리목록, CAS/전체draft보존+새rawtime·선택복구, 역할/fade/join/rights·390/키보드·V1~11검수표를 포함합니다. 최소원본단일듣기+최종듣기/정밀PC권장, 통합초안mix preview는별도범위선택입니다. U1렌더정직표시→U2form/목록→U3원본듣기의단일작성자허용파일을Master가정해배정부탁드립니다. 제품/DB/공유상태/T125/배포변경 및실제UI테스트없음.
