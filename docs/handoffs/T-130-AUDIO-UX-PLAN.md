# T130 · P2-5 오디오 UX와 구현 연결 초안

| 항목 | 내용 |
|---|---|
| 담당 / 날짜 | Codex design · CX-DESIGN-01 / 2026-11-17 Asia/Seoul |
| 배정 | Master msg_c0f7665250bb, 수락 msg_476363fa2d95 |
| 상태 | **ready_review · 코드 근거에 따른 명세 초안**. 제품 구현·미디어 실행 검증·사용자 승인 완료를 뜻하지 않음 |
| 열람 기준 | 시작 시 HEAD `fb146e47e8c183f19599dfce69e5a580e120dcc5`. TEAM 최신 T129/T130 배정과 PLAN 11.2·11.4·18장, 현행 timeline/render/library/backup 경로 |
| 수정 | **이 새 문서만**. 제품·스키마·공유 문서·실제 사용자 DB·T125 시안·배포 변경 없음 |

## 1. 제안의 핵심

기존 **수정·조립** 안에 '소리' 영역을 추가한다. 제작 단계를 늘리지 않고, 기존 명시 저장/CAS와 렌더 작업을 재사용한다. 사용자가 가진 로컬 음성·음악·효과음 파일을 선택하는 범위부터 시작한다. 유료 서비스, 음성 생성, 외부 음원 다운로드, 자동 음성 인식·자막 정렬은 이번 범위에 넣지 않는다.

가장 작은 최종 출력 경로는 **현재 무음 Remotion 합성 → 같은 작업의 FFmpeg 오디오 처리·AAC 결합 → 최종 MP4의 영상·소리 검사 → 새 결과로 게시**다. 오디오 없는 저장본과 기존 렌더는 무음 경로를 유지한다. 소리만 실패했다고 무음 파일을 성공으로 돌려주지 않는다.

미리보기는 초기에 브라우저에서 소리의 위치·대략적인 크기·페이드를 확인하는 용도로 한정한다. **최종 -14 LUFS 음량 맞춤과 완전히 같다고 하지 않는다.** 정확한 최종 소리는 저장한 타임라인으로 만든 MP4를 듣는다. 이 구분으로 새 미리듣기 작업 테이블/별도 영구 파일을 먼저 만드는 일을 피한다.

## 2. 코드로 확인한 현재 상태

| 확인된 사실 | 코드 근거 | P2-5에 미치는 영향 |
|---|---|---|
| audio 항목의 role/start/gain/fade/duck 필드는 이미 있으나 strict v1 | `lib/edit/timeline.ts:24,38~42` | 사용 구간·길이·곡 간 연결·믹스 정책이 없다. audio id 중복 검사도 추가 필요 |
| 저장은 audio.length>0를 명시 거부 | `lib/services/timeline.ts:47~52` | UI만 열거나 프런트 값만 넣어서는 동작하지 않음 |
| 저장은 새 timeline revision + content revision, 이후 단계 무효화, CAS | 같은 파일 `write/cas/save/restore`, `app/api/projects/[id]/timeline/route.ts` | 오디오 수정도 동일한 저장·충돌·복구 규칙을 따라야 함 |
| 저장된 JSON을 그대로 해시 검증하고 P1 이관 행은 출처와 비교 | `lib/db/timeline-data.ts:checkP1MigratedRow/checkTimelineRows`, 발행된 0005 | 기존 행/해시/0001~0007을 조용히 고치거나 재이관하면 안 됨 |
| 미리보기 props에는 audio가 없고 영상 소리는 muted | `lib/edit/preview.ts`, `components/player/timeline-composition.tsx` | 새 소리 props/로딩·오류 처리가 필요. 장면 원본 소리를 갑자기 켜면 안 됨 |
| Player는 초점별 Space/←→/Shift/Home/End, 탭 숨김 pause 유지 | `components/player/player-panel.tsx:80~110,152` | 소리도 같은 재생 위치·멈춤을 따라야 함. 입력의 키를 가로채면 안 됨 |
| 렌더 입력은 v1, media는 image/video, output.audio는 'none' 고정 | `lib/render/input.ts:26~35,105~108` | audio asset pin, 믹스 프로필, 오디오 출력 기대값을 담을 새 계약 필요 |
| renders.input_json에는 최상위 schemaVersion=1 SQL CHECK도 있음 | `lib/db/migrations/0006_renders.sql:input_json`, `lib/db/render-data.ts:checkRenderRow` | 렌더 최상위를 단순히2로 바꾸면 현재 SQL/복원 검사를 통과하지 못함. timeline 버전과 렌더 envelope 버전을 구분해야 함 |
| 합성 props/컴포지션은 영상·글자만, renderMedia도 muted:true | `lib/render/props.ts`, `render/render-composition.tsx`, `render/child.ts:68` | 무음 영상 합성은 재사용하고 AAC 결합을 같은 attempt 뒤에 연결하는 안 권장 |
| ffprobe 검증은 audioStreams=0만 성공 | `lib/render/verify.ts:VerifyExpect/judge`, `components/render-panel/copy.ts:verifyReasons` | 오디오 결과에 기대 트랙·코덱·길이·음량 검사와 오류 문구가 필요 |
| 단계는 prepare/compose/verify 세 값만 저장 가능 | `lib/db/schema.ts:renders`, `0006_renders.sql` | 초기에는 compose 전체를 '장면·글자·소리 합치기'로 표현해 새 SQL 단계 열을 피할 수 있음 |
| 업로드는 매직 바이트/확장자/ffprobe 검사를 하며 mp3/wav/m4a 지원 | `lib/media/inspect.ts`, `lib/storage/upload.ts`, `app/api/assets/upload/route.ts` | 기존 업로드 재사용. 단 현재 메타는 durationMs 중심이고 채널·샘플률/정밀 샘플 수는 없음 |
| 업로드 한도 기본2GiB, UUID 새 파일, 해시·크기 보관, 원본 덮지 않음 | `lib/storage/upload.ts:13~55` | 새 오디오 업로드 서비스/다른 파일 저장소를 만들 필요 없음 |
| 자료 읽기 route는 audio inline/Range 206·416 지원 | `app/api/assets/[id]/route.ts` | 로컬 파일 미리듣기에 활용 가능. 실제 브라우저별 디코더 지원은 별도 시험 |
| 권리 메모는 nullable 500자 자유문, 업로드 외 수정 API 없음 | `lib/services/library.ts:note/uploadAsset`, `lib/db/schema.ts:assets` | 곡별 플랜·생성일·라이선스의 구조화·수정 경로가 아직 없음. 메모 존재를 권리 확인으로 표시하지 않음 |
| 현재 사용 수는 project_assets 연결을 셈 | `lib/repo/library.ts:assetUsage` | audio 참조가 연결/보관 보호에서 빠지지 않도록 점검 필요 |
| 백업 참조는 모든 자료 + 내보내기 + 보관 렌더, tmp는 제외 | `lib/repo/maintenance.ts:fileReferences`, `lib/backup/archive.ts:verifyBackupArchive/verifyRestoredDatabase` | 원본 오디오와 최종 MP4 포함, 임시 PCM/분석 캐시는 제외. 복원 시 새 timeline/render 계약 검증 필요 |
| 현재 음악 권리 검수는 별도 필수 항목 | PLAN 12장, `docs/spec/menus.json:c.rights/x.music-rights`, `lib/services/review.ts` | 오디오를 붙였다고 이 항목을 자동 통과시키거나 기존 편집 ZIP에 새 게이트를 소급하지 않음 |

