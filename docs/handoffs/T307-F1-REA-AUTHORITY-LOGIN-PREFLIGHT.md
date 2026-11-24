# T307-F1 등록 분석 DB 로그인 최소 권한 검증

T307-R의 F307-1을 수정했다. DB 시작 검증에서 `session_user`로 실제 로그인 역할을, `current_user`로 전환한 읽기 역할을 확인한다. 실제 로그인 역할에는 `LOGIN`이 필요하고 전환한 읽기 역할에는 `NOLOGIN`이 필요하다. 두 역할 모두 `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `SUPERUSER`, `REPLICATION`이 있으면 연결을 거절한다.

기존 데이터베이스·루프백·격리 수준·쓰기 역할 멤버십·RLS 검증도 적용한다. 시작 검증에 실패하면 자료 조회 SQL의 계획을 요청하기 전에 트랜잭션 연결을 폐기하고 풀을 닫는다. 운영 연결에 필요한 복원 및 자료 증거 발급 조건은 [T307 인계 문서](./T307-REA-REGISTERED-AUTHORITY-STORE.md)에 있다.

## 검증

- 소유 루프백 PostgreSQL 17.12에서 두 역할에 다섯 가지 초과 권한을 각각 부여하고, 읽기 역할의 `LOGIN`도 확인했다. 11가지 모두 공급자 생성이 거절됐다. PostgreSQL 로그에서 역할 검사 실행과 자료 조회 SQL 미실행을 확인했고, 각 경우 백엔드 연결 0건을 확인했다.
- 각 권한을 원복한 직후 공급자 연결과 목록 조회를 확인했다. 기존 계정 A·B 격리, 권한 철회·재연결, 증거 만료, 조회 기한·취소 및 클러스터 정리 검사도 통과했다.
- REA Vitest 213개 통과, 조건부 64개 건너뜀. 대상 TypeScript와 ESLint 통과. 공유 작업공간의 전체 TypeScript 검사에는 삭제된 Studio 경로를 참조하는 기존 `.next` 검증 파일 오류 4건이 남아 있다.

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
```
