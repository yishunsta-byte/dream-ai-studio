# T-014 · 데이터 구현 대조 검토 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-014 / P1 종료 (운영 우선순위 P1) |
| 담당 / 플랫폼 | CC-DATA-01 · Claude Code CLI (Windows) · Orca `term_a0a6f98c-c4ca-405a-9a7e-9fb263d26390` |
| 지시 | Master `msg_d67f28a43286`, 수락 회신 `msg_2fb6c6de8f77` |
| 기준 | 시작 HEAD `c4072b9`. 검토 중 HEAD가 `7bfb3fb`(문서 커밋 2개)로 바뀌었으나 `lib/ tests/ app/ worker/` 코드 차이 0 확인 |
| 상태 | ready_review (자료 분석만, 개발 완료 판정 아님) |
| 바꾼 파일 | 이 파일 하나. 코드·공용 문서·실제 data/storage/backups는 읽지도 바꾸지도 않음 |

## 1. 결론 요약

- **현재 P1을 막는 새 필수 결함: 없음.** 독립 검수의 F-016-1/2 게이트는 그대로예요.
- **P1 안에서 고치길 권하는 것 1건 (D-1, 중간, 재현됨).** 복원본에서, 복원에 쓴 백업 자신이 "실패/취소했어요"로 보이고 "마지막 성공 백업 없음"으로 표시돼요. 데이터는 손상되지 않지만 복원본의 기록을 잘못 읽게 만들어요.
- **P2 진입 전에 정해야 할 것 1건 (D-3, 후속 높음).** 지금 복원은 마이그레이션 기록이 완전히 같을 때만 허용해요. P2에서 마이그레이션을 하나만 추가해도 **P1 시절 백업을 모두 복원할 수 없게** 돼요.
- 나머지 7건은 낮음·후속이에요 (D-2, D-4~D-9).

## 2. 실제로 읽은 범위

| 자료 | 범위 |
|---|---|
| `AI_TEAM_RULES.md`, `docs/team/CLAUDE_ROLES.md` | 전부 |
| `docs/PLAN.md` | 5장(도메인 규칙)·7장·9장·10장·14장·18장·19장 전부. 그 외 장은 안 읽음 |
| `docs/REVIEW.md` | 열린 필수 수정과 판정 부분(1~37행)과 일부 검색 결과. 과거 회차 전체는 안 읽음 |
| `docs/PROGRESS.md` | P1-9 부분(3~12행)만 |
| 스키마·마이그레이션 | `lib/db/schema.ts`(기본값 부분), `migrations/0001~0004.sql` 전부, `migrate.ts`·`connection.ts`·`server.ts`·`json.ts`·`seed.ts`, `scripts/db.ts` |
| 백업·복원 | `lib/backup/schema.ts`·`paths.ts`·`archive.ts`, `lib/services/backups.ts`·`restore.ts` 전부 |
| 기록·작업 | `lib/services/history.ts`·`jobs.ts`, `lib/repo/jobs.ts`·`maintenance.ts`, `lib/jobs/schema.ts`·`runner.ts`, `worker/main.ts`(자동 백업 호출 줄) 전부 |
| 테스트 | `tests/restore.test.ts`는 읽음. backup-*/history/jobs 테스트는 실행만, 내용은 검색으로 일부만 봄 |
| 안 읽은 것 | `lib/services/exports.ts`·`review.ts`·`production.ts` 등 다른 서비스, 화면 코드, `docs/handoffs/T-007~T-011` 본문(T-008만 검색), 실제 `data/app.db` (금지 범위) |

## 3. 검증 명령과 결과

1. 기존 데이터 테스트 7개 파일:
   `npx vitest run tests/backup-archive.test.ts tests/backup-immutability.test.ts tests/backup-paths.test.ts tests/backup-service.test.ts tests/history.test.ts tests/jobs.test.ts tests/restore.test.ts` → **7파일, 96검사 통과**
2. 재현 테스트(제 scratchpad, OS 임시 폴더 fixture만, 저장소 파일은 만들지 않음):
   `t014.repro.test.ts` + 별도 vitest 설정(root=저장소, `server-only`는 빈 모듈로 대체). 3건 실행, 결과는 4장에 적었어요. 재현 파일 원본: `C:\Users\Administrator\AppData\Local\Temp\claude\9c3bd76e69730906\72335754-dcf6-48fb-a814-8bb5d926afda\scratchpad\t014\t014.repro.test.ts`
