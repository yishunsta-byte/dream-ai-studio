# T-021 · 복원본 백업 출처 구분·파일 없음·원래 환경 경계 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-021 / T-019 (P1 데이터 정합성 수정) |
| 담당 / 플랫폼 | CC-DATA-01 · Claude Code CLI (Windows) · Orca `term_a0a6f98c-c4ca-405a-9a7e-9fb263d26390` |
| 지시 | Master `msg_9183a3914b87`, 수락·점유 회신 `msg_2082a301212c` |
| 기준 | 시작 HEAD `4eac15a`, 커밋 직전 HEAD `abaefcb`(협업 문서만 바뀜) |
| 상태 | ready_review (자체 확인, 독립 검수 아님) |
| 바꾼 파일 | `lib/services/backups.ts`, `lib/services/restore.ts`, `lib/backup/schema.ts`, `lib/backup/paths.ts`, `tests/backup-origin.test.ts`(새 파일), 이 보고서 |
| 안 바꾼 것 | UI, 공용 문서, lockfile, SQL migration, `history.ts`, 기존 테스트 |

## 1. 바꾼 내용

### 1) 백업 출처 구분 (T019-1)
- **복원 확정 때 정확한 목록을 남겨요.** `normalize`가 복원본 DB의 비공개 설정 `restore.info`에 `inheritedBackupIds`(복원 시점 backups 표의 모든 ID)와 `protectedRoots`(아래 3)를 추가로 기록해요. 디스크의 `restore-info.json` 표시 파일과 그 strict 스키마는 그대로예요. 정규화 DB 해시와 재시도 인증 방식도 바뀌지 않았어요.
- **새 백업에는 출처 표시를 붙여요.** `request()`가 백업 행을 만들 때 같은 트랜잭션에서 설정 `backup.<id>.origin = {schemaVersion:1, restoreTicketId}`를 넣어요. 값은 복원한 적 없는 환경이면 `null`, 복원본이면 그 복원본의 ticketId예요. 키가 `backup.*.meta` 보호 트리거와 겹치지 않는 것을 확인했어요.
- **분류 규칙 (시계 비교 없음):**
  - `restore.info`가 없으면(복원한 적 없는 환경) 모두 `local`.
  - 복원본에서 `error=RESTORE_INTERRUPTED`이거나 `inheritedBackupIds`에 있으면 `inherited`.
  - 출처 표시의 ticketId가 이 복원본 ticketId와 같으면 `local`.
  - 그 밖(구형 복원본이라 목록이 없고 표시도 없는 행, `restore.info`를 읽을 수 없는 경우)은 `unconfirmed`. 보수적으로 집계에서 빼요. 구형 복원본도 이번 수정 뒤 새로 요청한 백업부터는 표시가 붙어 `local`이 돼요.
- **집계:** `lastSuccess`·`lastFailure`는 `local` 행만 세요.
- **파일 존재:** 성공 행마다 지금 그 경로에 일반 파일이 있는지 `lstatSync`로만 확인해 `available`로 내려요. 검증 이력(`status`·`verifiedAt`·`fileCount`·`sizeBytes`)은 그대로 두고, 행을 `succeeded`에서 바꾸지 않아요. `restorable`은 성공 + 파일 있음 + meta 정상일 때만 true예요.

### 2) 파일 없음 오류 (T019-2)
- `inspect`에서 `lstat`·`fileDigest` 중 `ENOENT`·`ENOTDIR`이 나면 `BACKUP_NOT_FOUND`(404)로 바꿔요. 문구: "이 PC에서 백업 파일을 찾지 못했어요. 원래 백업 파일이 있던 위치나 연결한 저장 장치를 확인해 주세요."
- 링크, 다른 내용(해시·크기·manifest 불일치), 그 밖의 오류는 기존 `RESTORE_INVALID` 보호를 그대로 유지해요.
- 없는 드라이브(`Q:\…`)도 Node에서 `ENOENT`로 나오는 것을 이 PC에서 확인했어요.

