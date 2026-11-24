# T297 관리자 검수 큐와 게시 API 연결

- 담당: Codex(Front) · 배정 Master `msg_0ab402fdbb8e`, 공용 시험 조정 `msg_542a58901cc4`·`msg_61517e66c343`·`msg_7f09751643c9`
- 기준: T289-F4-R 통과, T290-F1 서비스(`lib/public-showcase/admin-publication-service.ts`)
- 고정 SHA: `1801d83f5905c3a7c2d1654f206fc8e43f55fceb`
  - 제품 코드는 `1a82cca`에서 끝났어요. `1801d83`은 공용 legacy 시험만 바꿨어요.
  - 커밋: `a6aff19`(연결) → `1a82cca`(인증 우선 순서·공용 보호 인벤토리) → `1801d83`(legacy 시험 클라우드 전용 명시)
- 판정: 구현과 자체 확인을 마쳤어요. 독립 검수 전이에요.

## 연결 구조

| 층 | 파일 | 하는 일 |
|---|---|---|
| 화면 | `app/admin/page.tsx` | 기존 관리자 판정(`getRenderAuth`: 로그인·허용 이메일) 뒤에만 첫 목록을 서버에서 읽고, `ProtectedContent` 안 관리 허브 아래에 큐를 그려요. |
| 화면 래퍼 | `components/admin/publication-http-queue.tsx` | 동일 출처 공급자를 한 번만 만들어 `PublicationQueue`(`source="server"`)에 넘겨요. 공급자 참조가 그대로라 큐의 공급자 세대가 바뀌지 않아요. |
| 공급자 | `components/admin/publication-http-provider.ts` | `/api/admin/publications`로 `cache: no-store`·`credentials: same-origin`·`redirect: error` 요청을 보내요. 본문에는 계약 필드 6개만 담아요. |
| 라우트 | `app/api/admin/publications/route.ts` | GET·POST가 서버 경계만 불러요(`runtime=nodejs`, 동적). |
| 서버 경계 | `lib/public-showcase/admin-publication-http.ts` | 인증·출처·형식·크기·저장소 연결을 판정하고 T290 서비스를 불러요. |

**서버 경계 순서**
- GET: 인증 1회 → 저장소가 없으면 `{kind:"closed"}` → 있으면 서비스 `list()`. 모두 `no-store`예요.
- POST: 인증 1회 → 같은 사이트·`application/json`(머리글만 확인) → 저장소 연결 → 본문 1024바이트 제한 읽기 → JSON 객체 확인 → 서비스 `apply()`.
  - 인증·출처·연결 판정 전에는 본문을 읽지 않아요.
  - 서비스 결과(성공·`conflict`·`source-unavailable`·`denied`·`invalid`·`unavailable`)는 모두 200 본문으로 돌려줘요.
- 인증 결과는 요청 하나 안에서만 기억해요(getUser 1회, 전역 캐시 없음). 서비스가 다시 검증된 세션·게시자·작품 소유·요청 UUID 원장·권리·리비전을 판정해요. 화면이 보낸 actor·owner는 계약 밖 필드라 `invalid`예요.

**HTTP 응답과 공급자 해석**

| 경우 | 서버 응답 | 공급자 해석 |
|---|---|---|
| 로그인 없음 / 허용 안 된 계정 / 인증 장애 | 401 / 403 / 503 (`no-store`, 리다이렉트 없음) | 쓰기 `denied`·`denied`·`unavailable`, 목록 `failed` |
| 로컬 실행(로그인 꺼짐) | 503 `PUBLICATION_UNLINKED` | — (화면은 기존 로컬 안내) |
| 다른 사이트·Origin 없음 | 403 `AUTH_ORIGIN_REJECTED` | `denied` |
| JSON 아님 / 너무 큼 / 깨진 본문 | 415 / 413 / 400 | `invalid` |
| 운영 저장소 미준비 | GET 200 `closed`, POST 503 `PUBLICATION_UNLINKED`(서비스·저장소 0) | 목록 "게시 서버 미연결", 쓰기 `unavailable` |
| 네트워크 오류·형식 틀린 응답 | — | 쓰기 `unavailable`(커밋 여부 모름 → 같은 UUID 재시도), 목록 `failed` |

- 공급자는 목록 한 줄의 필드가 계약 9개(+`source` 2개)와 정확히 같을 때만 받아요. 서버가 실수로 소유자·경로 같은 값을 더 보내도 화면에 들이지 않아요.
- **운영 저장소:** `productionPublicationStore()`는 `null`이에요. 그래서 운영 `/admin`은 지금 "게시 서버 미연결"만 보이고, 쓰기를 실행하지 않아요. T293 어댑터는 격리 시험용이고, 신뢰 서버 자격과 운영자 세션을 분리하는 운영 어댑터가 준비되면 이 함수만 바꾸면 돼요. 합성 저장소는 시험 파일에만 있어요.

## 바꾼 파일

- 제품: `app/admin/page.tsx`, 신규 `app/api/admin/publications/route.ts`, `lib/public-showcase/admin-publication-http.ts`, `components/admin/publication-http-provider.ts`, `components/admin/publication-http-queue.tsx`
- 집중 시험
  - 신규 `tests/admin/publication-http.test.ts` (36개)
    - GET 인증 4종·예외·미연결·운영 기본값·A/B
    - POST 출처·형식·인증 전 본문 0·미연결·크기·깨진 본문·위조 필드
    - 준비→게시→철회와 같은 UUID 재생(저장 추가 0), 커밋 전 실패 뒤 같은 UUID 처리
    - 증빙 없음 `source-unavailable` 고정, 충돌·같은 UUID 다른 의도, B의 A 작품 변경 거절
    - 공급자 연결·상태 해석·네트워크·형식 오류, 화면·라우트 소스
  - 신규 `tests/admin/publication-http-fixture.ts`: 합성 저장소. T290 시험과 같은 규칙이고, 커밋 전 실패 주입이 들어 있어요.
  - `tests/admin/publication-queue.test.ts`: "운영 /admin 미연결" 확인을 "HTTP 큐로만 연결, 합성 공급자 사용 안 함"으로 바꿨어요.
