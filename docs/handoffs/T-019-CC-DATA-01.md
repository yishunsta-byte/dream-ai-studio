# T-019 · 복원본의 기존 백업 선택 정책 데이터 확인 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-019 / T-016 (디자인 `msg_87313a35822e` 3번 확인) |
| 담당 / 플랫폼 | CC-DATA-01 · Claude Code CLI (Windows) · Orca `term_a0a6f98c-c4ca-405a-9a7e-9fb263d26390` |
| 지시 | Master `msg_296303943a1d`, 수락 회신 `msg_7d4d639f83a3` |
| 기준 | 시작 HEAD `be88922`. 검토 중 HEAD가 `b39838d`로 바뀜. 바뀐 코드는 `app/(studio)/settings/page.tsx`·`components/settings-panel.tsx` 표시 2줄(51a3df4, 이름표 "복원으로 멈춤"·출처 날짜 중복 정리)뿐이고 `lib/services`·`lib/backup` 차이 0 |
| 상태 | ready_review (읽기 검토와 가상 재현만, 개발 완료 판정 아님) |
| 바꾼 파일 | 이 파일 하나. 코드·공용 문서·실제 data/storage/backups·기존 fixture DB는 읽지도 바꾸지도 않음 |

## 1. 결론 요약

1. **기존 백업 경로 바깥 읽기 자체는 안전해요(의도대로 유지 권장).** 성공 행·meta·zip 해시·크기·manifest ID·DB 해시·파일 목록 해시를 모두 맞춰 본 뒤 읽기만 해요. 재현에서 원래 백업 파일·원래 DB·원래 storage 모두 그대로였어요.
2. **표시 문제 1건 (T019-1, 중간, 재현됨, 사용자 확인 전 수정 권장 → 필수 여부는 Master 판단).** 복원본의 "마지막 성공"이 **원래 환경에서 만든 백업**을 가리켜요. 복원본 자신은 아직 백업이 하나도 없는데 보호받는 것처럼 보여요. 다른 PC에서는 그 파일이 아예 없어도 똑같이 "성공·검증됨"으로 보여요.
3. **오류 문구 1건 (T019-2, 낮음, 재현됨, 권장).** 다른 PC에서 파일이 없으면 "복원 검사 정보나 파일이 달라요. 다시 검사해 주세요."가 나와요. 다시 검사해도 해결되지 않아요. 성공으로 잘못 보이지는 않아요.
4. **경계 1건 (T019-3, 중간, 재현됨, 권장).** 같은 PC의 복원본에서 복원할 때, 목적지가 **원래 환경의 data·storage 폴더 안**이어도 막지 않아요. 기존 파일을 덮어쓰지는 않지만, 원래 환경 폴더 안에 복원본 전체(DB 포함)가 새로 생기고 원래 환경의 다음 백업에 그대로 딸려 들어가요.

## 2. 실제로 읽은 범위

| 자료 | 범위 |
|---|---|
| `lib/services/restore.ts` | 전부 (inspect·boundary·normalize·finish) |
| `lib/services/backups.ts` | 전부 (request·list·runClaimedBackup) |
| `lib/backup/paths.ts`·`schema.ts` | 전부 |
| `lib/backup/archive.ts` | `storageInventory` 부분만 |
| `lib/services/history.ts` | `restoreInformation`·`readRestoreInformation` 줄만 |
| `app/(studio)/settings/page.tsx`, `components/settings-panel.tsx` | HEAD `b39838d` 기준 diff 부분과 백업 목록·복원 선택 줄 |
| `lib/repo/maintenance.ts` | 백업 삭제 경로 검색만 (삭제·정리 코드 없음 확인) |
| 기존 테스트 | `tests/restore.test.ts`·`backup-service.test.ts`·`backup-paths.test.ts` 실행만: 3파일 44검사 통과 |

읽지 않은 것: `docs/PLAN.md`·`REVIEW.md` 이번 회차 갱신분, API 라우트(`app/api/restore/*`)의 오류 변환 부분. API가 오류 코드를 다른 문구로 바꾼다면 T019-2의 화면 문구는 달라질 수 있어요(미확인).

## 3. 재현 (OS 임시 가상 fixture만)

- 위치: 세션 scratchpad `t019/t019.repro.test.ts`, `t019/vitest.config.mjs` (T-014와 같은 방식, `server-only`는 빈 모듈). 모든 폴더는 `os.tmpdir()/t019-repro-*` 안에서 만들고 끝나면 지웠어요.
- 공통 준비: 원래 환경 `source`에 자료 1개 → 백업 B1 성공 → 1시간 뒤 백업 B2 성공 → B2에서 `restored`로 복원 → 이후 `DREAM_DATA_ROOT=restored`로 바꿔 복원본 DB로 서비스 실행.

