# T352-F1 프로젝트 상세의 응답 범위 검증

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_504da82a7b19` · 기준 `1c3c330`

상세의 JSON 행 수와 성공 응답의 `Content-Range`를 함께 대조한다. 목록에 적용되던 정확 범위 계산을 공유하며 상세는 최대 한 행만 허용한다. [조회 어댑터](../../lib/services/project-https-read.ts)

| 실제 상세 응답 | 앱 응답 |
| --- | --- |
| 빈 배열과 정확한 `*/0` | 기존 404 `NOT_FOUND` |
| 정확한 `0-0/1`과 조회한 ID에 일치하는 유효한 한 행 | 기존 200 상세 DTO |
| 범위 누락·비정규 표기·행 수 불일치·복수 행·다른 ID | 기존 503 `PROJECT_READ_UNAVAILABLE` |

성공·실패 응답에 기존 `no-store`를 유지한다. 상세 시험은 빈 배열의 `*/1`, 한 행의 `0-0/2`, 근거 없는 총건수, 누락과 범위 오류, 두 행 및 잘못된 ID를 다룬다. 목록의 정확 건수·인증은 기존 회귀로 확인한다. [집중 시험](../../tests/postgres/t352-project-https-read.test.ts)

`npm test -- --maxWorkers=1 tests/postgres/t352-project-https-read.test.ts tests/postgres/project-read-request.test.ts tests/postgres/project-read-backend.test.ts`로 88건을 통과했다. 변경 파일 ESLint 및 생성 `.next` 검증기 제외 소스 TypeScript도 통과했다. 검증 범위는 모의 PostgREST 응답과 로컬 코드 검사다.
