# T-034 · K-6 고정 백업 s4 회귀 fixture 설계 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 작업 ID | T-034 (차기 준비 · 데이터 설계만) |
| 지시 | Master `msg_c18d83f39a97`, 수락·점유 회신 `msg_fabe058d2c36` |
| 기준 HEAD | `b9c926c` 이후 Master 커밋 상태(수락 시점 HEAD는 회신에 기록) |
| 상태 | **명세만.** 코드·SQL·fixture·ZIP을 만들지 않았고, 이관도 실행하지 않았어요. P2 착수나 승인이 아니에요. 사용자 흐름 확인과 시안 승인 대기는 그대로예요 |
| 바꾼 파일 | 이 파일 하나 |

## 0. 읽은 범위와 직접 계산한 것

| 자료 | 범위 |
|---|---|
| `docs/PLAN.md` | 14장 K-6 표 줄(530행), 18장 P2-1 줄(604행), 변경 이력 v2.4 보완(728행) |
| `docs/handoffs/T-017-CC-DESIGN-01.md` | 3장 전부(3.1~3.7) |
| `lib/db/migrations/0001~0004.sql` | 테이블·인덱스·트리거 목록(CREATE 줄 전부) |
| `lib/db/migrate.ts` | 전부. 해시는 CRLF→LF 정규화 후 sha256. `__schema_migrations.applied_at`은 실행 시각 |
| `lib/db/seed.ts`, `scripts/db.ts` | 전부. seed는 `v7()`·`new Date()` 사용 → 실행마다 다른 값 |
| `lib/backup/archive.ts` | `inventoryHash`, `verifyStagingFiles`(55~59행). 현재는 마이그레이션 **완전 일치**만 받고, 그다음 `integrity_check`·`foreign_key_check`·글자 스냅샷 스키마 검사를 해요 |
| `lib/backup/schema.ts`, `lib/services/backups.ts`, `lib/services/restore.ts` | T-019/T-021에서 전부 읽음(이번에 바뀐 곳 없음) |
| `lib/export/zip.ts` | `writeArchive`/`writeZip`: `zip.entry(stream,{name,store:true})`에 날짜를 넘기지 않음 → **ZIP 항목 시각이 실행 시각** |
| `lib/providers/mock.ts` 13행 | 샘플 PNG는 `sharp`가 SVG를 시스템 글꼴(Malgun Gothic)로 그려서 만듦 → 바이트가 플랫폼·글꼴에 따라 달라짐 |
| 기존 테스트 | `tests/restore.test.ts`·`backup-service.test.ts`·`backup-origin.test.ts`·`jobs.test.ts`의 fixture 만드는 방식(임시 root, `process.cwd` mock, 직접 insert + 서비스 호출) |

직접 계산한 값(파일 읽기와 sha256만 사용, LF 정규화 후):

| version | name | sha256 | 바이트 |
|---|---|---|---|
| 1 | 0001_initial.sql | `ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0` | 17,251 |
| 2 | 0002_ownership.sql | `6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed` | 2,214 |
| 3 | 0003_edit_snapshots.sql | `9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e` | 402 |
| 4 | 0004_audit_backups.sql | `6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3` | 1,757 |

이 4줄이 s4의 기대 마이그레이션 기록이에요. 현재 라이브러리 버전은 better-sqlite3 13.2.0(SQLite 3.54.1), zip-stream 7.0.5, yauzl 3.4.0, sharp 0.35.5예요.

## 1. 핵심 결정 (추천)

### 1.1 무엇을 고정하나 — 해시 4단계