| # | 장면 | 관찰 결과 |
|---|---|---|
| A | 복원본 백업 목록 | B1 `succeeded`, 경로 `source\backups\B1.zip`(원래 환경). B2 `failed / RESTORE_INTERRUPTED`. `lastSuccess`=**B1**, 복원 선택 후보=**B1**. 복원본 백업 폴더 설정은 `restored\backups` |
| B | 복원본에서 B1을 새 폴더로 복원 | 복원 완료. 원래 B1.zip 해시·수정 시각 그대로, 원래 DB 해시 그대로, 원래 storage 목록 그대로 |
| C | 다른 PC 흉내(원래 backups 폴더를 다른 곳으로 옮김) | 목록은 그대로 B1 `succeeded`, `lastSuccess`=B1. 검사는 `RESTORE_INVALID 409 "복원 검사 정보나 파일이 달라요. 다시 검사해 주세요."` |
| D | 같은 경로에 다른 백업 zip을 놓음 | `RESTORE_INVALID`로 거부 (해시 검증 작동) |
| E | 복원본에서 목적지를 `source\storage\restored-inside`, `source\data\inside`로 지정 | **둘 다 복원 완료.** 원래 storage 목록이 1개 → 4개로 늘고 복원본 DB(`restored-inside/data/app.db`)가 포함됨 |

## 4. 질문별 확인

### 4.1 기존 백업 경로 바깥 읽기가 검증·경계·원본 불변을 지키는가

**의도·안전: 지킴 (A·B·D 근거).**
- `restore.ts` inspect: 백업 행이 `succeeded`이고 `backup.<id>.meta`가 있어야 해요. 파일이 일반 파일인지(링크 거부), zip 해시·크기가 meta와 같은지, manifest의 backupId·DB 해시·파일 목록 해시·파일 수가 행과 같은지 모두 확인해요. 그 뒤 압축 풀기 단계에서 파일마다 해시를 다시 맞춰요.
- 원래 백업 파일에는 읽기만 해요(`lstat`·`fileDigest`·`readBackupManifest`·`verifyBackupArchive`). 쓰기·이름 바꾸기·삭제 코드가 없어요. 백업 정리·삭제 기능도 코드에 없어요.
- 목적지 경계: 현재 실행 환경(복원본)의 data·storage·backups·소스 폴더, 그리고 그 백업 파일이 있는 폴더(`dirname(backup.path)`)·설정된 백업 폴더와 겹치면 막아요.

**빈틈 (E 근거, T019-3).** 경계 목록에 **원래 환경의 data·storage**가 없어요. 복원본은 원래 환경의 위치를 모르기 때문이에요(manifest·restore.info에 원래 루트 경로가 없음). 그래서 같은 PC에서 원래 환경 폴더 안을 목적지로 적으면 통과해요. 비어 있는 새 폴더만 허용하므로 기존 파일 덮어쓰기는 없어요. 대신:
- 원래 환경 storage 안에 복원본 전체가 생기고, 원래 환경의 `storageInventory`가 이를 그대로 모아 다음 백업 크기가 커져요.
- 원래 환경 `data` 안에도 폴더가 생겨요(원래 앱 DB 파일은 그대로).
- 사용자가 직접 그런 경로를 적어야 생기는 일이라 빈도는 낮아요.

### 4.2 다른 PC에서 파일이 없을 때

- **오류: 나요. 다만 문구가 맞지 않아요 (C 근거, T019-2).** `inspectInternal`의 `lstat(record.path)`가 try 밖에서 ENOENT를 던지고, 바깥 `inspect`가 이를 `RESTORE_INVALID`("…다시 검사해 주세요.")로 바꿔요. 다시 검사해도 같은 결과예요.
- **복원 자체를 성공으로 잘못 보이는 경우: 없음.** 파일이 없거나 내용이 다르면 검사 단계에서 멈춰요(C·D).
- **목록의 성공 오표시: 있음 (C 근거, T019-1).** `list()`는 행 상태와 meta만 보고 파일이 있는지 보지 않아요. 그래서 파일이 없는 PC에서도 "검증됨 · N개", "마지막 성공: B1 시각"으로 보이고, 복원 선택 목록에도 올라와요.

### 4.3 이전 백업 이력과 복원본 백업을 최소한 어떻게 구분할까