### 3) 원래 환경 안으로의 복원 거절 (T019-3)
- **새 복원:** 복원을 확정할 때 복원을 실행한 환경의 물리 경계를 기록해요(`sourceBoundaries`). 대상은 `runtimeRoot`(realpath), `data`, `storage`, `backups`, 실제 열린 DB 파일의 부모 폴더예요. 그 환경이 복원본이면 그 환경이 이어받은 `protectedRoots`도 계승해요(최대 256개, 넘으면 실패로 닫음). `dirname(dirname(backup.path))` 같은 추정은 쓰지 않아요. 따라서 외부 백업 폴더도 영향을 받지 않아요.
- **검사 위치:** `boundary()`가 inspect와 finish 모두에서 현재 환경 `restore.info.protectedRoots`와 목적지가 겹치는지 봐요(양방향 포함 관계). 겹치면 `INVALID_INPUT`: "원래 환경의 데이터·자료·백업 폴더와 겹치지 않는 새 복원 폴더를 골라 주세요."
- **구형 복원본과 추가 보호:** 목적지의 물리 상위 폴더 중 `data/app.db`가 있는 곳이 있으면 거절해요(`rejectForeignDataRoot`, stat만 사용, 목적지 자신은 제외). 모든 복원에 적용해요. 문구: "다른 데이터 폴더 안에는 복원할 수 없어요…"
- **경로 정책:**
  - 목적지는 기존 `canonicalTarget`이 부모를 realpath로 풀어서 비교해요. 그래서 Windows junction과 8.3 짧은 이름은 물리 경로로 비교돼요(junction 테스트 포함).
  - 기록된 경계가 이 PC에 없을 때(다른 PC, 빠진 드라이브)는 기록된 물리 경로 문자열로 비교해요.
  - 경계나 상위 폴더 확인 중 `ENOENT`/`ENOTDIR`가 아닌 오류가 나면 실패로 닫아요. 문구: "복원 폴더 위치를 확인하지 못했어요…"
- 경로는 어떤 DTO에도 나가지 않아요. `history.restoreInformation()`은 여전히 `backupCreatedAt`·`restoredAt`만 반환해요(테스트로 확인).

## 2. DTO 계약 (`readBackups()` / `GET /api/backups`)

기존 필드는 이름·의미·기본값이 모두 그대로예요. 행마다 아래 필드만 **추가**했어요.

| 필드 | 타입 | 뜻 |
|---|---|---|
| `origin` | `"local" \| "inherited" \| "unconfirmed"` | 위 분류 규칙. `BackupOrigin` 타입으로 export |
| `inherited` | `boolean` | `origin==="inherited"` |
| `originUnconfirmed` | `boolean` | `origin==="unconfirmed"` |
| `available` | `boolean \| null` | 성공 행이면 지금 파일 존재 여부, 그 밖은 `null`. 내용 검증 아님 |
| `restorable` | `boolean` | 성공 + `available` + meta 정상. UI 복원 선택 후보 기준으로 권장 |

- 최상위 `lastSuccess`·`lastFailure`: 이제 `local` 행 중에서만 골라요. 복원 직후 복원본은 둘 다 `null`이에요.
- `tests/maintenance-routes.test.ts`의 mock(`{rows:[],lastSuccess:null,lastFailure:null}`)은 그대로 통과해요.
- UI 연결(Master 후속)에 쓸 수 있는 것:
  - 복원 선택 목록: `restorable`로 거르거나, `inherited`·`originUnconfirmed`에 이름표를 붙여요.
  - 파일이 없는 행: `available===false`면 "이 PC에 파일 없음"으로 보여요.
  - 복원 실패: `BACKUP_NOT_FOUND`의 문구를 그대로 보여 주면 돼요.
- 참고: `unconfirmed` 행도 같은 PC에 파일이 있으면 `restorable=true`예요. 같은 PC 재복원은 해시 검증으로 보호되므로 유지하라는 지시에 따랐어요.

## 3. 검증

| 명령 | 결과 |
|---|---|
| `npm run lint` | 통과 (경고 0) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | 통과 |
| `npm test` | 24파일 207검사 통과 (새 `tests/backup-origin.test.ts` 14검사 포함, 기존 테스트 수정 없음) |
| `npm run build` | **실행 안 함.** 이 저장소에서 `next dev --hostname 127.0.0.1 --port 3013`(PID 3764, 다른 세션 실행)이 켜져 있었어요. root `.next`를 공유하므로 지시 조건에 따라 건너뛰었고, 그 서버는 건드리지 않았어요 |

