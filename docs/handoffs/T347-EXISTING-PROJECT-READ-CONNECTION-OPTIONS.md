# T347 기존 프로젝트의 내 프로젝트 읽기 경로 결정안

2026-11-19 KST · Codes(Backend) · 배정 `msg_249668d46fde` · 읽기 계약 `59778be`

**다음 실행안은 Supabase Auth 기반 HTTPS Data API의 읽기 전용 격리 검증이다.** 기존 Supabase·Vercel을 유지한다. 지금 실행 가능한 후보로는 실제 사용자 데이터에 접속하지 않고 인증·행 격리·응답 동등성을 먼저 확인할 수 있다. 제품 연결은 현재 보류다. 근거는 T346의 고정본 계약과 Master의 추가 관측이며, 이번 대조에서 현재 프로젝트의 네트워크·DB·설정을 새로 실측하지 않았다. [T346 사전 점검](T346-EXISTING-PROJECT-READ-PREFLIGHT.md) · [Master 기록](../TEAM.md)

## 경로 비교

| 경로 | 확인된 근거 | 변경 부담과 판정 |
| --- | --- | --- |
| **기존 호스트의 PostgreSQL Direct IPv6** | Master 관측에서 Direct 주소는 A 0·AAAA 1이고 메인 PC의 IPv6 TCP 5432는 `NetworkUnreachable`이었다. Orca에 등록된 원격 환경은 0개였다. 기존 맥미니는 Tester 역할만 기록돼 있다. 실제 실행 호스트의 승인·IPv6 경로와 제한 로그인은 확인되지 않았다. Supabase 공식 문서는 IPv4 옵션이 없는 Direct를 IPv6 경로로 설명하며, Vercel을 IPv4 호환 경로가 필요한 사례로 든다. | 승인된 기존 호스트와 네트워크가 확인되면 일회성 DB 읽기 점검의 코드 변경 부담은 낮다. 별도 장비에서 Direct 사전 점검을 통과해도 기존 Vercel Node 런타임의 접속 증거가 생기는 것은 아니다. 앱 자체가 쓰는 승인된 호스트에서 인증서·호스트 이름, 실제 DB 세션의 TLS, 제한 읽기·RLS와 대상 일치를 확보해야 한다. [Master 기록](../TEAM.md) · [T323 장비 근거](T323-REA-TWO-HOST-STAGING-READINESS.md) · [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres) · [IPv4·IPv6 호환성](https://supabase.com/docs/guides/platform/ipv4-address) |
| **기존 공유 Session pooler** | B8/B11은 공식 CA 및 호스트 검증을 포함한 클라이언트→pooler TLS 성공을 기록했다. 같은 SQL 세션의 `pg_stat_ssl.ssl`은 당시 `false`였다. 당시 접속은 `CREATEROLE`·DB `CREATE`가 있는 관리 계정이었다. B9-R은 로컬의 이관 계약 검수다. | IPv4 경로의 연결 후보지만 현재 앱의 실제 TLS와 최소권한 증거가 부족하다. Session을 채택하려면 동일 대상의 제한 로그인과 신뢰 경로를 확인하고 필요한 TLS 조건 및 역할·actor 복귀를 재검증한다. Transaction pooler는 별도 모드이며 기존 Session 결과를 공유하지 않는다. 운영 SSL 변경은 별도 결정이다. [B8 실측](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B11 범위](B11-SSL-CHANGE-READINESS.md) · [B9-R](B9-R-SESSION-MIGRATION-REVIEW.md) · [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres) |
| **Supabase Auth + HTTPS Data API** | 공급자는 HTTPS REST, 사용자 JWT, Postgres 권한 및 RLS를 지원한다. 이 프로젝트에서 대상 스키마·제한 뷰 및 정책이 적용돼 있는지와 현재 Data API 노출 범위는 미확인이다. 이 경로의 보안 근거는 서버→Data API HTTPS와 사용자 JWT에 따른 DB 권한이다. | 기존 플랫폼과 플랜 범위에서 별도 IPv4 옵션 없이 검토할 수 있다. 실제 추가 비용 0은 현재 플랜·사용량 및 서버 호출 규모를 권한 있는 담당자가 확인해야 한다. 준비 비용은 DB 읽기 표면·RLS 이관, 어댑터 및 사용자 권한 회귀와 되돌림 검증이다. [Supabase REST 계약](https://supabase.com/docs/guides/api) · [API 보안](https://supabase.com/docs/guides/api/securing-your-api) · [Egress 사용량](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| **IPv4 유료 옵션** | 공급자의 기존 DB Direct용 유료 옵션은 DNS 주소 계열을 바꾸며 플랜 조건이 있다. | 비용과 운영 영향이 발생할 수 있어 이번 무추가비용 실행안에서 제외한다. [Supabase IPv4 옵션](https://supabase.com/docs/guides/platform/ipv4-address) |

## HTTPS 읽기 검증에서 보존할 계약

1. Vercel의 기존 서버 경로에서 Supabase `getUser`와 앱 허용 계정 확인을 수행한 뒤 해당 사용자의 JWT로 읽는다. 공개용 프로젝트 키의 역할은 프로젝트 식별이다. 행 선택은 JWT와 DB 정책이 맡는다. `service_role`이나 DB 관리자 자격은 이 사용자 읽기 경로의 권한에서 제외한다. [현재 인증](../../lib/auth/resolve.ts) · [현재 읽기 요청](../../lib/services/postgres/project-read-request.ts) · [Supabase 사용자 JWT와 RLS](https://supabase.com/docs/guides/database/secure-data)
2. 기존 RLS는 `dream_api`와 transaction-local `dream.actor_id`에 묶여 있다. HTTPS에서는 이 계약을 단순 설정 교체로 재현할 수 없다. 기반 이관이 있는 합성 PG17에서만 별도 읽기 스키마와 `security_invoker` 투영을 검토한다. 필요한 프로젝트·단계·렌더 상태 자료만 남기고 `authenticated`의 객체·열별 `SELECT`와 SELECT 전용 RLS를 최소 범위로 설계한다. 소유자는 `auth.uid()`에서 가져오고 앱에서 차단된 사용자도 직접 Data API를 통해 읽지 못하도록 별도 DB 승인 조건을 적용한다. 기본 `dream`/Auth 스키마와 쓰기 함수는 API 노출 대상에서 제외한다. 기반이 미적용이면 별도 기반 이관 승인과 검증이 필요하고, HTTP 경로 도입 시에도 노출 스키마·ACL·RLS 변경은 버전 관리와 독립 검수를 거친다. [고정 RLS](../../lib/db/postgres/0003_rls.sql) · [프로젝트 저장소](../../lib/repo/postgres/projects.ts) · [Supabase RLS와 invoker 뷰](https://supabase.com/docs/guides/database/postgres/row-level-security) · [노출 스키마](https://supabase.com/docs/guides/api/using-custom-schemas)
3. 호출자 권한으로 읽는 뷰에 필요한 내부 테이블 권한은 열 단위로 검토한다. `authenticated`에 기존 쓰기 역할 `dream_api`나 `dream_worker` 멤버십을 부여하지 않고, 기존에 노출된 객체나 함수를 통해 새 권한이 이어지는지도 확인한다. 목록과 상세 각각은 프로젝트·단계·상태를 한 번의 DB 읽기로 구성해 리비전 혼합을 방지한다. 승인된 A/B·차단 계정·익명, 자기 상세·타인/보관/미존재 상세, 직접 Data API 호출의 접근 제한, 쓰기 거부, `no-store`와 실패 시 503을 확인한다. 목록 크기와 페이지 계약, 표시 데이터와 오류의 기존 경계를 확인한다. [현재 읽기 서비스](../../lib/services/postgres/project-reads.ts) · [현재 트랜잭션](../../lib/db/postgres/transaction.ts) · [T259-R 격리 증거](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)

## 실행 책임과 사용자 결정

- **지금** · Master가 Backend에 로컬 격리 검증을 배정하면 시작할 수 있다. 사용자에게 추가 선택을 받을 단계는 아직 없다. 합성 A/B 인증과 PG17 기반으로 증거를 만들고 Tester에 독립 검수를 맡긴다. 기존 프로젝트의 설정·스키마·계정·배포는 이 단계에서 그대로 둔다.
- **운영 적용 직전** · Master는 지정 플랫폼·DB 담당으로부터 기존 프로젝트의 Data API 활성 상태·노출 스키마·기반 버전·현재 접근 범위의 비밀값 없는 확인을 받는다. 사용자 또는 이미 위임받은 운영 권한자가 범위가 명시된 스키마·권한 변경, 시험 계정/자료 읽기, 기존 Vercel 배포 적용과 복귀를 승인해야 한다. DB 담당에게 승인 이관·권한 회수 권한, 플랫폼 담당에게 노출 설정과 복귀 권한, 배포 담당에게 지정 배포 전환 권한이 필요하다. 실제 플랜 한도나 비용 범위를 넘는 경우에만 비용 결정을 사용자에게 올린다.
- **복귀 판정** · 인증·소유자 격리·동등성 또는 운영 대상 검증에 실패하면 읽기 연결을 닫아 기존 미연결 응답으로 되돌린다. 승인된 담당이 배포와 읽기 표면의 접근을 회수하고 이력 및 감사 근거를 보존한다. [T346 되돌림](T346-EXISTING-PROJECT-READ-PREFLIGHT.md)

이번 작업은 문서·고정 소스·공식 공개 문서 대조다.
