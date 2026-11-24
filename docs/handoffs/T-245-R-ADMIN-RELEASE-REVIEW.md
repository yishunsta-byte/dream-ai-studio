# T-245-R 관리자 최종 release 독립 검수

2026-11-18 · Codex(Tester) · final **5148ebb8a5492ead4037afda76692212a1ed4c2d** · Master msg_4212b429fbcf.

**PASS — 고정 release 구성·44px UI·검증한 모의 복구/보안 범위.** 관리자 reset 복귀의 ended/partial, 실패 뒤 logout만 재시도, 일반 흐름 보존을 독립 재현했다. 실제 Supabase/실메일·실계정 비밀번호·운영 배포·브라우저 offline까지 통과한 판정은 아니다. 원6d T243의 reset 미지원 기록과 과거 미완료 검사는 소급 수정하지 않는다. 제품/원 테스트/설정에 patch 없이 이 보고서만 변경한다.

## release 트리와 index 경계

`tmp/t245r-review-5148ebb/release-preflight.mjs`가 git 객체를 직접 대조했다:

- 유일한 parent는 운영 기준 **e36171c6f84bfdb2baebf69ddc4118fe8a3481be**, 최종 tree **a696dcc1f19c7b834546e143c48b1950ee429c07**, 파일1196개.
- e361→release 변경은 **18파일**로 source commits6d0ee14/ff1bc43/9148b8e의 변경 경로 합집합과 정확히 같다. 18개 모두 release blob/mode가 source9148b8e의 해당 blob/mode와 동일하다.
- 합집합 밖 모든 tree entry는 e361과 같다. Backend catalog는 원87c2a8fd…ae0이며 e361과 byte 동일, B46/B47 신규 harness는 release에 없다. 다른 HEAD 문서/백엔드 commit이 섞였다는 근거는 없다.
- 본인 읽기 검증 전후 공유 index SHA **18dc815ce93e0e495ac30e6ed769d4231581555719021da6c6698a75187209de** 동일, HEAD/stage 동일. index/read-tree/apply/ref 수정은 하지 않았다. 작성 당시 임시 GIT_INDEX_FILE 방식과 과거 index prefix는 T244/T245 작성자 보고 근거로 구분하며 과거 작업 순간을 본인이 관측했다고 주장하지 않는다. 최종 트리 결과는 위 독립 대조로 확인했다.

정확 final archive를 소유 `tmp/t245r-review-5148ebb/app`에 풀고 기존 node_modules만 junction으로 연결했다. 마지막에18경로 사본 LF가 final 고정과 모두 일치했다(`final-evidence.json`). build/typegen/install 없이 사본 Next dev/사본 `.next`만 사용했다. 운영 preview50963/Ego54·공유3013/.next·다른 WIP는 조작하지 않았다.

## 검사와 구현 검토

고정 사본 관련11파일(t245/t243/t241/t182/t183/t200/t207/t213/t220/t229/public-showcase) **294/294 PASS**. native PG5개 switch는 process-local0. 고정 clean **whole-project tsc --noEmit --incremental false exit0**, 변경 TS/TSX·관련 테스트 scoped eslint `--max-warnings 0` exit0. 저자 production build 결과는 저자 근거이고, 본인은 금지 범위인 재빌드/배포를 하지 않았다.

CSS는 reveal/linkButton의 누르는 높이를 기존 touch-min44로 맞추며 인증/요청/색상은 바꾸지 않는다. resetContext는 일반 폼이면 email만, admin 폼이면 email+정해진 context를 보낸다. 서버 passwordContext는 정확한 문자열admin만 허용하고 메일 next·완료 경로는 고정 문자열로 만든다. 임의 next/redirectTo/스토리지값을 권한이나 복귀 URL로 신뢰하는 경로는 추가되지 않았다. NewPasswordForm의 비밀번호 POST·서버 getUser/allowlist·로그아웃·실패 재시도 함수는 유지되고 ended/partial 목적지만 고정 helper로 달라진다. 기존 callback의 same-site next·code/OTP·허용 계정 판정은 변경되지 않았다.

## 실제 HTTP·SDK와 독립 반례

독립 Next dev **50982**, 로컬 모의 Supabase **50981**, VERCEL1/supabase/process-local 합성 설정 및 소유 runtime root를 사용했다. 모의 서버는 fake token/user/recover/PUT/logout만 구현하고 **실제 메일을 보내거나 계정/비밀번호를 저장·변경하지 않는다**. 따라서 실제 SDK transport와 앱 흐름을 검증했으나 실제 토큰 서명·메일 링크·새 비밀번호 인증 성공을 증명하지 않는다.

