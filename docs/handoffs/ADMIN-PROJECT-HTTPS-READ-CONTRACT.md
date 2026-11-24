# 관리자 02 프로젝트 목록의 HTTPS 조회 연결 계약

2026-11-20 KST · Codes(Backend) · 배정 `msg_adc5db7fda62` · 운영 기록 기준 `e4fa378` · HTTPS 앱 기준 `633c10b`

**기존 HTTPS 조회를 관리자 목록에 재사용할 수 있는 범위를 확인했다.** 별도 배정에서 기존 관리자 인증, 현재 계정 한정, 조회 상태와 다시 불러오기 동작을 유지한 채 격리 환경에서 검증한다. 운영 연결은 T362의 제한 카탈로그·실효 권한·행 격리 확인과 별도 적용 판정을 기다린다. [운영 관리자 배포 기록](ADMIN-WORK-CONSOLE-LIVE-DEPLOYMENT.md) · [T362 운영 인계](T362-OPERATIONAL-READ-HANDOVER.md)

## 고정 소스 대조

| 경계 | 현재 계약과 연결 시 필요한 확인 |
| --- | --- |
| 관리자 진입과 읽기 | `e4fa378`의 `/admin`은 동적 렌더링이며 proxy와 서버 `getRenderAuth()`를 거친다. 로컬 모드는 안내로 끝나고 인증 필요·권한 없음·인증 확인 불가는 각각 관리자 로그인으로 보낸다. 확인된 계정에만 `loadAdminProjects()`를 호출한다. 이 함수는 `DREAM_PROJECT_READ_BACKEND=postgres`에서만 `readCloudProjects()`를 한 번 호출하고 그 밖의 값은 조회 전에 미연결로 처리한다. 기존 PostgreSQL 읽기는 서버가 검증한 사용자 UUID로 소유자를 정한다. [관리자 페이지](../../app/admin/page.tsx) · [관리자 목록](../../components/admin/admin-projects.tsx) · [02 제품 독립 검수](ADMIN-PROJECT-CONSOLE-PRODUCT-REVIEW.md) |
| 개인·API의 HTTPS 읽기 | T356 `633c10b`는 `GET /api/projects`, `GET /api/projects/[id]`, 개인 클라우드 목록·상세에서 명시적인 `supabase-https` 모드를 사용한다. API는 요청의 `AbortSignal`과 라우트 쿠키 경로를, 서버 렌더는 요청 쿠키의 읽기 전용 경로와 기존 proxy 갱신을 쓴다. `e4fa378` 트리에는 이 HTTPS 조립 모듈이 없고, 개발 소스의 관리자 모드 조건도 이 조회를 선택하지 않는다. 공용 모드 변경은 개인 화면과 두 GET에도 영향을 주므로, 관리자 후보는 T356 계열 소스의 격리 연결로 검증하고 운영 설정은 별도 판정한다. [T356 적용 범위](T356-PROJECT-HTTPS-READ-APP-INTEGRATION.md) · [앱 조회 조립](../../lib/cloud/project-read-request.ts) |
| 계정·대상 일치 | HTTPS 조립은 설정된 Supabase ref와 표준 HTTPS Auth 주소, 프로젝트 공개 키, SSR 쿠키에서 읽은 JWT를 같은 요청에 묶는다. 서버 Auth의 검증된 사용자와 JWT의 subject·issuer·audience·role·기한을 대조한 뒤 해당 JWT로 `project_read`의 읽기 뷰를 조회한다. 관리자 화면의 확인 계정과 HTTPS 조회에서 확인한 UUID도 Data API 호출 전에 같아야 한다. 현재 조립의 `resolveLegacyAuth`는 기존 조회 경로에만 적용되므로 관리자 UUID 일치 조건을 대신할 수 없다. 관리자 연결의 재인증 실패는 개인 `/login` 대신 기존 관리자 로그인 판정에 연결한다. [SSR 인증 조립](../../lib/services/project-https-read-assembly.ts) · [HTTPS 조회 어댑터](../../lib/services/project-https-read.ts) · [개인 읽기 화면 변환](../../lib/cloud/project-read-page.ts) |
| 행과 공개 필드 | T358 후보 뷰는 호출자 권한으로 현재 `auth.uid()`의 승인된 활성 프로젝트만 읽는다. 관리자 화면은 기존 카드의 ID·제목·메뉴·화면비·길이·시각·상태·다음 단계만 사용한다. 검색과 상태 필터는 이미 수신한 본인 카드에서 작동한다. 상세 링크는 `/cloud/projects/{id}#admin-project-heading`이며 개인 상세가 독립 인증·권한을 적용해 타인·보관·없는 프로젝트를 404로 처리한다. 관리자 목록의 범위는 읽기이며 기존 생성 POST, 게시·철회, 계정 관리와 독립이다. [T358 조회 정책](../../lib/db/postgres/project-https-read/0001_install.sql) · [관리자 카드와 링크](../../components/admin/admin-project-console.tsx) |
| 재조회와 상태 | 목록 성공 후에만 조회 시각을 만들고, 다시 불러오기는 `/admin?reload=…#admin-project-list`로 실제 새 문서를 요청한다. 이 값은 주소를 바꾸기 위한 토큰이며 계정·권한 입력은 서버 인증에서 정한다. 공급원 선택이 없으면 미연결과 목록 호출 0, HTTPS가 선택됐지만 설정·전송·응답 검증이 실패하면 실패 카드와 다시 불러오기를 적용한다. 인증 후 DB 읽기 승인이 회수된 정상 빈 배열은 조회 0건으로 표시한다. 성공 목록에서 검색만 실패한 경우는 검색 결과 0건으로 표시한다. 실패·미연결에는 조회 시각을 붙이지 않는다. [관리자 상태·재조회](../../components/admin/admin-projects.tsx) · [시안 독립 범위](ADMIN-PROJECT-READ-STATE-PROTOTYPE-INDEPENDENT-REVIEW.md) |

