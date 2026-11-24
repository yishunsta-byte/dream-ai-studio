# 기존 로컬 PG 프로젝트에 두 번째 PNG 연결

Master 배정 `msg_939f24ce91a2`. `2b892d9` 기준에서 프로젝트 생성은 단일 검증 PNG를 제품 사진으로 저장했고, 제작 목록은 그 연결만 읽었다. 생성 후 PNG를 추가하는 제품 경로를 연결했다.

기획을 승인한 프로젝트의 제작 화면에서 **제작용 PNG 추가**를 열고 1 MiB 이하의 PNG와 출처·권리 메모를 입력한다. 연결한 원본은 장면별 **PNG 원본** 선택에 추가된다. 제작 승인 전 등록한 두 원본을 서로 다른 장면의 결과로 선택할 수 있다.

- 기존 업로드를 재사용한다. 같은 파일과 권리 메모로 연결을 재시도하면 업로드에서 발급된 자료 ID를 재사용한다. 서버는 연결 전에 원본의 현재 검증을 확인하고, 같은 자료 ID의 연결은 한 건만 유지한다. 연결돼 있는 다른 자료와 SHA-256이 같으면 중복 연결을 거절한다.
- 생성 시 입력과 최초 `productAssets` 연결은 보존된다. 추가 연결에는 `productionImage`를 사용하며, 결과 등록과 제작 승인 시 두 종류의 연결을 읽는다.
- 화면은 `components/cloud/project-png-attachment.tsx`, `components/cloud/project-production-scenes.tsx`를 변경했다. 서버와 DB 권한은 `lib/cloud/local-project-production.ts`, `lib/db/postgres/local-project-brief/local.sql`에 있다. HTTP 회귀는 `tests/postgres/local-project-brief-http.mjs`, `tests/postgres/t371-project-create-http.mjs`에 추가했다.

## 검증

- 관련 회귀 시험 283건과 변경 파일 ESLint 통과. 공유 작업본의 별도 자막 변경에서 타입 오류와 HTTP 시험용 모듈 복사 누락이 발생해 Master에게 `msg_e72aedce5e19`로 전달했다. 실제 PG17과 브라우저 시험은 `2b892d9` 기준 사본에 이 변경을 적용해 진행했다.
- 고정 사본에서 전체 타입 검사, 관련 회귀 276건, `T371_VERIFY_HTTP=1`로 실행한 `node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs` 모두 통과. 타인·보관·구버전·같은 SHA의 별도 자료를 거절했다. 동시 연결은 201/200을 반환했고 연결과 활동 기록은 각각 한 건 늘었다. 생성 입력에 최초 PNG ID만 남은 것을 확인했다.
- Chromium에서 첫 PNG가 있는 프로젝트에 두 번째 PNG와 권리 메모를 추가했다. 연결 성공 응답을 유실시킨 뒤 같은 파일로 재시도해 한 번의 업로드와 동일 자료 ID의 201/200 응답을 확인했다. 장면별로 서로 다른 PNG를 등록·선택했고 새로고침 뒤 두 선택과 DB 권리 메모가 유지됐다.
- 자막 작업 `0dbc51d` 반영 이후 공유 작업본에서 전체 타입 검사와 관련 회귀 283건, 실제 PG17 HTTP 통합 시험을 다시 실행해 모두 통과했다.

## Master에게 전달할 결과

> 기존 프로젝트의 제작 단계에서 검증 PNG를 하나 더 연결할 수 있습니다. 생성 입력과 첫 연결을 보존하고, 장면별로 서로 다른 이미지 결과를 등록해 선택할 수 있습니다. 새로고침, 연결 응답을 받지 못한 뒤 재시도, 타인·보관·중복으로 인한 차단을 독립 검수해 주세요.
