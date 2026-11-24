# T254-R 공개 커버 이미지 독립 검수

기준은 제품 커밋 `710c2c1`, 구현 보고 `dd6519c`, 사전 조사 `99ce139`다. Codex(Tester)는 Orca 배정 `msg_552a47ef0939`과 `docs/TEAM.md`를 대조했다. 지정 보고서와 8개 제품 변경 경로에 점유 충돌이 없어 `msg_e812026ce690`으로 수락했다.

**판정.** 정규 URL의 합성 이미지 제공과 철회는 통과했다. 외부 HTTP 계약에는 사전 조사 기준과 다른 동작이 두 가지 있다. Next가 정규화하는 별칭 일부가 활성 커버의 응답으로 이어지고, GET·HEAD 200에 `Content-Length`가 전달되지 않는다. 해당 기준을 유지하면 수용을 보류하고 보완 후 재검수해야 한다.

## 독립 실행

- `git archive 710c2c1`로 별도 디렉터리에 소스를 풀고 의존성을 복사했다. Windows, Node `26.13.0`, Next `16.4.6`에서 고정 소스와 합성 공급원 사본을 각각 `npm.cmd run build`로 빌드했다. 두 빌드 모두 종료 코드 0과 `verify-build` 통과를 확인했다. 합성 주입은 사본의 `COVER_SOURCE`와 파일 기반 스토어에만 적용했다. 시험 후 같은 아카이브에서 해당 파일을 복원해 Git blob 해시를 대조했다.
- `vitest run tests/public-showcase tests/t241-public-home-route.test.ts tests/t243-admin-login.test.ts tests/t169-build-tracing.test.ts`에서 **8파일 94건 통과**. 고정 소스 사본에서 `tsc --noEmit --incremental false` 및 T254 변경 8개 경로의 `eslint --max-warnings 0`도 종료 코드 0이었다.
- `next start`를 가짜 인증 설정과 임시 루프백 포트로 실행했다. Node `http.request`가 원시 요청 대상을 보내고 리다이렉트를 자동으로 따르지 않도록 했다. 초기 하네스가 상대 `Location`을 절대 URL로만 해석하던 부분을 기준 주소와 함께 해석하도록 고쳤다. 홈 RSC에는 Next가 요구하는 `_rsc` 표시를 포함해 다시 시험했다.

| 검사 | 관측 결과 |
| --- | --- |
| 고정 소스 GET·HEAD | 공급원 비활성 상태에서 정규 URL 모두 404 |
| 합성 GET·HEAD | 같은 정규 URL에서 승인 전 **404** → 승인 후 **200** → 철회 후 **404**. HEAD 본문은 매 단계 0바이트. 과거 세대 GET은 404 |
| WebP 및 Range | GET 200과 Range 요청 모두 90바이트 전체 `image/webp`. 받은 바이트의 SHA-256은 `c801886c644dcb72bc34fd48404d85421fa3ed6283940d23f09aef042454cd04`로 96×54 합성 원본과 일치 |
| 오류와 메서드 | 조회 예외·객체 읽기 예외·해시 불일치 각각 GET·HEAD 503. 정규 URL의 POST·PUT·PATCH·DELETE·OPTIONS는 양쪽 빌드에서 405와 `Allow: GET, HEAD` |
| 이미지 최적화 | 활성 중 커버 URL 변형 8종이 모두 400이며 이미지 응답 없음. 철회 후 같은 커버 요청도 400. 기존 예시 원본과 최적화 요청은 모두 200 `image/png` |
| 접근 경로 | `/studio`, `/cloud/projects`, `/admin`, 인접 미디어 경로, 값 있는 쿼리를 붙인 커버 주소와 미등록 예시 경로는 해당 로그인 화면으로 307. `/api/projects`는 401. 두 로그인 화면과 공개 홈은 200. 홈 HTML에 예시 6개 표시 |
| 캐시 | 정규 커버 200·404·405·503에 `Cache-Control: no-store`와 `X-Content-Type-Options: nosniff`. `Age`·`ETag`·`Set-Cookie` 부재. 오래된 ETag를 보낸 요청도 활성 중 200, 철회 후 404. 홈 HTML과 RSC는 200 및 `private, no-cache, no-store, max-age=0, must-revalidate`. 기존 예시 최적화는 `public, max-age=14400, must-revalidate`와 `X-Nextjs-Cache: HIT` 확인 |