PLAN 18장의 P2-4 진행 주석은 최신 TEAM 수용 기록보다 오래돼 있다. 이를 현행 렌더 미구현의 증거로 삼지 않았다. 본 문서에서 PLAN/TEAM을 고치지 않는다.

## 3. 사용자 흐름과 화면 명세

### 3.1 수정·조립 → 소리

현재 미리보기/글자 편집 아래에 같은 Card·Button·Field·Callout·Toast와 토큰으로 소리 영역을 둔다. 새 디자인 3안 적용과 분리한다.

1. **소리 없음**: '아직 소리를 넣지 않았어요. 지금처럼 소리 없는 영상으로 만들 수 있어요.' + '소리 파일 고르기'. 자동 파일 선택·자동 재생 없음.
2. **파일 선택**: 기존 자료 보관함의 오디오와 로컬 업로드. 이름/길이/샘플 여부/권리 메모 유무 표시. 링크 자료는 오디오 파일로 취급하지 않음. 새 선택은 보관되지 않은 오디오만, 기존 사용 중 자료의 보관은 삭제와 구분.
3. **역할**: '목소리 / 배경 음악 / 효과음'. 파일 형식이나 이름으로 역할을 추정해 확정하지 않음. 사용자가 선택.
4. **사용 구간**: 영상 안 시작·끝, 원본에서 가져올 시작·끝을 표시. 원본 파일은 바꾸지 않음. 긴 파일은 '이번 영상에는 앞30초를 사용해요'처럼 적용 구간을 먼저 보여 줌. 짧은 파일을 몰래 반복하거나 영상 길이를 늘리지 않음.
5. **크기·페이드**: 기본 gain0dB, 페이드0프레임. '처음 서서히 / 끝 서서히' 시간 입력. 기술 숫자는 보조로 '원본과 같음(0dB)'처럼 설명. -60dB를 디지털 무음/0%라고 부르지 않음.
6. **음성에 맞춰 음악 낮춤**: 음악에서만 기본 켬을 제안. 목소리 항목이 없으면 '목소리 파일을 넣으면 적용돼요'. '모든 말을 알아듣는다'거나 자막과 맞춘다는 설명 금지.
7. **곡 사이 연결**: 두 음악 클립이 이어질 때 '겹쳐서 부드럽게'와 겹치는 시간. 기본0, 사용자가 켜면 제안1초(30프레임)를 미리 보여 주고 짧은 구간에서는 줄이도록 안내. 변경되는 두 클립 구간을 화면에 표시하고 다른 장면/다른 곡을 몰래 밀지 않음.
8. **소리 빼기**: 선택한 타임라인 클립만 초안에서 제거, 원본은 자료 보관함과 이전 버전에 남음. 되돌릴 수 있는 초안 변경에 불필요한 삭제 승인창을 추가하지 않음.
9. **명시 저장**: '영상·글자·소리 설정 저장'으로 범위를 설명. 같은 timeline CAS 사용. 저장 안 한 변경 상태에서는 새 렌더 진입을 기존 규칙대로 막고 이유 연결. 충돌 때 로컬 오디오 초안·시간 원시 입력도 기존 복구 자료에 포함.

