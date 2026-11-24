# T-241-R 공개 메인·작업실 인증 통합 독립 검수

2026-11-18 · Codex(Tester) · 고정 **313c16d6ad56ae7d3d05171b63d3eb77d63e4631** · 배정 msg_c81da51f173a.

**판정: PASS — 고정 소스·합성 인증·격리 HTTP에서 검증한 통합 보안 범위.** 공개 `/`와 고정 이미지의 익명 접근, 작업실/API 보호, 메뉴 검증 이동에서 새 보안 결함을 발견하지 않았다. 실제 Supabase 계정/운영 배포 승인이나 디자인 PASS가 아니다. T240 원본 F240-1 대비 결함 및 보고84083f9는 그대로 유지하며 후속 수정은 별도 검수한다.

## 소스 경계와 기존 기대 변경

고정 git archive를 소유 `tmp/t241r-review-313c16d/app`에 풀고 node_modules만 기존 설치에 junction 연결했다. 앱 제품 소스·원 테스트·기대값은 수정하지 않았다. 사본 메뉴 설정만 명시적 손상 실험 후 원래 바이트로 복원했다. 원 studio 홈의 이동 전/후 git blob 내용은 동일하다(독립 hash-object **59d499a69f564341f053370925499a4f72ce2263**, 양쪽 일치). `/studio`는 기존 `(studio)` 레이아웃과 각 페이지 legacyPageGate를 계속 거친다.

신규 공개 page는 next Metadata, T240 컴포넌트, SAMPLE_WORKS만 가져오고 로그인 주소 `/login?next=%2Fstudio`를 명시한다. 루트 레이아웃은 font/Toast/children이며 개인 DB·서비스·인증 사용자·메뉴 설정 import가 없다. SAMPLE_WORKS는 6개 예시/media:null. 사용자 자료나 작업실 데이터를 공개 목록에 공급하는 경로는 추가되지 않았다. 기존 instrumentation의 서버 시작 시 메뉴 읽기/검증 로그는 유지되므로 이를 서버 전체의 메뉴 I/O 0으로 확대하지 않는다.

proxy 새 early allow는 정확한 `/` 및 frozen6개 PNG 경로 Set에 한정된다. auth off/config503/getUser/기존 공개 인증 경로/401·403의 기존 순서는 그 밖의 경로에서 유지된다. 기존 matcher의 `_next/static`, `_next/image`, favicon/fonts 제외와 기존 공개 로그인/콜백/API는 별도로 존재한다. 신규 예외가 7개라는 설명을 앱의 모든 공개 경로가 7개뿐이라는 의미로 해석하지 않는다.

메뉴 검증은 StudioLayout의 legacyPageGate 뒤, startup/메뉴 사용 앞이다. 오류이면 메뉴 안내를 반환하고 startup 및 layout children을 그리지 않는다. `(workspace)/layout.tsx`도 같은 StudioLayout을 export한다. Next의 layout/page 병렬 실행 때문에 studio/workspace 페이지 내부 getMenuConfig throw는 서버 로그에 남을 수 있다(아래 실험); 이를 자식 함수 실행 자체가 항상 0이라는 보장으로 쓰지 않는다. 공개 HTML에는 해당 설정 오류/경로가 노출되지 않았다.

초기23 red 관련 네 테스트 파일 diff를 확인했다. 보호 예시 `/`→`/studio`는 동일503/403 기대를 유지하며, 가입 next `/studio`와 링크 변경은 새 경로 정책이다. 메뉴 mock getMenuConfigState는 같은 호출 spy를 거쳐 기존 인증 거절 전 메뉴/startup/SQLite/service 부작용0 기대를 유지한다. 가드 순서와 이동 파일 대조군도 유지됐다. 새로운11건은 공개 예외와 비슷한 경로 거부를 추가한다. 이 변경에서 거부 기대를 성공으로 바꾸거나 보호 부작용0을 제거한 부분은 발견하지 않았다. safeNextPath/loginPath/sameSiteRedirect/origin 방어 기본 `/` 로직은 변경되지 않았다.

