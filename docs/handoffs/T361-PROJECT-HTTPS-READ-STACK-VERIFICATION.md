# T361 프로젝트 HTTPS 조회 로컬 통합 검증

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_4b0735de93f3` · 앱 `633c10b` · 설치 후보 `cb29c98`

T356의 프로젝트 목록·상세 GET, 클라우드 목록·상세와 개인 관리 페이지를 T358의 설치·복귀 SQL을 적용한 소유 PostgreSQL 17.12와 PostgREST 16.6에 연결했다. 동일한 실행에서 기존 PostgreSQL 읽기 경로와 응답을 비교하고, 승인 철회와 스키마 복귀 후의 앱 동작까지 확인했다.

| 검증 | 관측 결과 |
| --- | --- |
| 앱과 전송 | 격리한 고정 T356 소스를 실제 Next 개발 서버로 실행했다. 테스트의 표준 형식 Supabase origin은 Next의 테스트 전송에서 루프백 HTTPS 리스너로 고정했다. 해당 인증서를 명시적으로 신뢰할 때만 성공했고, 기본 신뢰 설정의 연결은 거절됐다. 합성 Auth는 시험 A/B의 고정 토큰에만 응답했다. 같은 토큰을 루프백 HTTP로 전달해 실제 PostgREST가 서명과 DB 역할을 처리했다. |
| A/B 소유자 격리 | A/B는 자신의 활성 프로젝트만 조회했다. 익명 401, 타인·보관 상세 404, 성공·오류 API의 `no-store`를 확인했다. 실제 PostgREST의 `Content-Profile: project_read`와 목록·상세 `Content-Range`의 1건·2건·0건을 확인했다. 앱 DTO는 단계 순서만 정규화한 뒤 기존 PostgreSQL 목록·상세 서비스와 깊은 동등성을 확인했다. |
| 클라우드와 승인 회수 | 목록·상세 HTML과 개인 관리의 A/B 프로젝트 수를 확인했다. A의 DB 승인을 회수해도 같은 쿠키의 합성 Auth는 성공했다. 이후 A의 목록은 빈 배열, 상세는 404, 개인 관리에는 빈 상태가 표시됐으며 B의 행은 유지됐다. A를 다시 승인하면 본인 목록이 복원됐다. |
| 기존 쓰기와 복귀 | 설치 이후 기존 `dream_api` 프로젝트·단계 쓰기와 `dream_worker` 작업 갱신이 새 조회에 반영됐다. T358 복귀에서 기존 행·ACL·정책·트리거·기반 이력을 비교하고 기존 쓰기가 계속됨을 확인했다. 스키마 제거 직후 HTTPS 선택 상태의 앱은 실제 PostgREST 실패를 503과 `no-store`로 반환했다. 이어 앱을 비활성 설정으로 재시작했을 때 목록·상세는 503과 `no-store`, 개인 관리는 조회 불가였고 Data API 호출은 0건이었다. |

Auth 응답과 JWT 발급은 합성이다. TLS 증거는 Next→로컬 게이트웨이 구간이며, 게이트웨이→PostgREST는 루프백 HTTP, PostgREST→PG17은 로컬 SCRAM이다. 제품 origin으로 DNS 조회나 요청을 보내지 않았다. 실제 Supabase Auth 발급·HTTPS 인증서와 관리형 Data API 설정, Vercel 런타임, 배포와 세션 갱신은 이 실행의 검증 범위에 포함되지 않는다. 쿠키 갱신은 T356 별도 시험으로 확인한 바 있다. [T356 쿠키 시험](T356-PROJECT-HTTPS-READ-APP-INTEGRATION.md) · [T358 설치 및 복귀](T358-PROJECT-HTTPS-READ-SCHEMA-CANDIDATE.md)

## 기존 Supabase 읽기 전용 사전 점검

기존 프로젝트를 사용할 결정은 완료됐다. 지정 운영 담당과 승인된 실행 경로의 확인은 남아 있다. 기존 기록에서 메인 PC의 Direct IPv6 연결은 실패했으며, 이번에는 재측정하지 않았다. Master가 역할별 담당과 읽기 범위를 확정한 뒤 다음 항목의 일치 여부만 기록한다. [T346 사전 점검](T346-EXISTING-PROJECT-READ-PREFLIGHT.md) · [T347 연결 경로](T347-EXISTING-PROJECT-READ-CONNECTION-OPTIONS.md)

| 실행 담당 | 승인된 읽기 점검 |
| --- | --- |
| Master | 기존 Supabase 프로젝트 ref와 대상 환경, Vercel 프로젝트·배포 ID·커밋·리전, 승인된 실행 호스트·시간·접근 범위, DB 및 플랫폼 운영 담당을 확정한다. 시험 계정 A/B와 자료가 이미 존재하며 조회 승인을 받았는지 확인한다. |
| 지정 Supabase 플랫폼 운영 담당과 Backend | 현재 프로젝트의 Auth/Data API 사용 여부와 노출 중인 스키마 목록을 읽기 확인한다. `project_read`의 설치·노출 여부와 `dream`, `auth`, `project_read_private` 비노출 여부를 기록한다. 후보가 이미 노출된 상태라면 승인된 호스트의 DNS·TCP·HTTPS 인증서 체인과 호스트 이름, 공개 키 종류와 프로젝트 일치, JWT issuer/audience/subject와 Auth 결과의 일치, GET의 프로필·범위 헤더만 확인한다. 키·토큰·쿠키 원문을 기록하지 않는다. |
| 지정 DB 운영 담당과 Backend | 승인된 제한 읽기 세션으로 대상 DB·역할·버전·주 서버, 기반 이력 ID·체크섬, 기존 노출권과 후보 승인/RLS/열 ACL 유무를 대조한다. Direct로 확인할 경우 같은 세션의 호스트·인증서·`pg_stat_ssl.ssl`을 확인한다. 승인된 제한 경로가 없으면 누락 항목을 기록하고 점검을 보류한다. |
| Tester와 지정 Vercel 배포 담당 | 이미 승인된 배포에서 해당 경로가 열려 있고 시험 자료가 있으면 Tester가 A/B·익명 읽기, 자기 상세·타인 상세·응답 상태와 캐시를 확인한다. 배포 담당은 대상 배포와 런타임 일치를 확인한다. 현재 비활성이면 503과 미연결을 기록하고 설정을 변경하지 않는다. |

SQL 설치·복귀, 승인 UUID 등록·회수, 역할·ACL이나 Data API 노출 변경, Vercel의 기능 설정·배포는 별도의 운영 변경이다. 명시적으로 승인된 뒤 DB 운영 담당은 T358 SQL과 권한 복귀를, 플랫폼 운영 담당은 노출과 캐시 복귀를, 배포 담당은 이전 앱 설정 복귀를 맡는다. Tester는 승인된 대상에서 결과를 독립 대조한다.

## 재현

`node --conditions=react-server --import tsx tests/postgres/t361-project-https-read-stack.pg17.ts`로 실행했다. Windows x64의 T358용 서명 확인된 PG17 도구, 고정 해시 PostgREST ZIP, Git for Windows OpenSSL, Node 26 및 설치된 앱 의존성을 사용한다. T358 실행기의 Git blob을 확인한 후 테스트 프로세스 안에서만 마지막 복귀 호출을 연결점으로 사용한다. 기존 실행기 파일과 SQL은 수정하지 않았다. Next·HTTPS·PostgREST·PG17 리스너와 임시 소스·인증서·DB를 정리했다. [연결점](../../tests/postgres/t361-project-https-read-stack.pg17.ts) · [Next 및 HTTPS 실행기](../../tests/t361-project-https-read-next.mjs)

관련 회귀 테스트 1,079개 통과, 환경 조건부 300개 건너뜀. 신규 실행기 ESLint 및 기존 `.next` 생성 검증 파일을 제외한 소스 TypeScript 검사 통과.

> T361 고정 앱과 T358 설치·복귀를 소유 PG17/PostgREST에 연결해 자체 검증했습니다. 소유자·승인 회수·DTO·캐시와 기존 쓰기, 비활성 설정에서 Data API 0건을 확인했습니다. 독립 검수를 요청합니다. 운영 사전 점검 담당 및 확인 목록은 본 문서에 기록했습니다.
