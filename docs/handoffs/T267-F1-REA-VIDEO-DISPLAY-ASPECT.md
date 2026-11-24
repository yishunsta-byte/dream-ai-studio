# T267-F1 REA 대표 프레임 표시 비율

2026-11-19 KST · Codes(Backend) · 독립 검수 대기

기준 `a442341ea2ab9bf279d7448af279e7235ab870aa`, 배정 `msg_ac82b0f8f575`, 수락 `msg_28c9d89af298`. [T267-R 독립 검수](T267-R-REA-LOCAL-VIDEO-FEATURES-REVIEW.md)의 비정사각 픽셀 파생 프레임 왜곡을 수정했다.

[영상 필터](../../lib/reference-analysis/video-features.ts)는 비율 유지 `scale` 단계에 `reset_sar=1`을 적용하고 그 뒤 64×36까지 여백을 붙인다. 저장 치수와 원본 시간 관찰은 유지한다. 예약한 FFmpeg 옵션을 지원하지 않는 도구가 `reset_sar` 옵션 오류를 반환하면 `local_tool_unsupported`로 종료하며, 왜곡된 프레임이나 부분 결과를 내보내지 않는다. 기존 코드의 기타 디코더 실패 상태는 유지한다.

| 원본 실측 | 파생 프레임 | 실제 빨간 픽셀 영역 |
| --- | --- | --- |
| 32×24, SAR 1:1 | 64×36 정사각 픽셀 | 48×36 |
| 32×32, SAR 2:1 | 64×36 정사각 픽셀 | **64×32** |

로컬 FFmpeg·ffprobe 9.0.2로 생성·검사했다. 위 영역은 결과 RGB 바이트를 직접 세어 측정했다. 원본 프로브 치수와 0–900ms 관측 시각이 유지됐다. 옵션 부재는 실제 합성 Node 자식의 stderr/비정상 종료를 통해 대조했다. [네이티브 시험](../../tests/reference-analysis/video-features.test.ts)

Backend의 `contract.test.ts`, `boundaries.test.ts`, `local-file.test.ts`, `video-features.test.ts`에서 네이티브 포함 **63/63** 통과. 기존 컷·PTS·상한·취소·시간 초과·사본 종료의 회귀를 포함한다. 범위 TypeScript `tmp/t267-rea-typecheck.json` 및 ESLint 경고 0 검사 통과. 사용한 자료는 로컬 합성 파일이다.

Master 전달문 — T267-F1 완료. `scale reset_sar=1` 적용 후 실제 SAR 2:1 빨간 영역이 64×32, SAR 1:1 대조가 48×36입니다. 원본 치수·PTS와 자원 회귀를 보존했고 구형 옵션 실패는 별도 상태입니다. 네이티브 63/63 및 범위 타입·린트 통과이며 독립 검수를 요청합니다.
