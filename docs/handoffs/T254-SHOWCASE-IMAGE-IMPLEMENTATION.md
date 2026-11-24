# T254 공개 커버 이미지 격리 구현

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_1259b66358b5`
- 기준 문서
  - 사전 조사 `99ce139`
  - 결정 `msg_6a6d2cd8c99a`
  - 설계 `c9d5674`, 검수 `33f6c64`
  - T253 `ecc6807`
- 상태: **ready_review**
- 코드 커밋: `710c2c1`(8경로). 이 보고는 별도 커밋이에요.
- 점유 확인
  - T250 `a50e821`은 독립 검수 `106caea`로 수용됐어요.
  - 착수 시점에 `neon-showcase.tsx`, `proxy.ts`, `next.config.ts`에는 커밋 전 변경이 없었어요.
  - 작업 트리에 남아 있던 변경은 공유 문서 2개와 보존 대상 2개뿐이에요. 이 파일들은 건드리지 않았어요.

## 바꾼 것(8경로)
| 경로 | 내용 |
|---|---|
| `lib/public-showcase/cover-path.ts`(신규) | import가 없는 순수 파서예요. 정규형 `/media/public/<slug>/<generation>/cover.webp` 하나만 받아요. slug 규칙은 T249·T253과 같아요(최대 64자, 예약어 4개 제외). generation은 1 이상 BIGINT 상한 이하 문자열이고 JS 숫자로 바꾸지 않아요. `isCoverReadMethod`가 받는 메서드는 GET·HEAD뿐이에요. |
| `lib/public-showcase/cover-source.ts`(신규) | 서버 전용(`server-only`) `serveCover`, `verifyCoverBytes`와 운영 공급원 `COVER_SOURCE`예요. `COVER_SOURCE`는 `{mode:"inactive"}`로 고정했어요. |
| `app/media/public/[slug]/[generation]/[file]/route.ts`(신규) | `nodejs`·`force-dynamic`이에요. GET·HEAD는 `serveCover`로 보내요. OPTIONS·POST·PUT·PATCH·DELETE는 명시적으로 405를 돌려줘요. 경로 파라미터를 그대로 믿지 않고 요청 주소를 다시 판정해요. |
| `proxy.ts` | 기존 익명 정확 집합 다음, 인증 확인 전에 분기를 하나 추가했어요. 정규형이고 쿼리가 없을 때만 해당해요. GET·HEAD는 통과시키고, 나머지 메서드는 405(`Allow: GET, HEAD`, `no-store`, `nosniff`)로 답해요. matcher는 바꾸지 않았어요. |
| `next.config.ts` | `images.localPatterns = [{ pathname: "/showcase/t240/**", search: "" }]`만 추가했어요. BOM과 T-169 추적 제외는 바이트 그대로예요. |
| `components/public-showcase/neon-showcase.tsx` | `<Image>` 5곳에 `unoptimized={!X.sample}`를 붙였어요. 승인 작품은 원래 주소로 직접 그리고, 예시는 기존 최적화를 그대로 써요. 다른 코드는 바꾸지 않았어요. |
| `tests/public-showcase/cover-path.test.ts`(신규) | 6건 |
| `tests/public-showcase/cover-route.test.ts`(신규) | 18건 |

## 응답 계약(Master 결정 반영)
| 상황 | 응답 |
|---|---|
| 공급원 비활성(현재 운영 값) | 정규 GET·HEAD 모두 **404** |
| 활성, 정확히 일치하는 활성 세대가 있고 검증을 통과함 | **200** `image/webp`. 본문은 검증한 바이트예요. HEAD는 본문 없이 응답해요. |
| 활성, 미등록·준비·철회·과거 세대(조회 결과 null) | **404** |
| 활성, store 없음(설정 누락)·조회 예외·이상한 조회 결과·행 계약 위반·파일 부재·5 MiB 초과·길이/해시 불일치·WebP 검증 실패·5초 초과 | **503**. 시간을 넘기면 공급원에 중단 신호를 보내요. |
| 정규 경로에서 GET·HEAD가 아닌 메서드 | proxy가 인증 전에 **405** + `Allow: GET, HEAD`로 답해요. route도 같은 계약이에요. |
| 정규형이 아닌 주소(쿼리 포함) | proxy의 기존 인증을 그대로 거쳐요(익명이면 307/401, 설정이 없으면 503). route에 도달해도 조회하지 않고 404예요. |

- 모든 응답에 `Cache-Control: no-store`와 `X-Content-Type-Options: nosniff`가 붙어요. `Range`는 무시하고 항상 전체 200을 돌려줘요.
- 행 계약은 T253 `find_cover`의 결과와 같아요.
  - `objectKey`는 `<slug>/<generation>/<sha>.webp`와 정확히 같아야 해요.
  - `mime`은 `image/webp`, `sizeBytes`는 1~5242880 정수, `sha`는 소문자 hex 64자예요.
- 다운로드는 DB가 준 키만 써요. 응답에는 키·해시·서명 주소·자격 정보를 싣지 않아요.
- 바이트 검증 순서
  1. 길이가 행과 같아요.
  2. SHA-256이 행과 같아요.
  3. RIFF/WEBP 헤더와 RIFF 길이가 정확히 일치해요.
  4. sharp(`failOn: warning`, 픽셀 한도 4096²)로 정지 1장(pages 1)인지 확인해요.
  5. raw로 **끝까지 디코딩**한 뒤 가로·세로가 각각 4096 이하인지 확인해요.
- 운영에서 공급원을 고르는 방법은 코드의 고정 값 하나뿐이에요. 환경변수·요청 값·시험용 공개 우회는 없어요. 시험이 이것을 소스 문자열로 고정해요.

## 시험
- **신규 24건**
  - `cover-path` 6건
    - 정규형 5종
    - 거절형 37종과 비문자열 6종
    - slug 경계와 T253 SQL·T249 규칙 원문 대조
    - BIGINT 경계(상한과 상한+1, 2^53 초과 문자열 유지)
    - 메서드
    - 파서에 import가 없는지
  - `cover-route` 18건
    - 비활성 404와 고정 공급원
    - 같은 주소의 승인 전 404 → 200(바이트 동일, 헤더) → 철회 404 → 교체 뒤 과거 세대 404
    - HEAD가 같은 검증을 거치는지
    - Range 무시
    - 정규형이 아니면 조회 없이 404
    - 503 경우: 설정·조회·행 8종·파일 부재·길이·해시, 해시가 맞는 PNG·잘린 파일·덧붙인 파일·RIFF 길이·손상·**애니메이션 WebP**(직접 만든 VP8X+ANIM+ANMF 2프레임)·4097px, 4096px은 200, 5 MiB 초과, 5초 초과 시 중단 신호
    - route export 목록과 405
    - proxy
      - 로그인 준비·미준비·끔 세 상태에서 GET·HEAD가 getUser 없이 통과
      - 다른 메서드는 인증 전 405
      - 인접 경로 10종은 기존 307/503
    - `next.config` images 일치
    - 승인 작품 렌더에 `/_next/image`가 없고, 예시는 최적화가 유지됨
- **관련 회귀:** `tests/public-showcase`(5파일), `t241-public-home-route`, `t243-admin-login`, `t169-build-tracing` 합계 8파일 **94 passed (94)**
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 범위 eslint 0(exit 0)이에요.

## 격리 빌드·HTTP(저장소 밖 사본)
- **사본 준비**
  - `git archive 710c2c1`을 scratchpad `t254/app`에 풀었어요.
  - `node_modules`는 원본을 **물리 복사**했어요(robocopy 702 MB).
  - 연결(junction) 방식은 쓸 수 없었어요. Turbopack은 사본 밖 다른 드라이브를 읽지 않고, webpack도 드라이브가 달라 실패했어요.
  - 원본 `node_modules`는 283항목 그대로예요.
- **합성 주입(사본에서만, 커밋 안 함)**
  - 사본의 `COVER_SOURCE` 한 줄을 `{mode:"active", store: syntheticStore}`로 바꿨어요.
  - 사본 전용 `t254-synthetic.ts`를 추가했어요. 상태 파일과 객체 폴더를 읽어요.
  - 합성 WebP는 640×360, 506바이트예요.
- **합성 빌드:** `npm run build`(next build + verify-build) exit 0, 경고 0. `/media/public/[slug]/[generation]/[file]`가 ƒ로 나와요.
- **합성 HTTP**(127.0.0.1:43254, 가짜 Supabase 주소, `curl --path-as-is`, 리다이렉트는 따라가지 않음)
  - 같은 주소에서 승인 전 **404** → 활성 **200**(`image/webp`, `no-store`, `nosniff`, 받은 바이트 SHA 일치, 506바이트) → 철회 **404**
  - HEAD도 404/200/404(본문 없음)였어요.
  - Range를 보내도 200 전체예요.
  - POST·PUT·PATCH·DELETE·OPTIONS는 **405** `Allow: GET, HEAD`, `no-store`였어요.
  - 조회 실패 503, 파일 실패 503(GET·HEAD)이었어요.
  - 최적화 경유 8종은 모두 **400**이었어요.
    - 대상: 직접 주소, 이중 인코딩, 같은 사이트 절대 URL, `/showcase/t240/../..` 경유, `//`, 대문자, 쿼리
    - 이미지는 나오지 않았어요.
    - 기존 예시 `/_next/image?url=/showcase/t240/*.png`는 200 `image/png`이고, 예시 원본도 200이에요.
  - 보호 경로
    - `/studio`·`/cloud/projects`·`/admin`·인접 `/media/public`, `/media/public/neon-demo/1`, `/showcase/t240/other.png`는 307이에요.
    - `/api/projects`는 401이에요.
  - 홈은 200이고 `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`예요. 예시 6개와 로그인 링크가 그대로 있어요.
