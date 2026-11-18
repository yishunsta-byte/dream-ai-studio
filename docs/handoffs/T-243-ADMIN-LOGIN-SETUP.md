# T-243 관리자 로그인·관리 진입

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_5ad62d61648d` · 운영 읽기 근거: Master `msg_31fd6b522ce7`
- 상태: **ready_review(작성자 자체 검증, Auth 경계 변경이라 독립 보안 검수 필요)**
- 기준: 로컬 HEAD `c2adc6b` 위. 운영 배포는 `e36171c`예요.
- 이번 변경은 아직 배포되지 않았어요. 빌드·배포는 고정 검수 뒤 별도 범위예요.

## 1. 확인한 차이(구현 전)
- **운영 `e36171c`**
  - 공개 메인에는 "크리에이터 로그인"(`/login?next=%2Fstudio`)만 있어요.
  - **관리자 진입 주소·링크·화면이 없었어요**(`/admin` 없음). 사용자가 말한 "아직 안 되어 있음"의 코드 쪽 원인은 이거예요.
- **기존 인증**
  - Supabase 이메일·비밀번호 로그인(`/api/auth/login`)을 써요.
  - proxy와 서버(`resolveServerAuth`)가 getUser와 허용 이메일(`DREAM_ALLOWED_EMAILS`)로 판정해요.
  - 관리 성격의 기존 화면: `/cloud/manage`(개인 관리, 읽기 전용), `/cloud/projects`, `/account/password`
- **운영 설정**(Master 읽기 확인, 제가 다시 조회하지는 않았어요)
  - Production Current는 `e36171c`예요.
  - Supabase Site URL과 `/auth/callback` 허용 주소가 이미 있어요.
  - Email 공급자에 등록 계정이 보여요.
  - 관리자 로그인은 같은 `/api/auth/login`(비밀번호)을 써서 **새 redirect 설정이 필요 없어요.**
- **확인하지 못한 것**
  - 운영 계정의 비밀번호가 실제로 정해져 있는지, 실제로 로그인되는지는 확인하지 못했어요.
  - 과거 T184 기록("초기 owner 비밀번호 없음, 사용자 설정 필요")은 역사 기록이에요. 지금 실패의 원인으로 단정하지 않을게요.
  - Vercel env 이름과 유무는 제가 접근할 수 없어서 확인하지 못했어요.

## 2. 바꾼 것
| 파일 | 변경 |
|---|---|
| `lib/auth/config.ts` | `PUBLIC_PATHS`에 `/admin/login` 정확 경로 추가 |
| 〃 | `ADMIN_HOME`·`ADMIN_LOGIN`, `isAdminPath`(`/admin`과 `/admin/…`만, `/adminx` 아님) 추가 |
| 〃 | `adminNextPath` 추가: `safeNextPath`를 거친 뒤 `/admin` 아래만 허용해요. `/admin/login` 자신은 빼요. 그 밖은 `/admin`이에요 |
| 〃 | `adminLoginPath` 추가 |
| `proxy.ts` | `deny()`에서 `/admin` 아래면 401 → `/admin/login?next=…`, 403 → `/admin/login?error=forbidden`으로 보내요. **판정 순서·조건은 그대로**이고 목적지만 달라요 |
| `app/admin/login/page.tsx`(새) | 관리자 로그인 화면이에요 |
| 〃 | 기존 `LoginForm`을 `loginOnly`로 써요(회원가입 탭 없음, 로그인·비밀번호 찾기만). next는 `adminNextPath`로만 정해요 |
| 〃 | 오류 문구는 계정 존재·허용 여부를 드러내지 않아요. `noindex, nofollow`예요 |
| 〃 | 로그인 꺼짐(이 PC)이면 폼 없이 설정 안내만 보여요 |
| `app/admin/page.tsx`(새) | 관리 허브예요. proxy와 별도로 그리기 전에 `getRenderAuth()`로 다시 판정해요 |
| 〃 | 401 → 관리자 로그인(next=/admin), 403 → forbidden, 503 → unavailable로 보내요. 로그인 꺼짐이면 안내만 보여요 |
| 〃 | 확인된 계정만 `SessionBoundary`·`AccountMenu`·`ProtectedContent`(기존 T-220 경계)로 그려요. `noindex`이고 `force-dynamic`이에요 |
| `components/admin/admin-hub.tsx`(새) | 로그인 계정과 자기 범위 링크 3개(개인 관리·내 프로젝트·비밀번호 바꾸기)를 보여 줘요 |
| 〃 | "회원 관리"·"서비스 상태"는 **미연결**로만 표시해요 |
| 〃 | 가짜 통계, 다른 회원 정보, 정상 배지, 삭제·실행 버튼, 폼은 없어요 |
| `components/admin/admin-local-notice.tsx`(새), `admin.module.css`(새) | 로그인 꺼짐 안내 화면이에요. 링크는 44px이에요 |
| `components/auth/login-form.tsx` | `loginOnly` prop만 추가했어요(기본 false, 기존 화면 그대로). 요청과 판정은 같아요 |
| `components/public-showcase/neon-showcase.tsx`·`.module.css` | 푸터에 크리에이터 로그인과 나란히 **관리자 로그인** 링크(`adminHref` 기본 `/admin/login`)를 넣었어요 |
| 〃 | `.link`(44px)를 상속하고, 색은 muted예요. `.footerLinks`로 줄바꿈돼요 |

- 새 계정, 새 권한, 허용 이메일 확대, 고정 비밀번호, 토큰, localStorage 판정, 우회는 **없어요.**
- `.env`와 비밀값은 건드리지 않았어요.

## 3. 시험
- **새 `tests/t243-admin-login.test.ts`: 13개 통과**(mock Auth, 실제 Supabase 계정 아님)
  - **경로 판정**
    - `/admin/login`만 공개예요. 익명 즉시 통과(T241 7개) 대상은 아니라서 설정 확인·세션 갱신을 받아요.
    - `/admin`, `/admin/`, `/admin/x`, `/admin/login/x`, `/admin/LOGIN`, `/adminx`, `/admin/login/`은 공개가 아니에요.
  - **next 방어**
    - `/admin/x?tab=1`만 그대로 둬요.
    - `//evil.test`, 외부 URL, 탭·역슬래시, `/studio`, `/adminx`, `/admin/login…`, `/login`은 모두 `/admin`으로 바뀌어요.
  - **proxy**
    - 설정 누락: `/admin/login`·`/admin`·`/admin/x` 503 no-store
    - 익명: `/admin/login` 통과(getUser 1회), `/admin` → `/admin/login?next=%2Fadmin`, query 유지
    - 기존 경로는 그대로예요: `/studio` → `/login?next=…`, `/adminx` → `/login`, API 401
    - 허용 밖 계정: `/admin` → `/admin/login?error=forbidden`. 허용 계정은 통과해요.
  - **허브**
    - 401·403·503은 그리기 전에 이동해요.
    - 허용 계정만 이메일·링크 3개·미연결이 보여요. 폼·삭제·가짜 통계는 없어요.
    - 로그인 꺼짐이면 안내만 보이고 getUser는 0회예요.
  - **로그인 화면**
    - password 칸은 있고 회원가입·tablist는 없어요.
    - forbidden과 알 수 없는 오류 문구를 확인했어요.
    - 로그인 꺼짐이면 폼이 없어요. 두 화면 모두 noindex예요.
  - **기존 폼과 공개 메인**
    - 일반 `/login` 폼은 탭·회원가입이 그대로예요.
    - 공개 메인에 `/admin/login` "관리자 로그인"과 크리에이터 로그인이 함께 있어요.