저장된 r4 렌더가 진행 중일 때 r5 소리를 고쳐 저장해도 r4 입력은 유지한다. 기존 결과는 '지금 내용과 다름'으로 보존하며 자동 대체/자동 재생/자동 선택하지 않는다.

### 3.2 미리보기와 최종 결과를 구분

| 영역 | 문구 / 동작 |
|---|---|
| 작업 중 미리듣기 | '편집 중 소리 미리듣기 · 최종 음량 맞추기 전'. 초안의 위치·gain·페이드/겹침을 대략 확인 |
| 모니터 음소거·볼륨 | '이 기기에서 듣는 소리'. 기기 재생 설정이며 timeline 저장/최종 출력 음량을 바꾸지 않음 |
| 재생 시작 | 사용자 클릭/Space에 따라 시작. 브라우저 정책에 막히면 '소리 켜기를 눌러 주세요'. 권한 없는 자동재생을 반복하지 않음 |
| 더킹 미리듣기 | 초기 브라우저에서 최종 sidechain 처리를 같게 재현하지 못하면 '음성에 따라 음악 낮춤은 만든 영상에서 확인해요'를 명시. 구현 전 효과를 켠 척하지 않음 |
| 정확한 확인 | 저장한 타임라인으로 '영상 만들기' 후 결과의 '영상 보기'에서 듣기. 마지막 저장본과 다른 초안이면 기준 버전을 명시 |
| 결과 소리 | '소리 포함 / 소리 트랙 없음 / 무음 신호'를 구분. 재생기의 muted 상태와 파일의 트랙 존재를 혼동하지 않음 |
| 측정 | 최종 파일에 결합된 측정 결과가 없으면 '최종 음량 · 측정 전'. 자막 오차·음성/자막 맞춤·실기기 재생은 각각 별도 미확인 |

로컬에 설치된 Remotion4.0.543의 `Html5Audio/Audio`와 audio props의 trimBefore/durationInFrames/volume가 존재함을 확인했다. 별도 패키지 설치 없이 미리듣기 후보로 삼을 수 있다. 채택 여부와 브라우저 동기 오차는 구현 검증 사항이다(`node_modules/remotion/dist/cjs/audio/props.d.ts`).

### 3.3 상태·오류·접근성

| 상태 | 보여 줄 것 / 다음 행동 |
|---|---|
| 파일 읽는 중 | 해당 행만 '소리 파일 정보를 확인해요', 선택 취소 가능. 업로드 완료를 저장 완료로 표시하지 않음 |
| 미리듣기 준비/버퍼링 | '소리를 불러오고 있어요'. 영상과 소리의 위치가 갈라진 채 계속 재생하지 않고 함께 멈춤/재동기화 |
| 미리듣기만 실패 | 원인·다시 불러오기. 초안/타임라인/원본 보존. 최종 renderer 디코딩 가능 여부와 구분 |
| 손상·코덱·지원하지 않는 채널 | 해당 파일을 특정하고 다른 파일/변환본을 고르도록 안내. 소리를 생략한 성공 금지 |
| 파일 없어짐/바이트 변경 | 렌더 전에 막거나 실행 중 실패. '선택한 소리 파일이 바뀌었어요. 다시 골라 주세요.' |
| 잘못된 시간·겹침·페이드 | 필드 옆 이유 + 오류 요약에서 해당 필드 이동. 다른 행 입력은 유지 |
| 분석·믹스·검사 중 | 초기에는 세 단계 유지. compose는 '장면·글자·소리 합치기', verify는 '파일과 소리 확인 중' |
| 음량 맞춤 실패 | '소리의 음량을 맞추지 못했어요. 원인을 확인한 뒤 다시 만들어 주세요.' 기존 성공 파일 보존 |
| 디지털 무음 | 정상 유한 LUFS 측정과 별도로 '소리는 있지만 모두 무음이에요. 음량 맞추기를 적용하지 않았어요'. -14 달성 배지 금지 |
| 음원 없음 | 오디오0트랙 기대값의 기존 무음 렌더. '소리 트랙 없음', 음량 맞춤 해당 없음 |
| 취소·늦은 취소 | 기존 계속 만들기/취소하기, 임시 소리 파일까지 정리. 늦게 끝난 결과는 보관·백업만, 재생/받기404 유지 |
| 저장 실패/충돌 | 원시 시간·소리 설정을 포함해 기존 복구 흐름 사용. 저장 안 된 값을 렌더에 사용하지 않음 |

키보드: 기존 초점별 재생/seek를 유지한다. 오디오 행 Enter로 상세 선택, 클립 이동 ←→1프레임·Shift±30프레임을 제안하되 시간 입력/slider/select가 키를 소유하면 전역 처리하지 않는다. 삭제·이동 버튼에 곡/행 이름을 붙인다. 장식 파형을 유일한 정보로 쓰지 않고 시작·끝·역할을 글로 제공한다. 단계/완료/오류는 한 번 알리고 퍼센트·gain 반복 낭독은 피한다.

