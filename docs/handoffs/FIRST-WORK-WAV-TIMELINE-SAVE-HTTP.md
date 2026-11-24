# 프로젝트 WAV를 배경 음악으로 저장

| 항목 | 현재 상태 |
|---|---|
| 저장 API | 로컬 PG17에서 POST /api/projects/{id}/timeline/audio-clips 구현. 본문은 assetId, expectedContentRevision, expectedTimelineId이며 요청 헤더 Idempotency-Key는 UUIDv7이다. 성공 시 timelineId, timelineRevision, contentRevision, clipId를 반환한다. |
| 신규 프로젝트 | 실제 생성 직후 저장을 시도하면 HTTP 409와 PRODUCE_APPROVAL_REQUIRED, BASE_TIMELINE_REQUIRED를 함께 반환한다. 제작 승인과 기존 타임라인을 준비해야 한다. 출력 길이가 0이면 OUTPUT_LENGTH_REQUIRED를 반환한다. |
| 편집 가능한 프로젝트 | 인증한 소유자의 프로젝트에 첨부된 검증 WAV를 사용한다. 서버의 현재 장면과 기존 리비전을 대조하고 남은 프레임 안에서 음악을 추가한다. 포인터·내용 버전·후속 단계·활동 기록을 한 번에 저장한다. |
| 통합 시험 | 독립 로컬 PG17과 실제 Next HTTP를 사용했다. 테스트 전용 제작 승인·PNG 장면·기준 타임라인에서 100ms WAV가 3프레임으로 저장됐다. 동일 키 동시 요청과 응답 유실 후 재요청은 최초 결과를 반환했다. 서로 다른 동시 저장은 하나만 성공했다. 활동 기록 쓰기 실패 시 전체 롤백을 확인했다. |
| 실작품 적용 | 일반 사용자가 쇼핑숏츠를 제작 승인하고 첫 타임라인을 만드는 경로, 편집 화면 저장 버튼 연결, 실제 콘텐츠 렌더·운영 배포는 후속 작업이다. |

재현 명령은 저장소 루트의 PowerShell에서 실행한다.

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```