3. 실행 후 `git status`에서 저장소 변경 없음을 확인했어요(이 보고서 작성 전 기준).

## 4. 발견 사항

표기: **사실** = 코드/실행으로 직접 확인 · **추정** = 코드 읽기로 추론 · **미확인** = 확인 못 함

### D-1 · 복원본에서, 복원에 쓴 백업이 "실패/취소"로 보임 — 중간 · 사실(재현) · P1 안 수정 권장

- **재현 결과 (R1):** 원본 DB의 백업 행은 `succeeded`였어요. 복원본에서는 같은 백업 행이 `failed / RESTORE_INTERRUPTED`, 그 작업은 `canceled / RESTORED_NOT_RESUMED`로 바뀌어 있었어요. 복원본 `backupService.list()` 결과는 `lastSuccess: null`, `lastFailure.error: "취소했어요."`였어요.
- **원인 (사실):**
  - `jobs.ts` claim 단계에서 `updateBackup(running)`을 한 다음, `backups.ts:39` `runClaimedBackup`이 **백업 행이 running인 상태로** DB 스냅샷을 떠요. 그래서 모든 백업 ZIP 안에는 그 백업 자신이 "실행 중"으로 저장돼 있어요.
  - 복원 시 `restore.ts:39` `normalize`가 T-006 규칙대로 running 백업을 failed로, 작업을 canceled로 바꿔요.
  - `backups.ts:31` `list()`의 오류 문구는 `job.status==="canceled"`를 `RESTORE_INTERRUPTED`보다 먼저 검사해요. 그래서 기준에 있는 "복원으로 중단된 백업이에요." 문구는 백업에서 절대 나오지 않고, "취소했어요."로 보여요.
- **영향:** 데이터 손상은 없고 V12(참조 유효)도 그대로 통과해요. 하지만 복원본을 연 사용자는 "이 데이터의 백업이 하나도 성공하지 않았다", "취소했다"로 잘못 읽어요. PLAN K-3("마지막 성공·실패 표시")의 의미와도 어긋나요.
- **수정 위치 제안 (구현은 CC-ENG-01):**
  1. `lib/services/restore.ts` `normalize`: `id = ticket.backupId`인 백업 행만 예외로 두고, 출처 백업으로 표시해요. 방법은 둘 중 하나예요.
     - (가) `status='succeeded'`, 원본의 `db_sha256`·`file_inventory_sha256`으로 채우고 `backup.<id>.meta`를 원본 값으로 넣기
     - (나) 새 오류 코드 없이 "이 복원본의 출처 백업" 표시만 하기
     - 그 백업의 작업도 canceled가 아니라 succeeded로 맞추기
  2. `lib/services/backups.ts:31`: `RESTORE_INTERRUPTED` 검사를 canceled보다 먼저 하도록 순서를 바꾸기
  3. `tests/restore.test.ts`에 "복원본에서 출처 백업이 성공으로 보인다"는 검사 추가
- **기준 해석:** T-006 문구("실행 중이던 백업은 failed")를 글자 그대로 따른 결과예요. 출처 백업이라는 특수한 경우는 기준에 빠져 있었어요. 문구 보완은 기준 문서 담당(Claude design)이 하면 되고, 은영님 결정은 필요 없다고 봐요.

### D-2 · 자동 백업 등록이 "사용자" 행동으로 기록됨 — 낮음 · 사실(재현)

- **R2:** worker가 부른 `enqueueAuto()`의 기록이 `actor:"local-user"`로 남아 기록 화면에 "사용자 · 백업 등록"으로 보였어요.
- 위치: `backups.ts:25` `request()`가 kind에 관계없이 `"local-user"`로 기록해요. auto일 때는 `"worker"`로 바꾸면 돼요.
- 참고(사실, 낮음): `history.ts` `historyLabel`은 제목에 `@`나 전화번호 모양이 있으면 숨겨요. 그래서 "@브랜드 캠페인" 같은 정상 제목도 "프로젝트"로만 보여요. 개인정보를 막으려는 의도 안의 과잉 가림이라 기록만 해 둬요.