| 층 | 무엇 | 다시 만들 때 같아야 하나 | 이유 |
|---|---|---|---|
| H1 보관 파일 | 커밋한 `tests/fixtures/backups/s4.zip`의 sha256·바이트 수 | **아니요.** 한 번 만든 파일을 보관 원본으로 삼아요 | ZIP 항목 시각이 실행 시각이에요(`writeArchive`에 날짜 인자 없음). SQLite 파일 바이트도 버전·페이지 배치·헤더(변경 카운터, SQLite 버전 번호)에 따라 달라질 수 있어요. 그래서 "다시 만들어도 같은 ZIP"은 약속할 수 없어요. 커밋한 파일이 바뀌지 않았는지만 지켜요 |
| H2 ZIP 안 기록 | manifest `database.sha256`·`inventorySha256`·파일별 sha256, 마이그레이션 4줄 | 저장 파일 해시·`inventorySha256`·마이그레이션은 **예**, `database.sha256`은 **아니요** | 저장 파일은 생성기 소스에 바이트 그대로 넣은 상수라 어디서나 같아요. DB 파일 바이트는 위 이유로 고정하지 않아요 |
| H3 논리 내용 | 표마다 정해진 직렬화(2장)의 sha256 + 전체 묶음 해시 | **예** (플랫폼·SQLite 버전과 무관해야 함) | "같은 입력 같은 결과", "백업 복원 = 직접 migrate", "사용자 입력 보존"을 비교하는 기준이에요 |
| H4 스키마 | `sqlite_master`(type, name, tbl_name, sql) 정렬 목록 sha256 | 같은 마이그레이션이면 **예** | 마이그레이션 SQL 문자열이 그대로 저장돼요 |

**결론:**
- 회귀 시험의 동등성 판정은 **H3**로 해요.
- 보관 원본이 바뀌지 않았는지는 **H1**로 지켜요.
- 생성기를 다시 돌린 결과(재현 검사)는 H2(저장 파일·인벤토리·마이그레이션)와 H3가 기록과 같은지만 봐요. H1과 DB 해시는 재현 대상이 아니에요.

### 1.2 결정적 값과 사용자 입력값을 나눠요

| 구분 | 누가 정하나 | 규칙 | 이관에서 기대하는 것 |
|---|---|---|---|
| 생성기 값 (ID·시각·순서) | 생성기 | 라벨에서 결정적으로 만들어요(1.3). 실행 시각·난수 없음 | 이관이 새 ID를 만들면 원래 행 ID에서 결정적으로(K-6 ⑤). 옛 ID는 바꾸지 않아요 |
| 사용자 입력값 (제목·대본·대사·자막·검수 메모·권리 메모·입력 JSON 값) | fixture 상수표 `S4_INPUTS` | 생성기 소스에 문자열 상수로 둬요. **어떤 정규화도 하지 않아요** | UTF-8 바이트까지 그대로. H3의 입력값 표에서 따로 대조해요 |
| 시스템 파생값 (해시·크기·manifest·스냅샷 JSON) | 실제 함수(`fileDigest`, `inventoryHash`, `editSnapshotSchema`, `manifestSchema`) | 생성기가 직접 계산하지 않고 앱 함수를 불러요 | 다시 계산하면 같은 값 |
| 메뉴 스냅샷 | 생성 시점 `docs/spec/menus.json` | `projects.template_snapshot_json`에 그때 값 그대로 | 이후 menus.json이 바뀌어도 fixture는 그대로. 이것도 H3에 포함돼요 |

`S4_INPUTS`에는 보존 회귀용 경계 문자열을 일부러 넣어요(모두 가상).
- 한글 NFC와 같은 글자의 NFD 분해형(서로 다른 값으로 남아야 함)
- 이모지(서로게이트 쌍)와 ZWJ 결합 이모지
- 대본 안 CRLF·LF 섞임
- 탭, 앞뒤 공백, 빈 대사
- 따옴표·역슬래시·`<script>`처럼 보이는 글자
- JSON 특수 문자
- 자막 시간 소수(0.125, 2.5)
- 각 필드의 최대 길이 근처 값

**R10:** 실제 개인정보·키·실제 PC 경로는 넣지 않아요.

### 1.3 결정적 ID와 시각

- **시각:** 기준 `2026-01-05T00:00:00.000Z`에 라벨별 고정 오프셋(초)을 더해요. 만든 순서 = 시각 순서예요.
- **ID:** UUIDv7 형식이에요. 앞 48비트는 위 시각(ms)이고, 나머지 비트는 `sha256("dream-s4:" + 라벨)`에서 가져와요. version 니블 7과 variant `10`은 강제로 맞춰요. 그래서 `z.uuidv7()`을 통과하고, 시각 순서와 ID 순서가 같아요(일부 코드가 ID 정렬을 써요).
- **라벨:** 사람이 읽는 고정 이름이에요(예: `project.main`, `scene.main.1`, `version.main.1.v2`). 라벨 표가 곧 fixture 구성 명세예요.
- **`__schema_migrations.applied_at`:** `migrateDatabase`가 실행 시각을 넣어요. 생성기는 migrate 뒤 이 칸을 고정 시각으로 바꾸지 않아요(앱 함수 결과를 손대지 않음). 대신 H3에서 `applied_at`은 빼요.

