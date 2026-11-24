# 저장한 비공개 PNG 프로젝트 다시 열기

기존 로컬 Next.js 앱에서 계정별 PNG 업로드, 발급된 파일 ID로 프로젝트 생성 및 재시도, 같은 프로젝트의 목록·상세 GET을 연속 실행했다. 목록에서 생성된 ID는 한 건이었다. 상세의 제목, 첨부 파일 ID와 단계 7개가 저장 요청과 일치했다. 다른 계정의 목록에는 나타나지 않았고 다른 두 계정의 상세 요청은 404, 비로그인 목록과 상세는 401이었다. 모든 조회 응답에서 no-store를 확인했다.

제품 조회 코드는 그대로 사용했다. 테스트 실행기는 자신이 생성한 PG17 클러스터에 한해 단기 로컬 인증서를 설치한다. Next 자식 프로세스에 시험 인증서와 기존 조회 어댑터용 접속 설정을 전달한다. 실제 조회 세션의 TLS 사용을 pg_stat_ssl에서 확인했다. 운영 접속이나 설정 변경은 없다. 화면 링크·새로고침은 Front의 별도 검수 범위다.

재현 명령은 아래와 같다.

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

[조회 검증](../../tests/postgres/private-project-reopen-http.mjs) · [통합 실행기](../../tests/postgres/t371-project-create-http.mjs)

## Tester 독립 재실행

2026-11-19 MASTER 배정으로 위 명령을 별도 실행해 종료 코드 0을 확인했다. 조회 시험과 HTTP 실행기는 `5da505b`와 일치했다. 소유자 목록에 생성 ID가 한 번 나타났고 상세 제목·첨부 ID·7단계가 일치했다. 타인 목록에서 제외됐고 두 타계정 상세는 404, 익명 목록·상세는 401이었다. 모든 조회에서 no-store를 확인했다. PostgreSQL의 pg_stat_ssl에서 시험용 조회 세션의 TLS 사용을 확인했고 임시 클러스터가 정리됐다. 인증과 저장소에는 로컬 시험 서비스를 사용했다.
