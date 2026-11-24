# T255-F1 공개 홈 뒤로 가기 철회 보완

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_0d917548a402` · 수락 `msg_7a49932a0c13`
- 근거: T255-R `docs/handoffs/T255-R-SHOWCASE-FEED-STATES-REVIEW.md` F255-R1(앱 안 뒤로 가기에서 철회 카드가 다시 보임)
- 상태: **ready_review**
- 코드 커밋: `c4afb29`(4경로). 이 보고는 별도 커밋이에요.

## 원인
- 공개 홈이 `next/link`로 다른 화면에 갔다가 돌아오면 Next 앱 라우터가 이전 홈 화면을 그대로 복원했어요. 이때 서버를 다시 부르지 않아요.
- 응답 헤더 `no-store`는 서버에 새로 요청할 때만 효과가 있어요. 그래서 이 복원은 막지 못했어요.
- 이번 검증에서 하나를 더 확인했어요. 전체 문서 이동을 쓰더라도 이 브라우저(ego lite, Chromium)는 `no-store` 홈을 **페이지 캐시(bfcache)에서 복원**했어요. 복원 시 `pageshow`의 `persisted`가 true였어요. 링크만 바꿔서는 부족해요.

## 바꾼 것(4경로)
| 경로 | 내용 |
|---|---|
| `components/public-showcase/neon-showcase.tsx` | `next/link`를 쓰지 않아요. 브랜드 홈 `/`, 크리에이터 로그인 2곳, 관리자 로그인 링크를 일반 `<a>`(전체 문서 이동)로 바꿨어요. 사전 로드도 없어요. bfcache 대비 코드를 추가했어요. 떠날 때(`pagehide` persisted) 문서를 숨기고, 복원될 때(`pageshow` persisted) 숨긴 채 `location.reload()`로 서버에서 다시 읽어요. |
| `app/admin/login/page.tsx` | "← 공개 메인으로"를 `<a href="/">`로 바꾸고 쓰지 않게 된 `Link` import를 지웠어요. |
| `components/admin/admin-local-notice.tsx` | "공개 메인으로"를 `<a href="/">`로 바꿨어요. 작업실 링크는 `Link` 그대로예요. |
| `tests/public-showcase/home-navigation.test.ts`(신규) | 3건 |

- 시험 3건
  1. 홈 화면 파일에 `next/link`가 없고, 세 링크가 그려지는지
  2. `app`·`components` 전체에서 `/`로 가는 `<Link>`나 `router.push/replace/prefetch("/")`가 0건인지, 그리고 관리자 두 링크가 `<a>`인지
  3. bfcache 대비 코드
- 세 `<a href="/">`에는 `@next/next/no-html-link-for-pages` 예외 주석을 달았어요. 이유는 "의도한 전체 문서 이동"이에요.
- 로그인 성공 이동은 이미 `window.location.assign`(전체 문서)이에요. `/`로 가는 다른 클라이언트 라우터 경로는 없어요.

## 시험
- 관련 회귀 합계 9파일 **103 passed (103)**: `tests/public-showcase`(신규 포함 6파일), `t241`, `t243`, `t169`
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 변경 4경로 eslint 0(exit 0)이에요.

## 격리 브라우저 검증
- **환경**
  - 저장소 밖 사본 `git archive c4afb29`, `node_modules`는 물리 복사했어요.
  - 사본에서만 합성 목록 공급원을 주입했어요. 호출할 때마다 `calls.log`에 한 줄을 남겨요.
  - 빌드 exit 0, 경고 0
  - `next start` 127.0.0.1:43256에 `t255f1.localhost`로 접속했어요.
  - ego lite taskSpace 70을 썼어요. Tester `term_6cae471a…`에 시작과 종료를 통지했어요(이전 `term_410f…`는 연결이 없어 Master에 통지).
- **"철회 카드 보임" 측정 방법:** 뒤로 가기나 앞으로 가기 직후 1.5초 동안 약 25ms 간격으로 문서를 읽었어요. 철회한 작품명이 **보이는 상태**로 있는 횟수를 셌어요. `innerText` 기준이고, 숨김 상태는 셈에서 빠져요.

| 시나리오 | 결과 |
|---|---|
| A. 홈(2건) → 푸터 관리자 로그인 → 대표 작품 철회 → 뒤로 가기 | 관리자 화면은 문서 이동이었어요(`navigate /admin/login`). 뒤로 가기 때 브라우저가 bfcache로 복원했어요(`persisted:true`, 그 순간 `visibility:hidden`). 이어서 reload(`navType: reload`)되었고, 공급원은 1번 호출됐어요. 결과는 남은 1건만이에요. 측정 48회 중 **철회 카드가 보인 횟수 0** |
| B. 홈 → 크리에이터 로그인(`/login?next=%2Fstudio`) → 뒤로 가기 | 로그인 화면을 정상적으로 열었어요. 돌아올 때 bfcache 복원 → reload, 공급원 1번 호출, 현재 목록 표시 |
| C. 관리자 로그인(문서)에서 2.5초 대기 → "← 공개 메인으로" → 뒤로 → 철회 → 앞으로 | 관리자 화면에서 **사전 요청이 없었어요**(공급원 호출 0, `_rsc` 자원 0). 링크를 누르면 홈 문서를 새로 열어요(`navigate`, 공급원 1번 호출, 2건). 앞으로 가기 때 reload, 공급원 1번 호출, 1건만. 측정 49회 중 **철회 카드가 보인 횟수 0** |
| D. 새로고침 | 공급원 1번 호출, 현재 상태(2건) 반영 |
| E. 홈 안 브랜드 링크 | 문서 이동(`navigate`), 공급원 1번 호출, 철회 반영(1건) |
| F. 인증 이동 회귀 | `/studio` → `/login?next=%2Fstudio`, `/admin` → `/admin/login?next=%2Fadmin`, `/cloud/projects` → `/login?next=%2Fcloud%2Fprojects` |

- **HTTP 확인**
  - 홈 HTML: 200, `private, no-cache, no-store, max-age=0, must-revalidate`
  - RSC: `_rsc` 307을 거쳐 200 `text/x-component`, 같은 `no-store`
  - 홈 HTML의 링크: `href="/"` 1, `/admin/login` 1, `/login?next=%2Fstudio` 2
- **정리**
  - ego `finish({keep:[]})`를 했어요.
  - 사본 서버만 멈췄어요.
  - 사본 안을 가리키는 내부 연결 3개를 끊고 사본을 지웠어요. 원본 `node_modules`는 283항목 그대로예요.

## 남은 한계
1. bfcache 복원 때는 이전 화면이 화면 밖에서 잠깐 복원된 뒤 reload돼요. 문서를 숨긴 상태라 측정에서 보인 적은 없지만, 숨김 처리를 지원하지 않는 브라우저는 확인하지 않았어요. 측정한 브라우저는 ego lite Chromium 하나예요. Safari와 Firefox는 확인하지 않았어요.
2. 이미 화면에 그려진 홈을 띄워 둔 채 철회하면, 사용자가 다시 읽기 전까지는 그대로 보여요. 설계상 회수할 수 없는 범위예요.
3. 홈 링크가 전체 문서 이동이 되어서 그 링크로 이동할 때는 앱 안 이동처럼 빠르지 않아요. 홈을 오가는 링크에만 해당해요.
4. 문구 정리(F255-R2)와 시간 상한(F255-R3)은 지시대로 별도 후속이에요.
5. 실제 공급원·운영 연결·배포는 하지 않았어요. 운영은 여전히 명시 예시 모드예요.

## 범위
- 홈 탐색 경로 3파일과 신규 시험 1개만 바꿨어요.
- 다른 작업 파일(공유 문서 2개, 보존 대상, T254-R·T255-R 보고)은 그대로 두었어요.
- 공유 `.next`·3013·50963·Ego54/55는 쓰지 않았어요.