### 1.4 저장 파일 바이트

- 샘플 생성기(`mockImage`=sharp+시스템 글꼴)는 쓰지 않아요.
- 결과·원본 파일은 생성기 소스에 넣은 **아주 작은 고정 바이트**로 만들어요. 예: 1×1~8×8 PNG(base64 상수), 짧은 텍스트, 무음 WAV 머리말.
- `assets.sha256`·`size_bytes`·`width/height`는 그 바이트에서 앱 함수로 계산해요.
- 미리보기 표시가 필요한 화면 시험은 이 fixture 범위가 아니에요.

### 1.5 백업 ZIP 조립 방식 (추천: 앱 함수 조립 + 실제 경로와 형식 대조)

`runClaimedBackup`을 그대로 쓰면 두 문제가 있어요.
- 백업 ID·작업 ID를 `request()`가 `v7()`로 만들어요.
- 스냅샷 안 `backups.path`·`backup.directory`에 **생성한 PC의 실제 임시 경로(사용자 이름 포함)**가 들어가요(R10 위험).

그래서 생성기는 아래 순서로 만들어요.

1. 임시 root에서 `migrateDatabase` → 결정적 행 삽입(3장) → `foreign_key_check`·`integrity_check`·`verifyMigrations` 통과를 확인해요.
2. 경로처럼 보이는 값은 모두 가상 경로 `C:\dream-s4\…`로 넣어요. 대상은 `backups.path`, `settings backup.directory`, `restore.info.destination` 같은 값이에요. 실제 PC 경로 문자열(`Users`, `AppData`, 사용자 이름, 임시 폴더)이 DB 텍스트·manifest 어디에도 없는지 검사해요.
3. s4 백업 행은 `running` 상태로, 그 backup 작업은 `running`·임대 중으로 직접 넣어요. 실제 `runClaimedBackup`이 스냅샷을 뜨는 순간과 같은 모양이에요(T-014 D-1에서 확인한 상태).
4. `sqlite.backup()`으로 `data/app.db` 스냅샷을 떠요. 그다음 `fileDigest`, `storageInventory`, `inventoryHash`, `backupManifestSchema.parse`, `writeArchive`를 그대로 불러요. 즉 runClaimedBackup과 같은 함수들이고, 54~55행과 같은 순서예요.
5. **형식 대조 시험:** 같은 임시 환경에서 실제 `runClaimedBackup`으로 만든 ZIP과 비교해요. 비교 대상은 항목 이름 규칙, manifest 키 집합과 순서, `schemaVersion`, `appVersion`, 저장 방식(store), ZIP64 여부예요. 다르면 실패해요. 그래야 조립 방식이 실제 형식에서 벗어나지 않아요.
6. 산출물: `s4.zip`, 기록 파일 `s4.json`(5장), 생성기 소스. **이번 작업에서는 만들지 않아요.**

## 2. 논리 내용 해시(H3) 정의

- **대상 표:** `sqlite_master`의 `type='table'` 중 `sqlite_%`를 뺀 전부를 이름순으로 해요. 미래 마이그레이션이 새 표를 더하면 비교 목적별 포함 표를 명시해요(4장).
- **열:** `PRAGMA table_info` cid 순서예요. **행:** 기본키 열 순서로 정렬해요. 모든 표에 기본키가 있지만, 없으면 rowid로 정렬하고 그 표 이름을 기록에 적어요.
- **값 직렬화:** `typeof()`를 함께 읽어요. 유형마다 아래처럼 써요.
  - null → `null`
  - integer → `{"i":"10진 문자열"}`
  - real → `{"r":"float64 16진"}`
  - text → `{"t":JSON 문자열}` (정규화 없음, 코드 단위 그대로)
  - blob → `{"b":"16진"}`
  - 이렇게 하면 `1`과 `'1'`, 정수와 실수가 구분돼요.
