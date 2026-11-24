# T352 Supabase 프로젝트 HTTPS 조회 서버 어댑터 후보

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_09dbabd1179f` · T351 기준 `8ab9d7e`

신규 서버 전용 `createProjectHttpsReadRequest`가 T351의 원시 응답을 기존 ‘내 프로젝트’ 목록·상세 계약에 맞춘다. 요청마다 신뢰 서버가 확인한 앱 사용자 결과와 같은 요청에서 획득한 사용자 토큰을 함께 넘긴다. 앱 인증·허용 계정 거부는 네트워크 호출과 상세 파라미터 평가 전에 반환한다. [후보](../../lib/services/project-https-read.ts) · [기존 조회 계약](../../lib/services/postgres/project-read-request.ts) · [T351 검증](T351-POSTGREST-PROJECT-READ-LOOPBACK.md)

| 경계 | 구현과 검증 |
| --- | --- |
| 동일 사용자·토큰 | 토큰의 subject, 고정 프로젝트 issuer, audience, 인증 역할, 만료를 사전 대조한다. 실제 토큰 수락은 동일 프로젝트의 `GET /auth/v1/user`에 맡기고 반환 UUID와 이메일을 앱 결과에 대조한다. Auth 대조만 요청 안에서 병합하며 프로젝트 응답은 캐시하지 않는다. |
| 전송·설정 | 고정 Supabase 프로젝트 ref의 HTTPS origin과 명시적 조회 프로필에 바인딩한다. 공개용 키 또는 같은 ref의 레거시 anon 키를 사용한다. Auth·목록·상세 경로는 고정 GET이며 리디렉션·쿠키·캐시를 거절한다. 앱 응답과 upstream 요청에 `no-store`를 사용한다. 성공 데이터 응답의 `Content-Profile`까지 확인한다. 상류 호출당 제한 시간은 5초, 데이터 응답 본문 한도는 4MiB다. [PostgREST 프로필 처리](https://raw.githubusercontent.com/PostgREST/postgrest/v16.6/src/library/PostgREST/Response.hs) |
| 오류·데이터 변환 | 앱 거부는 401/403, 잘못된 상세 ID는 400, 비어 있는 상세는 404다. 토큰을 거부하는 PGRST301/303은 401이며 데이터 권한 오류·프로필 불일치·부분 응답·DTO 위반은 고정 503이다. 공급자 오류·토큰·설정값은 응답에 포함하지 않는다. 목록의 보조 필드는 반환에서 제외한다. 상세는 조회한 UUID와 프로젝트·스냅숏·단계 자료의 일치를 확인한다. |
| 목록 완전성 | 정확한 건수를 요청하고 단일 읽기 응답의 `Content-Range`와 행 수를 대조한다. 서버 행 한도 또는 응답 본문 한도로 잘린 목록은 503이다. 완전한 한 응답을 지원할 수 없는 실제 대상에는 안정적인 목록 페이지 계약이 필요하다. [PostgREST 정확한 건수·범위](https://docs.postgrest.org/en/stable/references/api/pagination_count.html) |

## 검증과 연결 전 조건

- 집중 시험과 기존 읽기 회귀 78건, 변경 파일 ESLint 및 생성 `.next` 검증기 제외 소스 TypeScript 검사를 통과했다. 합성 Auth와 모의 PostgREST에서 사용자·토큰 일치, 고정 GET·대상·프로필·응답 범위, DTO, 오류·취소·응답 본문 한도를 확인했다. T351을 다시 실행해 실제 루프백 PostgREST의 기존 원시 계약을 대조했다. 새 어댑터의 직접 연결 검증은 모의 응답 범위다. [집중 시험](../../tests/postgres/t352-project-https-read.test.ts) · [T351 실행기](../../tests/postgres/t351-postgrest-project-read.pg17.ts)
- 실제 연결 전 신뢰 서버가 검증한 사용자 결과와 DB에 사용할 사용자 토큰을 동일 요청 쿠키/세션에서 획득하는 조립을 별도로 검증해야 한다. 기존 프로젝트의 API gateway가 동일 토큰을 받아 승인 프로필과 응답 헤더를 유지하는지, 기준 스키마·소유자 RLS·별도 DB 승인 정책이 실제 적용됐는지 독립 확인해야 한다. 목록 제한·응답 크기 적합성, 실제 Auth의 A/B·비승인·익명 및 되돌림도 확인한다.
- 후보는 명시적 생성 함수로만 접근할 수 있다. 기존 인증·라우트·SQL·기본 제품 설정은 그대로이며 실제 Supabase HTTPS·운영 호출과 배포는 범위 밖이다.
