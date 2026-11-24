# T255 공개 홈 승인 목록·빈 목록·장애 연결

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_5eccfc9b52be`
- 상태: **ready_review**
- 코드 커밋: `7c7fce0`(5경로). 이 보고는 별도 커밋이에요.
- 기준
  - 설계 `c9d5674` §5
  - T249 변환기 `toPublishedWorks`
  - T253 `list_approved()` 모양 `{nowMs, rows[{slug, generation, approvedMs, display}]}`
  - T254 `cover-path`
- 점유 확인
  - `app/(public)/page.tsx`·`showcase-feed.ts`의 마지막 변경은 제 T251(`dda8096`)이에요.
  - 착수 시점에 커밋 전 변경은 없었어요.
  - `neon-showcase.tsx`는 이번에 고치지 않았어요. 기존 `status="error"` 화면을 그대로 써요.

## 바꾼 것(5경로)
| 경로 | 내용 |
|---|---|
| `lib/public-showcase/showcase-source.ts`(신규, 서버 전용) | 운영 공급원 `SHOWCASE_SOURCE = {mode:"sample"}`(명시 예시 모드), `ShowcaseListStore` 인터페이스, `readApprovedSnapshot`(스냅숏 계약 검사 → T249 원자료), `fetchApprovedSnapshot`(3초 한도, 장애 분류) |
| `lib/public-showcase/showcase-feed.ts` | T251의 동기 `buildShowcaseFeed`·`PUBLISHED_WORK_RECORDS`를 비동기 `loadShowcaseFeed(source?)`로 바꿨어요. 상태는 4가지예요. |
| `app/(public)/page.tsx` | `async`이고 `dynamic = "force-dynamic"`이에요. `unavailable`이면 `NeonShowcase status="error" works=[]`, 나머지는 `works`를 그대로 넘겨요. 로그인 링크는 같아요. |
| `tests/public-showcase/showcase-feed.test.ts` | T251 시험 6건을 T255 시험 12건으로 바꿨어요. |
| `tests/t241-public-home-route.test.ts` | 페이지가 비동기가 되어 렌더 2줄을 `await Page()`로 바꿨어요. 쓰지 않게 된 `createElement` import 1개도 지웠어요. 기대값은 바꾸지 않았어요. |

## 상태 계약
| 상태 | 언제 | 화면 |
|---|---|---|
| `sample` | 명시 예시 모드(**현재 운영**) | 예시 6개(기존과 같음) |
| `empty` | 공급원이 정상이고 활성 0건 | 예시 6개 |
| `published` | 정상 목록이고 25행 모두 계약을 통과함 | 승인 작품만 최대 24건. 예시와 섞지 않고, 커버는 `/media/public/<slug>/<gen>/cover.webp`예요. |
| `unavailable` | 설정 누락(`config`), 권한(`permission`, 42501/28000/28P01), 시간 초과(`timeout`, 3초), 조회 실패(`query`), 계약 오류(`contract`) | 예시로 **숨기지 않아요**. "작품 목록을 불러오지 못했어요"를 보여 주고, 헤더·푸터의 크리에이터 로그인(`/login?next=%2Fstudio`)과 관리자 로그인을 유지해요. HTTP는 200이에요. |

- **계약 오류가 되는 경우**
  - 스냅숏 키가 정확히 `nowMs`·`rows`가 아님
  - `nowMs`·`approvedMs`가 선행 0 없는 십진 문자열(안전 정수)이 아님
  - `rows`가 26개 이상
  - 행 키가 정확히 4개가 아님
  - slug·세대가 T254 파서 규칙에 맞지 않음
  - 승인 시각이 DB `nowMs`보다 미래
  - 순서가 `approvedMs DESC, slug ASCII ASC`가 아니거나 중복이 있음
  - 표시 키가 정확히 9개가 아님(kind·title·subtitle·creator·genre·format·description·width·height)
  - 가로·세로가 1~4096 밖
  - T249 변환에서 하나라도 제외되거나, 잘리거나, 순서가 어긋남(문구 길이·제어 문자·메일 형식·종류·연도 9999 초과 등)
- 검사 한도는 25로 맞추고 표시는 24건만 해요. 25번째 행도 같은 계약으로 검사해요.
- 승인 시각은 `new Date(ms).toISOString()`(밀리초 포함)으로 바꿔 T249에 넘겨요. 미래 판정은 DB `nowMs` 기준이에요.
- 서버 진단은 `console.error("[showcase] unavailable code=<분류> rows=<검증 통과 행 수>")` 한 줄뿐이에요. 원자료·주소·오류 원문은 남기지 않아요.
- 홈은 요청마다 새로 조회해요. 캐시·revalidate가 없고 커버 다운로드도 확인하지 않아요(설계 §5).
- 공급원 선택은 코드의 고정 값 하나뿐이에요. 환경변수·요청 값·시험용 우회는 없어요. 시험이 원문으로 고정해요.

## 시험
- **`showcase-feed.test.ts` 12건**
  - 운영 예시 모드
  - 정상 0건
  - 승인 1건(커버 주소, 내부 값 미노출, 얼림)
  - 철회 2→1→0건(요청마다 새 조회 3회)
  - 24/25 경계: 25행 → 24건, 동률은 `tie-a`만 표시. 25번째만 깨져도 장애. 24행 → 24건, 26행 → 장애.
  - ms·ASCII 정렬(`z-9`<`z10`<`z9`)
  - 장애 4종
  - 계약 위반 30종
  - 진단 로그
  - 페이지 렌더: 예시·빈 목록·승인·장애 3종. 장애는 예시와 빈 목록 문구 없이 두 로그인 링크를 유지해요.
  - 연결 범위(import·캐시 함수 없음)
- **관련 회귀:** `tests/public-showcase`(5파일), `t241`, `t243`, `t169` 합계 8파일 **100 passed (100)**
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 범위 eslint 0(exit 0)이에요.
- 시험 중 실제 버그 1건을 고쳤어요.
  - 시간 초과 때 중단 신호를 먼저 보내면, 그 신호를 받고 바로 결과를 돌려주는 공급원이 경합에서 이겨 `empty`가 되는 문제였어요.
  - 이제 시간 초과로 먼저 닫고, 그다음 중단 신호를 보내요. 경합 뒤에 `aborted`면 `timeout`으로 처리해요.

## 격리 Next HTML/RSC(저장소 밖 사본)
- **사본 준비**
  - `git archive 7c7fce0`에 `node_modules`를 물리 복사했어요(T254와 같은 방법, 원본 283항목 유지).
  - 합성 주입은 사본에서만 했어요. `SHOWCASE_SOURCE` 한 줄을 사본 전용 `t255-synthetic.ts` 상태 파일 공급원으로 바꿨어요. 커밋하지 않았어요.
- **합성 빌드:** exit 0, 경고 0
- **HTTP**(127.0.0.1:43255, 가짜 Supabase 주소)
  - 모든 상태의 HTML 응답이 200이고 `private, no-cache, no-store, max-age=0, must-revalidate`예요.
  - 상태별 결과
    | 상태 | 결과 |
    |---|---|
    | 정상 0건 | 예시와 예시 표시 |
    | 승인 1건 | 카드 1, 커버 정규 주소 |
    | 승인 2건 | 카드 2 |
    | 1건 철회 | 카드 1 |
    | 마지막 철회 | 예시로 돌아옴 |
    | 25행 | 카드 24, `tie-a` 있음, `tie-b` 없음 |
    | 26행·동률 순서 오류·미래 승인·`nowMs` 누락·조회 실패·권한 거부 | 장애 화면, 예시 0, 로그인 링크 유지 |
    | 시간 초과 | 3240ms에 장애 화면 |
  - 모든 응답에서 내부 값(`approvedMs`·`nowMs`·`rightsConfirmed`·`objectKey`·메일·분류 코드)이 0건이에요.
  - 서버 로그는 `code=contract`×4, `query`, `permission`, `timeout`이에요.
- **RSC**
  - Next 16은 `RSC: 1` 요청을 `_rsc` 검증값 주소로 307 보낸 뒤 200 `text/x-component`로 답해요. 이 리다이렉트는 기존 동작이에요.
  - 모든 RSC 응답이 `no-store`였어요.
  - 상태별 payload
    | 상태 | payload |
    |---|---|
    | 정상 0건·철회 | 예시(`"sample":true`) |
    | 승인 1건 | 해당 작품만 |
    | 25행 | `tie-a`만 |
    | 조회 실패 | `"works":[],"status":"error","loginHref":"/login?next=%2Fstudio"` |
  - 내부 값은 0건이에요.
- **정확한 커밋 빌드**
  - 합성 주입을 되돌리고 `diff -rq`로 `7c7fce0`과 같은지 확인했어요.
  - 빌드 exit 0, 경고 0, verify-build 통과, BUILD_ID `6mv18x_EaWmh54VkwT4SB`
  - 홈 HTML 200 `no-store`, 예시와 예시 표시, 장애 0, 두 로그인 링크
  - RSC 200 `no-store`, 예시
  - 진단 로그 0줄
- **보호 경로 회귀:** `/studio`·`/admin`·`/cloud/projects` 307, `/api/projects` 401, 커버(비활성) 404, 예시 이미지·`/login`·`/admin/login` 200
- **정리:** 사본 서버만 멈췄어요. 사본 안을 가리키는 `.next/node_modules` 내부 연결 3개를 먼저 끊고 사본을 지웠어요.

## 한계·후속
1. 장애 화면은 기존 `NeonShowcase status="error"`를 그대로 써요. 그래서 대표 영역과 음악 영역에 "공개된 작품이 생기면 …" 기본 문구가 함께 보여요. 목록 영역은 "작품 목록을 불러오지 못했어요"이고 다시 시도 버튼은 없어요(서버 페이지라 콜백 없음). 장애 전용 문구 정리는 화면 파일(`neon-showcase.tsx`) 범위라서 따로 배정해 주세요.
2. 홈으로 가는 링크의 사전 로드 끄기(`neon-showcase` 브랜드, `admin/login`, `admin-local-notice`)와 브라우저 뒤로 가기·재탐색 확인은 허용 범위 밖이라 하지 않았어요. 서버 응답(HTML·RSC)은 모두 `no-store`이고 요청마다 새로 조회하는 것까지만 확인했어요. 브라우저(ego) 확인도 하지 않았어요.
3. 실제 T253 PG17 `list_approved` 연결(전용 목록 자격·풀러·TLS)은 하지 않았어요. `ShowcaseListStore` 주입 지점까지예요. 운영은 명시 예시 모드 그대로예요.
4. 격리 사본에서 승인 카드의 커버 주소는 T254 공급원이 비활성이라 404예요(홈은 커버를 확인하지 않는다는 설계 그대로). 홈과 커버를 같은 합성 공급원으로 묶은 종단 확인은 하지 않았어요.
5. 진단 로그의 `rows`는 스냅숏 검사를 통과한 행 수예요. 스냅숏 단계에서 계약 오류가 나면 0으로 기록돼요.
6. T254 `cover-source.ts`도 시간 초과 처리에서 중단 신호를 먼저 보내요. 현재는 `load` 안의 추가 대기 단계 때문에 503이 유지되고 시험도 통과해요. 그래도 같은 순서 보정(먼저 닫고 신호 보내기)을 후속 1줄로 권해요. 이번 범위 밖이라 고치지 않았어요.

## 범위
- 실제 DB·Storage·게시·배포·push, `neon-showcase.tsx`·`proxy.ts`·`cover-*` 수정은 하지 않았어요.
- 공유 `.next`·3013·50963·ego는 쓰지 않았어요.