- **표 해시:** `sha256(표이름 + "\n" + 행마다 JSON 배열 + "\n")`이에요. **전체 해시:** 정렬한 `표이름=표해시` 줄의 sha256이에요.
- **비교용 제외 목록 (이름 붙인 집합으로 고정):**
  - `X_JOURNAL`: `__schema_migrations.applied_at`
  - `X_RUNTIME`: settings `worker.heartbeat`, `job.*.startedAt`, `restore.check.*`
  - `X_RESTORE`: 복원 정규화가 바꾸는 칸과 행(T-006·T-021). 대상은 아래와 같아요.
    - 표: jobs·scene_versions·exports·backups
    - settings: `backup.directory`, `backup.auto.lastDay`, `restore.info`
    - activity_log: `action='restore.completed'` 새 행
  - `X_NEWCOLS(n)`: 마이그레이션 n이 더한 새 표·새 칸 (그 마이그레이션 명세가 정함)
- **입력값 표(H3-U):** `S4_INPUTS`의 각 값이 어느 표·칸·JSON 경로에 있는지 정한 목록이에요. UTF-8 바이트 16진으로 대조해요. 이관 뒤 위치가 바뀌는 값(예: 0005가 settings 스냅샷을 새 표로 옮김)은 그 마이그레이션 명세에 "옛 위치 + 새 위치" 두 곳을 적고 둘 다 대조해요(옛 행은 지우지 않음, K-6 ⑤).

## 3. s4 데이터 구성 (가상)

복원·정규화·출처·내보내기 규칙을 모두 건드리도록 짜요. 괄호는 라벨 예시예요.

| 영역 | 구성 | 이유 |
|---|---|---|
| projects | `project.main`(모든 단계 진행, 광고 isAd=true, content_revision r5), `project.draft`(seed와 같은 초기 상태), `project.archived`(보관됨) | 진행·초기·보관 상태가 모두 있어야 이관이 빠뜨리지 않는지 볼 수 있어요 |
| stage_states | 세 프로젝트 × 메뉴 단계 전부, `approved_revision`·`approved_plan_id` 포함 | 0002 트리거 대상 |
| plans | main: v1 approved, v2 approved(현재), v3 draft. draft: 없음 | 승인 불변·삭제 금지 트리거, `plans_project_version` 유일성 |
| scenes | main: 3개(그중 1개 `archived_at`, 1개 `needs_recheck=1`). 위치 1..3 | 순서·보관·재확인 |
| scene_versions | 장면1: v1 succeeded(선택), v2 failed CONTENT_REJECTED, v3 succeeded 미선택. 장면2: v1 succeeded(선택), v2 canceled, v3 **queued**(일시 오류 대기 errorCode 있음). 장면3: v1 **running**(provider_job_id 있음) | 완료 불변·삭제 금지, 선택 가드, 복원 정규화(queued·running → canceled) |
| jobs | generate(succeeded/failed/queued/running), export(succeeded/failed STORAGE_FAILED/canceled), backup(B0 succeeded, **s4 자신 running**), `idempotency_key` 유일 | 정규화·재시도·D-1 상태 |
| generations | succeeded·failed 버전마다 1개, currency USD, cost 0, settlement 값 | 입력 불변 트리거(0004), 통화 가드 |
| assets | 원본 업로드 PNG 2개, 링크 자료 1개(파일 없음), 결과 PNG 4개(isMock=1), 보관 자료 1개. 권리 메모에 `S4_INPUTS` 문자열 | 파일 불변 트리거, 링크 자료 예외 |
| project_assets / characters / project_characters | 고정 캐릭터 1개(잠금 JSON·참조 자료 2개·음성 프로필) | 참조 무결성 |
| settings | `project.main.edit.<e1>`(이전), `.edit.<e2>`(현재), `.edit.current`→e2. 레이어에 광고 표기(잠김)+자막 2개(소수 시간). `backup.B0.meta`, `backup.<id>.origin`(T-021 표시, B0는 null), `backup.directory`(가상 경로), `worker.heartbeat`, `job.<id>.startedAt` | 글자 스냅샷 불변(0003), 백업 meta 불변(0004), 정규화 삭제 대상 |
| review_items | r4 전부 pass, r5 일부 보류(메모 있음) | `review_project_revision_item` 유일성 |
| exports | r4 succeeded(묶음 ZIP 파일 포함), r5 failed STORAGE_FAILED, 취소 1개 | 완료 불변·삭제 금지 |
| backups | B0 succeeded(가상 외부 경로, 파일 없음 → 복원본에서 inherited·available=false), s4 자신 running | T-019/T-021 출처 구분 |
| activity_log | 위 동작 기록 몇 줄(actor 3종) | 수정·삭제 금지 트리거 |
| storage | `library/…png`, `projects/<main>/scenes/…png`, `projects/<main>/exports/<r4>.zip` | 파일 참조 대조 |

