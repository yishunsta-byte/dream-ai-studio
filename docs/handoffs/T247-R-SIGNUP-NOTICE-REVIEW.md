# T247-R 가입 안내 문구 독립 검수

2026-11-18 · Codex(Tester) · Master msg_1c7da8a42831의 우선 순차 작업. 고정 **ce1f5b3**, 변경4경로 전체를 확인했다. **문구·코드 범위 PASS.** 메일 미수신의 운영 원인이나 실제 전달 성공을 검증한 결과는 아니다.

제품 변경은 `app/api/auth/signup/route.ts`의 SENT 문자열1개와 주석뿐이다. 이전/이후에서 해당 문자열·추가 주석만 제거하면 나머지 route 원문이 일치한다. 허용 목록·SDK 호출·검증·오류 처리·리다이렉트·권한 로직 변경은 없다. 나머지3경로는 새 시험과 T246/T247 인수인계 문서다. 현재4파일은 ce1f5b3과 일치한다.

안내는 “가입 요청을 받았어요”와 조건부 확인 메일 설명으로 바뀌었으며 “보냈어요”라는 완료 단정이 없다. 메일이 오지 않을 때 로그인·비밀번호 찾기를 안내한다. 성공 형태의 세 경우(허용 밖, 허용된 신규 요청, user_already_exists)는 동일한200/ok/message 응답을 쓰며, 허용 밖은 SDK를 호출하지 않는다. SDK가 성공 형태를 반환하는 기존 계정도 마지막 동일 응답을 받는다. 이는 코드와 mock SDK 결과의 동일성 확인이며 실제 Supabase 프로젝트의 설정/가입 상태를 조회한 결과가 아니다.

429는 RATE_LIMITED/429, signup_disabled는 SIGNUP_DISABLED/403, 기타 provider 오류는 AUTH_SEND_FAILED/502를 유지한다. 약한 비밀번호·설정 누락·잘못된 요청/출처 등의 기존 오류 분기도 그대로다. 클라이언트 LoginForm의 post는 비2xx를 예외로 처리하고 가입 실패 알림을 표시하므로 이 문구 변경이 실제 실패를 성공 알림으로 바꾸지 않는다. 새 테스트의 응답 동일성/SDK 호출수/실패 코드 및 기존 인증·관리자·재설정 회귀 검사를 확인했다.

실제 검증:

- Vitest4파일 **65/65 PASS**: tests/t247-signup-notice.test.ts, tests/t182-auth.test.ts, tests/t243-admin-login.test.ts, tests/t245-admin-reset-return.test.ts. SDK는 mock이며 실제 계정/메일 요청을 하지 않는다.
- 별도 ignored tsconfig로 route/new test와 import graph의 strict 타입 검사 exit0. 공유 .next 생성 파일을 포함하지 않고 Next typegen/build를 실행하지 않았다. 전체 프로젝트 타입 검사라고 표현하지 않는다.
- route/new test 범위 ESLint max-warnings0 exit0. 제품 diff 제한과 고정 파일 동일성 재확인 PASS.

운영 확인 제한은 Master 배정문과 Front 문서의 보고 사실로 구분한다. Vercel 값 읽기와 Supabase Users 읽기는 각각 자동 승인 검토의 Unauthorized Access로 거절돼 실행되지 않았다는 보고이며, 서비스가 반환한401/403이라는 증거가 아니다. 검수자는 해당 거절 원본 도구 실행을 재수행하지 않았고, 다른 경로로 우회하지도 않았다. 운영 허용 주소 포함 여부, 실제 계정 Confirmed 상태, SMTP/발송 제한/스팸 분류 중 어느 것이 원인인지는 **미확정**이다. 문구 개선은 그 운영 원인을 해결했다는 주장이 아니다.

Own ignored **tmp/t247r-review-ce1f5b3**의 preflight.mjs/preflight.json, tsconfig.json에 고정4파일 해시·문구 외 코드 동일성·범위 타입 설정을 남겼다. 검수 중 운영 조회·실로그인·메일 발송/재전송·계정/설정 변경·배포는 각각0회다. 브라우저·빌드·새 agent/window/worktree도 사용하지 않았다. .env.local이나 운영 비밀값은 읽거나 출력하지 않았다. 이 신규 보고서만 tracked이며 Master TEAM/plan WIP, Front 결과와 다른 담당 파일/shared index를 보호했다.

Master 반환: T247-R fixedce1f5b3 문구코드 scopedPASS. 제품은 SENT+주석 한정, 허용 밖/신규/기존 동일 응답·SDK0/실429403502 실패 유지, 실제 발송 완료 단정 제거. 관련65/범위type/lintPASS. 운영 자동승인 거절은 서비스401이 아니며 실행/원인/전달 상태 미확정, 메일0/로그인0/운영조회0/배포0·우회없음. 운영5148+문구delta 준비/배포는 이 보고서가 수행하거나 승인하지 않는다. 첫 보고 고정 후 배정된 B54-R2에 별도로 착수한다.