- **기존 시험 갱신 1건:** `tests/t220-protected-content-session.test.ts`
  - 처음엔 실패했어요(AccountMenu를 그리는 파일 목록에 `app/admin/page.tsx`가 새로 들어옴).
  - 목록에 추가하면서, 같은 `SessionBoundary account={account}`·`ProtectedContent` 조건을 그대로 요구하게 했어요. 기대를 낮추지 않았어요.
- **본 작업 트리**
  - 전체 vitest: **Test Files 104 passed | 10 skipped (114), Tests 2085 passed | 319 skipped (2404)**
  - B47 WIP(`tests/b47-…`, 미추적) 파일이 함께 있는 트리에서 낸 결과예요.
  - `eslint . --max-warnings 0`은 exit 0이에요.
- **격리 clean 사본**(`tmp/t243/app` = `git archive HEAD` + 변경 12파일): `next typegen` + `tsc --noEmit --incremental false` 오류 0

## 4. 격리 HTTP(dev, 제 포트만, production build 없음)
| 상태 | 결과 |
|---|---|
| 운영 유사 익명(가짜 Auth) | `/` 200(푸터 `href="/admin/login"` "관리자 로그인"). `/admin/login` 200 no-store·noindex·cookie 0. 본문에 "관리자 로그인"이 있고, 회원가입 0, password 1, 민감 문구(허용 이메일·DREAM_·서비스 키) 0 |
| 〃 next 위조 | `/admin/login?next=//evil.test` 200(next는 서버가 `/admin`으로 바꿈) |
| 〃 보호 | `/admin` 307 → `/admin/login?next=%2Fadmin`. `/admin/x?y=1` → `next=%2Fadmin%2Fx%3Fy%3D1`. `/admin/login/x` → `next=%2Fadmin`. `/adminx` → `/login?next=%2Fadminx`. `/studio` → `/login?next=%2Fstudio`. `/api/projects` 401. 모두 no-store |
| 〃 실패 응답 | 로그인 실패 응답은 `400 INVALID_CREDENTIALS "이메일 또는 비밀번호가 맞지 않아요."`예요(계정 존재 여부 미노출) |
| 설정 누락 | `/` 200, `/admin/login`·`/admin` 503 no-store |
| 이 PC(로그인 꺼짐) | `/admin/login`·`/admin` 200 "관리자 로그인은 운영 사이트에서 써요" 안내만. 관리 메뉴·폼 0, noindex |