**내보내기 r4 묶음 ZIP:** 이것도 `writeZip`의 시각 문제로 바이트가 매번 달라요. 그래서 `exports.sha256`과 묶음 ZIP 바이트는 **H3에서 빼고**, 대신 `verifyZip`(manifest 파일 해시 대조)이 통과하는지로 확인해요. 묶음 manifest JSON(`exportedAt` 고정)은 H3에 넣어요.

## 4. 회귀 행렬

표의 "현 코드(P1)" 열은 **코드를 읽고 한 예상이고 실행하지 않았어요.** 근거: `verifyStagingFiles` → `verifyMigrations` 완전 일치 요구, `backupManifestSchema.appVersion=z.literal("0.1.0")`.

변형본은 모두 **시험 시간에 OS 임시 폴더에서** 커밋한 s4.zip의 사본으로 만들어요. 원본은 읽기만 해요.

| # | 시험 | 입력 | 현 코드(P1) 예상 | K-6 구현 후 기대 | 확인할 것 |
|---|---|---|---|---|---|
| A1 | 보관 원본 | 커밋 s4.zip | — | — | H1 = `s4.json` 기록. manifest 스키마 통과, 마이그레이션 4줄 = 0장 표 |
| A2 | 같은 구조 복원 | s4 → 현재(4) | 성공 | `compat:"same"` 성공 | 복원본 H3(X_JOURNAL·X_RESTORE 제외) = 기록, H3-U 전부 일치, H4 = 기록. 정규화 결과: s4 행 RESTORE_INTERRUPTED, queued·running 버전 canceled, B0 inherited·available=false |
| A3 | 올려서 복원 | s4 → 현재(5+) | — | `upgrade` 성공 | 기존 표 H3(X_NEWCOLS 제외) 불변, H3-U 옛·새 위치 일치, 새 마이그레이션의 데이터 검사, `restore-info.json`에 schemaFrom 4 / schemaTo n |
| A4 | 같은 결과 | (a) s4 복원+올리기 (b) s4의 `data/app.db`를 직접 migrate한 뒤 같은 정규화 적용 | — | 같음 | H3 (a)=(b) (X_JOURNAL·restore.info·restore 활동 행 제외) |
| A5 | 두 번 해도 같음 | 같은 s4로 A3를 서로 다른 임시 폴더에서 두 번 | — | 같음 | 두 결과 H3 동일. 이관 코드에 시각·난수 없음(코드 sha256이 `__schema_migrations`에 기록됨) |
| B1 | 미래 버전 | 사본 DB와 manifest 둘 다에 0099 줄 추가 후 다시 묶음(meta 다시 계산) | 거부 RESTORE_INVALID | `BACKUP_TOO_NEW` | staging 없음, 목적지 없음 |
| B2 | 기록 다름 | 0002 sha256 한 글자 변경 / 3번 줄 삭제(1,2,4) / 이름만 변경 / `__schema_migrations` 표 없음 | 거부 | `BACKUP_SCHEMA_MISMATCH` | 각각 따로 |
| B3 | manifest ≠ DB | DB는 그대로, manifest `migrations`만 한 줄 다르게 | 거부 | `BACKUP_SCHEMA_MISMATCH` | |
| B4 | manifest 형식 | `schemaVersion:2` / `appVersion:"0.2.0"` | 둘 다 거부 | 2는 거부, 0.2.0은 **허용**(기록용) | K-6 ⑦ |
| C1 | ZIP 변조 | 사본 1바이트 바꿈(meta는 원래 값) | 거부 | 거부 | 원본·사본 해시 앞뒤 기록 |
| C2 | 항목 누락·추가·이름 | 저장 파일 하나 빼기 / 남는 파일 추가 / `../` 이름 | 거부 | 거부 | 기존 backup-archive 시험과 겹치는 부분은 그 시험을 재사용 |
| C3 | 파일 해시 다름 | 저장 파일 내용만 바꾸고 manifest 그대로 | 거부 | 거부 | |
| C4 | DB 무결성 | 사본 DB에서 FK 깨기(트리거 우회 없이 가능한 범위: `PRAGMA foreign_keys=OFF` 후 삭제) | 거부 | 거부 | |
| D1 | 중간 실패 격리 | K-6 3단계 각 지점에 시험용 실패 주입: 풀기 뒤 / 올리기 트랜잭션 안 / 올린 뒤 검사 / 정규화 / rename 직전 원본 해시 재대조 | 해당 지점만(정규화·rename) | `BACKUP_UPGRADE_FAILED` 등 | staging 지워짐, 목적지 없음, 원본 ZIP·현재 DB H3 앞뒤 같음, 티켓 failed, 남은 파일 0 |
| D2 | 변형끼리 격리 | 위 변형을 같은 시험 실행에서 연속 | — | — | 각 시험은 자기 임시 root만 사용. 커밋 s4.zip은 읽기 전용으로 열고 끝에 H1 재확인. 실패 하나가 다른 시험의 사본·DB에 남지 않음 |
| E1 | 이관 전 스냅샷 | s4 DB를 임시 런타임의 현재 DB로 두고(WAL에 미반영 쓰기 있는 상태) `db:migrate` | — | 적용 전 새 파일 스냅샷, `integrity_check ok`, 스냅샷 H3 = 이관 전 H3 | K-6 ⑥ |
| E2 | 스냅샷 실패 | 대상 파일을 미리 만들어 둠 / 대상 폴더 쓰기 불가 | — | 이관 시작 안 함, DB H3 그대로, 기존 파일 덮지 않음 | |
| E3 | 동시 접근 | 다른 연결이 쓰기 트랜잭션을 잡은 상태 | — | 조정 규칙(대기 또는 거부)대로, 반쪽 스냅샷 없음 | 조정 방식은 코딩 단계에서 정함(K-6 ⑥) |
| E4 | 스냅샷 자동 삭제 없음 | 성공 후 | — | 스냅샷 남음 | |

