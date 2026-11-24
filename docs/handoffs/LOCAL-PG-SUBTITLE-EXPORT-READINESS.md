# 로컬 PG 자막 내보내기 연결 조사

기준 커밋 `c2ca978`. 첫 작품 계획의 SRT/VTT 항목을 대상으로 현행 저장·검수·출력 경로와 기존 시험을 대조했다.

## 현행 연결

| 지점 | 확인 결과 |
| --- | --- |
| 데이터 위치 | `lib/db/postgres/0001_schema.sql`의 `dream.timeline_revisions.timeline_json`에 타임라인을 저장한다. `lib/edit/timeline.ts`의 v1·v2 스키마가 프레임 단위 `text[]`를 지원한다. 프로젝트의 `current_timeline_rev_id`는 현재 타임라인 행을 가리킨다. 타임라인 자체 버전 `revision`과 전체 작업의 `content_revision`은 각각 쓰임이 다르다. |
| 현재 쓰기 | `lib/cloud/local-timeline-audio.ts`는 초기 타임라인을 `text: []`로 생성한다. WAV 추가는 기준 타임라인을 읽고 `lib/edit/audio-ops.ts`의 `addClip`으로 기존 글자를 보존한다. PG 편집 화면에는 첫 타임라인 및 WAV 저장 경로가 있다. `app/api/projects/[id]/timeline/route.ts`의 일반 타임라인 저장·복원은 `lib/services/timeline.ts`의 SQLite 경로를 사용한다. |
| 승인 기준 | `lib/cloud/local-project-review.ts`는 소유자·프로젝트·현재 타임라인 ID·내용 리비전으로 행을 찾고 JSON SHA-256, 스키마, 정규 JSON, 화면 비율 및 선택 장면 일치를 검사한다. 편집 완료와 검수 승인의 `approved_revision`은 현재 내용 리비전이다. 타임라인 저장의 트랜잭션은 새 행과 포인터를 기록하고 편집·검수·내보내기 상태를 조정한다. |
| 기존 내보내기 | `lib/edit/timeline.ts`의 `timelineSrt(text)`와 `timelineVtt(text)`는 DB 의존 없이 자막 레이어의 프레임을 밀리초로 변환한다. VTT는 LF·UTF-8, 정렬·겹침 유지 및 기호 이스케이프를 적용한다. `lib/services/exports.ts`의 SQLite 묶음은 기존 `srtText`로 `subtitles/manual.srt`를 만들고 저장 타임라인에 대해 `subtitles/timeline.vtt`를 추가한다. |
| MP4 제약 | `lib/cloud/local-render-request.ts`는 승인된 정규 타임라인을 바탕으로 요청을 만들 수 있다. `lib/render/local-pg-still-render.ts`의 실행기는 `timeline.text.length`가 1 이상이면 `RENDER_INPUT_UNSUPPORTED`로 거절한다. 자막을 저장하면 현재 렌더 경로에 이 제약이 드러난다. `lib/edit/schema.ts`의 광고·AI 생성·가상인물 필수 표기는 자막 파일의 대상이 아니며, 표시가 필요한 MP4에서는 별도로 확인해야 한다. |

## 구현 순서와 완료 조건

1. **자막 저장**. PG의 현재 타임라인에서 자막을 읽고 수정하는 작은 경로를 추가한다. 소유자·내용 리비전·타임라인 ID 검증과 요청 키 재시도, 기존 오디오·장면·다른 글자 레이어 보존, 새 버전 저장과 이전 승인 무효화를 기존 쓰기 계약에 맞춘다. 저장·새로고침·두 탭 충돌·재시도를 검증하고, 필요한 고정 표기는 SQLite 편집의 보존 규칙과 대조한다.
2. **별도 파일 다운로드**. 소유자 한정 읽기 전용 GET에서 요청 시 표시한 타임라인 ID와 내용 리비전, 현재 검수 승인, 저장본 해시를 한 스냅샷에서 확인한 뒤 두 직렬화 함수를 호출한다. `lib/cloud/local-wav-access.ts`에 이미 repeatable-read 읽기 전용 트랜잭션 형태가 있다. 자막이 없으면 화면에 안내하고 파일 링크를 숨긴다. 승인 전·구버전·타 계정은 파일을 받지 못해야 한다. HTTP 응답에 적절한 MIME, 다운로드 파일명, `private, no-store`를 붙이고 390px·1280px의 키보드 진입과 실제 파일 바이트를 검증한다. 파일 생성 저장소나 내보내기 작업 큐는 이 GET에 필요하지 않다.
3. **MP4와 재편집 ZIP**. 같은 승인 리비전으로 글자를 입힌 MP4까지 필요한 흐름은 실행기의 글자 렌더 지원과 프레임 검증을 선행한다. 현 실행기의 거절을 제거하려면 자막·필수 고정 표기가 실제 영상에 보이는지 먼저 확인한다. 재편집 ZIP은 매니페스트 및 원본 자료 검증을 포함하는 후속 단위다.

## 검증 근거

`npm.cmd test -- tests/p2-6-vtt.test.ts tests/measure-subtitle.test.ts tests/p2-1-timeline.test.ts tests/jobs.test.ts`에서 **4파일·75건 통과**. 프레임 반올림, 한글·여러 줄·표기 문자, 겹침, 비어 있는 자막, 실제 SQLite ZIP 내부 자막과 메타데이터를 확인했다. PG 자막 작성·다운로드 및 글자가 들어간 MP4는 이후 구현에서 HTTP·브라우저와 실제 출력으로 검증해야 한다.

> PG는 타임라인 JSON에 자막을 담을 수 있고 검수도 현재 저장본에 묶입니다. PG 제품에 자막 저장·다운로드 경로가 필요합니다. 기존 SRT/VTT 직렬화와 묶음 시험 75건이 통과했습니다. 글자가 포함된 PG 타임라인은 현 MP4 실행에서 거절되므로, 저장→승인 리비전 파일 내려받기와 MP4 글자 지원을 연계해 배정해 주세요.