- **정확한 커밋 빌드**
  - 합성 주입을 되돌린 뒤 `git archive 710c2c1`과 사본 트리를 비교했어요(`diff -rq` 동일).
  - `npm run build` exit 0, 경고 0, verify-build 통과, BUILD_ID `LzKbrb_qQUXcprrqPy8pQ`
  - HTTP 결과
    - 정규 GET·HEAD **404**(`no-store`, `nosniff`)
    - 5개 메서드 405
    - 커버 최적화 400, 예시 최적화와 원본 200
    - `/studio`·`/admin`·인접·쿼리 별칭 307, `/api/projects` 401
    - `/login`·`/admin/login`·홈 200, 예시 화면 그대로
- **정리**
  - 서버는 사본 경로인 것을 확인한 프로세스만 멈췄어요.
  - 사본 안 `.next/node_modules` 내부 연결 3개(사본 안을 가리킴)를 먼저 끊고 사본을 지웠어요.
  - 로그(`build*.log`, `http.log`)와 합성 파일만 scratchpad에 남겼어요.

## 한계·확인 필요(Master 판단)
1. **Next가 경로를 먼저 정규화해요.** 원본 주소 그대로 보내도 다음 별칭은 Next 서버가 proxy 전에 정규 주소로 바꾸거나 308로 보내요.
   - 200을 받은 별칭: `/./`, `/x/../`, 역슬래시, 빈 `?`
   - 308로 보내진 별칭: 후행 `/`, `//`
   - 그 결과 활성일 때는 정규 주소와 같은 파일(200)을 받고, **철회 뒤에는 모두 404**예요(따라간 결과도 404).
   - 보호 경로로 넘어가거나 철회를 피하는 경로는 확인되지 않았어요.
   - 다만 "별칭은 허용형에서 제외"를 엄격하게 지키려면 앱 밖 정책이 필요해요. 예를 들어 `skipTrailingSlashRedirect`처럼 전역 설정을 바꾸거나 배포 앞단에서 거절해야 해요. 그래서 이번 범위에서는 바꾸지 않았어요.
   - 인코딩된 `%2F`·`%2E`·`%6E`·`%00`·`;`·대문자·`01`은 기존 인증(307)을 거쳐요.
