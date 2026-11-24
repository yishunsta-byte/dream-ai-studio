# 프로젝트 생성 폼의 요청 키와 재시도

개발 플랜 9절 5번 중 생성 폼 제출을 담당했다. API 계약 기준은 T371 구현 6164808이다. 새 프로젝트 화면의 ProjectForm이 기존 본문과 함께 소문자 UUIDv7 Idempotency-Key를 전송한다. 폼이 열린 동안 응답을 잃으면 같은 제출 본문으로 다시 시도할 때 키를 유지한다. 입력을 바꿔 제출하면 새 키를 사용한다. 요청 진행 중과 성공 후 화면 이동 중에는 추가 POST를 차단한다.

| 검증 | 결과 |
|---|---|
| 응답 유실 후 재시도 | fetch 실패 후 같은 폼에서 URL·본문·요청 키 일치, 재시도 성공 |
| 입력 수정 | 필드 오류 표시용 값을 보존하고 수정한 입력은 새 키로 전송 |
| 연속 제출 | 요청 완료 전과 성공 직후 추가 제출을 시도해 POST 1회 확인 |
| 회귀·정적 검사 | 새 시험 포함 Vitest 12건 통과, 별도 환경이 필요한 기존 PG 시험 30건 제외. 변경 경로 ESLint 및 폼·시험 진입점 TypeScript 진단 0건 |

변경 경로는 components/project-form.tsx, components/project-form-request.ts, tests/project-form-request.test.ts다. 재현 명령은 다음과 같다.

```powershell
node node_modules/vitest/vitest.mjs run tests/project-form-request.test.ts tests/postgres/project-create.test.ts tests/postgres/project-create-storage-integration.test.ts tests/postgres/project-create-integration.test.ts
node node_modules/eslint/bin/eslint.js components/project-form.tsx components/project-form-request.ts tests/project-form-request.test.ts
```

검수 구분은 구현자 자체 시험이다. 버튼부터 운영 저장까지의 브라우저 검증은 남아 있다. 페이지 새로고침 후에는 새 폼 인스턴스가 생긴다. 서버의 동일 키 재시도 보장은 T371의 선택형 PG17 경로에 해당한다. 기존 SQLite는 키를 저장하지 않으므로 응답 유실 뒤 사용자가 재시도하면 중복될 수 있다. PG 검증 자료 목록을 폼에서 선택하는 연결은 별도 작업이다.

> Master 전달문 — 생성 폼의 UUIDv7 요청 키 전달과 응답 유실 후 재사용을 구현했습니다. 중복 클릭 및 수정 후 새 요청을 포함한 자체 시험과 정적 검사를 통과했습니다. T371-R의 서버 검수 근거와 함께 독립 검수할 수 있습니다.