### D-3 · 스키마 이관: 새 마이그레이션 1개만 생겨도 이전 백업을 모두 복원할 수 없음 — 후속 높음(P2 전) · 사실(코드) + 추정(영향)

- **사실:**
  - `archive.ts` `verifyRestoredDatabase`는 `verifyMigrations`를 불러요. 이 함수는 마이그레이션 개수·이름·해시가 **현재 코드와 완전히 같아야** 통과시켜요.
  - 그 뒤 manifest의 migrations와도 완전히 같은지 비교해요.
  - `backup/schema.ts`의 manifest는 `appVersion: z.literal("0.1.0")`, `schemaVersion: z.literal(1)`이라 앱 버전이 바뀌면 이전 ZIP의 manifest를 읽는 단계부터 실패해요.
- **추정 영향:** P2-1(`timeline_revisions`)에서 0005를 추가하는 순간, P1 기간에 만든 백업은 "지원 안 되는 스키마"로 전부 거부돼요. PLAN K-5의 "지원 안 되는 버전 거부"와 글자로는 맞지만, 백업이 사실상 다음 마이그레이션 전까지만 쓸모 있게 돼요.
- **같이 볼 것:**
  - PROGRESS P1-9에 따르면 "0004는 실제 앱 DB에 아직 미적용"이에요(실제 DB는 제가 열지 않아 **미확인**).
  - `scripts/db.ts` migrate는 한 트랜잭션이라 실패하면 되돌려지지만, 적용 전에 스냅샷을 따로 남기지는 않아요. 0004는 트리거뿐이라 위험이 낮아요. 하지만 P2의 settings→`timeline_revisions` 데이터 이관(PLAN 7.1 T-002)부터는 이관 전 스냅샷이 필요해요.
- **추천:**
  - 복원할 때 "백업 쪽 마이그레이션 기록이 현재 기록의 **앞부분과 정확히 같으면**, staging 복사본에 남은 마이그레이션을 적용한 뒤 검증"하는 단계를 둬요.
  - manifest의 `appVersion`은 정확히 같은 값 대신 지원 범위로 바꿔요.
  - migrate 전에 `VACUUM INTO`로 스냅샷을 남겨요.
  - 이 3가지를 P2-1의 완료 기준과 테스트에 넣어요.
- **결정 필요 여부:** "P2 이후에도 P1 백업을 복원할 수 있어야 하는가"는 K-5의 범위 문제예요. 저는 "예"(앞부분이 같을 때만 올려서 복원)를 추천해요. Master가 기존 승인 범위로 판단하기 어려우면 DEC로 올려 주세요.

### D-4 · 실패·취소·복원 중단된 생성 기록이 끝나지 않은 상태로 남음 — 낮음(P1) / 후속 높음(P3) · 사실(코드)

- `jobs.ts`의 `fail()`·`canceled()`·`cancel()`과 `restore.ts` `normalize`는 `generations`를 건드리지 않아요. 그래서 실패·취소된 생성은 `finished_at=NULL`, `settlement='none'`으로 남아요.
- P1은 mock이라 비용이 0이어서 지금 영향은 없어요. P3에서 `reserved` 정산이 생기면 실패·취소·복원본의 예약금이 풀리지 않고 남아 **예산이 이중으로 잡힐 수** 있어요(추정).
- 추천: P3-1 전에 작업이 끝나는 모든 경로(실패·취소·복원 정규화)에서 같은 트랜잭션 안에 `finished_at`과 정산 상태(`refunded`/`none`)를 정리하고, 테스트를 붙여요.

### D-5 · 기록 페이지 정렬 기준이 시간 하나뿐 — 낮음 · 재현 안 됨

- `maintenance.ts`의 `activityPage`·`generationPage`는 `created_at`/`started_at` 하나로만 정렬하고 50개씩 건너뛰며 읽어요. 같은 트랜잭션의 기록은 시각이 같을 수 있어요.
- **R3:** 같은 시각 120건을 3페이지로 읽었더니 120건 모두 중복·누락 없이 나왔어요. **실제 문제는 재현 안 됨.** 다만 SQLite가 같은 순서를 보장하지는 않아요.
- 추천: 2차 정렬로 `id DESC`(UUID v7)를 추가해요.

