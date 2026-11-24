# T302-F1 잘못된 신호에서도 작업실 분석 슬롯 보존

기준 `2aea4f4` · Backend 자체 검증

작업실 분석은 `AbortSignal`의 런타임 형식, 사전 중단, 요청 제한 시간과 신호 결합을 확인한 뒤에만 실행 슬롯을 점유합니다. 잘못된 형식 또는 신호 설정 실패는 기존 `source_unavailable` 응답으로 돌아가며, 사전 중단된 유효 신호는 `cancelled`를 반환합니다. 인증·등록 권한 조회·파일 읽기는 시작되지 않습니다. 슬롯을 점유한 뒤에는 기존 `finally`에서 반환합니다. [구현](../../lib/reference-analysis/studio-verified-storage-analysis.ts)

## 검증

- 수정 전 잘못된 신호가 Node의 `ERR_INVALID_ARG_TYPE`을 외부로 전달하고, 시간 제한 설정 예외도 같은 경계를 빠져나가는 것을 재현했습니다.
- 수정 후 객체·문자열·`null`·위조 신호, 사전 중단, 시간 제한 및 신호 결합 실패를 대조했습니다. 모든 거절에서 인증·권한 조회·루프백 요청은 0건이고, 같은 `maxConcurrent=1` 인스턴스의 실제 신호 요청은 성공했습니다. 기존 취소·기한·Windows 네이티브 사본 정리도 회귀했습니다. [집중 시험](../../tests/reference-analysis/studio-verified-storage-analysis.test.ts)
- 네이티브 REA·저장소·공개·관리자 큐 회귀 36개 파일 447건 통과, 1건 건너뜀. 범위 TypeScript와 ESLint `--max-warnings 0` 통과.

제품·운영·배포에는 연결하지 않았습니다. 독립 재검수는 잘못된 런타임 인자와 신호 설정 예외 뒤의 단일 슬롯 재사용을 포함합니다.