## 5. 기록 파일 `tests/fixtures/backups/s4.json` (제안 형식)

```json
{
  "fixture": "s4",
  "generatorVersion": 1,
  "zip": { "sha256": "…", "sizeBytes": 0 },
  "manifest": { "schemaVersion": 1, "appVersion": "0.1.0", "inventorySha256": "…", "fileCount": 0 },
  "migrations": [ { "version": 1, "name": "0001_initial.sql", "sha256": "ee96edd4…" } ],
  "logical": { "all": "…", "tables": { "projects": "…" }, "excluded": ["X_JOURNAL"] },
  "schema": "…",
  "inputs": { "count": 0, "sha256": "…" },
  "environment": { "betterSqlite3": "13.2.0", "sqlite": "3.54.1", "zipStream": "7.0.5" }
}
```

- `environment`는 기록용이에요. 판정에는 쓰지 않아요(H1은 보관 원본, H3는 버전과 무관).
- 기록 파일을 바꾸는 커밋은 "새 fixture 추가"일 때만 받아요. s4를 다시 만들어 덮는 것은 금지예요. K-6 ⑧대로 새 마이그레이션 때는 s5를 **추가**해요.

## 6. 생성·재현 절차 (나중에 구현할 때)

1. 생성기는 테스트 쪽 스크립트예요(예: `tests/fixtures/backups/make-s4.ts`). OS 임시 root에서만 돌고, 실제 data/storage/backups는 열지 않아요.
2. 입력: 라벨 표, `S4_INPUTS`, 고정 바이트 상수, 기준 시각. 출력: 임시 폴더의 `s4.zip` + `s4.json` 초안.
3. 생성 직후 자체 검사: A1·A2를 그대로 실행하고, 실제 runClaimedBackup ZIP과 형식을 대조하고(1.5-5), 개인 경로 문자열 검사를 해요.
4. 사람이 확인한 뒤 한 번만 커밋해요. 이후 생성기는 **재현 검사 모드**로만 돌아요. 다시 만든 결과의 H2(저장 파일·인벤토리·마이그레이션)·H3·H4가 `s4.json`과 같은지만 보고, 파일을 쓰지 않아요.
5. 재현 검사가 다르면 원인이 생성기(입력·ID 규칙)인지, 의존 라이브러리 차이인지 나눠서 보고해요. H3가 다르면 결정성 결함이에요. H1만 다르면 정상이에요(재현 대상 아님).

