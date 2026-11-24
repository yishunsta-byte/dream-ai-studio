# 로컬 PG MP4의 한글 자막과 필수 표기 렌더 연결 조사

## 실제 출력 확인

`b3a97be` 기준 제품 렌더 소스를 사용했다. 로컬 시험 스크립트 `tmp/pg-text-render-feasibility.ts`에 서로 다른 단색 PNG 두 장, 한글 두 줄과 잠긴 ‘광고’ 레이어를 입력했다. 기존 렌더 자식 프로세스와 등록된 Pretendard 글꼴로 합성했고, 결과를 FFmpeg로 디코드했다.

- 1080×1920 H.264, 30fps, 90프레임, 3초. Remotion 4.0.543, 고정 Headless Shell 158.0.8127.2, Pretendard SHA-256 `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.
- 한글 두 줄 모두 0부터 센 15~69프레임에서 표시됐다. 입력 구간 `[15,70)`과 첫·마지막 프레임이 일치했고, 29→30프레임의 배경 장면 전환 중에도 자막이 이어졌다.
- 잠긴 광고 표기가 0~89프레임에 표시됐고 빈 대조 영역에는 감지된 프레임이 없었다. 30프레임에서 ‘광고’, ‘첫 번째 줄 가나다’, ‘두 번째 줄 라마바’를 직접 읽었다. 첫 실행의 중앙 검출 영역은 왼쪽 위 광고 배지를 놓쳤다. 실제 프리셋 위치에 맞춘 영역에서 재실행했다.
- MP4 SHA-256 `0e57029ad8fe96b92c7253161ab9ae64795c6d68375f031c3a269550729adf6b`, 33,366바이트. 임시 파일 서버를 닫고 렌더 자식의 남은 프로세스가 0개임을 확인했다.
- `node --conditions=react-server --import tsx tmp/pg-text-render-feasibility.ts` 종료 0. `npm.cmd test -- tests/p2-4-render-units.test.ts tests/p2-4-render-t120.test.ts tests/measure-subtitle.test.ts tests/p2-6-vtt.test.ts` 4파일·43건 통과.

이번 출력은 PG 입력 조립을 연결하기 전의 합성 무음 시험이다. PG의 검증된 PNG와 WAV, 승인, 다운로드의 기존 종단 근거는 [PG 종단 검증](LOCAL-PG-FIRST-WORK-END-TO-END.md)에 있다.

## 최소 연결 범위

1. `lib/render/local-pg-still-render.ts`에서 이미 승인 리비전·타임라인 해시를 확인하고 선택한 원본 PNG를 재검증해 임시 파일로 만든다. 글자가 있으면 이 파일과 저장된 글자 레이어를 기존 컴포지션에 전달하고, 그 무음 영상을 현 PG `mixAudio`·`verifyRender`·`verifyAudio` 경로로 보낸다. 글자가 없는 작업은 현재 FFmpeg 경로를 사용한다.
2. `lib/render/props.ts`부터 `render/render-composition.tsx`와 `components/player/composition-core.tsx`까지 기존 묘사를 재사용한다. `renderProps`는 클립·글자·폰트·크기·프레임만 사용하므로, 필요하면 매개변수 타입을 이 필드로 좁혀 SQLite 핸들러 없이 PG 입력을 전달할 수 있다. `lib/fonts/registry.ts`의 설치 및 라이선스 확인과 `lib/render/tools.ts`의 브라우저·소스 해시 검사를 재사용한다. 저장 스타일의 모든 글꼴과 굵기를 확인한다.
3. `lib/render/file-server.ts`로 검증된 PNG와 글꼴만 작업 전용 루프백 주소에서 제공하고 `lib/render/run.ts`의 자식 프로세스를 사용한다. PG가 주는 중단·9분 타임아웃을 자식 취소에 연결한다. DB 렌더 작업의 시도 번호, 재검증, 16MB 크기 제한, 소유자 다운로드, 완료 활동을 기존 `lib/cloud/local-render-execute.ts`에서 유지한다.
4. `lib/cloud/local-subtitle-edits.ts`는 자막 저장 때 필요한 ‘광고’, ‘AI 생성’, ‘가상인물’을 추가하고 보호 레이어를 보존한다. 첫 PG 타임라인에는 글자가 비어 있을 수 있으므로, 필수 표기가 설정된 경우 승인된 타임라인에 필요한 잠긴 표기가 있는지 출력 전에 확인한다. 누락은 편집으로 돌려보낸다. 저장 시 허용하는 장면 이후 글자 구간은 기존 컴포지션과 같은 검정 배경으로 이어지는 케이스를 별도 검증한다.

## 파일 점유와 후속 합격 조건

- 주 변경 후보는 `lib/render/local-pg-still-render.ts`, 별도 PG 글자 조립 모듈, 좁은 `lib/render/props.ts` 조정, PG 렌더 HTTP 시험이다. 중단 사유를 연결할 때만 `lib/cloud/local-render-execute.ts`를 함께 점유한다. 필수 표기 누락을 편집 완료에서 막는 방식은 `lib/cloud/local-project-review.ts` 담당과 먼저 조정한다.
- 렌더 요청 단계까지 브라우저·폰트·컴포지션 해시를 고정하려면 `lib/cloud/local-render-request.ts`의 입력 계약도 별도 범위로 조정한다. 기존 글자 없는 대기 작업을 읽을 수 있어야 한다.
- 실제 Next/PG17에서 서로 다른 PNG 두 장과 WAV, 한글 두 줄, 잠긴 표기를 저장·승인하고 MP4를 받는다. 구간 시작·종료, 컷 전후, 두 줄 형태와 표기 원문, WAV 샘플 수, DB·파일 SHA, 이전 승인 차단, 글꼴 누락 및 취소 후 임시 자원 정리를 검사한다. 글자 없는 기존 출력도 함께 회귀 검증한다.

> 기존 렌더러로 한글 두 줄과 잠긴 광고 표기를 합성했습니다. 다운로드와 같은 H.264 형식에서 자막 구간은 15~69프레임, 광고 표기는 0~89프레임이었습니다. PG 임시 PNG·승인 타임라인을 기존 컴포지션으로 연결하고 현재 WAV 믹싱·출력 검증을 이어 쓰는 범위로 배정할 수 있습니다.
