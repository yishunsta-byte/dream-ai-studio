# T262-R 보호 Preview 런타임 TLS 사전점검 독립 검토

2026-11-18 KST · Codex(Tester) · 기준 `cbf9b3cbbad2234470da2411fb9dceb4932d3f5a` · 배정 `msg_4489d46a943a`

**판정은 조건부 설계 수용, 구현·실행·읽기 opt-in 보류.** 기존 서버 인증과 제한 API 풀을 재사용하는 방향은 고정 코드와 일치한다. 승인된 보호 Preview–시험 Supabase 매핑, 신뢰 가능한 배포 식별 경로, 배포 전체에서 원자적으로 한 번만 소비되는 승인, opt-in 전환 후보의 제품 GET 접근 제한과 해제 방식은 현재 기록에서 입증되지 않았다. 이 네 가지가 확인되기 전에는 실행 경로를 열 수 없다. 운영 `DEC-SSL-01`은 대기 상태다. [T262 설계](T262-PREVIEW-RUNTIME-TLS-PREFLIGHT.md) · [팀 기록](../TEAM.md) · [개발 계획](../MASTER_DEVELOPMENT_PLAN.md)

## 인증과 배포·대상 바인딩

- `/admin`은 동적 렌더링에서 verified 계정을 확인한다. `getRenderAuth`는 렌더용 캐시다. Action은 명시적인 POST마다 `resolveServerAuth()`를 직접 호출해 Supabase `getUser` 검증을 통과한 UUID를 승인된 담당자 UUID와 대조해야 한다. 일반 허용 계정, local 상태, 렌더·prefetch에는 진단 정보나 checkout이 발생하지 않아야 한다. `instrumentation.register`는 Node 인스턴스 시작 시 실행되므로 담당자의 승인된 호출을 입증할 수 없다. [관리 페이지](../../app/admin/page.tsx) · [렌더 인증](../../lib/auth/render.ts) · [서버 인증](../../lib/auth/resolve.ts) · [시작 훅](../../instrumentation.ts)
- 연결 전에 보호 Preview의 배포 ID, 정확한 소스 SHA, Node 런타임, 리전, 정확한 HTTPS origin, 시험 Auth ref와 DB 프로필을 승인과 대조한다. 배포 담당이 원장과 현재 런타임의 신뢰 가능한 서버 측 값을 연결하는 방법을 입증해야 한다. 현재 인증 설정의 일반 허용 origin에는 운영 주소도 포함될 수 있다. 요청 host·forwarded 헤더나 브라우저 입력만으로 배포와 대상의 일치를 판정하면 안 된다. [인증 설정](../../lib/auth/config.ts)
- 제품 GET은 읽기 선택기 통과 후 풀에 접근한다. 진단은 동일 생성 경로와 제한 API 자격을 사용하고, checkout 전에 고정 DNS/포트, DB, Auth ref, Session 라우팅 로그인과 SQL 역할의 기대값, CA 정책을 비교한다. 문법 검증의 공유가 필요하면 순수 함수만 분리한다. 로그인 이름 일치는 권한 제한의 증명이 아니므로 대상에 귀속된 역할 승인 증거와 연결하고, 부족하면 같은 읽기 전용 트랜잭션에서 승인 범위의 역할 속성을 확인한다. 실제 앱 풀이 명시 CA를 쓰지 않는 상태에서 명시 CA가 필요해지면, 앱 풀과 진단에 같은 설정을 적용하는 변경을 별도로 검토한다. [제품 읽기 요청](../../lib/services/postgres/project-read-request.ts) · [읽기 선택기](../../lib/services/postgres/project-read-backend.ts) · [런타임 풀](../../lib/services/postgres/project-read-pool.ts) · [공유 연결 설정](../../lib/db/postgres/connection.ts)

## 승인 소비와 영수증

- 승인된 비공개 호출 수단 또는 독립된 공유 저장소가 현재 승인 상태, 만료와 run ID·배포·대상·담당자의 일치를 하나의 원자적 조건부 갱신으로 검사하고 기록해야 한다. 모든 인스턴스가 같은 기록을 읽으며, 소비 성공이 확정된 한 호출만 checkout한다. 타임아웃 등으로 갱신 결과를 알 수 없으면 checkout 없이 종료한다. 진단·영수증 저장 실패나 프로세스 종료 뒤에도 소비를 되돌리지 않는다. 프로세스 메모리는 인스턴스를 넘을 수 없고, 시험 대상 DB에 소비를 기록하려면 소비 전에 대상에 접속해야 한다. 두 방식 모두 전제에 맞지 않는다. 현재 승인된 공유 수단은 미확인이다.
- 지정된 접근 범위에서 안전한 run·대상 참조와 소비·완료·결과 미확인 상태를 대조할 수 있어야 한다. 관측 UTC, 배포 ID/SHA/리전, TLS와 호스트·역할·startup 판정, `pg_stat_ssl` 행 수와 결과, 롤백·반환 또는 폐기 상태를 남긴다. 브라우저에는 상태나 영수증 참조만 제공하고 원시 DSN, 자격, 계정 식별자, 인증서, 드라이버 오류와 SQL 결과는 노출하지 않는다. 한 번 소비됐다는 기록과 점검이 완료됐다는 기록을 각각 검증한다.

