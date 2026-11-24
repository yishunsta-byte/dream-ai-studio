# T305 작업실 API와 단일 검증 사본 분석 연결

T301·T302-F1 수용 기준 · Backend 자체 검증

공통 `createStudioAnalysisConnection`이 등록 자료 목록과 전체 분석 함수를 같은 권한 공급자에서 받도록 확장했습니다. 등록 자료 조회와 분석 동작이 모두 있어야 양쪽 진입점이 연결됩니다. 이전 파일 조회 공급자도 지원하며, 전체 분석과 기존 조회를 동시에 설정하거나 필수 항목을 빼면 양쪽 연결을 닫습니다. [공통 연결](../../lib/reference-analysis/studio-analysis-connection.ts)

POST는 기존 인증, 동일 출처, 1KB·두 ID 검사를 거쳐 `analyzeRegisteredSource(actor, selection, signal)`에 인증된 계정과 선택만 전달합니다. 격리 공급자는 같은 계정을 모든 재인증에 결합하고 T302 호출 전체를 실행합니다. 임시 경로는 T300 콜백에서만 사용됩니다. 기존 T284 결과 DTO와 `no-store`, 요청 취소·기한 및 최종 등록 권한 검사를 유지했습니다. [POST 구현](../../lib/reference-analysis/studio-analysis-http.ts)

## 검증

- 깨끗한 `4f26134` 사본에 연결 변경과 합성 공급자만 주입해 실제 Next.js, Supabase SDK, 루프백 Auth와 Storage를 실행했습니다. 목록만 있는 구성은 GET 미연결·POST 503이었고 분석 권한 조회와 파일 다운로드는 0건이었습니다.
- 완비 구성에서 실제 `/cloud/reference-analysis` GET 뒤 등록 자료 POST를 A/B/A로 실행했습니다. 다른 계정 목록·자료, 미인증, 교차 출처 요청 및 1KB 초과 요청을 차단했습니다. 성공마다 객체 GET 한 번과 공개 가능한 분석 DTO를 확인했습니다. 다운로드 직후 권한 철회 시 결과와 목록에서 자료가 사라졌습니다. 저장소 사본을 보유한 분석이 연결 중단되면 권한 요청을 끊고 사본을 정리했고, 다시 분석할 수 있었습니다. 두 Next 프로세스와 임시 사본을 정리했습니다. [실제 Next 루프백 시험](../../tests/reference-analysis/studio-verified-storage-http.native.ts)
- `node --import tsx tests/reference-analysis/studio-verified-storage-http.native.ts` 통과. 집중 시험은 부분·혼합 구성에서 분석을 호출하지 않는지, 새 진입점에 서버에서 확인한 계정이 전달되는지, 기한·취소 이후 늦은 응답이 전달되지 않는지 확인했습니다. REA·저장소·공개·관리자 큐·공용 인증 37개 파일 575건 통과, 1건 건너뜀. 범위 TypeScript와 ESLint `--max-warnings 0` 통과.

운영 공통 연결의 기본값은 닫혀 있습니다. 실제 운영 등록 권한·스토리지 설정, 공용 Auth, 권한 SQL 및 배포에는 변경 사항이 없습니다.
