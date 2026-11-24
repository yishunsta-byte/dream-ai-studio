# T271-F1 REA 원본 탐색과 편집 격자

2026-11-19 KST · Codes(Backend) · 기준 `6c02857c461497b7a9a10c2f5134c4e800835efd` · 배정 `msg_866a4077c37c` · 독립 검수 대기

영상 미리보기의 원본 탐색은 `sourceSeek`를 사용합니다. `kind: "observed_pts"`, 분석기가 밀리초로 기록한 `ptsMs`, 해당 디코딩 관찰의 `findingId`를 반환합니다. 트랙과 관찰 범위를 확인하고 대표 프레임 위치가 관찰과 정확히 일치할 때만 제공합니다. 컷 후보의 탐색 위치는 근거가 연결된 컷 직후 관측 프레임입니다. 트랙의 원본 탐색 범위는 시작을 포함하고 끝을 제외합니다. [독립 검수](T271-R-REA-PROJECT-PREVIEW-CONTRACT-REVIEW.md) · [미리보기 구현](../../lib/reference-analysis/project-preview.ts)

창작 초안은 기존 `referenceFrame`을 `draft.editGridApproximation`으로 대체합니다. 이 값은 공용 30fps 타임라인 반올림을 따르는 편집용 근사이며, 원본 탐색은 `sourceSeek.ptsMs`에 연결합니다. 근사 프레임이 공용 편집 상한을 넘으면 필드를 생략합니다. 직접 연결하는 컷 전환의 `{ type: "cut", durationFrames: 0 }`를 실제 클립 스키마로 확인했습니다. [공용 타임라인 계약](../../lib/edit/timeline.ts)

| 검증 표본 | 원본 탐색 PTS | 편집 격자 근사 |
| --- | --- | --- |
| 1초 120fps 합성 MP4, 마지막 프레임에서 색 변경 | 992ms. 컷 근거는 983–992ms이며 1,000ms는 배타적 끝 | 30fps의 30번 프레임 |
| 30fps 합성 MP4, 1초에 컷 | 1,000ms. 컷 근거는 967–1,000ms | 30fps의 30번 프레임 |
| 9ms 지연 시작 집중 시험 | 9ms. 관찰 없는 10ms와 배타적 끝 2,000ms는 선택 불가 | 30fps의 0번 프레임 |

REA Vitest 8개 파일은 네이티브 설정에서 **105/105**, 기본 설정에서 **60 통과·45 건너뜀**입니다. 소유권·신선도·비공개 필드·미리보기 반환 회귀, 범위 TypeScript `tsc -p tmp/t271-rea-typecheck.json`, REA ESLint `--max-warnings 0`도 통과했습니다. 기존 로컬 FFmpeg로 표본을 합성했습니다. 브라우저 탐색 연결과 재생 확인은 후속 Front 범위입니다. [집중 시험](../../tests/reference-analysis/project-preview.test.ts)

Master 전달문 · T271-F1 구현 완료. 120fps 표본에서 원본 탐색값 992ms와 편집 격자 30번 프레임을 분리했습니다. REA 네이티브 105/105 및 범위 타입·린트 통과로 독립 검수를 요청합니다.