## 격리 연결 판정 기준

| 검증 | 합격 기준 |
| --- | --- |
| 기존 모드와 관리자 인증 | 기존 PostgreSQL의 본인 목록과 재조회, 로컬 안내, 401·403·인증 장애의 관리자 로그인, 읽기 미연결을 유지한다. 거절 경로에서 프로젝트 조회는 0건이다. 형식이 맞지 않는 ref·오리진·프로필, 예약 프로필 또는 잘못된 설정은 Data API 호출 0건이다. 형식이 유효하지만 노출되지 않은 프로필은 실제 Data API GET 1건에서 406 `PGRST106`을 반환하고 화면에 실패로 표시한다. 두 경우 모두 PostgreSQL 우회는 0건이다. |
| 현재 계정과 승인 회수 | 소유 Next·PostgREST·PG에서 A/B 각각 자기 활성 자료만 조회한다. 화면 인증 A와 HTTPS 인증 B가 엇갈리면 프로젝트 조회 0건을 확인한다. A의 DB 승인 회수 뒤 같은 Auth 세션으로 실제 다시 불러오기를 했을 때 목록은 정상 0건, 기존 상세는 404, B의 목록은 그대로다. 재승인 뒤 같은 절차로 A의 목록이 복원된다. |
| 데이터·장애·HTTP | 성공 요청은 재인증과 별개로 목록 GET 한 번이며, 카드 응답에 원본 행·승인 UUID·키·토큰을 전달하지 않는다. 정상 빈 배열과 장애를 구분하고, 프로필·범위 헤더 불일치나 503은 실패 카드로 표시한다. API 성공·오류의 `no-store`와 사용자 간 목록 재사용 방지를 유지한다. 상세와 프로젝트 생성 POST, 게시/렌더 호출은 기존 계약을 유지한다. |
| 관리자 화면 | 390px·1440px에서 정상 목록, 정상 0건, 검색 0건, 미연결, 실패, 접근 거절을 구분한다. 실패에서 다시 불러오면 새 문서 요청과 목록 제목 초점이 복구되고, 정상 상세 이동과 뒤로 가기의 위치를 보존한다. 목록 조회는 쓰기 권한이나 운영자 전체 조회를 추가하지 않는다. |

T361-R은 고정 `633c10b`의 **개인 화면과 목록·상세 GET**을 실제 소유 PG17.12/PostgREST에 연결해 합성 A/B, 승인 회수·복구, 503, 기존 쓰기 보존을 독립 확인했다. `e4fa378`의 실제 운영 화면 기록은 관리자 목록 미연결까지다. `dcab613`은 화면 시안 수정이며 `3abd4fe`는 해당 시안의 독립 재검수 기록이다. T362는 2026-11-19 22:19 KST의 HTTP 406/PGRST106으로 당시 `project_read` 미노출을 관측했다. 실제 운영 스키마 설치, 실효 권한, 승인과 행 격리는 기존 승인된 제한 경로나 운영 권한자의 관측 결과를 기다린다. [T361 독립 검수](T361-R-PROJECT-HTTPS-READ-STACK-REVIEW.md) · [운영 배포 기록](ADMIN-WORK-CONSOLE-LIVE-DEPLOYMENT.md) · [T362 읽기 인계](T362-OPERATIONAL-READ-HANDOVER.md)

**Master 인계** · 관리자 인증을 통과한 같은 계정의 읽기만 기존 HTTPS 공급원에 연결하는 격리 검증 범위를 정리했다. T362 운영 확인·설정과 `dcab613` 시안은 별도다. 이번 검토는 고정 Git과 기존 인계의 문서 대조이며 운영 DB/API 호출, 설정 또는 제품·시안 변경은 없었다.
