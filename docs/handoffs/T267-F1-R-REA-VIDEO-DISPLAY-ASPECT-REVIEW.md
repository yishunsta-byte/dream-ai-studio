# T267-F1-R 영상 표시 비율 독립 재검수

2026-11-19 KST · Codex(Tester) · 기준 `701afe203a30a5aad3708a045d05f75dbae03d55` · 배정 `msg_f18e2388ddf1`

**통과.** T267-R에서 확인한 대표 프레임의 표시 비율 왜곡이 수정됐다. 이 결함으로 보류했던 영상 대표 프레임의 화면·구도 연결 조건을 해제할 수 있다. 실제 자료의 실행 격리·권한·파생 프레임 수명은 후속 연결에서 검증한다. [수정 보고](T267-F1-REA-VIDEO-DISPLAY-ASPECT.md) · [이전 검수](T267-R-REA-LOCAL-VIDEO-FEATURES-REVIEW.md)

## 독립 재현

기존 로컬 FFmpeg와 ffprobe로 별도 8fps·1초 단색 표본을 만들어 결과 RGB의 빨간 픽셀 범위를 직접 집계했다. `scale reset_sar=1`은 여백을 추가하기 전에 표시 비율을 반영했다. [영상 필터](../../lib/reference-analysis/video-features.ts#L62)

| 원본 | 파생 화면 | 실측 빨간 영역 | 원본 메타데이터와 PTS |
| --- | --- | --- | --- |
| 32×24, SAR 1:1 | 64×36 RGB24 | 48×36, 좌우 8px 여백 | 32×24, 8프레임 0–875ms |
| 32×32, SAR 2:1, DAR 2:1 | 64×36 RGB24 | 64×32, 상하 2px 여백 | 32×32, 8프레임 0–875ms |

두 단색 표본에서 컷 후보는 0개였다. 별도 녹색→자홍 합성 MP4는 실제 `375–500ms` 컷 후보 한 건을 유지했고, 대표 프레임의 시각과 중앙 색은 각각 0ms 녹색·500ms 자홍이었다. 과대 소스 치수와 후보 상한을 넘는 표본은 `analysis_limit`과 파일 메타데이터만 반환했다. 전용 네이티브 시험에서 지연 PTS, 첨부 표지, 복수 트랙, 프레임·기한 한도, 취소와 사본 정리도 통과했다. [회귀 시험](../../tests/reference-analysis/video-features.test.ts)

`reset_sar` 옵션 부재를 stderr와 비정상 종료로 반환하는 합성 자식 프로세스에서는 `local_tool_unsupported`와 기존 파일 메타데이터만 남았다. 대표 프레임과 컷 출력은 없었다. 옵션을 지원하지 않는 별도 FFmpeg 설치본은 사용하지 않았으며, 지원되는 기존 FFmpeg와 합성 자식의 실패 경로를 각각 확인했다.

## 실행 범위

관련 파일이 고정 커밋과 일치했다. `contract.test.ts`, `boundaries.test.ts`, `local-file.test.ts`, `video-features.test.ts` 기본 **36 통과·27 건너뜀**, 네이티브 **63/63 통과**. 같은 시험 네 파일 및 REA 라이브러리 다섯 파일 범위의 TypeScript와 ESLint 경고 0 검사가 통과했다. 합성 파일과 검사 사본을 정리했다. T268 작업 경로에는 손대지 않았으며 공유 작업공간에는 이 보고서 한 파일을 추가했다.
