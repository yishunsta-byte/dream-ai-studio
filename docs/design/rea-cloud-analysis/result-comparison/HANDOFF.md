# 등록 이미지·음악·영상 분석 시안 비교

[세 시안 비교 열기](http://127.0.0.1:8769/docs/design/rea-cloud-analysis/result-comparison/index.html) · [HTML 원본](index.html)

격리 시험 자료로 확인한 관찰값과 시안의 동작을 한 화면에서 비교한다. 각 카드의 링크는 기존 고정 시안으로 직접 이동한다. 세 카드에 운영 분석 공급원 미연결을 표시했다.

| 형식과 고정 시안 | 확인한 동작 | 독립 검수 근거 |
| --- | --- | --- |
| [PNG 초안 비교](../png-result/compare.html) `98ba64d` | 16×16 시험 이미지의 전체 영역과 대표색 구간을 확인한다. 생성 초안·수정본 복사 및 자동 복사 거부 시 직접 복사 안내를 제공한다. | `03fc09d` [PNG 독립 검수](../../../handoffs/REA-R-REGISTERED-PNG-DRAFT-PROTOTYPE-REVIEW.md) |
| [PCM WAV 결과 비교](../pcm-wav-result/compare.html) `5a3ee4a` | 0–125 ms 모노 시험 자료 두 건의 최대 정규화 RMS 25%·12.5%를 보여준다. 자료별 수정본과 접근 철회·재선택·빈 목록 복구·공급원 미연결을 확인한다. | 작업 시작 뒤 UI Tester의 `msg_540484847d91`에서 독립 검수 통과를 확인해 카드에 반영했다. [WAV 인계](../pcm-wav-result/HANDOFF.md) |
| [MP4 시간 비교](../mp4-result/compare.html) `0894c66` | 0 ms·1000 ms의 디코딩 프레임과 1000 ms의 장면 전환 후보를 구분한다. RGB 관찰 구간과 30 fps 편집 근사치, 결과별 수정본을 확인한다. | `f7ee097` [MP4 독립 검수](../../../handoffs/REA-R-REGISTERED-MP4-TIMING-PROTOTYPE-REVIEW.md) |

## 비교 화면 검수

- 390×900에서 카드 1열, 1440×900에서 3열로 배치됐다. 문서 가로 넘침은 두 폭 모두 0px이며 링크의 최소 높이는 44px이다.
- Tab으로 PNG → PCM WAV → MP4 순서로 이동하고 Shift+Tab으로 역방향을 확인했다. 두 폭에서 각각 세 링크를 Enter로 열고, 목적지의 URL과 화면 제목을 대조했다.
- 작성자 브라우저 기록에는 비교 화면과 각 목적지의 로컬 HTML·글꼴 요청만 있었고, 독립 검수에서는 390px에서 PNG 시안으로 정상 이동하는 동안 브라우저 기본 로컬 `GET /favicon.ico` 요청 1건의 404 응답도 관측했다. 외부·API·운영 요청은 각각 0건이었다. 화면 캡처는 로컬 `tmp/registered-result-comparison-proof/`에 있다.