390에서는 목록·선택 상세·미리듣기·저장 상태·오류·렌더 요청을 세로 배치하고 44px 이상을 지킨다. 첫 구현의 정밀 배치·트림·겹침 편집은 PC로 제한하는 안을 권장한다. '소리의 시작·끝과 곡 연결은 PC에서 바꿔요'를 표시하고 숨긴 타임라인 대신 읽을 수 있는 요약을 둔다. 모바일 출력 설정 편집을 추가로 열지는 Master가 범위를 정한다.

## 4. 시간·데이터 계약 제안 — 현행과 구분

아래는 **새 계약 후보**이며 기존 스키마를 고쳤다는 뜻이 아니다. 최소안도 실제 trim/겹침을 정확히 저장하려면 지금의 strict v1에 없는 필드가 필요하다.

### 4.1 권장: timeline v2 읽기/쓰기 + v1 호환

```ts
// 제안 형태, 제품 타입 아님
AudioClipV2 = {
  id, assetId, role: 'voice' | 'music' | 'effect',
  startFrame,                 // 영상 안 위치, 정수 >=0
  sourceInFrame, durationFrames, // 원본 사용 시작/길이, 정수, duration>=1
  gainDb, fadeInFrames, fadeOutFrames, duckUnderVoice
}
AudioJoinV2 = {
  fromClipId, toClipId, type: 'crossfade', durationFrames, curve: 'equalPower'
}
TimelineV2 = {
  schemaVersion: 2, fps: 30, aspect, video, text,
  audio: AudioClipV2[], audioTransitions: AudioJoinV2[],
  audioMixProfile: 'p2-5-local-v1',
  audioRights: [{ assetId, note, sourceUrl, planName, createdOn, licenseNote }]
}
```

- v1은 기존 읽기를 보존하고 v2는 새 명시 저장에 사용한다. 기존 JSON·행·hash·P1 snapshot·발행 migration/fixture를 덮지 않는다. v1을 열었다는 이유로 v2를 저장하지 않는다. **기존 읽기 호환과 새 소리 저장 허용은 별도 계약**이다.
- 현행 저장은 audio가 비어 있지 않으면 거부하지만 읽기 schema에는 정의가 있다. 모든 역사적 v1이 무조건 비어 있다고 단정하지 않고, 비어 있지 않은 값을 발견하면 처리 방침을 확인한다. source/길이를 추측해 조용히 변환하지 않는다.
- 오디오 ID 중복, 잘못된 참조, NaN/Infinity, 소수 frame·음수·상한 초과를 서버에서 거절한다. 소리 설정 때문에 기존 video/text를 바꾸지 않는다.
- 출력 길이D는 현행대로 `max(videoFrames, text.endFrame...)`. 소리 때문에 자동 연장/반복하지 않는다. `start+duration<=D`, 원본 사용 구간과 실제 decode 길이, fade 각각의 범위와 `fadeIn+fadeOut<=duration`을 검사한다. 긴 곡의 초기 사용 범위도 사용자에게 명시한다.
- crossfade는 같은 music 줄의 인접2clip부터 지원한다. `B.start=A.start+A.duration-X`, X가 양쪽 사용 길이 안에 있음을 검사한다. 삼중 겹침·의미가 모호한 임의 겹침은 초기에는 거절한다. clip 바깥 fade와 곡 연결 쪽 fade를 이중 적용하지 않는다.
- frame→sample 변환을 서버/DSP에서 통일한다. 후보48kHz/30fps면1frame=1600samples다. 끝의 소수 시간·decoder delay·AAC padding은 실제 측정으로 구분하고 durationMs만 보고 정확한 샘플 수를 확정하지 않는다.
- `audioMixProfile`은 서버가 정한 처리 버전 식별자다. 임의 필터 식/CLI 인자를 클라이언트가 보내지 않는다. 초기 UI에 LUFS/TP 자유 편집을 더하지 않는다.

### 4.2 소스·권리·보관 계약

`audioRights`는 정규화된 assetId별 기록 후보다. 현재 전역 자료의 자유문 메모를 초기값으로 읽되, 프로젝트에서 보완한 플랜·생성일·라이선스 메모를 **해당 타임라인 버전에 함께** 담는 안을 권장한다. 전역 자료 메모 수정 API를 이번에 반드시 신설하지 않아도 된다. 날짜/문자 길이·URL 형식은 서버 검사하되, 메모가 있다는 이유로 법적 사용권/검수 통과를 자동 확정하지 않는다.

새 음악 선택에서 미기록 항목은 '직접 확인 필요'로 남긴다. 무음·음성만인 경우 음악 전용 항목은 해당 없음이며 실제 쓰인 오디오 역할을 기준으로 판단해야 한다. 기존 메뉴 usesMusic 조건과 새 음악 선택이 어긋나 검수 항목이 빠지는 문제는 Q6에서 Master가 정한다. 라이선스 약관을 새로 판단하거나 실제 곡/플랜을 조회하지 않았다.

