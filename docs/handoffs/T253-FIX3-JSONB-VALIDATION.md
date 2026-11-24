# T253-FIX3 표시 객체 JSONB 검증

독립 검수 `ecb581dd83098b0e9dda3bd92c52f1175f1d1bda`의 첫 PG17.12 실행은 DDL 및 첫 권한 검사를 통과한 뒤 준비 요청에서 `invalid input syntax for type json`으로 중단됐다. 실패 조건의 `payload->'display' - ARRAY[...]`에서 키 제거가 먼저 묶였다. SQL 한 줄을 `(payload->'display') - ARRAY[...]`로 수정했다. 나머지 키 제거는 최상위 `payload`에 직접 적용되고, 객체 추출 뒤 형 변환과 문자열 결합은 이미 괄호로 묶여 있음을 대조했다.

러너에 정상 표시 필드의 준비·완료·파일 조회와 추가 필드 거부를 한 사례로 추가했다. 준비와 완료에서 각각 추가 표시 키가 있으면 SQLSTATE `22023`과 `invalid manifest bounds`를 요구한다. 거절 직후 같은 요청 ID로 정상 manifest를 보내 성공하는지도 확인한다. 활성화 전에는 파일 조회 결과가 비어 있어야 한다. 성공 대조군은 다음 사례에 영향을 주지 않도록 철회한다.

러너 strict TypeScript, ESLint 경고 0개 및 변경 경로 공백 검사를 통과했다. 이번 작업에서는 PostgreSQL 실행을 하지 않았다. 새 사례와 이전 실행이 도달하지 못한 잠금·공존 RLS·롤백 검증은 Tester의 다음 폐기 PG17 실행에서 확인한다.

| 변경 파일 | SHA-256 |
|---|---|
| 시험 SQL | `7b9a252ec3093df0c7e7b900555d081baa1e5a5a8a20a2f18ce27c7c03f2b46c` |
| 러너 | `49e75b87f6b6247f07f6487ce75d5ec65ca8cb7dc095bc63d1a9483693e6101b` |

첫 실행의 출력과 종료 코드 `tmp/t253-r2-f2b3479-review/first-run.txt`, `first-run.exit`, 원 서버 로그와 종료 증거 `tmp/t253_654d2c206a23468182ee2ab584a4c61e/postgres.log`, `cleanup.json`은 읽기 전용으로 해시를 확인했다.

Master 전달문 — T253-FIX3은 하위 표시 객체를 먼저 추출하도록 괄호를 추가하고, 정상 manifest 성공과 추가 표시 키 거부를 준비·완료 양쪽에 추가했다. 타입·린트 통과. 최초 PG17 실패 자료와 종료 증거를 보존했고 이번 수정본의 PG17 재실행은 Tester에게 반환한다.
