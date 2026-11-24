# T-245 관리자 비밀번호 재설정 뒤 관리자 로그인 복귀 · 최종 release 후보

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_495cf0c21983` · 근거: Tester `msg_b55a9b8a8ef1`
- 상태: **ready_review(작성자 자체 검증)**
- **최종 후보:** `5148ebb8a5492ead4037afda76692212a1ed4c2d`(ref `release/admin-login-20261118-t245`)

## 1. 원인과 고친 것(커밋 `9148b8e`)
- **원인:** 관리자 로그인에서 "비밀번호 찾기"를 해도 메일 링크 → `/account/password` → 변경 후 일반 `/login?notice=…`로 갔어요. 관리자는 다시 관리자 로그인을 찾아야 했어요.
- **고친 방식:** 정해 둔 이름 하나(`context="admin"`)만 주고받아요. 돌아갈 주소는 서버·설정 코드가 고정 문자열로 만들어요.

| 파일 | 변경 |
|---|---|
| `lib/auth/config.ts` | `passwordContext`(정확히 `"admin"`만), `passwordPagePath`, `passwordDonePath` 순수 함수를 추가했어요 |
| `app/api/auth/reset/route.ts` | 메일 링크 next를 `passwordPagePath(passwordContext(body.context))`로 만들어요 |
| 〃 | 다른 값이나 본문의 next·redirectTo는 쓰지 않아요 |
| 〃 | 교차 사이트 거절, 허용 밖 동일 안내, 429·502 처리는 그대로예요 |
| `components/auth/login-form.tsx` | `resetContext` prop을 추가했어요. 재설정 본문에 `context`를 붙일 때만 써요. 일반 화면은 `{ email }` 그대로예요 |
| `app/admin/login/page.tsx` | `resetContext="admin"`을 넘겨요 |
| 〃 | `notice=password`·`password-partial` 안내(일반 로그인과 같은 문구)를 보여 줘요. 모르는 값은 무시해요 |
| `app/account/password/page.tsx` | `?context=`는 `passwordContext`로만 읽어요. 관리자면 표시줄에 "· 관리자"를 붙이고 폼에 context를 넘겨요 |
| `components/auth/new-password-form.tsx` | 로그아웃 결과 ended·partial일 때 이동만 `passwordDonePath(context, …)`로 바꿨어요 |
| 〃 | 비밀번호 변경 요청, 로그아웃 실패 시 "로그아웃 다시 시도"(비밀번호를 다시 보내지 않음), 세션 변경 알림은 그대로예요 |

- **관리자 흐름**
  1. 메일 링크: `/auth/callback?next=/account/password?context=admin`
  2. callback의 기존 `safeNextPath`·허용 계정 검사를 그대로 거쳐요.
  3. 비밀번호를 바꾸고 로그아웃해요.
  4. `/admin/login?next=%2Fadmin&notice=password`(또는 `password-partial`)로 돌아와요.
- 일반 로그인·가입·재설정의 문구, 계정 존재 미노출, CSRF, no-store, 허용 계정, 토큰 검증, 쿠키 정책은 바꾸지 않았어요.
- 실제 메일 발송, 비밀번호 조회·변경, 계정 조작은 하지 않았어요. mock SDK와 로컬 가짜 인증 서버만 썼어요.

## 2. 시험
- **새 `tests/t245-admin-reset-return.test.ts`: 7개**
  - **고정 이름:** `"admin"`만 받아요. `Admin`·공백·`/admin`·외부 URL·`admin&next=…`·배열·객체·숫자는 null이에요.
  - **고정 경로 값:** 메일 next가 `safeNextPath`를 통과하는지도 확인해요.
  - **reset 라우트**
    - 관리자 요청만 `next=/account/password?context=admin`이에요. 메일 링크 기준 주소(origin)와 `/auth/callback` 경로는 그대로예요.
    - 다른 context 5종은 `/account/password`예요.
    - 본문의 next·redirectTo는 무시해요.
  - **허용 밖 계정:** 관리자 요청이어도 일반 요청과 응답이 똑같고 메일 호출은 0이에요. 다른 사이트 요청은 403에 호출 0이에요.
  - **화면 연결**
    - 관리자 로그인 안내 문구 2종이 보여요. 모르는 notice는 보이지 않아요.
    - 폼 본문 분기와 비밀번호 화면 context 읽기를 확인해요.
    - 끝난 뒤 이동은 `passwordDonePath`로만 하고, 로그아웃 재시도 흐름이 유지돼요.
    - 외부 값이면 "관리자" 표시가 없어요.
- **red→green:** 옛 6개 소스로 돌리면 `6 failed | 1 passed (7)`, 수정 후 7 pass예요.
- **본 트리**(B47 WIP 미추적 파일이 있는 트리)
  - 전체 vitest: **105 passed | 10 skipped files, 2093 passed | 319 skipped (2412)**
  - `eslint .`: 0

## 3. 최종 release 후보 구성
- **기준:** 운영 `e36171c` + T-243 `6d0ee14` + T-244 `ff1bc43` + T-245 `9148b8e`의 diff만 넣었어요. Backend B46/B47와 HEAD의 다른 커밋은 넣지 않았어요.
- **방법**
  - 임시 `GIT_INDEX_FILE`에 중간 후보 `f94faa1`의 tree를 read-tree 했어요.
  - `9148b8e^..9148b8e` diff를 `apply --cached` 했어요(T-245 파일은 `ff1bc43` 이후 다른 커밋이 건드리지 않음).
  - `write-tree` → `commit-tree -p e36171c` → `update-ref refs/heads/release/admin-login-20261118-t245`(새 ref만)
  - commit `5148ebb8a5492ead4037afda76692212a1ed4c2d`, tree `a696dcc1…`
- **보존 증거**
  - 전후로 공유 `.git/index` sha256 앞 16자 `41cf249ab8430aa9`가 같아요.
  - stage 0개, HEAD `9148b8e`, `refs/heads/master`가 그대로예요.
  - 중간 후보 ref `release/admin-login-20261118` = `f94faa1`도 그대로예요.
- **대조**
  - `e36171c`→`5148ebb` 변경 파일 18개(648+/25−)가 세 저자 커밋 변경 파일의 합과 같아요.
  - 18개 모두 blob이 HEAD(`9148b8e`)의 같은 파일과 같아요.

## 4. 최종 후보 검증(저장소 밖 archive 사본)
- **archive:** 1196파일(`git ls-tree` 1196), sha256 `afefe317d88bf64a9a710ec045131f419aca81ced7d4ed819e14f968adb0f018`
- **정적 검사:** `next typegen`+`tsc` 0, `eslint .` 0
- **관련 시험 11파일:** **294 pass**
  - t245, t243, t241, t182, t183, t200, t207, t213, t220, t229, public-showcase
- **빌드:** `npm run build` exit 0, 경고 0, "Compiled successfully", verify-build 통과(BUILD_ID `eIkzUqJDMa9kGg5KGL18b`)
- **운영 빌드 `next start` HTTP**
  - 앱 localhost, 가짜 인증 127.0.0.1, 합성 토큰을 썼어요.
  - 이 모드는 `VERCEL` 없이 supabase 모드예요. 이 PC 주소에서 쓰는 같은 사이트 확인을 거치려고 그렇게 했어요.

| 상태 | 결과 |
|---|---|
| 익명 | `/`·`/admin/login` 200. `/admin` → `/admin/login?next=%2Fadmin`. `/admin/x?y=1`은 next를 유지해요. `/adminx`·`/studio` → `/login`. API 401 |
| 〃 비밀번호 화면 | `/account/password?context=admin` → `/login?next=…`(기존 보호 동작, 관리자 경로 아님) |
| 허용 owner | `/admin`·`/account/password?context=admin` 200 |
| 허용 밖 | `/admin` → `/admin/login?error=forbidden`, API 403 |
| 위조 토큰 | `/admin` → 관리자 로그인, API 401 |
| 설정 누락(`VERCEL=1`) | `/` 200. `/admin/login`·`/admin`·`/login`·`/account/password?context=admin` 503 |

- 재설정 요청 API에 `context:"admin"`을 보내면, 가짜 인증 서버가 받은 `redirect_to`는 `http://localhost:<port>/auth/callback?next=%2Faccount%2Fpassword%3Fcontext%3Dadmin`이에요.

