# T327 관리자 게시·공개 홈 공급원 런타임 연결

2026-11-19 KST · Codes(Backend) · 기준 `d562caa` · Master 배정 `msg_80c8750e42a9` · 공개 라우트 승인 `msg_66d6b54070d9` · T304 범위 승인 `msg_a4c53e9ae477`

관리자 화면과 게시 API는 기존 `createAdminPublicationHttp()`를 통해 공용 게시 런타임의 관리자 저장소를 사용한다. 공개 홈과 표지 GET·HEAD도 같은 런타임에서 조회 공급원을 가져온다. Node 런타임마다 첫 호출 때 T325 조립을 한 번 실행하며, 별도로 번들된 Next 진입점도 같은 초기화 결과를 기다린다. 관리자 인증은 기존 요청 단위로 처리되고, 쓰기의 인증·출처·형식 검사를 통과한 뒤에 저장소를 조회한다. [공용 런타임](../../lib/public-showcase/publication-runtime.ts) · [관리자 HTTP](../../lib/public-showcase/admin-publication-http.ts)

활성화 입력은 서버 전용 `loadPublicationRuntimeOptions()`다. 기본 반환값 `undefined`는 관리자 목록 `closed`, 쓰기 `503 PUBLICATION_UNLINKED`, 홈 예시, 표지 `404 no-store`로 이어진다. 권한을 검증하는 명시 구성에서만 T325의 승인된 DB 대상 확인을 통과할 수 있다. 시작 실패 역시 같은 비활성 결과로 고정되며, 먼저 획득한 공급원은 T325에서 닫는다. 구성 변경과 초기화 재시도는 새 Node 런타임에서 시작한다. [구성 진입점](../../lib/public-showcase/publication-runtime-config.ts) · [공용 조립](../../lib/public-showcase/publication-provider-assembly.ts)

`closePublicationRuntime()`은 호출 즉시 새 공급원 조회를 비활성화한다. 진행 중인 초기화가 있으면 그 결과를 기다려 획득한 핸들을 한 차례 닫고, 대기 중이던 요청에는 비활성 결과를 돌려준다. 실제 연결을 시작할 호스트는 기존 요청을 비운 뒤 이 함수를 호출하는 수명 주기를 연결해야 한다. 이번 범위에서 제품 `instrumentation.ts`와 Next의 종료 신호 처리는 변경하지 않았다. 이미 반환된 핸들의 작업은 호스트의 요청 배출 단계에서 완료한다.

## 자체 검증

- 합성 설정을 넣은 격리 사본에서 `npm.cmd run build`로 Next 16.4.6 프로덕션 빌드와 산출물 검사를 통과했다. `node tests/public-showcase/t327-publication-runtime-next.mjs <격리 사본>`은 각 구성마다 새 루프백 Next 프로세스를 실행한다.
- 첫 관리자 GET·관리 화면·홈·표지 GET·HEAD를 동시에 보내도 설정을 한 번만 읽었다. 미구성, 관리자 핸들을 연 뒤 공개 리더 초기화 실패, 검증된 세 공급원 정상 연결을 재현했다. 잘못된 요청 출처는 설정을 읽기 전에 `403`이었다. 헤더와 쿼리의 가짜 활성화 값은 미구성 상태에서도 결과를 바꾸지 않았다.
- 정상 구성은 관리자 검수·게시 뒤 홈에 작품과 표지를 표시했고 표지 GET·HEAD는 `200`이었다. 철회 뒤 새 홈에서 작품이 사라졌고 같은 표지가 `404`였다. 명시 종료 이후 화면과 HTTP가 미구성 상태로 돌아가고 핸들마다 종료가 한 번 기록됐다. 세 실행 모두 프로세스 종료 및 루프백 연결 해제를 확인했다. 초기화 도중 종료하는 경쟁은 전용 단위 시험에서 별도로 검증했다. [Next 시험](../../tests/public-showcase/t327-publication-runtime-next.mjs) · [합성 구성](../../tests/public-showcase/t327-publication-runtime-next-config.ts) · [단위 시험](../../tests/public-showcase/publication-runtime.test.ts)
- 관리자·공개·기존 홈 회귀 228건 전부 통과. 전체 Vitest 2,769건 통과, 실행 조건에 따라 387건 건너뜀. 변경 소스 ESLint와 제품 기본 구성을 복원한 격리 사본의 `npm.cmd run typecheck`를 통과했다.

검수용 격리 사본은 현재 소스와 설치된 의존성을 복사해 만들었다. 사본의 `publication-runtime-config.ts`에서 `loadT327Options`를 `loadPublicationRuntimeOptions`로 내보내고, 사본의 `lib/auth/resolve.ts`에서 `t327Auth`를 `resolveServerAuth`로 내보내도록 교체하면 재현할 수 있다. 두 함수는 위 합성 구성 파일에 있다. 처리 경로인 관리자 HTTP, 홈, 표지, T325, 런타임은 제품 소스를 그대로 사용한다. 시험 도구는 합성 저장소와 IPC로 초기화 대기·종료를 제어한다. T326의 기존 격리 PG17 시험은 고정 커밋 기준으로 보존했다.

자동 실행 정책이 재귀 삭제 명령을 거절해 종료한 프로세스의 격리 사본 `dream-t327-988b932931b74e928e11336eda1d44ad`는 Windows 임시 폴더에 남았다.

## 인계

Tester에게 미구성·부분 실패의 기존 응답, 첫 동시 요청에서 DB 대상 확인을 포함한 조립 1회, 정상 게시와 철회, 종료 뒤 재개 차단과 핸들 정리의 독립 검수를 요청한다. 실제 연결 단계에는 승인 서버 구성, 관리자·목록·표지 역할과 DB·TLS 검증, 비공개 Storage, 호스트 종료 연결이 남았다.

> T327에서 관리자 API·관리 화면·공개 홈·표지의 공급원 연결을 공용 서버 런타임으로 전환했습니다. 격리 Next 프로덕션에서 미구성·부분 실패·정상 구성을 검증했고, 동시 첫 요청의 조립 1회, 게시·철회 반영, 명시 종료 후 공급원 정리를 확인했습니다. Tester 독립 검수를 요청합니다.