새 테스트가 확인한 장면 (모두 `os.tmpdir()/dream-origin-test-*` 임시 fixture, 끝나면 삭제):

| 장면 | 확인한 것 |
|---|---|
| B1·B2 백업 → B2 복원 | 복원본에서 B1=`inherited`·`available`·`restorable`, B2=`inherited`·중단. `lastSuccess`/`lastFailure`=null. `restore.info`에 ID 목록과 원래 경계 기록. DTO에 경로 없음 |
| 복원본에서 새 백업 (시계를 2020년으로 되돌림) | `local`, `lastSuccess`=새 백업, 저장 위치는 복원본 `backups` |
| 원본 ZIP 있음, 같은 PC 재복원 | 복원 성공. 원래 ZIP 해시·수정 시각, 원래 DB 해시, 원래 storage 목록 그대로. B1 행은 `succeeded` 유지 |
| 원본 ZIP 없음 | 검증 이력 유지 + `available=false`·`restorable=false`. `BACKUP_NOT_FOUND` 404. 행 상태 유지 |
| 같은 경로·다른 내용 | `RESTORE_INVALID` 유지 |
| 원래 환경 `storage`·`data`·루트 안 목적지 | 모두 `INVALID_INPUT`. 원래 DB 해시·data·storage 목록 그대로 |
| 복원본의 복원본 | 원래 환경 경계 계승. 원래 `data/app.db`를 지워 휴리스틱을 끈 상태에서도 거절 |
| junction 별칭으로 원래 storage 지정 | 거절 (junction 만들기 실패 시 건너뜀. 이번 실행에서는 실제로 실행됨) |
| 구형 복원본(목록·경계 없는 `restore.info`), 시계 2030년 | 표시 없는 행은 `unconfirmed`, 집계 제외. 중단 행은 `inherited`. 이후 새 백업은 `local`. 원래 data·storage 목적지는 휴리스틱으로 거절, 바깥 폴더 복원은 성공 |
| 읽을 수 없는 `restore.info` | 표시 행까지 `unconfirmed`로 보수 처리, `lastSuccess`=null |
| 경계 함수 | 없는 경로는 문자열 비교로 거절, 없는 드라이브 경계는 무관한 목적지를 막지 않음. 다른 `data/app.db` 상위는 거절 |
| 복원한 적 없는 환경 | 모든 행 `local`, 기존 동작 그대로 |

## 4. 한계와 남은 일

- **빌드 미실행** (위 사유). Master가 dev 서버를 멈춘 뒤 `npm run build`로 확인해 주세요.
- **이전 복원본은 경계 목록이 없어요.** 이번 수정 전에 만든 복원본은 `protectedRoots`가 없어 `data/app.db` 휴리스틱만으로 막아요. 원래 환경이 다른 위치에 DB를 두는 배치(현재 코드에서는 `runtimeRoot/data/app.db` 고정)라면 막지 못할 수 있어요.
- **구형 복원본에서 수정 전에 만든 로컬 백업은 `unconfirmed`로 남아요.** 시계 비교로 확정하지 말라는 지시에 따른 결과예요. 화면에서 "출처 확인 안 됨"으로 보이게 될 거예요.
- **`available`은 존재 여부만 봐요.** 내용 검증은 inspect에서 해시로 해요. 목록을 열 때마다 성공 행 수만큼 `lstat`이 실행돼요. 네트워크 드라이브가 느리면 목록도 느려질 수 있어요(측정 안 함).
- **이번 범위가 아닌 것:** 복원본에서 백업 저장 폴더를 원래 환경 안으로 바꾸는 것(`validateBackupDirectory`)은 여전히 현재 환경 경계만 봐요. 새 ID라 덮어쓰기는 없어요.
- **UI 연결:** 설정 화면 연결은 Master 후속이에요. 지금 화면은 새 필드를 쓰지 않아요. 그래서 이 상태로도 "마지막 성공"은 복원본 로컬 기준으로 바르게 바뀌지만, 복원 선택 목록에는 아직 `inherited`·파일 없는 행이 그대로 보여요.
