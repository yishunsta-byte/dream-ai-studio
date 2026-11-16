# T-041 복원 실패 뒤 재검사 길 고치기 — CC-DATA-01 보고

- 부모: T-035 · 근거: `T-035-DESIGN-CHECK-CC-DESIGN-01.md` D-1
- 시작 HEAD: 1bf1276 · 담당: CC-DATA-01 (임시 코딩 위임)

## 1. 무엇을 바꿨나요

| 파일 | 바꾼 내용 |
|---|---|
| `lib/backup/restore-retry.ts` (새) | 검사 상태 목록과 `canRetrySameTicket(state)`. failed·missing이면 같은 검사로 다시 확정할 수 없어요. 나머지(ready·finishing·prepared·completed·unknown)는 같은 검사를 유지해요. |
| `lib/services/restore.ts` | 서비스에 `status(ticketId)`를 더했어요(던지지 않고 실제 티켓 상태를 돌려줘요. 없거나 형식이 틀리면 missing). 공개 함수 `restoreTicketStatus()`는 시작 점검 실패 등으로 읽지 못하면 unknown을 돌려줘요. DTO에 `backupId`를 더했어요(새로고침 뒤 고른 백업을 되살리려고). |
| `app/api/restore/finish/route.ts` | 확정이 실패하면 기존 `{error,code}`에 `ticketStatus`와 `retryable`을 더해 돌려줘요. 상태 코드는 그대로예요. 요청 형식이 틀려 티켓 번호를 못 읽은 경우는 붙이지 않아요. |
| `components/settings-panel.tsx` | `retryable:false`이면(만료 포함) 검사와 브라우저 저장값(restore-pending)을 지우고 "검사하기"를 다시 보여 줘요. 고른 백업과 폴더는 그대로 둬요. 안내 문장 한 줄을 더했어요. `retryable`이 true이거나 없으면(네트워크 오류 등 결과를 모름) 같은 검사를 유지해요. 키보드 초점은 다시 그린 뒤 다음 할 일 버튼("검사하기" 또는 "같은 검사로 복원 다시 확인")으로 옮겨요. 저장값 형식에 `backupId`를 더했어요(옛 저장값은 빈 값으로 읽어요). |
| `tests/restore.test.ts` | 실제 서비스로 2개 추가: ① 원본 변경 → failed, 같은 검사 재확정은 RESTORE_INVALID, 바뀐 원본 그대로 새 검사는 meta 거부, 원본을 되돌리면 같은 백업·폴더로 새 검사 성공, 올리기 실패 → failed, 만료 → failed, 없는 번호·형식 오류 → missing, 원본 백업 바이트 불변. ② 준비 뒤 이름 바꾸기 실패(RESTORE_FAILED) → prepared → 같은 검사로 한 번만 완료. DTO 키 목록 갱신. |
| `tests/maintenance-routes.test.ts` | 오류 코드가 같아도 실제 상태로 `retryable`이 갈리는지 7가지(RESTORE_FAILED+prepared/failed/unknown, SOURCE_CHANGED, UPGRADE_FAILED, INVALID+missing, CONFLICT+finishing)와 요청 형식 오류 때 상태 조회를 안 하는지 확인해요. |

### 판단 기준 (코드 이름만 보지 않아요)
- RESTORE_FAILED는 서버가 티켓을 prepared로 남겼을 때만 같은 검사를 유지해요. failed면 지워요.
- 처리 중 CONFLICT(finishing)와 네트워크 오류(응답 없음)는 같은 검사를 유지해요. 다시 눌러도 서버가 중복 실행을 막아요(T-035의 finishing 잠금·prepared 재실행 그대로).

## 2. 실행 확인

- lint 통과 · typecheck 통과 · test 28파일 261 통과(+1 건너뜀) · build 경고 0
- 브라우저(ego lite) — 임시 가상 폴더에 새 DB를 만들고 고정 s4.zip 복사본을 검증된 백업으로 등록해 `next start`(127.0.0.1:3041)로 실행했어요. 실사용 데이터·고정 원본은 쓰지 않았어요. 끝난 뒤 임시 폴더와 서버를 지웠어요(다른 세션의 :3013은 건드리지 않음).

| 경우 | 방법 | 결과 |
|---|---|---|
| 원본 변경 (1280·390) | 검사 뒤 복사본 ZIP 끝에 1바이트 추가 → 키보드로 복원 | 실제 서버 BACKUP_SOURCE_CHANGED. 저장값 지워짐, "검사하기"로 바뀜, 초점 "검사하기", 백업·폴더 유지, 390에서 가로 넘침 없음 |
| 바뀐 원본 그대로 새 검사 | "검사하기" | meta 거부 문구 표시(변조 백업 복원은 하지 않음). 원본을 되돌리자 새 검사 성공 |
| 올리기 실패·만료·invalid·RESTORE_FAILED+failed | 확정 응답만 화면 안에서 가짜로 바꿈 | 모두 저장값 지움, "검사하기", 초점 이동, 입력 유지 |
| RESTORE_FAILED+prepared·처리 중 CONFLICT·네트워크 끊김 | 같은 방법 | 저장값 유지, "같은 검사로 복원 다시 확인", 초점 그 버튼 |
| 새로고침 | 유지된 검사에서 새로고침 | 검사·백업 선택·폴더 되살아남 |
| 같은 검사로 실제 완료 | 위 상태에서 키보드로 확정 | 실제 서버 완료, 저장값 지워짐 |

- 올리기 실패·만료·prepared 재실행의 **서버 동작**은 위 서비스 테스트(실제 서비스, 임시 fixture)로 확인했어요. 브라우저에서는 해당 응답을 흉내 내 화면 분기만 확인했어요.
- 화면 사진: `C:/Users/Administrator/ego/t041/` (2·5·6 원본 변경, 3 prepared 유지, 4 완료, 7 올리기 실패 1280). 저장소에는 넣지 않았어요.

## 3. 남은 것
- 네트워크가 끊기면 오류 문장이 브라우저 영어 문구("Failed to fetch")로 보여요. T-041 이전부터 있던 동작이고 범위 밖이라 그대로 뒀어요(설정 화면 공통 `request()`).
- d-2(오류 코드 줄)는 손대지 않았어요.