2. **HTTP 응답에 `Content-Length`가 없어요.** route는 넣지만 Next 서버가 chunked로 보내면서 빠져요. 본문 길이와 SHA는 받은 바이트로 확인했어요.
3. 실제 T253 PG17 `find_cover`와 실제 Storage 다운로드 어댑터는 연결하지 않았어요. 인터페이스(`CoverStore`)와 합성 주입까지만 했어요. 운영 연결은 Recovery의 관리형 DB·전용 자격 단계 뒤에 해요.
4. 시간 한도 5초가 지나면 503을 바로 돌려주고 중단 신호를 보내요. 공급원이 신호를 무시하면 뒤쪽 작업은 끝날 때까지 남을 수 있어요(응답에는 영향 없음).
5. 홈 공급원 연결, 홈으로 오는 링크의 사전 로드 끄기, RSC 재탐색 검증은 3단계 범위라 하지 않았어요. 브라우저(ego) 확인은 하지 않았어요. 화면 쪽은 렌더 결과(시험)로 원본 주소와 최적화 미사용을 확인했어요.
6. 기존 동작 두 가지를 기록해요(T254 변경 아님).
   - 예시 최적화 응답은 `public, max-age=14400, must-revalidate`예요.
   - 기존 deny는 후행 슬래시 주소를 `/login/`으로 보내요.

## 범위
- 관리형 DB·Storage·운영 조회·배포·push, 홈 공급원 연결, `lib/auth/config.ts` 수정은 하지 않았어요.
- 공유 `.next`·3013·50963·ego는 쓰지 않았어요.
- 원본 `node_modules`는 읽기만 했어요(복사 원본으로만 사용).
