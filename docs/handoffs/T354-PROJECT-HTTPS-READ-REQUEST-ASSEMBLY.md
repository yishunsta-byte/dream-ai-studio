# T354 프로젝트 HTTPS 조회의 요청 단위 인증 조립

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_087edf71ba83` · 조회 기준 `e67884e`

서버 전용 `createCookieProjectHttpsReadRequest`는 기존 Next SSR 쿠키 클라이언트를 요청당 한 번 사용한다. 같은 프로젝트 origin·공개 키를 대조한 뒤 SDK의 `getSession()`에서 액세스 토큰만 읽고, 그 토큰을 명시한 `getUser(token)`으로 확인된 사용자와 기존 이메일 허용 정책을 적용한다. 그 결과와 같은 토큰을 T352에 전달한다. 쿠키의 사용자 데이터와 요청 헤더는 권한 입력에서 제외한다. [조립 후보](../../lib/services/project-https-read-assembly.ts) · [기존 SSR 클라이언트](../../lib/auth/server.ts) · [허용 정책](../../lib/auth/config.ts)

| 격리 검증 | 결과 |
| --- | --- |
| 정상 요청·경계 | 동일 쿠키 토큰으로 SDK Auth와 T352 Auth·목록/상세를 호출한다. 한 요청의 병렬 목록·상세는 인증 결정을 공유하고, 별도 A/B 요청은 각자 토큰을 쓴다. 정상 목록·상세의 404와 실패 응답은 `no-store`다. |
| 갱신과 만료 | 실제 설치된 SSR/Auth SDK로 만료 쿠키를 읽었을 때 모의 갱신 응답의 새 토큰만 이후 Auth·조회에 전달되고, 갱신 쿠키 기록을 관측했다. 갱신 거부 또는 만료·다른 issuer·잘못된 토큰은 조회를 중단했다. |
| 익명·차단·불일치·장애 | 세션 부재·인증 거부는 401, 허용 목록 밖은 403, 사용자와 토큰이 다르면 실제 조회 전에 401이었다. SDK/Auth 장애나 설정 불일치는 고정 503이다. 응답과 관측한 로그에 합성 토큰·갱신 자격·내부 오류가 나타나지 않았다. |

시험은 실제로 설치된 SSR/Auth SDK와 기존 `createSupabaseServer`를 실행하고, Next 쿠키 저장소와 네트워크만 모의로 교체했다. 집중·기존 조회 회귀 102건과 변경 파일 ESLint, 생성 `.next` 검증기 제외 소스 TypeScript를 통과했다. 실제 브라우저·Supabase 발급 토큰·관리형 Data API는 후속 검증 범위다. [집중 시험](../../tests/postgres/t354-project-https-read-assembly.test.ts)

## 제품 라우트 연결 전

- 이 후보에서 SDK `getUser(token)`과 T352의 고정 Auth 재검증으로 정상 요청당 Auth GET이 두 번 발생한다. 갱신 시 SDK 토큰 요청이 추가된다. 기존 `proxy.ts`의 요청 처리와 `getRenderAuth`는 별도 호출 경계다. 연결 작업에서는 검증된 토큰·사용자·대상 결합을 보존하는 공용 요청 Auth로 중복을 줄이고, SDK Auth/갱신 호출의 리디렉션·시간 제한·캐시 정책과 쿠키 갱신 소유자를 함께 확정해야 한다. T352의 `no-store`와 리디렉션 거부는 후반 Auth GET과 조회 호출에서 확인했으며, 기존 SDK 호출의 기본 Fetch 설정에는 전달되지 않는다. 서버 컴포넌트에서 쓰기 불가능한 쿠키는 기존 proxy의 갱신 책임에 따른다. [기존 Auth](../../lib/auth/resolve.ts) · [렌더 Auth](../../lib/auth/render.ts) · [proxy 갱신](../../proxy.ts) · [T352 조회](T352-SUPABASE-PROJECT-HTTPS-READ-ADAPTER.md)
- 다음 변경은 대상과 프로필을 공급하는 명시적 서버 설정, `GET /api/projects`, `GET /api/projects/[id]`, `lib/cloud/project-read-page.ts`의 요청 선택 및 렌더 Auth 공유 범위를 별도로 승인받아 진행한다. 목록 경로의 POST와 기존 인증·기본 백엔드 동작을 보존하는 회귀가 필요하다. 실제 대상의 RLS, 응답 헤더와 목록 크기, A/B·익명·차단, 갱신 쿠키의 Next 전달과 되돌림을 연결 전 검증한다. [목록·생성 라우트](../../app/api/projects/route.ts) · [상세 라우트](../../app/api/projects/%5Bid%5D/route.ts) · [클라우드 조회](../../lib/cloud/project-read-page.ts)
