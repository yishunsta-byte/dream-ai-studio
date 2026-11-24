# T263-F3-R REA 첨부 표지 독립 검수

2026-11-19 KST · Codex(Tester) · 기준 `25bd64c` · 배정 `msg_a62dc7499ecd`

**통과.** T263-F2-R의 첨부 표지 결함 두 건이 해소됐다. 실제 영상 탐색·공유의 표지 관련 보류를 해제할 수 있다. 실제 저장·권한·서버 작업 연결은 별도 검증 범위다. [수정 보고](T263-F3-REA-ATTACHED-PICTURE.md) · [직전 검수](T263-F2-R-REA-TRACK-RESULT-BOUNDARIES-REVIEW.md)

| 독립 합성 표본 | 실물 ffprobe 관측 및 REA 판정 |
| --- | --- |
| 음원 1500ms + PNG 표지 16×8 MP4 | 표지는 `codec_type=video`, `attached_pic=1`이었다. REA는 `invalid_file`과 빈 근거를 반환했다. 900–1000ms 영상 finding 추가와 선택 공유가 거절됐다. |
| 영상 500ms·48×32 + 음원 1500ms + PNG 표지 16×8 MP4 | ffprobe는 재생 영상에 `0`, 표지에 `1`을 반환했다. REA는 영상 `0–500ms`와 음원 `0–1500ms`를 내보내고 치수를 48×32로 유지했다. `490–500ms` 관찰은 소유자 화면에서 탐색 가능했고 공유 위치에도 포함됐다. `900–1000ms`는 거절됐다. |
| MP3 음원 + PNG 표지 16×8 | ffprobe는 첨부 표지를 별도 영상 스트림으로 반환했다. REA 음악 검사는 완료됐으며 영상 시간축은 생기지 않았다. |

네이티브 회귀에서 disposition 누락, 문자열 `"0"`, 정수 `2`인 합성 자식 응답은 영상 `local_tool_failed`와 미확인 finding만 반환했다. 시간축 생성과 치수 산정 전 영상 후보의 확인이 필요하고, 음원 입력에서는 확인 가능한 음원만 유지하는 코드 경계를 확인했다. [판별 코드](../../lib/reference-analysis/local-file.ts) · [네이티브 회귀](../../tests/reference-analysis/local-file.test.ts)

관련 소스와 지정 시험이 고정 커밋과 일치했다. `contract.test.ts`, `boundaries.test.ts`, `local-file.test.ts` 기본 **36 통과·14 건너뜀**, 네이티브 **50/50 통과**, 같은 범위 TypeScript와 ESLint 경고 0 통과. 추가 합성 파일을 정리했고 보고서 한 파일을 추가했다.