프로젝트 사용 연결과 과거 timeline audio 참조를 사용 수/보관·정리 보호에서 누락하지 않는다. 사용 중 파일의 보관과 바이트 삭제를 구분하고, 보관된 기존 참조는 원본이 존재하는지 별도 확인한다. 렌더는 실제 사용 오디오의 경로·sha256·size·정밀 사용 구간·미디어 속성·샘플 여부를 고정 입력에 포함한다. audio 샘플도 결과 SAMPLE 판단에 합산한다.

### 4.3 API와 화면이 필요한 값

| 경로/값 | 초기 연결안 | 주의 |
|---|---|---|
| 소리 목록 | editing 서버 loader 또는 timeline GET에 기존 자료 보관함 audio selector용 데이터 제공 | 새 endpoint 필요 여부는 Q3. 이름·duration·available·isSample·권리 기록 표시. 외부 URL을 파일로 받지 않음 |
| 소리 상세 검사 | 선택 파일의 codec/channels/sampleRate/decoded samples를 서버 preflight | 현재 assets에는 이 값이 다 없음. GET마다 전체 보관함을 전부 디코드하지 않음 |
| timeline GET | 실제 project `revision`을 명시적으로 추가하는 안 | 현재 current.contentRevision은 저장 행의 값이라 현재 프로젝트 CAS 값과 혼동 금지 |
| timeline POST | 기존 action/revision/timelineId/timeline 저장·복원, v1/v2 판독 | 기존 error 문자열 유지 + code/fieldErrors의 추가 응답 제안. CONFLICT 복구 payload에 audio 포함 |
| render POST | 기존 revision/timelineId 그대로, **저장된 audio에서 출력 모드 결정** | 기기 음소거/미저장 audio를 request override로 보내지 않음 |
| 고정 render input | 최상위schemaVersion1은 SQL과 일치시켜 유지. 기존 none형식 + `output.audio='aac'`/`audioPlan.schemaVersion=1`의 명시 분기 후보 | audioMedia pins/profile·도구버전·권리 snapshot은 새 audioPlan에 포함. 기존 none형식과 과거 hash를 재해석/덮어쓰기하지 않음 |
| RenderView | `audioMode`, `audioSummary`, `loudness` null/finite/silent/failed, 기대값·측정값·측정기 버전 | 값이 없으면 측정 전. 기존 subtitleMeasure/phonePlayback null은 그대로 |
| verifyJson | 기존 결과 판독 유지 + 새 audio codec/트랙/시간/정규화·최종 측정 | input version에 따라 기대0트랙/1트랙을 구분. 기존 무음 성공을 실패로 바꾸지 않음 |

소리 사양 후보: AAC-LC,48kHz,stereo,192kb/s. 현재 목표에 없는 세부 수치는 **Q1의 제안 기본값**이며 확정 아님. 초기 소스는 mono/stereo로 좁히고 그 밖의 채널 배치는 명시적으로 지원/거절하도록 한다.

**DB 최소안의 전제:** timeline v2와 렌더 최상위 v2는 같은 일이 아니다. 새 렌더는 기존 SQL이 받는 최상위1 안에서 별도 버전의 audioPlan을 명시하는 안을 우선 검토한다. 판독기와 복원 검사는 none/audioPlan 양쪽의 완전한 타입·파일 참조·profile을 검사해야 한다. 최상위 render schemaVersion2를 택한다면 renders CHECK의 변경/테이블 보존 이관·독립검수가 필요하므로 단순 타입 변경으로 배정하지 않는다. 물리적 새 열이 없어도 구앱이 새 timeline 자료를 구형 DB로 오인하지 않도록 다음 migration/기능 수준 게이트를 함께 정한다(Q10).

## 5. DSP와 렌더 연결안

```mermaid
flowchart LR
  A[저장된 타임라인·고정 오디오 원본] --> B[사용 구간·gain·fade·곡 연결]
  B --> C[음성 기준 음악 낮춤·믹스]
  C --> D[동일 PCM 믹스의 음량 분석 1회]
  D --> E[분석값으로 음량 맞춤 2회차]
  E --> F[AAC 인코딩·무음 영상과 결합]
  F --> G[최종 MP4 구조·소리·음량 검사]
  G --> H[통과한 새 결과만 게시]
```

**필터 확인 근거:** 설치된 `.tools/ffmpeg/ffmpeg.exe`는9.0.2이며 읽기 전용 `-h filter=loudnorm/acrossfade/sidechaincompress`로 세 필터와 옵션 존재를 확인했다. 공식 문서도 읽었다. 실제 믹스/정규화·소리 품질 시험은 아직 하지 않았다.