## 외부 요청 계약

### F254-R1. Next 선행 정규화와 308 별칭

점 경로 세그먼트와 빈 쿼리 구분자를 가진 요청은 승인 시 정규 URL과 같은 GET·HEAD 200에 도달했다. 후행 슬래시와 중복 구분자를 가진 요청은 GET·HEAD 308을 반환했고 `Location`의 정규 URL을 별도로 요청하면 승인 시 200이었다. 두 308 응답에는 `Cache-Control`이 없었다. 원시 요청의 별칭에서 승인된 파일을 얻을 수 없어야 한다는 `99ce139`의 외부 기준은 충족하지 못했다.

철회 후 점 경로와 빈 쿼리는 바로 404였다. 후행 슬래시와 중복 구분자는 308을 유지했고 그 대상의 GET·HEAD는 404였다. HTTP 캐시는 308을 휴리스틱으로 보관할 수 있다. 시험에서 308의 `Location`은 계속 같은 정규 URL을 가리켰고 해당 정규 응답은 `no-store`였다. 이번 루프백 시험에서는 승인 이미지가 철회 후 새 요청에 제공되는 현상을 관측하지 못했다. 운영 앞단과 브라우저의 캐시 동작은 이 증거의 범위 밖이다. [RFC 9110 §15.4.9](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.9) · [RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5)

별칭 거절이 수용 조건이면 해당 접두사의 원시 요청을 Next 정규화 전에 검사하고 HTTP로 재검수한다. 정규화를 허용할 경우 별칭과 308 캐시 동작을 외부 계약에 명시하고 철회 뒤 그 대상이 404인지를 수용 조건에 포함한다.

### F254-R2. `Content-Length`가 HTTP로 전달되지 않음

애플리케이션의 `Response`에는 검증된 바이트 수가 설정되지만 Next 16.4.6의 `dist/server/send-response.js`가 헤더를 복사할 때 `content-length`를 제외한다. 실제 HTTP/1.1 200 응답에서 GET은 `Transfer-Encoding: chunked`로 90바이트를 전달했고 HEAD는 본문과 `Content-Length` 없이 종료했다. 수신 바이트 해시와 승인·철회 상태에는 영향이 없었다. HTTP에서는 HEAD의 `Content-Length`를 선택적으로 제공할 수 있지만 사전 조사에 적힌 200 헤더 계약과는 다르다. 해당 헤더를 소비하는 클라이언트가 있으면 배포 앞단까지 포함한 보완과 재검증이 필요하다. 선택 헤더로 확정할 경우 수용 기준을 실제 전송 동작에 맞춘다. [RFC 9110 §8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6)

## 증거 및 범위

- 로컬 증거는 `D:/starwork/t254-r-snapshot-f4d3c170/tmp/`에 있다. 빌드 로그 `build-fixed.log`, `build-active.log`, HTTP 로그 `http-inactive.log`, `http-active.log`, 시험 로그 `vitest.log`, `typecheck.log`, `lint.log`와 합성 주입 및 요청 하네스를 보관했다. 고정 빌드 `KN8Z4Pp1murEPrAvdc8ky`는 34개 HTTP 응답, 합성 빌드 `BPyYJlgsUfthg0Lk_1Yd_`는 80개 HTTP 응답을 검사했다. 종료 뒤 각 루프백 포트의 `ECONNREFUSED`를 확인했다.
- 제품 저장소에는 이 검수 보고서만 추가했다. 관리형 DB·Storage 연결, 운영 조회, 게시·배포, 브라우저 탐색은 범위 밖이다. T253-R3의 기존 실행 기록을 보존했다.

## Master 전달용

> T254-R 검수 완료. 710c2c1 관련 94건, 타입·린트, 고정 및 합성 Next HTTP 검증을 통과했습니다. 동일 커버 GET·HEAD는 승인 전 404, 승인 후 200, 철회 후 404였고 WebP 해시와 최적화 제한을 확인했습니다. 외부 계약에서는 Next 선행 정규화·308 별칭과 HTTP `Content-Length` 미전송이 사전 기준과 다릅니다. 철회 후 시험한 별칭의 최종 응답은 모두 404입니다. 기존 기준을 유지할 경우 보완과 재검수를 요청합니다. 결과는 `docs/handoffs/T254-R-SHOWCASE-IMAGE-REVIEW.md`에 있습니다.
