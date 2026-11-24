# 관리자 렌더 대기열 GET

`GET /api/admin/render-queue`를 관리자 렌더 대기열의 읽기 서비스에 연결했다. 기존 서버 인증으로 허용 계정을 검증한 뒤 프로젝트 PostgreSQL 읽기 설정과 풀을 사용한다. 현재 연결은 개발의 루프백 요청에서 명시된 격리 DB에만 열린다. 운영 모드와 Vercel에서는 인증 뒤 미연결 상태로 반환한다.

| 상태 | HTTP 결과 |
|---|---|
| 로그인 없음 또는 허용되지 않은 계정 | 401 AUTH_REQUIRED 또는 403 AUTH_FORBIDDEN |
| 읽기 미연결, 설정 불일치 또는 연결 장애 | 503 ADMIN_RENDER_QUEUE_UNAVAILABLE |
| 연결된 본인 계정 | 200과 최대 50건의 `jobs`. 작업이 없으면 `jobs: []` |
| POST | 405 |

라우트 응답은 `private, no-store`이며, 인증 프록시가 먼저 거절할 때에는 공용 `no-store` 응답을 사용한다. 조회 조건의 소유자는 검증된 계정으로 결정된다. HTTP 시험에서 다른 소유자 ID를 쿼리에 넣어도 조회 범위는 본인으로 유지됐다. 실제 PG17 TLS 연결, 본인 목록과 빈 목록, 조회 전후 DB 기록 일치, 임시 프로세스 정리를 검증했다. [조회 서비스 계약](ADMIN-RENDER-QUEUE-READ.md)

```powershell
$env:ADMIN_RENDER_QUEUE_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/admin-render-queue.pg17.mjs
```