## 같은 제한 client에서 입증 가능한 범위

- 로컬 설치본 `pg` 8.23.1의 `lib/connection.js`는 TLS 전환에서 DNS host를 `servername`으로 지정하고 연결 stream을 TLS stream으로 교체한다. 앱의 공유 연결 설정은 정상 경로에서 `rejectUnauthorized: true`를 적용한다. 같은 대여 client의 실제 `TLSSocket`에서 `authorized === true`와 승인 DNS에 대한 피어 검증이 모두 확인돼야 한다. `tls.checkServerIdentity`는 호스트 일치를 확인하고, CA 검증은 같은 소켓의 인증 상태와 승인된 신뢰 설정으로 입증한다. 이 stream 접근은 `pg` 내부 형태에 의존하므로 버전에 묶인 좁은 어댑터와 Node 런타임 호환 확인이 필요하다. 관측할 수 없으면 미확인으로 처리한다. [공유 연결 설정](../../lib/db/postgres/connection.ts) · [고정 의존성](../../package.json)
- 같은 client의 `BEGIN READ ONLY` 트랜잭션에서 PG17, DB·port, `session_user = current_user`, 승인 역할 및 startup 설정을 확인하고 `pg_catalog.pg_stat_ssl`에서 `pid = pg_backend_pid()`인 행이 정확히 하나이며 `ssl=true`일 때만 DB 관측을 통과시킨다. `false`, `NULL`, 0행, 복수 행은 각각 기록한다. Session 풀러에서는 실제 소켓이 client→풀러, 자체 `pg_stat_ssl`이 DB에 도달한 백엔드 구간을 관측한다. Direct에서는 두 관측이 같은 구간을 설명할 수 있다. B8의 과거 운영 Session 관측과 T259의 합성 루프백은 해당 Preview의 영수증 범위에 포함되지 않는다. [B8 관측](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [T259-R 검토](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)
- 소비·checkout·SQL·영수증·정리에 전체 시간 제한을 적용한다. 연결/SQL 개별 타임아웃은 전체 기한을 보장하지 않는다. 롤백 완료가 확인된 client를 반환하고, 상태가 불확실하면 대여한 client만 폐기한다. 시간 초과 뒤 늦게 도착한 체크아웃도 정리해야 한다. 프로세스 공유 풀은 유지하며 자동 재시도는 금지한다. [런타임 풀](../../lib/services/postgres/project-read-pool.ts) · [공유 연결 설정](../../lib/db/postgres/connection.ts)

## 재배포 순환 의존성과 최소 후속 범위

1. 최초 후보는 opt-in을 끈 상태에서 점검한다. opt-in 적용으로 새 배포가 생기면 해당 배포 ID/SHA에 귀속된 별도 승인과 새 run으로 다시 검증한다. 최초 영수증은 전환 승인에 연결할 수 있으며 재검증 증거는 새 배포에서 확보한다.
2. **전환 후보에는 Action과 별개로 제품 GET까지 막는 담당자 전용 경계가 필요하다.** 현재 제품 GET의 읽기 플래그와 일반 인증, Action의 시험 담당자 검사만으로는 opt-in 상태에서 일반 허용 사용자의 접근을 막을 근거가 없다. A/B 개방을 배포 ID/SHA 변경 없이 같은 후보에 적용할 수 있는 보호·해제 수단을 배포 담당이 입증해야 한다. 개방에 또 새 배포가 필요하면 재검증이 반복된다. 같은 후보를 검증하고 개방할 수 있는 방법이 확인될 때까지 전환을 보류한다.
3. 소비된 run을 유지한 채 만료·담당 접근을 회수하고, 이전 보호 origin에서도 호출이 거절되며 checkout이 발생하지 않는지 확인한다. 새 배포 생성은 이전 배포 회수의 증거로 사용하지 않는다. A/B 이후 한시 Action을 제거한 새 배포를 검증 대상으로 계속 쓸 경우, 이미 승인된 비공개 호출 경로에서 그 배포의 영수증을 다시 확보한다. 그런 경로가 없으면 제거 배포의 TLS 상태는 미확인이다.
4. 위 수단이 확인되면 기존 승인 경로에서 서버 전용 점검 함수를 호출하는 범위부터 검토한다. 필요한 경우에만 한시 `/admin` Action, 공유 DSN 검사, 버전 고정 TLS 관측 어댑터를 추가한다. 후속 검증은 잘못된 담당자·배포·대상, 여러 인스턴스에서의 동시 호출과 소비 결과 미확인, TLS 관측 실패, 롤백·폐기, 구 배포 회수의 checkout 및 영수증 결과를 확인한다.

이번 검토는 고정 코드·로컬 기록과 설치된 드라이버를 대조했다. 실제 Preview 호출이나 DB 접속, 제품 코드·설정 변경, 배포는 수행하지 않았다.