### ego(새 taskSpace 2개, 앱 localhost)
- **44px UI**(`tmp/t245/ui-result.json`, PASS): `/admin/login`·`/login` × 1280·390
  - 44px 미만 0, 넘침 0
  - 관리자 폼은 tablist 0, 일반 폼은 1
  - Tab 순서: 이메일 → 비밀번호 찾기 → 비밀번호 → 보기
  - "보기" Enter로 `aria-pressed` true와 text, 다시 false와 password로 바뀌어요.
  - 비밀번호 찾기 화면: 작은 대상 0, 이메일 포커스. "로그인으로 돌아가기"를 누르면 비밀번호 칸이 다시 나오고 이메일에 포커스가 가요.
  - 캡처: `tmp/t245/shots/`
- **재설정 복귀 흐름**(390, `tmp/t245/flow-result.json`, PASS)
  - **요청:** 관리자 로그인 → 비밀번호 찾기 → 이메일 제출하면 일반 안내가 떠요. 가짜 서버가 받은 `redirect_to`의 next는 관리자 비밀번호 화면이에요.
  - **변경(로그아웃 성공):** 합성 owner 세션으로 `/account/password?context=admin`에 들어가요.
    - 표시줄 "DREAM AI STUDIO · 관리자"
    - 새 비밀번호를 제출하면 `/admin/login?next=%2Fadmin&notice=password`로 가고, h1 "관리자 로그인"과 안내가 떠요. 세션 쿠키는 0이에요.
  - **서버 로그아웃 실패:** 가짜 서버가 global 로그아웃에 500을 줘요. `/admin/login?next=%2Fadmin&notice=password-partial`로 가고 partial 안내가 떠요. 이 브라우저 쿠키는 0이에요.
  - **외부 값:** `/account/password?context=https://evil.test`는 일반 표시줄로 나오고, 변경 후 `/login?notice=password`(기존과 같음)로 가요.
  - **가짜 서버 호출 순서:** RECOVER 1 → (PUT user 1, LOGOUT global 204) → (PUT 1, LOGOUT global 500, local) → (PUT 1, LOGOUT global 204). **변경마다 비밀번호 요청은 1번뿐이에요.**
