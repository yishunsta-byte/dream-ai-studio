# 쇼핑숏츠 프로젝트에 검증 WAV 첨부

Master 구현 배정 `msg_9d7b42a30177`. 기존 로컬 PNG 및 WAV 서버 설정을 모두 사용하는 Next 앱에서, 같은 소유자의 쇼핑숏츠 프로젝트와 WAV 등록 결과를 연결한다. 로그인 세션은 서버에서 검증한다. 자료 첨부는 타임라인에 재생 클립을 추가하는 작업과 별도다.

| 요청 | 응답 |
|---|---|
| PUT /api/projects/{id}/audio-assets/{assetId} | 본문 없이 호출한다. 최초와 같은 요청 반복 모두 200과 `{assetId}`를 반환한다. |
| GET /api/projects/{id}/audio-assets | 200과 `{assets:[{id,title,durationMs,rightsNote}]}`를 반환한다. 보관된 음원은 제외한다. |
| 실패 | 타인·미등록·보관된 대상 및 PNG를 WAV로 첨부할 때 404, 익명은 401, 로컬 연결 비활성·저장 오류는 503이다. |

전용 역할은 음원 원문에 대한 SELECT 권한이 없다. 같은 소유자의 검증 행에서 파일 키·해시·크기·길이를 자산과 대조한다. 프로젝트와 음원 행을 공유 잠금으로 읽고 `productionAudio` 연결과 활동 기록을 같은 트랜잭션에서 쓴다. 권리 메모는 현재 자료의 값을 조회한다. 입력 스냅샷이나 기존 PNG 첨부는 변경하지 않는다.

실제 로컬 Next와 PG17에서 동시 PUT 및 재시도, 목록 재조회, 타인 계정 두 방향, 잘못된 자료와 비로그인 요청을 검증했다. 활동 기록 오류 주입 후 첨부와 기록이 모두 0건임을 확인했다. 보관 중인 음원에 대한 첨부 요청의 DB 잠금 대기를 관찰하고 보관 커밋 뒤 404를 확인했다. SQLite 기본 생성, 기존 PNG·WAV 업로드, 생성 재시도와 프로젝트 재조회도 같은 실행에서 검증한다.

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

[라우트 처리](../../lib/cloud/local-project-audio.ts) · [로컬 권한 설치](../../lib/db/postgres/private-wav-upload/project-audio.sql) · [경합과 롤백 시험](../../tests/postgres/private-project-audio-http.mjs)

Tester 독립 재실행(2026-11-19). `1aae8b9`와 일치하는 첨부 코드 및 HTTP 시험을 새 로컬 PG17에서 실행해 종료 코드 0을 확인했다. 같은 음원의 동시 PUT과 재시도 뒤 연결·활동 기록은 각 1건이었다. 감사 기록 실패를 주입한 PUT은 503이었고 연결·기록 모두 0건으로 돌아갔다. 타계정·잘못된 자산·보관 프로젝트는 404, 익명 PUT은 401이었다. 보관 트랜잭션이 잠금을 잡은 음원은 첨부가 기다렸다가 커밋 후 404였다. 목록 GET, PNG 생성·재조회, 임시 클러스터 정리도 통과했다.