## 7. 미정·추천

| 미정 | 추천 | 결정 주체 |
|---|---|---|
| ZIP을 앱 함수로 조립 vs `runClaimedBackup` 그대로 | 앱 함수 조립 + 형식 대조(1.5). 개인 경로가 fixture에 들어가는 것을 막기 위해서예요 | Master |
| 가상 경로 형식 | `C:\dream-s4\…`(Windows 주 플랫폼). POSIX에서 복원하면 inherited·available=false로 보이는 것이 정상 | Master |
| H3 제외 집합의 범위 | 2장의 이름 붙인 집합으로 고정. 새 마이그레이션이 늘리면 그 명세에 적기 | 마이그레이션 담당 |
| fixture 크기 | 저장 파일은 수 KB, ZIP 전체 100KB 미만 목표(저장소 부담) | Master |
| 스냅샷 방식(backup API vs VACUUM INTO) | K-6 ⑥대로 코딩 단계에서 E1~E3로 검증해 정하기 | 코딩 담당 |
| 현 코드 B1~B4 실제 응답 | 구현 전에 한 번 실행해 "현 코드" 열을 확정 | 구현 담당 |

## 8. 수용 기준 (이 명세로 구현했을 때)

1. `s4.zip`과 `s4.json`이 커밋되고 A1이 통과해요. 생성 직후 A2와 형식 대조가 통과해요.
2. 개인 경로·키·실제 데이터 검사 결과가 0이에요(DB 텍스트 전체, manifest, ZIP 항목 이름).
3. 재현 검사: 다른 임시 폴더, 가능하면 다른 플랫폼에서 H2(저장 파일·인벤토리·마이그레이션)·H3·H4가 같아요.
4. 4장 행렬을 모두 시험으로 만들어요.
   - 0005가 없는 지금은 A1·A2·B·C·D의 정규화와 rename 지점까지만 실행 가능해요.
   - A3~A5·E는 첫 새 마이그레이션 마일스톤에서 실행해요.
   - 실행하지 않은 칸은 skip 사유를 적고, 통과로 세지 않아요.
5. 모든 시험이 끝난 뒤 커밋 s4.zip의 H1이 그대로예요.

## 9. 하지 않은 것·한계

- 코드·SQL·마이그레이션·seed·기존 테스트·기존 fixture·원본 백업·실제 data를 바꾸거나 열지 않았어요. fixture ZIP을 만들지 않았고 이관도 실행하지 않았어요.
- 실행한 것은 마이그레이션 파일 4개의 sha256 계산과 라이브러리 버전 확인뿐이에요.
- 4장 "현 코드" 열은 코드를 읽고 한 예상이에요. 실행 결과가 아니에요.
- 같은 SQLite 버전·같은 입력에서 DB 바이트가 같을 가능성은 있지만 확인하지 않았어요. 그래서 고정 대상에서 뺐어요.
- zip-stream이 항목마다 날짜 옵션을 받는지는 이번에 확인하지 않았어요. 앱 코드(`writeArchive`)가 날짜를 넘기지 않는 것만 확인했어요. 날짜를 고정해도 라이브러리 버전 차이가 남으므로 H1을 재현 대상에서 빼는 결정은 그대로예요.