### D-6 · settings가 끝없이 늘어남 — 낮음 · 사실(코드)

- `job.<id>.startedAt`이 작업마다 1행씩 생기고 지우지 않아요(`jobs.ts` claim).
- `restore.check.<id>` 티켓에는 manifest 전체(파일 최대 10,000개)와 절대 경로(목적지·staging)가 들어 있어요. 완료 후에도 원본 DB에 계속 남고, 다음 백업마다 함께 들어가요. 복원본에서는 `normalize`가 지워요.
- 추천: 작업이 끝나면 timer 행을 지우고, 완료·실패 티켓은 요약만 남겨요.

### D-7 · 백업 파일 수 상한 10,000개 — 낮음(규모) · 사실(코드)

- `archive.ts` `storageInventory`와 `backup/schema.ts`의 `files.max(10000)` 때문에, storage 파일이 10,000개를 넘으면 **백업 전체가 실패**해요.
- 생성 1건마다 파일이 1개 이상 생겨요. 실제 사용량은 모르니(**미확인**) P3 실사용 전에 상한을 다시 정하고 화면에 남은 여유를 보여 주길 권해요.

### D-8 · DB 수준의 보호가 빠진 곳 — 낮음 · 사실(코드), 현재 코드 경로에서는 발생 안 함

- `assets`·`generations`·`jobs`·`review_items`·`projects`에는 DELETE 보호 트리거가 없어요. 참조되는 행만 FK RESTRICT가 막아요.
- 지난 revision의 `review_items`, 아직 성공하지 않은 `jobs.input_snapshot_json`·`scene_versions.input_snapshot_json`, `assets.source_url`·`title`은 DB 수준에서 수정할 수 있어요.
- `jobs.kind`에는 CHECK 제약이 없어요.
- 코드 전체에서 DELETE는 `restore.ts` normalize의 settings 정리 1곳뿐이라 **지금은 안전해요**(검색으로 확인).
- 추천: P3에서 비용·재현성이 걸리기 전에 입력 스냅샷 불변 트리거와 `jobs.kind` CHECK를 추가해요.

### D-9 · 링크 자료의 생성 참조 스냅샷에 주소가 없음 — 낮음(P1) · 사실(코드)

- `generationInputSchema.refs`에는 `id`, `sha256`(링크는 null), `rightsNote`만 들어가요. 그런데 `assets.source_url`은 바꿀 수 있어요.
- 그래서 링크를 참조한 생성은 "당시 어떤 주소였는지"를 다시 알 수 없어요. P1은 링크를 받아오지 않아서(F-7) 영향은 P3부터예요.
- 추천: P3에서 링크를 쓸 때 refs에 `sourceUrl`을 넣어요.

### 참고 · 미확인 추정 (CC-ENG-01 확인용)

- `jobs.ts` `recover()`는 backup이 아닌 작업을 횟수 검사 없이 queued로 되돌리고, `claim()`은 매번 `attempts`를 1씩 올려요. 그래서 처리 중에 worker가 반복해서 죽으면 generate 작업의 `attempts`가 `max_attempts`를 넘어 계속 돌 수 있어 보여요. 재현은 하지 않았어요.
- 복원본 활동 기록 `restore.completed`에는 `pendingJobs` 개수만 남아요. 바뀐 내보내기·백업 행 수는 기록되지 않아요(PLAN K-5 "바꾼 내용 기록"의 일부만 충족).

## 5. 기준-코드 대조표 (괜찮음 확인)