## 독립 실행

- 고정 사본 관련6개 suite: t241 새11 + t182/t183/t200/t207 + 공개 컴포넌트13 — **220/220 PASS**, 파일6개 PASS. native PG 관련5개 플래그는 해당 process-local 0.
- 같은 고정 사본 `tsc --noEmit --incremental false` **exit0**. 공유 `.next` stale validator를 건드리지 않았다.
- 이번 변경 TS/TSX와 관련 테스트18개 경로 scoped eslint `--max-warnings 0` **exit0**.
- 실제 Next dev는 사본 `.next`, loopback **50949**만 사용. 모의 Supabase HTTP 서버 **50948**. 공유3013/.next·build/deploy/typegen/install·실제 Supabase 계정은 사용하지 않았다. 정적 이미지 optimizer 동작은 설치된 Next 문서의 인증 헤더 미전달 설명도 확인하고 실제 보호 소스 요청으로 검증했다.

## HTTP 관측

스크립트·응답 메타데이터·선택 HTML은 `tmp/t241r-review-313c16d/`에 보존했다. HTTP 클라이언트가 raw path를 유지하도록 Node http.request를 써서 인코딩/역슬래시·유사 prefix를 검사했다. redirect는 자동 외부 추적하지 않았다. 브라우저 점유는 하지 않았고 새 시각/스크린리더 검증을 했다고 주장하지 않는다.

| 모드/근거 | 관측 결과 |
| --- | --- |
| 운영 유사: VERCEL1/supabase/로컬 모의 서버/합성 쿠키, `http-mock.json`50건 | `/`·6 PNG·`/_next/image?...orchid...` 모두200/cookie0. 만료 합성 쿠키를 보내도 이 공개 묶음 전후 모의 Auth 요청 수 동일. root 예시 외 내부 설정 문구 없음 |
| 익명 보호 | `/studio`, 쿼리 있는 studio, projects/cloud/jobs/files/workspace/account는307 로그인; `/api/projects`, jobs/logout/password는401. 모든 거부 no-store. studio next=/studio, studio?tab=x 전체 next 보존 |
| 허용 밖 계정 | studio/cloud는307 `/login?error=forbidden`, API403, no-store |
| 세션 갱신 | 합성 만료 cookie → 실제 Supabase SDK가 로컬 모의 refresh endpoint 호출 → studio/login200, Set-Cookie1/no-store. API는 인증 통과 뒤 데이터 backend 미설정503/Set-Cookie1. 이는 API 업무 성공이 아니라 세션 쿠키 전달 검증 |
| 유사·인코딩19경로 | 다른 파일/대소문자/확장자/map/폴더/끝slash/encoded studio·api·dot segment·이중slash·역슬래시 등 모두307/308/401 등 보호·정규화 응답, 보호 내용200 우회 없음. 실제 각 status/location은 JSON 보존 |
| optimizer 보호 원본 | `/_next/image?url=/api/projects...`200 아님; Next 로그에서 내부 원본401 확인. 이미지 API로 보호 API 내용 노출 없음 |
| 위조 forwarded host | studio는 같은 사이트 상대 login으로 이동, evil.test 이동 없음 |
| 설정 누락: VERCEL1만, `http-missing.json`17건 | 공개 root/6 PNG/optimizer200/cookie0/Auth 호출0. studio/API/cloud/비공개 이미지/workspace/login/callback 모두503/no-store |
| 로컬+메뉴 JSON 손상, `http-broken.json`13건 | 공개 root200/예시만/메뉴 설정·docs/spec 경로 없음. studio/jobs/workspace/legal-tax200 메뉴 오류 안내. login307 /studio. Auth 호출 증가 없음 |
| 로컬 정상, `http-local.json`13건 | 복원한 메뉴+소유 합성 runtime root에 제품 migration10개 준비. root/studio/jobs/workspace200, login307 /studio. 공유 DB나 기존 데이터를 사용하지 않음 |
| 정상 본문, `local-contents.json` | root h1 NEON AFTER HOURS/공개 로그인 next명시/작업실 href없음. studio h1 작업실, jobs 작업 대기열, workspace 법무·부동산·세무; 세 화면의 작업실 링크 /studio |
| 실제 SDK+모의 PKCE callback7건, `callback-probes.json` | /studio 및 /studio?tab=one → 같은 상대 경로307/쿠키2/no-store. //evil, https://evil, literal backslash, javascript → /로307. 모의 user 검증과 cookie 설정 경로를 거침 |