`http-probes.json` **30검사 PASS**:

- 정확admin만 callback next=`/account/password?context=admin`; undefined/대소문자/공백/encoded문자/외부URL/혼합문자/배열/객체/숫자/null은 일반 `/account/password`. body next/redirectTo를 외부로 줘도 고정 origin·`/auth/callback`·고정 next만 모의 recover에 전달된다.
- 미허용 이메일의 일반/admin reset 응답은 동일200/안내, 모의 recover 호출0. 잘못된 Origin·Sec-Fetch-Site403, text/plain415, 모두 recover 호출0.
- 익명·허용 밖·위조 합성 token으로 admin/API/password 경로 접근은307/401/403/no-store, owner정보 누출 없음. context=admin 자체가 인증을 만들지 않는다.
- owner 비밀번호 화면 context표시는 정확admin만; 중복 query context가 배열이 되어도 일반 표시다. 안전한 notice/noindex/no-store, 잘못된 callback code는 `/login?error=link`로 거부.

`http-missing.json` **7검사 PASS**: root200, admin/login/admin/account-password/login503/no-store, reset503, provider 호출0. `http-local.json` **7검사 PASS**: admin/login/admin은 폼·계정 없는 local 설정 안내, account-password/login은 기존 `/studio` redirect, reset404/AUTH_OFF, provider 호출0. 새 context로 local 관리 권한이 생기지 않는다.

## 실제 UI44px·일반 폼 보존

Front 미점유 회신 msg_5f1c80901c0b 뒤 **ego space65/localhost:50982**를 사용했다. 127.0.0.1 기존 쿠키를 지우지 않고 host를 분리했다. 사용자 보존 space54를 조회/claim하지 않았다.

관리자와 일반 `/login` 각각 **390×844/1280×900**에서 다음을 실제 관측했다(`ui-results.json`, `general-visibility-followup.json`):

- 표시된 제품 button/link/input **44px 미만0**, 가로 넘침0. 보기·찾기44px, 주요 제출48px. 일반 tablist1/관리자0.
- 이메일→찾기→비밀번호→보기 Tab 순서. Enter로 text/aria-pressed true, 다시 password/false. reset 전환 시 이메일 focus·작은 대상0·복귀 시 이메일 focus. 일반 signup의 confirm/password 두 입력도 유지된다(가입 제출은 하지 않음).
- 버튼 글자 computed foreground/동일한 불투명 panel/버튼 배경 대비의 최소값 **4.8721005:1**. 해당 버튼들은 이미지/gradient 위가 아니어서 조상 불투명 배경 계산을 사용했다. 전체 페이지의 모든 대비 인증으로 확대하지 않는다.

최초30 UI 검사 중28개 true/2개 false를 보존했다. 일반 폼에서 `button[aria-controls]`의 첫 대상이 tab이라 pressed=null로 센 검사 선택자 오류다(비밀번호 type은 text로 실제 바뀌었다). 역할이 정확한 보기/숨기기 aria-label 대상으로 별도 fresh 두 폭 후속 검증에서 true/false를 확인했다. 제품이나 원 기대를 바꾼 것이 아니며 최초30건 전부 PASS로 덮어쓰지 않는다.

## 모의 code 교환을 포함한 실제 복귀·재시도

`round-03`은 관리자 로그인의 reset UI로 모의 recover 요청을 보내고 그 redirect_to에 synthetic code를 붙여 **실제 `/auth/callback` + 실제 SDK exchangeCodeForSession**을 거쳤다. 브라우저의 SDK PKCE verifier cookie가 전달되고 `/account/password?context=admin`에 도착했다. mock은 synthetic code를 받아 세션을 줄 뿐 실제 Supabase PKCE/메일 전달/서명 검증은 아니다.

`flow-results.json`의 완료5단계와 `general-session-results.json`6단계 모두 PASS:

| 경우 | 실제 모의 결과 |
| --- | --- |
| admin ended | password API를 통한 SDK PUT user **1회**, global logout204 → `/admin/login?next=%2Fadmin&notice=password`, 정상 안내·세션cookie0 |
| 이후 owner 로그인 | 실제 폼/SDK mock password login → `/admin`, 확인된 owner 자기 범위 허브 |
| admin partial | PUT **1회**, global logout500→local logout500. SDK가 local 세션을 지우는 기존 정책에 따라 partial 안내와 admin 로그인으로 이동, cookie0. 전 기기 로그아웃 성공으로 표시하지 않음 |
| logout failed | PUT **1회** 뒤 logout의 proxy는 통과시키고 서버 재인증에 모의 user503을 반환. 성공 redirect 없이 password 화면에 남고 "비밀번호는 바뀌었지만 로그아웃하지 못했어요"/재시도 버튼·세션cookie 유지 |
| failed→retry | provider를 정상으로 되돌려 logout만 재시도 → admin 완료 안내. **추가 PUT0**, cookie0. 비밀번호를 두 번 보내지 않음 |
| 일반/unknown | 일반 reset의 실제 mock callback next는 `/account/password`, 관리자 표시 없음. 외부 URL context와 next=/admin를 추가해도 PUT1 뒤 `/login?notice=password`. 일반 로그인 기본도 기존 공개 `/` 도착 |
| 세션 변경 | admin 허브에서 합성 cross-tab 신호+서버 forbidden → 기존 owner 표시·ProtectedContent 노드0, 일반 forbidden 로그인 이동. 재접속 뒤 정상 앱 logout으로 정리 |

전체 테스트 PUT4는 ended/partial/failed/unknown 각1회다. 모의 상태/호출 순서는 `mock-state.json`, 요약은 `final-evidence.json`. 일반 및 관리자 reset callback을 각각 실제 SDK로 교환했고, 각 동작의 허용 여부는 계속 서버 auth/allowlist가 정한다. provider5xx는 위 partial/failed의 **실제로 완료한 통제 실험**에 한정한다. 이번에는 browser offline 실험을 하지 않았으며 과거 T243 미완료 offline을 PASS로 재표기하지 않는다.

합성 계정의 password login은 모의 서버가 고정 synthetic 자격을 받아 주므로, 비밀번호 PUT 이후 새 비밀번호가 실제 Supabase에 저장되어 인증된다는 주장은 아니다. ended/partial/failed는 앱·실제 SDK의 요청/표시/이동/쿠키 처리 범위 검증이다. 이전6d의 일반 reset 복귀 한계 기록은 역사적으로 그대로이고 이번5148에서 추가된 흐름만 위 근거로 판정한다.

직접 시각 확인한 admin390/partial 안내/실패 안내 스크린샷은 `shots/admin-390.png`, `admin-partial.png`, `admin-logout-failed.png`. 관리자·일반 두 폭 정상/reset·일반 완료 이미지도 보존했다. 모든 스크린리더·다른 브라우저·운영 SSR streaming/캐시를 확인한 것은 아니다.

## 정리·최종 범위

앱 정상 logout으로 localhost의 해당 합성 auth-cookie0 확인. ego65 `finish({keep:[]})` 완료 및 Front 해제 msg_804bdae5e6c6 전송. 모든 own Next/모의 서버 세션 종료, OS에서 **mock67680/최초Next57548/최종Next45644 부재·50981/50982 listener 부재** 확인했다. 잘못된 session0에 대한 도구 요청1건은 Unknown process id로 끝나 아무 프로세스도 조작하지 않았고 올바른 own 세션을 정상 종료했다.

고정18경로 사본 일치, 원 source/test/config/공유index·서비스·사용자 preview와 다른 WIP는 보존했다. 실제 계정·메일·운영 DB·패키지·빌드·배포·새 agent/window/worktree 조작 없음. 이 보고서만 선택 commit한다. 실제 Supabase 계정/새 비밀번호·실메일·운영 검증과 Master release/push 수용은 별도 gate다. B47-R은 이 보고 고정·정리 뒤만 순차 진행한다.

Master 복사 반환: T245-R **final5148 PASS(검증한release/UI/모의authflow범위)**. e361단일parent/선택18blob소스동일/다른tree불변·B46B47제외.294tests/type/scopedlint0·390/1280 admin+general44px/contrast최소4.87/키보드·signup보존. 실제SDK mockcallback/adminreset PUT1 ended/partial→adminnotice→owneradmin, failed5xx→retry추가PUT0·general/unknowncontext/CSRF/noenum/세션교체차단. 실계정/실메일/새비밀번호검증·offlinePASS아님. own65/ports서버정리·고정보고1파일선택commit.