| 기준 | 구현 위치 | 판정 |
|---|---|---|
| 7장 UUID v7·UTC ISO·JSON 검증 | `schema.ts` 기본값, `0001` `json_valid` | 맞음 |
| 7장 금액 정수 마이크로 + 통화 | `0001` 정수 CHECK, `0002` 통화 3글자 트리거 | 맞음 |
| 5.3 승인 기획·완료 버전·완료 내보내기 불변 | `0001` UPDATE 트리거 + `0004` DELETE 트리거, `recursive_triggers` 강제(`connection.ts`) | 맞음 |
| 5.3 선택 버전은 같은 장면의 succeeded만 | `selected_version_guard`·insert guard | 맞음 (파일 존재는 서비스 `storedFileExists`) |
| 소유 관계(기획·장면·단계 같은 프로젝트) | `0002` 트리거 | 맞음 |
| S4 revision은 줄지 않음 | `revision_monotonic` | 맞음 |
| 7.1 T-002 글자 스냅샷은 추가만 | `0003` 트리거, 복원 때 스키마 재검증 | 맞음 |
| 활동 기록 추가만·성공 백업·메타 불변·생성 입력 불변 | `0004` | 맞음 (D-8 빈 곳 제외) |
| 9장 중복 방지 | generate: 장면+종류+입력해시 / backup: 진행 중 1개·자동 날짜 키 | 맞음 |
| K-1 일관 스냅샷 | `sqlite.backup` | 맞음 |
| K-2 DB+인벤토리+파일, `.env`·tmp 제외 | `storageInventory`, 캡처한 DB로 참조 대조 | 맞음 |
| K-3 하루 1회·놓친 날 처리·성공/실패 표시 | `worker/main.ts`→`enqueueAuto`, `seoulDay` | 맞음. 같은 날 자동 백업이 최종 실패·취소되면 그날은 다시 만들지 않는 설계(T-008에 기록됨) |
| K-5 / T-003 새 빈 폴더에만 복원 | `validateRestoreTarget`, staging→rename, 원본 불변(테스트) | 맞음 |
| K-5 / T-006 복원본 정규화 | `normalize`: canceled `RESTORED_NOT_RESUMED`, failed `RESTORE_INTERRUPTED`, `backup.directory=<복원>/backups`, `restore.info`, 활동 기록 | 맞음. 단 D-1 |
| 복원 검증 | 해시·크기·별칭·여분·누락 항목, WAL 주입 거부, `integrity_check`, FK 검사, 파일 참조 대조 | 맞음 |
| 기록 가림 | 경로·키·이메일·전화 가림, 오류 원문 대신 고정 문구, 입력은 일부 필드만 | 맞음 (D-2 과잉 가림 참고) |
| V12 격리 복원 후 참조 유효 | `restore.test.ts` + R1 재현에서도 성공 | 맞음 |

## 6. 우선순위 정리

| 구분 | 항목 | 담당 제안 |
|---|---|---|
| 현재 P1 차단 | 없음 (기존 F-016-1/2·V13 유지) | — |
| P1 안 권장 | D-1 (+ D-2는 같이 고치면 쉬움) | CC-ENG-01 구현, Claude design이 T-006 문구 보완, Master 통합·재검수 |
| P2 진입 전 | D-3 이관 방식 결정과 P2-1 완료 기준 반영 | Master(필요하면 DEC), Claude design(PLAN) |
| P3 전 | D-4, D-8 입력 스냅샷 불변, D-9 | CC-ENG-01 |
| 개선 | D-5, D-6, D-7 | CC-ENG-01 |
| 은영님 결정 필요 | D-3만 해당할 수 있음 (Master 판단) | — |

## 7. 한계

- 실제 사용자 데이터는 열지 않아서 실데이터 건수, 0004 적용 여부, 실제 중복·누락은 **미확인**이에요.
- 대용량, 디스크 부족, 전원 차단, Windows 경쟁 상태는 검토하지 않았어요.
- exports/review/production 서비스는 범위 밖이라 읽지 않았어요.

## 8. 다음 담당자 할 일

1. **Master:** D-1을 P1 안에서 처리할지 정하고, 처리한다면 CC-ENG-01에 배정해 주세요. D-3은 P2 진입 조건에 넣을지 판단하고, 필요하면 DEC로 올려 주세요.
2. **CC-ENG-01:** D-1·D-2 수정과 테스트 추가(4장의 위치 참고), `recover()`의 attempts 상한 추정 확인.
3. **Claude design:** PLAN K-5/T-006에 "출처 백업은 성공으로 유지" 문구를 넣고, D-3이 정해지면 P2-1 완료 기준을 보완해 주세요.