- **쿠키**
  - 합성 세션 쿠키는 localhost에만 넣었어요. 앱 로그아웃으로 지워졌고, 끝난 뒤 localhost 쿠키는 0이에요.
  - 127.0.0.1의 기존 쿠키, Ego54, 50963은 건드리지 않았어요.
- 서버·가짜 인증 서버는 모두 종료했고 포트가 닫힌 것을 확인했어요.

## 5. 확인 안 된 것·사람만 할 수 있는 일
- 실제 Supabase에서 메일 발송, 링크 code 교환, 실제 비밀번호 변경은 하지 않았어요. callback의 code 교환은 기존 코드 그대로이고 mock 시험 범위예요.
- 운영 계정의 비밀번호 확정은 **주인님만** 할 수 있어요.
  1. 배포 뒤 `/admin/login` → "비밀번호 찾기" → 허용 이메일을 넣어요.
  2. 메일 링크를 눌러 새 비밀번호를 정해요.
  3. 관리자 로그인 화면으로 돌아와 로그인해요.
- 운영 Supabase의 redirect 허용 목록은 이미 `/auth/callback**`을 포함해요(Master 읽기 확인). 새 query `next=…context=admin`도 같은 경로라 설정을 바꿀 필요가 없을 것으로 보여요. 단, 실제 메일로 확인하지는 않았어요.

## 남은 gate
1. Tester 독립 보안·UI 검수: T243-R 진행 중, T244·T245는 아직
2. Master release 수용
3. 원격 master 정확 대조(`e36171c`)
4. Master의 정확 SHA push·배포
5. 운영에서 주인님 비밀번호 확정·로그인

## 보호
- 이 보고와 T-244 보고만 커밋해요.
- 코드는 `9148b8e`에 이미 고정했어요.
- B47 WIP, T122·T137, tmp는 미변경·미stage예요.
- push·배포 없음. 새 창·agent·worktree 없음.
