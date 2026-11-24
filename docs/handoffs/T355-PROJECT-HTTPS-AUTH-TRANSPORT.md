# T355 프로젝트 HTTPS 조회의 SDK 전송과 쿠키 경계

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_26d5c90ccd27` · 조립 기준 `344be9c`

프로젝트 HTTPS 조회의 SSR/Auth SDK는 승인된 Supabase origin에서 정확한 `GET /auth/v1/user`와 쓰기 가능한 라우트의 `POST /auth/v1/token?grant_type=refresh_token`만 사용한다. POST 본문은 SDK의 갱신 토큰 입력으로 제한한다. 기존 공용 SSR 헬퍼에는 선택형 전송 및 쿠키 정책을 추가했다. 기본 호출은 기존 전송과 쿠키 기록 실패의 처리 방식을 유지한다. [요청 조립](../../lib/services/project-https-read-assembly.ts) · [공용 SSR 헬퍼](../../lib/auth/server.ts)

| 경계 | 보장과 격리 증거 |
| --- | --- |
| 전송 | 첫 SDK 호출부터 `no-store`, 리디렉션 거부, 쿠키 헤더 제거를 적용한다. Auth 준비에 5초 한도를 사용하고 발신 요청에 호출자 취소 신호를 결합한다. 취소·시간 초과·잘못된 URL/메서드·리디렉션·상류 장애에서 조회를 닫는다. SDK의 자동 네트워크 재시도를 시작시키지 않도록 실패를 고정 응답으로 전달하며, 오류 본문과 토큰을 사용자 응답이나 관측 로그로 보내지 않는다. |
| 쓰기 가능 라우트 | SDK 갱신을 허용한다. 정상 갱신 후 Next 쿠키 저장소에 쓰기가 성공한 경우에만 해당 토큰으로 검증을 이어간다. 쓰기 예외 또는 갱신 후 쓰기 확인이 없으면 503이다. 여러 쿠키 중 일부만 기록된 실패에서는 조회를 닫는다. Next가 전송한 응답을 브라우저가 보존하는지는 후속 HTTP 시험에서 확인해야 한다. |
| 읽기 전용 렌더 | 정상 쿠키는 Auth GET 후 조회에 사용한다. 갱신이 필요한 경우 SDK의 POST를 네트워크 전송 전에 차단하고 쿠키 쓰기를 건너뛴다. 이 요청은 401로 닫히고 기존 proxy가 갱신한 쿠키가 이후 요청에 들어오면 다시 조회할 수 있다. 격리 시험은 다음 요청의 모의 쿠키로 이 경계를 확인했다. 기존 proxy는 그대로다. [proxy 세션 처리](../../proxy.ts) |
| 사용자·토큰 결합 | SSR의 명시적 `getUser(token)`과 T352의 동일 토큰 Auth 대조를 유지한다. 승인된 사용자·동일 토큰만 조회하며 정상 요청의 Auth GET 두 번을 확인했다. 앱 응답은 기존 DTO 및 `no-store`를 유지한다. 검증 결과 재사용은 두 검증이 동일 요청과 대상에 묶인다는 근거를 확보한 뒤 검토한다. [T354 요청 조립](T354-PROJECT-HTTPS-READ-REQUEST-ASSEMBLY.md) |

설치된 SSR/Auth SDK를 실행하고 Next 쿠키 저장소와 상류 네트워크만 모의로 구성했다. 프로젝트 조회와 기존 Auth 회귀 262건 및 변경 파일 ESLint, 생성 `.next` 검증기 제외 소스 TypeScript를 통과했다. 실제 Next 라우트·렌더/proxy의 쿠키 전달과 Supabase 실제 세션은 연결 단계에서 검증한다. [집중 시험](../../tests/postgres/t354-project-https-read-assembly.test.ts)

다음 연결 단위에서 GET 목록·상세 라우트는 `route`를, 클라우드 서버 렌더는 `render`를 명시하고 같은 호스트에서 proxy 갱신과 응답 전달을 확인한다. 제품 GET 라우트·SQL·운영 설정·배포는 그대로다.
