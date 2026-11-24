# T343 게시 설치 확인과 실제 DB 세션의 OID 대조

2026-11-19 KST · Codex(Backend) · Master 배정 `msg_bf97c693f7ca` · 기준 `633d319`

T342가 T341의 승인 계획에 기록된 DB OID를 T336 구성에 전달한다. 서버 설정에 OID가 명시된 경우 승인 계획과 일치해야 한다. T330은 관리자 게시·공개 목록·표지에 쓰는 각 직접 TLS 세션에서 현재 DB OID를 읽고 승인값과 대조한 뒤에만 SQL 작업을 시작한다.

기동 검증에서 OID가 다르면 공급원을 조립하지 않고 연결 그룹을 정리한다. 기동 후 새 작업 접속에서 OID가 다르면 그 작업의 콜백 전에 차단하고 연결 그룹 전체를 닫는다. T330의 기존 독립 호출은 같은 세션 간 일치 검증을 유지한다. 호스트·포트·DB 이름·클러스터 식별자의 기존 반환 형식도 유지한다.

## 소유 PostgreSQL 17 직접 TLS 검증

- 기본 PG17 실행 모드에서 역할별 실제 세션의 OID를 확인한 다음, 같은 클러스터의 DB를 복제해 원래 이름에 놓았다. 기존 세션 그룹은 관리자·목록·표지 각각 새 연결에서 차단됐고, 원래 승인 OID로 여는 새 그룹도 비활성으로 종료됐다. 복제된 DB의 별도 OID가 입력된 새 T330 검증은 통과했다. 이 시험은 T330의 접속 확인 범위를 검증한다.
- `--sealed-publication-runtime` 모드에서는 같은 이름과 TLS 설정이어도 승인 계획의 OID 또는 서버 설정의 OID가 다른 경우 공급원이 비활성으로 닫히고 비공개 Storage가 호출되지 않았다. 맞는 OID로 관리자 게시, 공개 목록, 비공개 Storage WebP 표시 및 철회 후 404를 확인했다.
- 실행 명령은 `node --conditions=react-server --import tsx tests/public-showcase/t328-publication-db-preflight.pg17.ts`와 동일 명령에 `--sealed-publication-runtime`을 붙인 두 가지다. 두 모드의 세션과 테스트 클러스터를 정리했다.
- 관리자·공개·Storage Vitest 단일 워커 299건, 변경 파일 ESLint, 생성된 `.next` 검증기 제외 소스 TypeScript 검사를 통과했다.
- 제품 기본 구성은 `undefined`다. 가동 중 설치 이력 재검증과 관리형 환경 검증은 후속 범위다.
