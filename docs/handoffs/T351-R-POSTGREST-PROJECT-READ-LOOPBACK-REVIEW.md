# T351-R 실제 PostgREST 조회 독립 검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `8ab9d7e` · Master 배정 `msg_ee1c42266978`

**루프백 검수 통과.** 대상 커밋의 두 경로는 시험 실행기와 인계 문서다. 공식 PostgREST 16.6 Windows x64 ZIP의 공개 SHA-256 `77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea`가 실행기 고정값과 일치했다. 실행기는 받은 본문 해시와 실행 파일 버전을 확인한 뒤 소유 PG17.12와 함께 실제 HTTP 시험을 실행했다. [공식 릴리스 자산](https://github.com/PostgREST/postgrest/releases/expanded_assets/v16.6)

- 연결 풀 한 개에서 A→익명→B 진단 요청을 실행했다. 연결 로그인은 유지됐고 요청 역할과 JWT subject는 각 요청에 맞게 전환됐다. 익명 요청에 A의 subject가 남지 않았고 GET의 트랜잭션은 읽기 전용이었다.
- A/B는 자기 활성 작품만 읽었다. 차단 사용자 목록은 200 빈 배열, 익명은 401이었다. 기반·Auth·내부 스키마는 406으로 거절됐고, 읽기 뷰 DELETE는 500/`55000`으로 실패했다. 원본 프로젝트 5행은 보존됐다.
- B의 고정 정렬 두 페이지를 중복 없이 읽었고 `Content-Range`는 `0-0/2`, `1-1/2`였다. 원시 필드를 앱 목록·상세 DTO로 매핑하고 단계 순서를 정규화했을 때 기존 읽기 요청과 일치했다.
- 타인·보관·미존재 상세는 원시 복수 응답에서 200 빈 배열이고 단수 응답에서 406/`PGRST116`이었다. 잘못된 UUID는 400, 조회 권한 회수는 403이었다. 기존 앱 대조에서는 누락 상세가 404이고 `no-store`였으며 원시 성공 목록에는 `Cache-Control`이 없었다. 두 응답 계약 간 정규화가 향후 연결에 필요하다. [PostgREST 16 오류 계약](https://docs.postgrest.org/en/v16/references/errors.html)
- 합성 시험에서 잘못된 서명·audience·만료는 401, 위임되지 않은 역할은 403이었다. 같은 합성 키로 서명한 다른 issuer와 audience 생략은 이 독립 구성에서 200이었다. 관측은 루프백 HTTP·로컬 PG SCRAM·합성 JWT에 한정한다. 실제 Supabase HTTPS, 제공자가 발급한 JWT와 관리형 설정은 검증 범위 밖이다. [PostgREST 16 인증](https://docs.postgrest.org/en/v16/references/auth.html)

관련 회귀 288건 통과·30건 건너뜀, 소스 타입 검사, 실행기 ESLint와 diff 공백 검사가 통과했다. 양쪽 루프백 포트의 종료 후 접속 거부와 ZIP·실행 파일·임시 클러스터 제거를 실행기가 확인했다. 별도로 소유 시험 프로세스 0건을 확인하고 검수 사본을 정리했다. 운영 접근·빌드·배포나 새 세션·worktree 생성은 없었다.
