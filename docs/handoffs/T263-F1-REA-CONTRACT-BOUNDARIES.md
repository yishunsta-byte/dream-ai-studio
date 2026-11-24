# T263-F1 REA 실제 자료 연결 전 계약 보완

2026-11-18 KST · Codes(Backend) · 독립 검수 대기

기준 `5836075c3cad038159367c68b612a71c62152703`, 배정 `msg_3b65c268e94d`, 수락 `msg_db53f5ddc838`. [T263-R 독립 검수](T263-R-REA-LOCAL-CONTRACT-REVIEW.md)의 실제 시간 근거, 직렬화 경계 및 검사 종료 상태를 REA 모듈에서 보완했다.

## 계약

| 항목 | 적용 결과 |
| --- | --- |
| 관측된 길이 | 영상·음악의 파일 메타데이터에서 `durationMs`가 있으면 양의 안전 정수와 값의 일관성을 검사한다. 시간 구간의 끝은 관측 길이와 같을 수 있고 시작 또는 점 위치는 관측 길이보다 작아야 한다. 원래 재현인 500ms 파일의 490–1000ms는 거절된다. 길이 미확인 시간은 소유자 화면에서 `seekable: false`이고 공유 summary에는 탐색 위치를 넣지 않는다. [결과 스키마](../../lib/reference-analysis/result.ts) |
| 비공개 원본 | `createPrivateReferenceResult`는 서버에서 검증한 actor에 원본 결과를 묶는다. 제출 본문·원 URL 경로·파일명·임의 메타데이터는 소유자 전용 서버 레코드에 남는다. 표시·공유 함수는 같은 verified actor만 사용할 수 있다. actor는 저장 레코드 소유권과 서버 인증을 확인한 호출자에게서 받아야 한다. 이 모듈 자체가 세션·Storage 소유권을 인증하지 않는다. [소유·출력 계약](../../lib/reference-analysis/projection.ts) |
| 소유자 화면 | 입력 판정·매체·검사 상태, 허용된 기술 메타데이터와 근거별 위치/탐색 상태를 내보낸다. 관찰·인용·추정은 소유자 전용 비신뢰 텍스트이므로 화면에서 텍스트로 렌더링한다. 원문 전체·URL·파일명·소유 ID·임의 메타데이터는 DTO에 없다. |
| 공유 출력 | 소유자가 명시적으로 선택한 근거의 분류, 허용된 위치 및 MIME·치수·길이·확인된 크기 같은 기술 필드만 내보낸다. 원문·비신뢰 URL·파일명·관찰/인용/추정 문구·임의 메타데이터·내부 근거/소유자 ID는 공유되지 않는다. 비어 있거나 현재 결과에 존재하지 않는 선택은 거절한다. 외부에서 검증된 출처나 사용자 편집 문구 공유는 별도 계약이다. |

## 로컬 파일 검사 예산과 결과

- [입력 판별](../../lib/reference-analysis/input.ts)과 [로컬 검사](../../lib/reference-analysis/local-file.ts)는 신고 크기, 열린 파일의 실제 크기 및 복사한 byte 각각에 **64 MiB** 상한을 적용한다. 이 값은 REA 로컬 검사의 보수적 상한이다. 서버 호출자는 인증된 소유자가 사용할 수 있는 서버 관리 루트와 절대 파일 경로를 확인해 제공한다. 문자열 경로와 실경로가 루트 안인지 각각 검사하며, native 도구에는 고유 임시 경로의 크기 제한 사본만 전달한다. 파일 경로는 결과에 포함하지 않는다.
- 기존 공용 `inspectMedia`는 ffprobe 비정상 종료·타임아웃을 같은 미디어 오류로 감싸기 때문에 해당 결과로는 종료 원인을 복구할 수 없다. 공용 코드를 바꾸지 않고 REA에서 기존 `mediaBinary`·`runMedia`, file-type 및 sharp를 재사용한다. ffprobe는 로컬 file/pipe, 출력 1 MiB, 전체 기한의 AbortSignal을 사용한다. 종료 시 실제 자식 `close`를 기다리고 임시 사본을 정리한다. sharp에는 기존 4천만 화소 제한과 남은 기한의 native timeout을 적용한다.
- 결과는 `completed`, `cancelled`, `timed_out`, `local_tool_unavailable`, `local_tool_failed`, `inspection_failed`, `invalid_file`을 구분한다. 형식 불일치·크기 초과는 별도 입력 이유로 남는다. 확인 가능한 손상 신호는 `invalid_file`, 손상 근거가 없는 실행 실패는 `local_tool_failed`다. 기한이나 취소 뒤 완료된 데이터는 결과에 들어가지 않는다. 사본 정리에 실패하면 취소나 정상 완료로 표시하지 않는다.
- 전체 로컬 기한은 기본 30초이며 호출자가 더 짧게 설정할 수 있다. Node 파일 I/O와 프로세스 내부 sharp 작업은 모두 즉시 중단할 수 있는 API가 아니다. 이미 시작한 작업과 정리가 끝난 뒤 종료를 반환한다. 실제 업로드 단계에는 수신 중 byte 한도·서버 소유권, 작업 취소와 늦은 결과를 막는 작업 세대, 필요 시 별도 프로세스 격리 또는 스케줄러가 필요하다. 이 배정에서 공용 실행 계층·큐·Storage는 변경하지 않았다.

## 확인 결과

- 기본 Vitest **27 통과, 네이티브 8 건너뜀**. `DREAM_REA_NATIVE_TEST=1` 포함 **35/35 통과**. 미확인 길이, 정확한 종료 경계, 초과 시간, 다른 소유자 거절, private path·원문 sentinel, 공유 허용 필드 및 선언 초과를 확인했다.
- 네이티브 표본에서 실제 FFprobe·sharp의 영상·음악·이미지 메타데이터, 손상·위장·도구 부재, 작은 신고 크기로 제시한 실제 64 MiB 초과 파일과 관리 루트 밖 경로를 대조했다. 취소·타임아웃·비정상 도구 종료는 **실제로 실행한 합성 Node 자식 프로세스**에 동일 실행 옵션을 연결해 테스트했고 각 결과 전에 `close`를 관측했다.
- 범위 TypeScript `node node_modules/typescript/bin/tsc -p tmp/t263-rea-typecheck.json`과 `node node_modules/eslint/bin/eslint.js lib/reference-analysis tests/reference-analysis --max-warnings 0` 통과. 임시 TypeScript 설정은 기존 설정을 확장해 두 REA 경로를 포함한다. 외부 URL 조회, UI·DB·Storage 변경, 배포는 없었다. URL 대체 안내는 유지했고 공급자 URL 정규화와 원격 조회는 후속이다.

Master 전달문 — T263-F1의 길이 경계·소유자/공유 출력·64 MiB 실제 관리 파일 상한·로컬 종료 상태를 보완했습니다. 기본 27건 및 네이티브 포함 35건, 범위 타입·린트 통과입니다. 공용 실행 계층과 큐를 유지했고, 실제 업로드·권한 연결과 비중단 native 작업의 강제 격리는 후속 조건으로 보고했습니다.
