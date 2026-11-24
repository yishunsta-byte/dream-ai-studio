# T287-F1 작업실 분석 인증 대기의 시간 제한과 정리

기준 `c5c863f` · Backend 자체 검증

격리 분석 어댑터에서 최초 인증, 비공개 사본을 만든 직후의 인증, 분석 후 인증을 모두 같은 요청 기한과 호출자 취소 신호에 연결했습니다. 인증 공급자가 대기 중이어도 `timed_out` 또는 `cancelled`로 요청을 완료하며 임시 사본과 실행 슬롯을 정리합니다. 뒤늦게 인증이 성공하거나 실패해도 권한 조회, 파일 수신, 디코딩을 재개하지 않습니다. 거절된 인증 Promise는 처리하고 취소 리스너는 정리합니다. [구현](../../lib/reference-analysis/studio-analysis-source.ts)

## 검증

- 수정 전 사본을 만든 직후 인증이 대기하면 호출자 취소 뒤에도 요청이 남는 현상을 재현했습니다. 수정 후 세 인증 시점 각각에서 기한 초과와 취소를 확인했습니다. 새 요청은 이전 인증이 여전히 대기 중일 때 같은 단일 슬롯으로 성공했습니다. 이후 이전 인증의 성공·실패가 추가 권한 조회, 수신 또는 디코딩을 일으키지 않았습니다. [집중 시험](../../tests/reference-analysis/studio-analysis-source.test.ts)
- `DREAM_REA_NATIVE_TEST=1 npm test -- tests/reference-analysis tests/p2-3b-timeline.test.ts tests/p2-5a-audio.test.ts tests/storage-private-read.test.ts` 20개 파일 287/287 통과. 범위 TypeScript, 변경 TypeScript ESLint `--max-warnings 0`, `git diff --check` 통과.

## 운영 연결 전 확인 범위

현재 제품 인증은 설치된 SDK의 `getUser(jwt?: string)`을 호출합니다. 호출 인자에 요청 취소 신호를 전달하는 경로가 없습니다. 이번 수정으로 분석 호출의 대기·임시 사본·실행 슬롯을 정리하지만, 시작된 SDK 네트워크 요청은 자체적으로 끝날 수 있습니다. 실제 연동 전에는 인증 전송의 시간 제한과 취소, 종료된 요청에서 뒤늦게 일어날 수 있는 세션 갱신과 쿠키 쓰기를 별도로 검증해야 합니다. 운영 Supabase 호출 없이 로컬 합성 인증으로 시험했습니다. [제품 인증 호출](../../lib/auth/resolve.ts) · [서버 인증 클라이언트](../../lib/auth/server.ts)

## 인계

T287-F1 보완과 자체 검증을 완료했습니다. 세 인증 시점의 대기 중 취소와 시간 제한, 사본·단일 슬롯 정리 및 뒤늦은 인증 결과를 독립 재검수해 주세요.