## 5. 브라우저(ego, 1280·390, 새 taskSpace, 사용자 보존 Ego54·50963 미사용)
- **공개 메인 푸터 관리자 링크**
  - 1280·390 모두 높이 44px, 폭 76px이에요.
  - 글자 (188,182,205)와 배경 (9,9,16)의 대비는 10.12예요. 크리에이터 로그인과 함께 있고 넘침이 없어요.
  - Enter를 누르면 `/admin/login`으로 가요(로그인 꺼짐 안내, 폼 0, 작은 대상 0).
- **허브 모양:** 격리 사본에만 둔 미리보기 경로(`/t243-preview`, 커밋 안 함)로 봤어요. h1 "관리 화면", 넘침 0, 44px 미만 0, 폼 0이에요.
  - 실제 로그인 상태 허브는 실제 계정이 없어서 브라우저로 보지 못했어요.
- **관리자 로그인 폼(운영 유사)**
  - `/admin` → `/admin/login?next=%2Fadmin`, h1 "관리자 로그인"이에요.
  - tablist·회원가입 0, 입력은 email·password, 넘침 0이에요.
  - 빈 제출하면 이메일 칸에 포커스가 가고 `aria-invalid=true`가 붙어요.
  - 틀린 값으로 제출하면 일반 실패 문구 alert가 뜨고 `/admin/login`에 머물러요.
  - 캡처는 `tmp/t243/shots/`, 결과는 `tmp/t243/{local,form}-result.json`에 있어요.
- **환경 메모**
  - 공유 ego에 127.0.0.1용 `sb-127-auth-token` 쿠키가 남아 있었어요.
  - 그래서 닿지 않는 가짜 Auth 주소에서는 요청마다 약 25초 걸렸어요(쿠키는 지우지 않았어요). 제품 결함이 아니라 시험 환경 때문이에요.
  - 다만 인증 서버가 응답하지 않으면 기존 proxy도 그만큼 기다린다는 점은 기존 동작이에요.
- **기존 공용 폼에서 본 점(이번 범위 밖, 기존 `/login`과 같음)**
  - "비밀번호 찾기" 버튼은 높이 30px, 비밀번호 "보기" 버튼은 36px이에요. 44px 기준보다 작아요.
  - 공용 `login.module.css`라 이번에는 바꾸지 않았어요. 필요하면 별도 배정해 주세요.

## 6. 사람만 할 수 있는 일·남은 gate
1. **운영 계정 비밀번호 확정**(주인님)
   - 관리자 로그인은 허용 이메일 계정의 이메일·비밀번호를 그대로 써요.
   - 비밀번호를 정한 적이 없거나 기억나지 않으면, 배포 뒤 `/admin/login` → "비밀번호 찾기"에서 허용 이메일로 재설정 메일을 받아 새 비밀번호를 정하면 돼요.
   - 이번에 메일 발송·계정 조작은 하지 않았어요.
2. 독립 보안·UI 검수(T243-R)
3. 정확 SHA 고정 → release 준비(빌드) → Master 수용 → 원격 정확 대조 → 사용자 승인 push
4. 배포 뒤 확인
   - 실제 계정으로 `/admin/login` 로그인 → `/admin` 도착
   - 허용 밖 계정 forbidden
   - 운영 noindex·no-store

## 누적 배포 기준 차이
- 운영 `e36171c` 대비 이번 제품 변경은 위 2장 파일과 시험뿐이에요.
- 로컬 HEAD `c2adc6b`까지 사이에는 Master·Tester·Backend의 docs 커밋과 Backend 실험(B46/B47)이 있어요.
- 다음 release 후보를 만들 때는 이번 T243 커밋만 `e36171c` 위에 올린 정확 후보인지, HEAD 전체인지 Master가 정해 주세요.
  - 저는 HEAD 위에 커밋해요.

## 보호
- 이번 파일·시험·이 보고만 선택 커밋했어요.
- B47 WIP, T122·T137, tmp(미리보기 포함)는 미변경·미stage예요.
- 50963·Ego54·3013·공유 `.next`는 쓰지 않았어요.
- push·배포 없음. 새 창·agent·worktree 없음.