- 공용 시험 (Master 승인 범위)
  - `tests/api-auth.test.ts`: 보호 인벤토리에 `admin/publications`를 등록했어요. 동일 출처·미연결 직접 시험 3건을 추가했어요.
    - 허용 계정이라도 다른 사이트·Origin 없음이면 본문 전에 403이에요.
    - 같은 사이트 JSON 쓰기도 운영 기본값이면 503 미연결이고, 본문을 읽지 않아요.
    - 허용 GET은 `closed`·`no-store`이고, getUser는 1회예요.
  - `tests/t198-legacy-gate.test.ts`: `NEW_READ`를 `CLOUD_ONLY`로 바꿨어요.
    - 기존 두 GET에 `admin/publications` GET·POST와 T296 `studio/reference-analysis` POST를 정확히 적었어요.
    - 적힌 경로·메서드가 실제로 있는지 확인하는 시험을 추가했어요.
    - 나머지 경로는 모두 같은 legacy 시험을 그대로 받아요.

## 검증 (실제 출력)

**명령 결과**
- 집중: `tests/admin` + `tests/api-auth.test.ts` `Tests 211 passed (211)`, `tests/t198-legacy-gate.test.ts` `Tests 80 passed (80)`
- 전체 vitest(`1801d83`): `Test Files 137 passed | 16 skipped (153)`, `Tests 2695 passed | 385 skipped (3080)`
- 전체 tsc 오류 0줄, 변경 파일 eslint exit 0, 커밋마다 `git diff --cached --check` 통과. 격리 사본 `npm run build` 성공.

**격리 Next 실제 HTTP** (127.0.0.1:43297)
- 사본 전용 조작(커밋 안 함)
  - `resolveServerAuth`를 시험 쿠키로 합성 계정 A(게시자)·B(게시자 아님)·X(허용 안 됨)로 정했어요.
  - `productionPublicationStore`가 합성 저장소를 돌려주게 했어요.
  - 조작용 `/api/t297-hooks`를 붙였어요.
- 실제 `/admin`·`/api/admin/publications`·관리자 판정·큐 코드는 그대로예요.

| 요청 | 결과 |
|---|---|
| GET 로그인 없음 / X / B / A | 401(`no-store`) / 403 / 200 `{"kind":"closed"}` / 200 A 작품 1개(B 작품 없음) |
| POST A 다른 사이트 / Origin 없음 / `text/plain` / 2KB | 403 / 403 / 415 / 413 |
| POST B(A 작품) / 로그인 없음 | 200 `{"status":"denied"}` / 401 |
| 위 요청 뒤 저장소 | 저장 0, 원장 0, A 작품 v0 그대로 |
| `/admin` 로그인 없음 / X | 307 → `/admin/login?next=%2Fadmin` / 307 → `?error=forbidden` |

**브라우저 확인** (ego 공간, 1280과 390에서 같은 결과)
- **B:** 큐는 "게시 서버 미연결" 안내만 있고, 작품 줄·버튼은 0개예요.
- **A, 검수→게시→철회:**
  1. 권리 체크 뒤 v0 준비 → v1 "게시 준비를 마쳤어요(세대 1)"
  2. 커밋 전 실패를 넣고 게시 → "같은 게시 요청 다시 시도"
  3. 재시도 → v2 "공개 목록에 게시했어요"
  4. 철회 확정 → v3 "세대 1을 철회했어요"
  5. 목록 다시 불러오기 → v3 그대로
- **보낸 요청:** `prepare`, `complete`×2(같은 UUID: 1280 `1ccb`, 390 `67f5`), `revoke`.
  - 서버는 revision 3에 준비·게시 세대가 비었어요. 원장 3건, 감사 3건이에요(롤백된 시도는 남지 않음).
- **미연결:** 저장소를 끄면 `/admin`이 "게시 서버 미연결"이 되고, 작품 줄은 0개예요. 같은 사이트 POST는 503 `PUBLICATION_UNLINKED`(`no-store`)이고, 저장소 트랜잭션은 0회예요.
- 상단 "목록 다시 불러오기"는 44px예요(미연결 화면에는 원래 없음). 가로 넘침이 없어요(1280: 1265 = 스크롤바를 뺀 너비, 390: 390).

**정리:** 처음 실행에서는 미연결 전환 값이 사본 조작 모듈 변수에 있었어요. 화면과 API가 이 모듈을 따로 불러와서 화면에 전환이 반영되지 않았어요. 사본 안에서 값을 전역 공유 상태로 옮기고 다시 확인했어요(제품 코드 변경 없음). 격리 사본·서버·ego 공간을 닫았고, 원본 `node_modules`는 283개 그대로예요. 실제 DB·Supabase·외부 요청·배포는 없었어요.

## 한계·다음

- 운영 게시는 아직 미연결이에요. 운영 저장소 어댑터(신뢰 서버 자격 분리)가 들어와야 실제 게시가 돼요.
- 공급자는 다른 사이트 403(`AUTH_ORIGIN_REJECTED`)도 `denied`로 해석해요. 화면을 새로 고치면 같은 사이트 요청이 되므로 재시도를 권하지 않아요.
- DOM 클릭 시험 도구가 없어서 화면 상호작용은 ego로 확인했어요.
