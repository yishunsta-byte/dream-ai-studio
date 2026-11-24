# T263 REA 1 로컬 입출력 계약

2026-11-18 KST · Codes(Backend) · 독립 검수 대기

기준 `cbf9b3cbbad2234470da2411fb9dceb4932d3f5a`, 배정 `msg_b0a63d2a777a`, 수락 `msg_00d4373c42ae`. [통합 개발 계획의 REA](../MASTER_DEVELOPMENT_PLAN.md#rea-구현-배정과-검수-기준)에 맞춰 입력과 결과를 TypeScript로 구현했다. 변경 범위는 신규 `lib/reference-analysis/`, `tests/reference-analysis/` 및 이 보고서다.

## REA 2에 넘길 계약

- [입력 판별](../../lib/reference-analysis/input.ts)의 `classifyReferenceInput`은 `url`, `file`, `body` 객체를 받는다. 문자열 입력은 URL 형태와 일반 본문을 구분하고 권한 정보를 미확인으로 처리한다. 파일의 매체는 지원 확장자로 판단하며 MIME 힌트와 불일치하면 거절한다. 파일 byte 검증은 별도 로컬 검사 단계에서 수행한다. URL·본문은 선택적으로 `mediaHint`를 넘길 수 있다.
- 상태는 `ready`, `replacement_required`, `invalid`다. 프로필, 제출 시 접근 제한 표시, 권한 미확인 및 내용 미열람 URL은 각각 이유를 기록하며 본문·캡처·파일을 대체 입력으로 반환한다. 프로필 판별은 YouTube·TikTok·Instagram·SoundCloud의 대표 패턴 범위다. 일반 URL의 접근·권한·실제 매체는 외부에서 확인하지 않는다. 출처 URL의 자격 포함 주소는 거절하고 쿼리·fragment는 제거한다. YouTube watch 링크만 형식이 맞는 영상 ID를 유지한다.
- `permission`의 `synthetic` 또는 `authorized`는 요청자가 전달하는 사용 권한 표지다. `creator_public`도 제출자가 지정하는 출처 표지다. 앱은 이러한 표지를 외부에서 재검증한 것으로 해석하지 않는다. 본문은 100,000자, URL은 정규화 후에도 4,096자로 제한한다. 파일명과 경로는 구분하며 계약의 파일 크기 확인은 양의 안전 정수에 한정한다.
- [결과 계약](../../lib/reference-analysis/result.ts)의 `referenceAnalysisResultSchema`는 `schemaVersion: 1`, 입력 판정과 `findings`를 검증한다. 한 응답은 하나의 출처를 가리키며, 관찰·제작자 공개 문구·파일 메타데이터·추정·확인 불가는 별도 discriminant다. 영상·음악 관찰은 밀리초 구간 또는 점 타임코드, 이미지는 0~1로 정규화한 이미지 영역, 본문은 원본 UTF-16 위치를 쓴다. 공개 문구는 제출자가 제작자 공개로 표시한 본문의 정확한 인용 및 범위를 요구한다. 추정은 같은 응답의 관찰·공개 문구·메타데이터 ID를 근거로 연결하며 대안을 선택적으로 포함한다.
- [로컬 파일 검사](../../lib/reference-analysis/local-file.ts)의 `inspectLocalReferenceFile`은 신뢰된 로컬 절대경로와 이미 선택한 파일의 제출 정보를 받는다. 파일 크기·자료 유형을 확인하고 [기존 검사기](../../lib/media/inspect.ts)의 byte 형식 판별, FFprobe 또는 sharp 결과를 `file_metadata`로 반환한다. 실제 파일 경로는 JSON에서 제외한다. 손상·확장자 불일치는 `invalid`, 로컬 검사 도구 부재는 `unavailable`로 기록한다.

## 표본과 실제 도구 검증

모든 자료는 시험이 고유 임시 디렉터리에 생성한 합성 파일이며 실행 뒤 정리했다. 기존 로컬 FFmpeg·ffprobe 9.0.2, sharp 0.35.5 및 저장소의 file-type 검사를 사용했다.

| 합성 표본 | 실제 도구로 읽어 단언한 파일 정보 |
| --- | --- |
| 단색 합성 영상 `clip.mp4` | file-type+ffprobe, `video/mp4`, 32×24, 500ms |
| 합성 사인파 음원 `music.wav` | file-type+ffprobe, `audio/wav`, 500ms |
| 합성 이미지 `still.png` | file-type+sharp, `image/png`, 12×8 |
| 손상 PNG, PNG를 MP4로 제시, ffprobe 부재 | 각각 `invalid_file`, `file_type_mismatch`, `local_tool_unavailable` |

컷·음악 구조·이미지 구도 같은 관찰과 제작 가설은 JSON 계약을 검증할 합성 사례로만 작성했다. 실제 도구로 확인한 범위는 위 표의 파일 형식·길이·치수다. 모델명·시드·제작 문구·BPM·컷 분석은 이번에 추출하지 않았다.

## 실행 결과

```powershell
node node_modules/vitest/vitest.mjs run tests/reference-analysis
$env:DREAM_REA_NATIVE_TEST='1'
node node_modules/vitest/vitest.mjs run tests/reference-analysis
node node_modules/typescript/bin/tsc -p tmp/t263-rea-typecheck.json
node node_modules/eslint/bin/eslint.js lib/reference-analysis tests/reference-analysis --max-warnings 0
```

- 기본 계약 시험 **22 통과, 네이티브 4 건너뜀**, 네이티브 옵션 포함 **26/26 통과**. 범위 TypeScript 및 ESLint 경고 0 검사 통과. `tmp/t263-rea-typecheck.json`은 기존 설정을 확장하고 새 두 경로만 포함하는 검사 설정이다.
- 외부 수집·도구 설치·제품 엔드포인트·DB·Storage·배포는 이번 범위 밖이다. REA 2는 독립 검수 후 이 상태와 결과 스키마를 화면 입력, 근거 탐색 및 후속 작업의 계약으로 사용할 수 있다. 실제 콘텐츠 특징 추출은 REA 3에서 검증한다.

Master 전달문 — T263 로컬 입출력 계약 및 자체 검증 완료. 자료 출처·시간·영역과 관찰/공개 문구/파일 메타데이터/추정/확인 불가를 분리했습니다. 기존 ffprobe·sharp로 영상·음악·이미지 합성 파일 3건의 실제 메타데이터를 확인했고 실패 표본을 포함해 26/26, 범위 타입·린트 통과입니다. 외부 조회·제품 연결 없이 Tester 독립 검수 후 REA 2로 넘길 수 있습니다.
