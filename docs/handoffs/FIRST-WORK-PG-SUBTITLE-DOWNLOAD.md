# 승인된 로컬 PG 자막 내려받기

현재 프로젝트의 소유자가 검수를 완료한 타임라인에서 SRT 또는 WebVTT 파일을 받는다. 조회는 읽기 전용 반복 읽기 트랜잭션 하나에서 프로젝트, 승인, 타임라인 ID·내용 버전, 저장 JSON의 SHA-256과 장면 상태를 확인한다. 기존 프레임 기반 직렬화 함수를 사용한다.

| 항목 | 계약 |
|---|---|
| 요청 | GET /api/projects/{id}/timeline/subtitles/download?format=srt 또는 vtt, revision, timelineId. revision은 검수 조회의 내용 리비전이다. |
| 성공 | UTF-8 첨부 파일 subtitles-r{revision}.srt 또는 subtitles-r{revision}.vtt. MIME은 application/x-subrip 또는 text/vtt이며 private, no-store로 반환한다. |
| 승인 전·이전 버전 | 409 REVIEW_APPROVAL_REQUIRED 또는 CURRENT_TIMELINE_CONFLICT. 현재 장면과 타임라인이 맞지 않으면 BASE_TIMELINE_STALE이다. |
| 파일이 없는 경우 | 승인본에 자막이 없으면 404 SUBTITLES_EMPTY. 타인 프로젝트는 404 PROJECT_MISSING. 로그인 없이 요청하면 401이다. |

실제 로컬 Next.js·PG17 시험에서 한글과 줄바꿈의 UTF-8 바이트, 4·21·22·30프레임의 SRT/VTT 시각, 첨부 파일명과 MIME, 다운로드 전후 이력·활동·큐 건수가 같은지 확인한다. 동일 파일에는 자막 레이어만 들어간다.

```powershell
$env:T371_VERIFY_HTTP='1'
$env:T371_VERIFY_RENDER_AUDIO='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```