**지금 상태 (A 근거).** 복원 선택 목록은 `날짜 · 자동/수동`만 보여요. 복원본에서 새로 만든 백업과 원래 환경에서 넘어온 백업을 구분할 수 없어요. 설정 상단 안내는 "아래 성공·실패 시각은 이 복원본에 기록된 백업 작업 기준"이라고 하지만, 실제로는 **원래 환경에서 만든 백업 행**이 마지막 성공으로 잡혀요. 출처 백업(B2)보다 오래된 B1이 "마지막 성공"으로 보여 안내와 숫자가 서로 어긋나요.

**구분 기준(데이터).**
- 정확한 방법: 복원 확정(`normalize`) 때 복원본 DB에 남아 있던 백업 ID 목록을 기록해 두는 것(예: DB 설정 `restore.info`에 `inheritedBackupIds` 추가. 디스크의 `restore-info.json` 표시 파일은 바꾸지 않아도 됨. `history.ts`는 느슨한 `z.object`라 추가 필드를 받아들여요).
- 이미 만든 복원본까지 다루는 대체 방법: `createdAt <= restore.info.backupCreatedAt`이면 이전 환경 기록으로 봐요. 근거: `request()`는 진행 중 백업이 있으면 새 행을 만들지 않으므로, 출처 백업 행 이후 스냅샷 전까지 다른 백업 행이 생길 수 없어요. 한계: 새 PC 시계가 원래 PC보다 늦으면 복원본의 새 백업이 이전 기록으로 잘못 분류될 수 있어요.

**최소 표시안.**
1. 백업 행에 `inherited`(이전 환경 기록) 표시를 내려 주고, 이름표 "이전 환경 백업"을 붙여요. "검증됨" 대신 "원래 환경에서 검증됨"처럼 검증한 곳을 밝혀요.
2. "마지막 성공"은 **이 복원본에서 만든 성공 백업만** 세요. 없으면 "이 복원본의 백업은 아직 없어요"로 보여요. 원래 환경 기록은 필요하면 따로 "이전 환경 마지막 백업: 날짜"로 보여 줘요. 기존 failed 이력과 lastSuccess null 원칙(T-014)과도 맞아요.
3. 복원 선택 목록에서 이전 환경 백업은 그룹이나 문구로 구분하고 "원래 백업 파일이 이 PC의 같은 위치에 있어야 해요"를 붙여요. 빼 버리는 것보다 구분 표시를 권해요. 같은 PC에서는 B처럼 정상 복원되기 때문이에요.

## 5. 권장 사항과 필수 여부

| ID | 내용 | 심각도 | 재현 | 권장 조치 | 필수 여부(제안) |
|---|---|---|---|---|---|
| T019-1 | 복원본의 마지막 성공·검증됨이 원래 환경 백업을 가리킴, 파일 없는 PC에서도 성공 표시 | 중간 | A·C | 4.3의 1·2: `inherited` 표시, lastSuccess에서 제외 | **은영님 흐름 확인 전 수정 권장.** "완료가 아닌 것을 완료로 표시 금지" 원칙에 가까워요. 최종 판정은 Master |
| T019-2 | 파일 없음이 "다시 검사해 주세요"로 보임 | 낮음 | C | ENOENT를 별도 코드로 구분: "이 백업 파일을 이 PC에서 찾지 못했어요. 원래 백업 파일 위치를 확인해 주세요." 선택적으로 `list()`에서 파일 존재를 가볍게 확인해 "파일 없음" 표시 | 권장 (P1 안 선택) |
| T019-3 | 복원본에서 원래 환경 data·storage 안으로 복원 가능 | 중간 | E | 이전 환경 백업으로 복원할 때 `dirname(dirname(record.path))`(기본 배치의 원래 루트)도 경계에 넣거나, 목적지 상위에 `data/app.db`가 있는 폴더(다른 Dream 데이터 폴더)를 거부. 기본 배치가 아닌 백업 폴더에서는 앞 방법이 안 맞으니 뒤 방법이 더 넓어요 | 권장. 덮어쓰기는 없어 절대 규칙 위반은 아니에요. P1 안/후속은 Master 판단 |

참고(낮음, 재현 안 함): 복원본에서 백업 저장 폴더를 원래 환경의 `backups`로 바꾸는 것도 같은 이유로 막히지 않아요(`validateBackupDirectory`가 현재 환경 경계만 봄). 새 ID라 덮어쓰기는 없어요.

## 6. 하지 않은 것

- 코드·공용 문서 수정 없음. 위 권장안은 실행하지 않았어요.
- 실제 사용자 data/storage/backups, 기존 fixture DB 접근 없음.
- 화면(1280·390px) 확인은 하지 않았어요. 표시 관찰은 `list()` 반환값과 컴포넌트 코드 기준이에요.
- 실제 다른 PC에서의 확인은 없어요. C는 폴더를 옮겨 흉내 낸 결과예요.