callback 검사 중 `/%2f%2fevil.test`까지 무조건 `/`로 바뀌어야 한다는 자체 기대1건은 false로 보존했다. 실제 반환은 인코딩된 **같은 origin 경로**이고, `encoded-redirect-followup.json`의 독립 요청에서307 `/login?next=%2F%252f%252fevil.test` → 로그인200으로 끝나며 외부 origin 이동은 없다. URL 표준 해석상 encoded slash를 authority로 취급하지 않으므로 그 false를 open redirect 결함으로 판정하지 않았다. 다른 origin은 요청하기 전에 중단하도록 검사했다. 최초 HTTP 스크립트가 상대 Location에 base 없는 new URL을 써서 Invalid URL 종료한 것도 제품 실패가 아니며 base를 지정한 뒤 전체50건을 완료했다.

손상 메뉴 실험에서 studio와 workspace는 요청200의 안내 HTML을 반환했으나 병렬 page의 getMenuConfig 오류가 dev 서버 로그에 남았다. 원 handoff의 workspace가 반드시 HTTP 오류 화면이 된다는 설명과 달리, 이 실행에서는 두 화면 모두 메뉴 안내를 반환했다. production 스트리밍/오류 경계와 동일하다고 주장하지 않으며, 현재 보안 판정은 공개 루트에 오류 내용이 노출되지 않고 protected layout이 업무 UI 대신 안내를 반환한 관측에 한정한다. 작성자 시각 검증의 root "DREAM SCREEN"은 document title과 실제 h1을 구분할 필요가 있다(독립 실제 h1은 NEON AFTER HOURS).

## 한계·정리·반환

모의 인증 서버는 synthetic JWT/user/refresh/PKCE 응답만 돌려준다. 실제 토큰 서명 검증·실계정 로그인·메일 전송·Supabase 장애/실운영 session 정책·Vercel 이미지 캐시를 증명하지 않는다. 실제 계정 도착/가입 메일/배포 경계 검증은 남는다. 공개 root 익명 렌더링과 보호 세션 cookie 경로는 여기서 실제 Next+실제 SDK로 검증했다. UI·미디어 재생은 이번 PASS 범위가 아니다.

모든 own Next 실행 세션과 모의 서버는 Ctrl-C로 종료했다. OS에서 **mock55636, 최종 Next70264/parent56260, 최초 Next23612 부재;50948·50949 listener 부재** 확인, `cleanup-os.json` 보존. 사본 메뉴 원복 byte compare true. 고정 auth/root/layout/page/원테스트 경로 git diff 없음; 동시 Front 대비CSS 및 Backend B46 WIP는 건드리지 않았다. 소유 scratch 외 추적 변경은 이 보고서 하나뿐이며 선택 commit한다.

Master 복사 반환: T241-R fixed313c16d 보안통합 한정PASS·220tests/type/scopedlint0·격리mock/missing/menu손상/local HTTP 확인. 정확공개7개 getUser-cookie0, 보호401/403/503/no-store·refresh쿠키·callback외부방어유지. 실제Supabase/배포/UI승인별도, 원T240F240-1 FAIL유지. own서버/모의서버/ports정리완료·후속T240-R2는 이 보고고정 뒤 순차착수.
