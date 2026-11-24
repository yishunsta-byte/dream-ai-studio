# 관리자 렌더 대기열 읽기

`readAdminRenderQueue({ resolveAuth, getPool })`는 서버에서 검증한 관리자 계정의 렌더 작업 목록을 반환한다. 기존 관리자 허용 계정 인증 판정과 승인된 프로젝트 PostgreSQL 풀을 호출자가 전달한다. 인증 거절이나 잘못된 계정 ID에서는 풀을 요청하지 않는다.

| 항목 | 계약 |
|---|---|
| 범위 | 현재 로그인 계정 소유의 보관되지 않은 프로젝트. `dream.jobs`의 `render-prepare`와 기존 `render` 유형을 조회한다. |
| 정렬 | 생성 시각 내림차순, 동률은 작업 ID 내림차순. 필터가 적용된 전체 목록 중 최대 50건. |
| 표시 | 작업 ID, 프로젝트 ID·제목, 상태·한글 표시, 생성·갱신·완료 시각. 상태는 대기, 진행 중, 성공, 실패, 취소다. |
| 결과 | 성공은 200과 `{ jobs }`. 빈 목록은 `jobs: []`다. 로그인 필요는 401, 제한 계정은 403, 연결 실패는 503 `ADMIN_RENDER_QUEUE_UNAVAILABLE`이다. 모든 응답은 `private, no-store`다. |

기존 `withActorTransaction`의 읽기 전용 반복 읽기와 `dream_api` RLS를 사용한다. 조회는 요청에서 소유자 ID를 받지 않으며, 입력 스냅샷과 공급자 작업 ID·원문 오류는 반환 목록에 포함하지 않는다. 현재 관리자 화면과 공용 API 연결은 후속 작업이다. 이 서비스는 명시적으로 주입된 PostgreSQL 풀을 사용한다. T362의 HTTPS 뷰는 프로젝트 읽기 전용이므로 대기열의 운영 연결에는 해당 데이터와 권한 검증이 별도로 필요하다. [T362 운영 판정](T362-OPERATIONAL-READ-HANDOVER.md)

PG17.12 시험은 기존 격리 실행기를 통해 실제 제한 로그인으로 수행했다. 소유 프로젝트 두 개의 렌더 55건에서 동률 정렬과 50건 상한, 다른 계정과 보관 프로젝트 및 백업 작업 제외, 다섯 상태, 빈 목록, 풀 연결 실패, 인증 전 풀 호출 0을 확인했다. 같은 연결에서 계정을 바꿔도 소유권이 유지됐고 작업·프로젝트의 원문 및 행 버전과 렌더·활동 기록 수가 같았다.

```powershell
node --conditions=react-server --import tsx tests/postgres/admin-render-queue.pg17.mjs
```
