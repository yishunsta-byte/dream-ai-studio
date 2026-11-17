# B2 통합 인증 회귀 수정

- 담당: Codex(Backend), 상위 CX-MASTER-01.
- 요청: msg_8ebd498d77cc, 2026-11-17 Asia/Seoul.
- 기준 SHA: d16755091dc77352ed49c82ebb02e18654650a89.
- 상태: ready_review. 구현자 자체 검증이며 독립 검수가 아니다.

## 변경과 원인

`tests/api-auth.test.ts`의 glob 분류가 login만 제외하여 T184의 signup/reset/password를 기존 업무 API와 동일하게 분류했다. 가입·비밀번호 찾기는 미인증 사용자가 진입해야 하고, password는 입력 검증 후 자체 getUser/허용 이메일 검사를 수행하므로 기존의 일괄 401/403/503·body 미열람·no-store 계약을 그대로 적용할 수 없다.

변경 파일은 이 보고서와 `tests/api-auth.test.ts`뿐이다. 제품 인증 코드·API·DB는 수정하지 않았다.

- 공개 인증 경로 3개(login/signup/reset), 자체 인증 password 1개, 공통 guard 경로 20개를 명시했다.
- 실제 glob 전체와 명시 inventory가 정확히 일치하고 중복되지 않는지 검사한다. 미등록 새 경로는 기본 보호 검사에 포함되며 inventory 검사도 실패한다. 새 공개 경로를 조용히 제외할 수 없다.
- public 여부를 실제 `isPublicPath`와 대조한다. logout/password를 공개 인증 경로에 넣지 않는다.
- 기존 업무 경로의 4가지 거부 시나리오와 body/params 미열람·no-store·서비스 미호출 검증은 보존했다.
- 공개 인증 3개는 세션 없이 직접 POST하여 실제 인증 provider mock 도달·200을 확인한다. 기존 T182의 잘못된 입력·가입/찾기·provider 오류/허용 이메일 검증을 유지한다.
- password는 세션 없음/만료 401, 허용 밖/이메일 없음 403, 잘못된 JSON/배열/약한·누락 비밀번호 400, Auth client 없음 503, 허용 계정 200 및 정확히 한 번 updateUser 호출을 검증한다. 거부·400에서는 updateUser 미호출을 확인한다.
- 기대값 일괄 완화·skip·테스트 삭제는 없다. 최초 수정 후 발견한 mock 미사용 인자 lint 1건과 optional error 타입 1건은 수정 후 재검증했다.

## 실제 검증

2026-11-17 17:49 KST, 기준 저장소에서 직접 실행:

| 명령 | 결과 |
|---|---|
| `npm.cmd test -- tests/api-auth.test.ts tests/t182-auth.test.ts tests/maintenance-routes.test.ts` | 3파일 143 PASS, exit 0 |
| `npm.cmd run lint` | exit 0, 경고 0 |
| `npx.cmd tsc --noEmit --incremental false` | exit 0 |
| `git diff --check` | 수정 파일 공백 오류 없음 |

Master가 보고한 기존 142건과 같은 관련 3파일을 실행했다. 잘못 분류된 3경로의 일괄 시나리오 12건을 전용 계약 13건으로 대체하여 총 143건이다. inventory 검사는 기존 개수 검사 자리에 들어간다.

공유 `.next` 생성·서버 재기동을 피하려고 typegen/build는 실행하지 않았다. 이 변경은 테스트 전용이며 실제 Supabase/브라우저/배포를 검증했다고 주장하지 않는다. 공유 3013·실사용 DB·외부 설정은 건드리지 않았다. 다른 담당의 untracked 문서도 보존했다.

## Master 인계

기존 공통 guard가 검증된 user UUID를 반환하지 않는 문제는 B1의 후속 저장계층 연결 계약이며 이 회귀 수정에서 인증 구현을 확장하지 않았다. password의 전체 네트워크 예외·Auth 응답 변형 검증은 이번 13건의 전용 경계 검증과 구분한다.

복사/전달 메시지:

> B2 ready_review. d167550 기준 tests/api-auth.test.ts만 수정: public 인증3/password 자체검증1/guard20 명시 inventory와 unknown 누락검출, 공개 인증 직접 진입·password 세션/허용 계정/400 경계 추가. 관련3파일143 PASS, lint/tsc exit0. 제품 인증코드·DB·3013·.next·배포 변경 없음. docs/handoffs/B2-AUTH-REGRESSION.md 검토 후 통합 요청.
