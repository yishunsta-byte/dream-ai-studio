# T263-F3 REA 첨부 표지와 재생 영상 트랙 구분

2026-11-19 KST · Codes(Backend) · 독립 검수 대기

기준 `71a668c1f20c8778eeb051170e31e8a3a33d8de6`, 배정 `msg_68891c82104c`, 수락 `msg_f3aba4ac2638`. [T263-F2-R 독립 검수](T263-F2-R-REA-TRACK-RESULT-BOUNDARIES-REVIEW.md)의 표지 트랙 재현을 수정했다.

[REA 로컬 검사](../../lib/reference-analysis/local-file.ts)는 ffprobe의 `stream_disposition=attached_pic`을 요청한다. 영상 후보의 `attached_pic=1`은 트랙 개수·재생 영상 존재 여부·치수·시간축 산정에서 제외한다. `attached_pic=0`인 영상만 재생 영상 후보로 사용한다. 표지를 제외한 재생 영상이 없으면 영상 입력은 `invalid_file`이다. 정상 재생 영상이 둘 이상이면 F2의 기존 미확인 시간축 처리를 유지한다.

영상 스트림의 disposition이 누락되거나 값이 0·1의 정수가 아니면 영상 입력은 `local_tool_failed`다. 어떤 스트림을 영상 개수에 넣어야 할지 증명되지 않기 때문에 치수나 탐색 시간을 산출하지 않는다. 음원 입력에서는 확인된 음원 처리 범위를 유지하며, 확인되지 않은 영상 disposition은 영상 시간축으로 사용하지 않는다. 결과 JSON과 소유자·공유 DTO의 구조는 그대로다.

## 실제 로컬 회귀

기존 FFmpeg·ffprobe로 그날 생성한 합성 음원·영상·12×8 PNG를 써서 두 MP4를 만들고, 별도 ffprobe 응답에서 disposition과 길이를 직접 대조했다. [네이티브 시험](../../tests/reference-analysis/local-file.test.ts)

| 표본 | 실제 도구 관측 | REA 결과 |
| --- | --- | --- |
| 음원 + 표지만 있는 MP4 | 음원과 컨테이너 1500ms, 표지 12×8·`attached_pic=1` | `invalid_file`, finding 없음. 900–1000ms 영상 근거를 추가할 수 없고 소유자 화면에 탐색 항목이 없다. 해당 항목 공유도 거절한다. |
| 정상 영상 + 음원 + 표지 MP4 | 재생 영상 32×24·500ms·`attached_pic=0`, 음원과 컨테이너 1500ms, 표지 12×8·`attached_pic=1` | 완료. 치수는 32×24, 실제 영상 0–500ms와 음원 0–1500ms를 유지한다. 영상 490–500ms는 소유자 탐색과 선택 공유에 나오고, 900–1000ms는 거절한다. |

실제로 실행한 합성 Node 자식으로 disposition 누락, 문자열 `"0"`, 정수 `2` 응답의 `local_tool_failed`도 대조했다. 실제 도구로 만든 합성 파일은 시험 뒤 정리했다.

- Backend의 기존 `contract.test.ts`, `boundaries.test.ts`, `local-file.test.ts`만 지정했다. 기본 실행 **36 통과·14 건너뜀**, `DREAM_REA_NATIVE_TEST=1` 실행 **50/50 통과**. 기존 취소·실패 finding, 관측 크기, v1 호환 회귀를 포함한다.
- `tmp/t263-f2-rea-typecheck.json`으로 범위 TypeScript, 같은 라이브러리·세 시험의 ESLint 경고 0을 확인했다. 수정 파일은 로컬 검사, 네이티브 시험, 이 문서 세 개다. T266 제품 경로, 외부·운영 환경, 배포는 범위 밖이다.

Master 전달문 — T263-F3 완료. 실제 ffprobe의 attached_pic을 확인해 표지를 영상 후보에서 제외했습니다. 음원+표지만 있는 MP4는 영상 부적합이고, 정상 500ms 영상+1500ms 음원+표지는 기존 영상 치수와 소유자 탐색·공유를 유지합니다. 미확인 disposition은 영상 결과를 만들지 않습니다. 네이티브 50/50 및 범위 타입·린트 통과입니다.
