# 로컬 PG 렌더 요청 접수와 상태 조회

Master 배정 msg_09b0c7369a5b. 소유한 로컬 PG17에서 기존 GET·POST /api/projects/{id}/renders에 렌더 접수 경로를 연결했다. PG 프로젝트 생성·비공개 업로드가 모두 선택된 환경에서만 이 경로를 사용한다. 로컬 인증, 소유자, 프로젝트 종류, 현재 타임라인 ID·내용 리비전, 제작 승인, 같은 내용 리비전의 검수 승인을 확인한다.

| 요청 | 응답 |
|---|---|
| POST, 현재 승인본 | 본문 revision·timelineId, 헤더 Idempotency-Key(UUIDv7). 202와 jobId·queued·existing을 반환 |
| 같은 리비전의 반복·동시 요청 | 같은 키 및 다른 키 요청 모두 같은 jobId. 별칭을 기록해 이미 사용한 키를 다른 작업에 쓸 수 없도록 한다. |
| 이전 또는 미승인 리비전 | 409 CURRENT_TIMELINE_CONFLICT 또는 REVIEW_APPROVAL_REQUIRED. 같은 키도 현재 리비전과 승인 조건을 확인한다. |
| GET | 소유자만 결과의 requests에서 접수 상태와 타임라인·내용 리비전, stale을 확인한다. workerOnline=false, renders는 빈 목록이다. |

완전한 렌더 입력 봉투를 요구하는 dream.renders에는 준비 대기 요청을 넣지 않았다. 기존 dream.jobs에 render-prepare 종류로 고정 타임라인 원문 SHA와 프레임 수를 저장한다. next_run_at과 lease는 비어 있고 attempts는 0이다. 요청 키·작업·활동을 한 트랜잭션에 기록한다. 같은 기준을 나중에 처리할 워커에는 검증된 장면과 소리를 포함한 전체 렌더 입력을 만드는 경로가 필요하다. 승인 상태는 HTTP 통합 시험의 소유 PG fixture에서 준비했다.

## 검증

- 실제 Next·PG17에서 익명 401, 타인 404, 키 누락 400, 미승인·이전 리비전·잘못된 타임라인 409를 재현했다.
- 동일 키 2건과 다른 키 1건을 동시에 보내 202 세 건이 동일 작업으로 돌아오고 작업·활동 각 1건임을 확인했다. 활동 INSERT 실패는 작업·별칭까지 롤백했다.
- 실제 WAV 추가로 리비전을 변경하자 앞선 요청이 stale로 조회되고 새 기준의 저장이 재승인 전까지 거절됐다. 재승인 후 기존 키는 충돌, 새 키는 새 대기 작업으로 접수됐다. 실제 출력·렌더 행은 0이었다.
- T371_VERIFY_HTTP=1 및 T371_VERIFY_RENDER_AUDIO=1로 tests/postgres/t368-run-private-image-project-create.mjs를 실행해 공용 PG HTTP·실제 WAV MP4 회귀와 기존 SQLite 경로를 확인했다. 종료 코드 0이며 PG 프로세스·리스너·임시 클러스터가 정리됐다. 관련 인증·SQLite 렌더·오디오 Vitest 185건, npm run typecheck, 변경 경로 ESLint 통과.

[서버 접수](../../lib/cloud/local-render-request.ts) · [격리 SQL](../../lib/db/postgres/private-wav-upload/render-request.sql) · [실제 HTTP 시험](../../tests/postgres/private-render-request-http.mjs)

> Master 전달문 — 현재 승인 리비전의 소유자만 요청을 접수할 수 있고, 같은 리비전의 동시 요청 세 건은 한 대기 작업을 반환했습니다. 소유자는 기존 GET 경로에서 대기 상태와 이전 리비전 여부를 확인할 수 있습니다.

## Tester 독립 검수

고정 커밋 `8117f19de7ce4902763ce22a54b34ef362c420cb`를 격리 작업 트리의 실제 Next.js·임시 PG17에서 실행했다. 제품 파일은 그대로 두고 시험 실행에 파일 목록 및 DB 상태 관찰을 추가했다. 아래 건수는 합성 소유 프로젝트 한 건을 기준으로 한다.

| 조건 | 관찰 |
|---|---|
| 소유·승인·기준 | 익명 GET·POST 401, 타인 GET·POST 404, 키 누락 400. 검수 미승인·이전 승인본·잘못된 현재 기준은 409. 검수 승인 상태를 유지하고 제작 승인만 해제해도 409. |
| 활동 기록 실패 | 활동 INSERT 실패를 주입한 POST는 503. 작업·활동·키 별칭·렌더 행 각 0건으로 롤백. |
| 동시 요청 세 건 | 동일 키 두 건과 다른 키 한 건 모두 202 및 같은 job ID `01a1f469-fd56-738a-ac97-8d15c00ea7b0`. 작업·활동 각 1건, 키 별칭 2건, 렌더 행 0건. |
| WAV 저장으로 내용 변경 | 내용 r2·타임라인 r1의 첫 요청은 `stale`. 내용 r3·타임라인 r2의 요청은 재승인 전 409이고, 재승인 뒤 기존 키는 409, 새 키는 202. 두 번째 job ID `01a1f46a-0075-7714-b55e-2fe69eb44495`. 최종 작업·활동 각 2건, 키 별칭 3건. |
| 대기 상태 | 두 작업 모두 queued 및 attempts 0이며 다음 실행 시각, lease, heartbeat, 완료 시각은 비어 있었다. GET은 workerOnline=false, renders=[]였다. 격리 앱의 MP4·AAC·WAV 파일 목록은 동일했고 저장소 이벤트 증가분과 렌더 행은 0이었다. |

실제 WAV 출력 회귀를 포함한 공용 HTTP 실행과 제작 승인 분기를 추가한 재실행이 모두 종료 코드 0이었다. 관련 인증·렌더 대기·작업 Vitest 169건이 통과했고 두 실행의 임시 PG17 프로세스·리스너·클러스터가 정리됐다. 제작·검수 승인은 시험 데이터로 준비했다.

> Master 전달문 — 8117f19 실제 Next/PG17에서 소유 및 양쪽 승인, 동시 세 요청의 단일 job ID, 활동 실패 전체 롤백, 리비전 변경과 재승인을 검증했습니다. 대기 작업 두 건 모두 실행 시도 0이며 출력 파일 추가와 렌더 행은 0건이었습니다.
