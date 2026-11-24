# T254 공개 이미지 제공 사전 조사

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_c159190d9908`
- 상태: **ready_review (읽기 전용 조사)**
- 기준 소스: `ecc6807`(현 HEAD)
- 대조 문서:
  - 설계 `c9d5674` T252-FIX
  - 검수 `33f6c64` T252-R2
  - T253 SQL `tests/fixtures/postgres/t253-showcase-publication.sql`(`ecc6807`)
  - 현 `proxy.ts`·`next.config.ts`·`lib/auth/config.ts`·`components/public-showcase/neon-showcase.tsx`
- 제품 파일은 수정하지 않았어요. 빌드·서버 실행·DB·Storage 접근도 하지 않았어요. 새 파일은 이 보고 1개예요.

## 1. 현재 상태에서 확인한 사실

| 위치 | 현재 | T254와의 관계 |
|---|---|---|
| `proxy.ts` | `isAnonymousPublicPath`(정확 일치 집합)만 인증 전에 통과시켜요. 나머지는 설정 확인 → 세션 갱신 → 공개 인증 경로 → 로그인·허용 순서예요. matcher는 `_next/static`·`_next/image`·`favicon.ico`·`fonts/`를 제외해요. | `/media/public/...`는 지금 익명이면 401 → 로그인으로 가요. 공개하려면 인증 전 분기가 필요해요. **`/_next/image`는 proxy를 거치지 않아요.** |
| `lib/auth/config.ts` | `ANONYMOUS_PUBLIC_PATHS` = `/` + T240 PNG 6개(정확 일치, 접두 허용 없음) | 새 경로를 이 집합에 넣을 수는 없어요(동적 경로). 정확 일치 원칙을 유지하려면 별도 파서를 써야 해요. |
| `next.config.ts` | `images` 설정이 **없어요**. Next `16.4.6`. | 기본값은 모든 로컬 경로의 최적화를 허용해요. 그래서 `/_next/image?url=/media/public/...`가 proxy를 거치지 않고 최적화 캐시에 남을 수 있어요(철회 뒤 잔존 위험). **설계 §2의 `localPatterns` 제한이 반드시 필요해요.** |
| 최적화를 쓰는 로컬 이미지 | `neon-showcase.tsx`의 `next/image` 5곳(85·193·233·288·323행). 대상은 예시 `/showcase/t240/*.png`예요. | `library-browser.tsx`·`result-preview.tsx`는 이미 `unoptimized`예요(`/api/assets/...`). 따라서 허용 목록에 남길 경로는 `/showcase/t240/` 하나예요. |
| `app/layout.tsx` | `export const dynamic = "force-dynamic"` | 홈은 이미 요청마다 렌더해요(T251 빌드에서 ƒ 확인). 실제 `Cache-Control` 값은 HTTP로 확인해야 해요. |
| 홈으로 오는 `next/link` | `neon-showcase.tsx:213`(브랜드), `app/admin/login/page.tsx:39`, `components/admin/admin-local-notice.tsx:16` | 설계 §2에 따라 사전 로드를 끄거나(`prefetch={false}`) 전체 문서 탐색으로 바꿔야 할 후보예요. |
| `public/` | `fonts`, `showcase`만 있어요. `media` 폴더는 없어요. | 정적 파일과 새 route가 겹치지 않아요. |
| `app/` | `media` route가 없어요. | 신규 route를 만들어야 해요. |
| T249 | 슬러그 `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`, 공개 접두 `/showcase/`·`/media/public/`, 이미지 확장자에 webp 포함, `DEFAULT_LIMIT 24`·`MAX_LIMIT 100` | 슬러그 규칙이 T253 `slots.slug` CHECK와 **같아요**(최대 64자, 예약어 4개 제외). 25건 검사 한도 조정은 3단계(홈 공급원)의 일이에요. |
| T253 파일 조회 계약 | `t253_showcase.find_cover(wanted_slug text, wanted_generation bigint)` → `(object_key, mime, size_bytes, sha)` | 아래 3절의 의존성을 보세요. |

## 2. 제품 수정 경로 제안 (T253-R3 판정 뒤 배정용)

**신규**
1. `lib/public-showcase/cover-path.ts`
   - 순수 파서이고 Node 전용 모듈을 쓰지 않아요(proxy에서도 쓰기 때문이에요).
   - `parseCoverPath(pathname)` → `{ slug, generation }` 또는 `null`
   - 정규형: `/media/public/<slug>/<generation>/cover.webp`
     - slug는 T249·T253 규칙과 같아요.
     - generation은 선행 0이 없는 십진 문자열이에요. 1 이상 `9223372036854775807` 이하이고, 문자열 길이와 사전 순서로 비교해요(JS 숫자로 바꾸지 않아요).
   - 다음은 모두 거절해요: 쿼리 문자열, `%`, `\`, `//`, `.`·`..`, 대문자, 후행 `/`, 다른 파일명이나 확장자.
2. `lib/public-showcase/cover-source.ts`(`server-only`)
   - 주입 가능한 두 의존성을 받아요.
     - `findCover(slug, generation)`: T253 함수 결과이거나 `null`
     - `readObject(key, { maxBytes, signal })`
   - 순수 검증 `verifyCover(bytes, row)`가 확인하는 것:
     - 길이가 `size_bytes`와 같고 5 MiB 이하
     - SHA-256이 `sha`와 같음
     - RIFF/WEBP 헤더와 VP8/VP8L/VP8X 가로·세로가 각각 4096 이하
   - 전체 시간 한도는 5초예요.
3. `app/media/public/[slug]/[generation]/[file]/route.ts`
   - `runtime = "nodejs"`, `dynamic = "force-dynamic"`예요.
   - 받은 파라미터를 그대로 믿지 않고, `request.nextUrl.pathname` 원문을 같은 파서로 다시 판정해요.
   - `GET`·`HEAD`를 명시적으로 내보내요. HEAD도 같은 승인·다운로드·검증을 거친 뒤 본문만 빼요.
   - `OPTIONS`·`POST`·`PUT`·`PATCH`·`DELETE`도 명시적으로 내보내요. 이들은 405와 `Allow: GET, HEAD`를 돌려줘요.
   - 상태 코드는 다음과 같아요.
     - 200: 활성 세대가 일치하고 검증을 통과함
     - 404: 미등록·준비·철회·과거 세대·형식 불일치
     - 503: DB 조회 실패, Storage 장애·부재, 무결성 실패
   - 모든 응답에 붙는 헤더: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`
   - 200 응답에만 붙는 헤더: `Content-Type: image/webp`, `Content-Length`
   - `Range`는 무시하고 항상 전체 200을 돌려줘요.
   - Route 파일은 handler와 config 외에는 export하지 않아요(T-246에서 확인한 Next 제약이에요).
   - 대안으로 폴더 이름을 `cover.webp`로 고정하는 방법도 있어요. 다만 점이 들어간 폴더 이름은 빌드·HTTP에서 동작을 확인해야 해요. 동적 `[file]`과 파서 재판정이 더 단순해요.

**수정**

4. `proxy.ts`(인증 전 분기 1줄 추가)
   - 조건은 `isAnonymousPublicPath(p) || parseCoverPath(p)`예요.
   - 정규 경로라면 메서드와 상관없이 handler까지 통과시켜요(405는 handler가 응답해요).
   - 인접 경로는 기존 인증을 그대로 받아요. `/media/public`, `/media/public/x`, `/media/x/1/cover.webp` 등이 여기에 해당해요.
   - 기존 matcher는 바꾸지 않아요.
5. `next.config.ts`
   - `images: { localPatterns: [{ pathname: "/showcase/t240/**", search: "" }] }`를 추가해요.
   - 효과
     - `/media/public/**`와 범용 패턴은 최적화 대상에서 빠져요.
     - T249가 허용하는 `/showcase/<그 밖>` 승인 이미지도 최적화 대상에서 빠져요. 따라서 승인 이미지는 4번 수정에서 반드시 `unoptimized`로 그려야 해요.
   - 이 파일은 한 줄로 압축돼 있고 BOM이 있으며 T-169 추적 제외를 포함해요. 그래서 `outputFileTracingExcludes`는 바이트 그대로 두고 `images` 키만 추가해야 해요. `tests/t169-build-tracing.test.ts`로 회귀를 확인해요.
6. `components/public-showcase/neon-showcase.tsx`
   - **T250 Design 소유 파일이에요. Master가 범위를 조정해 주세요.**
   - `<Image>` 5곳에 `unoptimized={!work.sample}`(또는 `opened`·`featured` 같은 대상 변수)를 붙여요.
   - 213행 브랜드 `Link href="/"`에 `prefetch={false}`를 붙여요.
7. `app/admin/login/page.tsx:39`, `components/admin/admin-local-notice.tsx:16`
   - 홈 `Link`에 `prefetch={false}`를 붙이거나 `<a href="/">`로 바꿔요.
   - 3단계(홈 공급원)와 묶어도 돼요.

**시험**

8. 신규
   - `tests/public-showcase/cover-path.test.ts`: 정규형과 거절형 목록, BIGINT 경계, T253 slug CHECK와 같은 규칙인지 대조
   - `tests/public-showcase/cover-route.test.ts`: 합성 `findCover`·`readObject`와 합성 WebP 1건 사용
9. 기존 회귀
   - `tests/t241-public-home-route.test.ts`
     - 익명 정확 집합은 그대로 두고, 커버 정규형만 인증 전에 통과하는지 확인해요.
     - 인접 경로가 401/307인지 확인해요.
     - 기존 NEAR 목록에 `/media/...`가 있으면 기대값을 조정해야 해서 Master 승인이 필요해요.
   - `tests/t169-build-tracing.test.ts`, `tests/t243-admin-login.test.ts`, `tests/public-showcase/*`

## 3. T253 저장 계약 의존성

| 항목 | T253 현재(`ecc6807`) | T254가 기대하는 것 / 확인 필요 |
|---|---|---|
| 파일 조회 | `find_cover(text, bigint)`, `SECURITY DEFINER`, 활성 세대가 정확히 일치할 때만 행을 돌려줌 | 0행이면 404, 1행이면 검증 단계로 가요. T253-R3에서 철회 직후 0행이 되는지와 과거 세대 0행을 입증해야 해요. |
| 세대 타입 | `bigint` | 경로 문자열 → DB 인자 전달 시 정밀도를 잃지 않아야 해요. `pg`에 문자열 그대로 넘기면 돼요. |
| 객체 키 | `<slug>/<generation>/<coverSha>.webp`(불변, DB가 생성) | 다운로드는 DB가 준 키만 써요. 경로에서 키를 만들지 않아요. |
| `mime`·`size_bytes`·`sha` | `image/webp` 고정, 1~5242880, 소문자 hex 64 | 응답 전에 실제 바이트와 대조해요. 불일치하면 503이에요. |
| 가로·세로 | **T253 슬롯에 열이 없어요.** 사본 규격 검사는 준비 단계 책임이에요. | T254 handler는 바이트에서 직접 4096 이하인지 확인해요. 목록 표시용 크기는 `active_display` 안의 값을 써요(3단계 범위). |
| 호출 자격 | `t253_file` 역할만 EXECUTE 가능해요. 목록 함수와 기저 테이블에는 권한이 없어요. | 운영 연결 정보(전용 풀러·TLS·역할)는 4단계(Recovery)의 일이에요. T254 첫 범위는 **합성 주입**으로만 시험해요. |
| Storage 읽기 | 계약 없음(설계 §3: service-role 금지, 전용 다운로드 주체) | T254는 `readObject` 인터페이스만 정의하고 합성 저장소를 주입해요. 실제 Supabase 어댑터는 운영 권한이 확인된 뒤에 만들어요. |
| 운영 미설정 | 공급원이 없음(T251 `PUBLISHED_WORK_RECORDS` 빈 배열) | **결정 필요:** 공급원이 설정되지 않은 운영에서 정규 경로에 어떻게 응답할지 정해야 해요. 제안은 404예요(공개된 작품이 있을 수 없는 상태라서). 설정 오류를 503으로 볼지는 Master가 정해 주세요. |

## 4. 검증 절차 (구현 배정 후)

1. **단위 시험(vitest)**
   - 파서: 정규형은 통과하고, 거절형 20종 이상은 모두 null이에요.
   - handler 상태 표: 200, 404(미등록·과거 세대·철회), 503(조회 예외·부재·길이·해시·형식·크기 초과·시간 초과), 405 + `Allow`
   - HEAD: 본문이 없고, 헤더가 GET과 같고, 같은 검증을 거쳐요.
   - 모든 응답에 `no-store`와 `nosniff`가 있어요.
   - 응답 본문과 헤더에 키·서명 주소·자격 정보가 없어요.
2. **격리 Next HTTP**
   - 저장소 밖 사본에서 `next build`와 `next start`를 써요. 합성 공급원은 시험 전용 주입으로 연결해요.
   - 운영 환경에서는 비활성이어야 해요. 주입 방법은 구현 배정 때 정해요.
   - 확인할 것
     - 같은 URL에서 승인 전 404 → 활성 200(실제 WebP, 해시 일치) → 철회 후 404
     - 다른 메서드 405
     - 원본 경로 별칭이 승인 파일을 주지 않아야 해요: 대문자, `%2F`, `//`, `/./`, 후행 `/`, `?x=1`, 역슬래시
       - `curl --path-as-is`로 보내고, 자동 리다이렉트는 따라가지 않아요.
     - 최적화 경로 차단
       - `/_next/image?url=/media/public/<slug>/<gen>/cover.webp&w=640&q=75`와 그 인코딩 변형
       - 같은 사이트 절대 URL
       - 위 요청은 모두 400 계열이어야 하고 이미지가 나오면 안 돼요.
       - 기존 `/showcase/t240/*.png` 최적화는 200이어야 해요.
     - 보호 경로 회귀: `/studio`, `/admin`, `/api/*`, 인접 `/media/...`
     - 홈 `Cache-Control`과 RSC 응답 헤더
3. **브라우저(ego lite, Tester 시작·종료 통지)**
   - 1280px·390px에서 승인 이미지가 원본 주소로 요청되는지 확인해요(`/_next/image`가 아니어야 해요).
   - 예시 6개는 최적화가 유지되는지 확인해요.
   - 철회한 뒤 새로고침·뒤로 가기·새 탐색에서 404가 나는지 확인해요.
4. **운영 연결 전 남는 것(T254 범위 밖)**
   - Vercel 앞단 캐시 헤더와 경로 정규화
   - 전용 Storage 다운로드 주체의 실효 권한
   - 관리형 PG17 이관

## 5. 배정 전 정해야 할 것
1. `neon-showcase.tsx`(T250 Design 소유)의 `unoptimized`·`prefetch` 수정을 누가 할지
2. 공급원이 설정되지 않은 운영에서 커버 경로를 404로 할지 503으로 할지
3. 격리 HTTP 시험에서 합성 공급원을 주입하는 방법
   - 제안: 별도 시험 빌드에서만 켜는 서버 모듈 교체
   - 환경변수 하나로 운영에서 켜질 수 있는 방식은 피해요.
4. T253-R3 PASS가 나면 위 2절 경로 1~9로 T254 구현 범위를 확정해 주세요.

## 범위
- 읽기 전용 조사예요. 제품 코드, 설정, 시험 수정, 빌드, 서버 실행은 하지 않았어요.
- DB·Storage·운영 조회, 배포도 하지 않았어요.
- 공유 `.next`·3013·50963·ego는 쓰지 않았어요.