1. **고정 준비:** audioMedia도 현재 attempt별 복사/해시 확인에 포함. 원본 음원·기존 성공 MP4는 덮지 않는다. FFmpeg binary hash/버전·믹스 구현/profile 버전도 고정 입력의 처리기 식별에 포함하고 바뀐 도구로 저장된 통계를 재사용하지 않는다. 영상 원본의 소리는 지금처럼 muted로 두고, 사용자가 선택한 audio 자료만 사용한다. 카메라 원본 소리 추출은 후속 범위다.
2. **사용 구간·곡 연결:** 같은 샘플률/채널 포맷으로 준비하고 trim/시간 배치/gain/fade 적용. 두 곡은 FFmpeg `acrossfade`로 처리할 수 있다. 이 필터는 첫 입력 끝과 다음 입력을 정해진 시간만큼 이어 겹치는 동작이므로 전체 영상이 X만큼 줄어들지 않게 목표 구간에 배치한다. X=0은 명시 cut. 제안 equalPower는 qsin/qsin 후보와 실제 gain 곡선을 대조해 고정하며 단순 tri를 같은 값으로 부르지 않는다. [공식 acrossfade 설명](https://ffmpeg.org/ffmpeg-filters.html#acrossfade)
3. **더킹:** 권장 초기안은 voice bus의 실제 신호를 sidechain으로 음악을 낮추는 방식. `sidechaincompress`는 두 번째 신호의 크기에 반응하며 발화 내용/단어/자막을 인식하지 않는다. threshold/ratio/attack/release를 profile에 고정해 검증한다. voice는 청취용과 제어용으로 분기하고, 압축된 음악에 청취용 voice/effect를 다시 합쳐야 한다. voice가 짧아도 전체 음악이 일찍 끝나지 않도록 고정D 길이의 무음 padding/끝처리와 합산 gain 정책을 명시한다. voice 신호가 없으면 음악을 낮추지 않고, duckOff 음악과 효과음은 해당 압축에서 제외한다. 브라우저 근사와 같다는 보장은 하지 않는다. [공식 sidechaincompress 설명](https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress)
4. **음량 맞춤:** 클립별 정규화로 사용자가 정한 음악/목소리 비율을 되돌리지 말고, fade·더킹을 거친 **최종 믹스 전체**에2회 loudnorm을 적용한다. 첫 PCM/필터 입력과 두 번째 입력이 같음을 digest/profile로 묶고 measured_I/LRA/TP/thresh 및 offset을 재사용한다. 조건에 따라 linear에서 dynamic으로 바뀔 수 있으므로 linear 플래그만 보고 통과시키지 않는다. 출력 sample rate도 명시한다. [공식 loudnorm 설명](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
5. **무음 예외:** 비유한 분석값(-inf 등)을 정상 LUFS 숫자로 저장/표시하지 않는다. 자료 없음, 디지털 무음, 매우 조용한 유효 소리, decode/분석 실패를 구분한다. 무음에는 임의 잡음/증폭을 더해 -14를 맞췄다고 하지 않는다. 정확한 판별 기준/아주 짧은 음원은 Q2/Q4에서 고정한다.
6. **출력·검사:** 같은 소유 child 안에서 믹스·분석·2회차·AAC결합을 끝내고 최종 out.mp4를 반환하는 안 권장. 원본은 그대로, 임시 PCM/stats/silent-video는 owned tmp에만. 취소·timeout·worker 종료 때 오디오 subprocess도 같은 정리 경계에 포함한다.
7. **최종 파일 기준:** 기존 영상 크기·프레임·색·codec 검사를 유지하며 audio 기대0/1트랙, AAC codec, sample rate/channels, 실제 decode 가능·길이/시작 오프셋을 추가한다. mux 후 AAC를 다시 분석해 수치를 파일 SHA·renderId·timelineId·profile/toolVersion에 연결한다. ffprobe의 트랙 존재만으로 -14 LUFS 통과라고 하지 않는다.

진행률 최소안: 세 stage enum은 유지한다. **audio가 있는 작업은 compose 전체를 불확정 진행으로** 보여 주고 '장면·글자·소리 합치기'라고 한다. 현행 renderedFrames 비율을 오디오 처리까지 포함한 전체 퍼센트로 쓰지 않는다. 상세 하위 단계를 보여 주려면 별도의 실제 IPC/영속 progress 계약을 먼저 추가하며 화면이 추측하지 않는다. 무음 작업의 기존 프레임 기반 퍼센트는 유지 가능하다.

## 6. 기존 저장·백업·복원과의 연결

- source audio는 기존 assets 파일 참조로 백업에 포함된다. 최종 AAC MP4와 늦은 취소 보관 MP4도 기존 render inventory 대상이다. 임시 WAV/PCM·stats·미리듣기 캐시는 `storage/tmp`에서 정리하고 영구 inventory에 섞지 않는다.
- v2 timeline을 read/hash/restore/구버전 복원 서비스가 함께 이해해야 한다. 처음에는 새 영구 오디오 캐시/preview 테이블을 만들지 않는 안으로 제한한다. 필요 시 발행된 SQL1~7을 수정하지 않고 Master가 후속 migration 번호·검증을 배정한다.
- render input의 기존 none/새 audioPlan 분기, verify 옛값/새값을 둘 다 읽고 과거 무음 결과·다운로드·백업 파일의 byte/hash를 보존한다. 저장 형식이 늘었다고 과거 성공 파일을 다시 만들지 않는다.
- 소리 수정도 이후 검수 승인 무효화와 기존 타임라인 충돌 복구에 반영한다. 검수/기존 편집용 ZIP의 게이트를 소급 변경하지 않는다.
- P2-6까지 내보내기 파일 구성 전체를 이 작업에서 완성했다고 하지 않는다. 오디오 원본/사용 구간/권리 메모가 이후 편집용 묶음에 빠지지 않을 계약만 먼저 넘긴다.

## 7. 가장 작은 단계별 구현·검수 배정안

| 단계 | 좁은 구현 범위 | 통과 후 다음 단계 |
|---|---|---|
| A · 읽기/저장 기반 | v1 보존 + v2 audio/시간/권리 계약, asset참조·사용 보호, CAS/복구/복원·고정 fixture. UI는 아직 열지 않음 | 구버전 bytes/hash 회귀·v2 왕복·잘못된 입력 원자 거절·백업 복원 독립 확인 |
| B · 오프라인 소리 처리 | 합성 tone/무음/신호로 trim/gain/fade/crossfade/duck/mix2pass/AAC·측정 도구 helper. source 원본 불변 | 아래 DSP 수치·대조군, 취소/실패/정리, 사용 도구/profile 버전 근거 |
| C · 저장본 렌더 연결 | 기존 owned attempt/글로벌 작업1에 v2 믹스·mux·검사·새 RenderView 연결, audio없는 경로 회귀 | 실제 앱 렌더·download/해시·stale·late404·backup/restore와 취소·실패 독립 확인 |
| D · 현재 UI 연결 | 소리 선택/편집/명시저장/근사 미리듣기/오류·측정 전·키보드/390 | 제작자 자체 QA + 별도 디자인/기능 검수. T125 새 셸 적용과 분리 |

처음 A 이전에 Q1~Q6을 Master/구현자가 기존 권한 내에서 결정한다. 결정 전에도 이 초안·자료 확인은 완료할 수 있으며 사용자에게 반복 승인을 요구할 이유는 없다. 단계가 끝났다는 이유만으로 P2 전체 종료/실기기 확인으로 올리지 않는다.

## 8. 완료·검증 기준

| ID | 필요한 증거 |
|---|---|
| A1 | 구v1/P1/고정s4~s7 및 발행 migration 원형, 예전 무음 render input/파일/재생·받기 보존 |
| A2 | v2 저장/복원·undo·CAS충돌에서 audio 전체와 원시시간 보존. 읽기만으로 revision/행/파일이 생기지 않음 |
| A3 | 중복audio id·존재하지 않는 asset·틀린kind·NaN/Infinity/소수frame·범위·fade/겹침 오류를 원자 거절, 무관한 행 보존 |
| A4 | project 사용 수·보관·새 버전 참조·backup inventory/restore에서 오디오 누락 없음. 원본/이전 결과 해시 동일 |
| B1 | 다른 시작/끝을 가진 합성 신호로 trim/배치 길이를 측정. 양 끝·gap·영상보다 긴/짧은 파일·한 프레임 경계 시험 |
| B2 | fade0/최소/최대/초과, 2곡crossfade0/정상/과도겹침. 이전곡·다음곡 신호와 구간 경계, 합계시간이 의도대로임을 증명 |
| B3 | voice 없는/있는/중간무음/겹친음성, duckOff·effect에서 music 신호 레벨 비교. 음성 전후 복귀와 pumping·말 명료도 청취를 별도 확인 |
| B4 | 같은 고정 믹스로2pass 통계 사용을 증명. 변경 믹스 통계 재사용 거절, 너무 조용함/클리핑/짧은 파일/디지털 무음·비유한 값 대조 |
| B5 | 제안 목표-14±1LU/TP상한 등은 Q1 확정 수치로 최종 AAC decode 재측정. 측정기·최종파일hash·profile 연결. target설정값만으로 통과 금지 |
| C1 | 실제 앱의 voice/music/effect 단독·혼합,9:16/16:9/1:1, 무음구버전/음원없음, mono/stereo, MP3/WAV/M4A가 기대 트랙/codec/길이를 가짐 |
| C2 | 영상 프레임·색 정보 회귀, 오디오 start/end 오프셋과 AAC delay/padding. 자동 concat으로 영상이 짧아지지 않음 |
| C3 | upload/decode/analyze/mix/normalize/mux/verify 중 실패·ENOSPC·영구권한/일시I/O의 재시도 구분, 취소·timeout·owned프로세스/임시파일 정리 |
| C4 | 중복 요청1작업, 다른 창 저장·소리 수정 중 입력고정/stale, 예전 성공 불변, 늦은취소 보관·404, 실제download 파일hash·이름 일치 |
| D1 | 저장 전/후와 기기모니터 음소거가 최종출력에 미치는 범위 분명. browser정책/버퍼링/지원안됨에서 초안 보존·오류/재시도·상태안내 |
| D2 | 1280/390 overflow0·44px·Tab/Enter/Esc·입력키 비간섭·초점복귀·단계알림. 모바일 타임라인 제한·읽을 수 있는 시간 요약 |
| D3 | 최종 LUFS측정/음성자막맞춤/자막경계/실기기 확인이 서로 다른 상태. 미측정·실패를 성공으로 읽지 않음 |

T127/T128의 합성 자막 경계 측정은 위 오디오 동기/말의 의미/실제 휴대폰 확인을 대신하지 않는다. 새 오디오 타이밍 검증도 지정 fixture/검출 기준 범위를 명시하고 보편적인 청취 일치로 확대하지 않는다.

## 9. 구현 담당·Master가 정할 질문과 제안 기본값

| 질문 | 제안 / 영향 |
|---|---|
| Q1 목표·포맷·판정수치 | 고정 profile후보: I=-14LUFS,TP=-2dBTP,LRA7,48k/stereo/AAC-LC192k. 최종 AAC I=-14±1LU,TP≤-1dBTP를 초기 허용안으로 제시. 이는 PLAN 확정 수치가 아니며 fixture의 짧음/코덱오버슈트를 측정해 정할 것 |
| Q2 무음/짧은 소리 | 디지털 무음은 N/A + 명시 상태, decode오류와 분리. 신호 판별 threshold/최소 유효길이·-inf 처리·짧은FX 패딩/거절 기준을 버전 고정. 임의로 -14 성공 처리 금지 |
| Q3 API/소스 메타 | 기존 loader/timelineGET 확장과 선택asset 상세 preflight를 우선. selector 범위·actualprojectrevision·errorcode·available/sampleRate/channels/decodedLength 제공 주체 확정 |
| Q4 v2 범위·출력길이 | 실제 source trim+duration+join+profile 필요성 확인, v1 비어있지 않은audio 취급, 소수시간 반올림/단일frame보다짧은FX/끝 padding·루프없음 정책 고정 |
| Q5 duck/preview | 최종 voice-signal sidechain을 우선, 브라우저는 gain/fade근사+차이안내. threshold/ratio/attack/release/곡전환curve와 미리듣기 약속 범위 결정. 별도 전체믹스 preview작업은 후속으로 미룸 |
| Q6 권리·검수/사용 연결 | 자료 자유문메모+v2프로젝트별보완안과 usesMusic 조건 불일치 해결. source audio의 project_assets/이전revision 사용 보존. 권리 메모가 없다고 기술적 렌더까지 새로 막을지는 기존 게이트와 조율하고 자동통과 금지 |
| Q7 진행 계약 | 초기 3stage 유지/audio compose불확정 권장. 정밀 하위단계가 꼭 필요하면 IPC·영속progress 필드·terminal불변·migration 추가범위를 별도 배정 |
| Q8 최종검사 위치 | 소유child 안 믹스/측정/mux, parent구조검사 + 최종파일hash에 묶인audio측정 결과안 권장. 별도parentffmpeg를 띄우면 취소/timeout/정리 소유를 함께 설계 |
| Q9 모바일 편집 | 초기 정밀 오디오편집PC·모바일읽기/듣기/렌더 중심 권장. 모바일gain/소리선택까지 열려면 검증범위와 저장 UX를 명시 |
| Q10 schema/migration | timeline2 + 기존 render envelope1/audioPlan1안을 우선 검토. render최상위2는 SQL CHECK 보존 이관이 필요. 새 열 유무와 별도로 구앱의 새자료 오판을 막는 다음 migration/기능수준 게이트와 고정audio fixture를 배정. 0005 코드/기발행 SQL을 수정하지 않음 |

위 질문은 구현 배정 전 기술 계약 검토용이다. T130 산출물 자체의 미완료/사용자 응답 대기가 아니다. 유료 서비스/외부 음악/제품 방향 변경은 제안하지 않는다.

## 10. 수행·미수행·반환

- 수행: 규칙/TEAM/PLAN과 현행 코드 읽기, 기존 Remotion4.0.543 audio 타입/내보내기 확인, 설치 FFmpeg9.0.2 버전 및3필터 help 읽기, ego21에서 FFmpeg 공식 필터 문서 확인.
- 공식 문서는2026-11-17에 읽었으며 온라인 문서와 로컬 배포 옵션을 구분했다. 설계 수치·구성은 제안으로 표시했다. 문서의 주장을 실제 처리 성능으로 바꾸지 않았다.
- 미수행: 실제 오디오 업로드·재생·믹스·loudness 측정·렌더·모바일/스크린리더·백업/복원 테스트. 코드/도구 설치·외부 음원 취득·유료 호출·DB 접근 없음. 문서 작업에 제품 전체 테스트를 실행하지 않았다.
- ego21은 공식 문서 열람 후 `finish({keep:[]})`로 종료. 앱 서버/worker/ffmpeg 처리 프로세스는 시작하지 않음(help 명령만 실행).
- 기존 T125 세 시안·기존 배포·공용 문서·다른 작성자의 WIP는 유지했다. 이 문서만 선택 커밋으로 반환한다.

복사용 전달 메시지: T130 오디오 UX/인터페이스 초안 반환합니다. 현행 audio저장거부·v1부족필드·무음preview/render·0audio검증·업로드/권리/백업 제약을 코드로 확인했습니다. 기존수정·조립 안 소리영역, 명시저장/CAS·v1보존/v2후보, 브라우저근사미리듣기와 최종-14LUFS출력 구분, 기존ownedrender안 FFmpeg믹스2pass/AAC결합/최종검사 경로를 제안합니다. 3stage유지/audio진행불확정으로 새progress열을 우선 피하고, A기반→BDSP→C렌더→DUI의 최소배정/완료검증표와Q1~Q10기본안을 기록했습니다. FFmpeg공식문서·로컬help만 확인했고 실제오디오처리PASS는 아닙니다. 제품/DB/공유문서/T125/배포 변경 없음. Master 계약검토 후 구현배정을 부탁드립니다.
