# T-035 · K-6 이전 백업 호환과 고정 백업 s4 구현 (CC-DATA-01, 임시 코딩 위임)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-035 / P2-1 준비 (P1 우선) |
| 지시 | Master `msg_5e8865daac09`, 수락·점유 `msg_8481faf208c5`. 근거: PLAN 14장 K-6, T-017 3장, T-034 최종 `08fe734` |
| 시작 HEAD | `3989653` |
| 상태 | ready_review. 자체 검증만 했어요. Master 통합 검토와 독립 검수가 남아 있어요 |
| 하지 않은 것 | 0001~0004 원문 변경 없음, 0005 등 제품 마이그레이션 추가 없음, 타임라인·Remotion 없음, 실제 data·storage·backups 접근 없음, 실제 사용자 DB 이관 실행 없음, PLAN·TEAM·디자인 문서 변경 없음 |

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `lib/db/migrate.ts` | `productMigrations()`, `migrationEntry()`, `journal()`, `compareMigrations()`(same·upgrade·too_new·mismatch) 추가. `verifyMigrations`·`migrateDatabase`가 목록(`migrations`)과 시각(`now`)을 받아요. 기본값은 기존 제품 목록이라 기존 호출은 그대로예요. 단계별 데이터 검사 `Migration.verify`를 적용 직후 실행해요 |
| `lib/db/live-migrate.ts` (새) | 지금 쓰는 DB 올리기(K-6 ⑥): 새 파일 예약(`wx`) → `VACUUM INTO` 일관 스냅샷 → 스냅샷 `integrity_check`·기록 대조 → 쓰기 잠금 + `data_version` 불변 확인 → 한 트랜잭션으로 적용·검사·`db.migrated` 기록. 오류 코드 `SCHEMA_MISMATCH`·`SNAPSHOT_EXISTS`·`SNAPSHOT_FAILED`·`DATABASE_BUSY`·`MIGRATION_FAILED` |
| `scripts/db.ts` | `db:migrate`가 `migrateLiveDatabase`를 쓰고, 스냅샷 위치는 `backups/pre-migrate/`예요. 실패 코드마다 쉬운 문구를 보여 줘요 |
| `lib/backup/compat.ts` (새) | `BackupCompatError`와 문구: `BACKUP_TOO_NEW`·`BACKUP_SCHEMA_MISMATCH`·`BACKUP_UPGRADE_FAILED`·`BACKUP_SOURCE_CHANGED` (모두 409) |
| `lib/backup/schema.ts` | `appVersion`을 기록용 `string(1..32)`으로 바꿨어요. `SUPPORTED_MANIFEST_VERSIONS=[1]`, `APP_VERSION` 추가. 티켓에 `compat`·`schemaFrom`·`schemaTo`(선택), restore-info에 `schemaFrom`·`schemaTo`·`migrationsApplied`(선택)를 더했어요 |
| `lib/backup/archive.ts` | `parseManifest`: 모르는 형식 번호는 SCHEMA_MISMATCH예요. `verifyRestoredDatabase`·`verifyStagingFiles`가 기대 기록(`journal`)과 목록(`migrations`)을 받아요. DB 기록 = 기대 기록(기본 manifest)이고 앞부분 판정을 해요. 옛 구조는 해시·무결성·FK만 보고, 파일 참조·글자 스냅샷은 올린 뒤 다시 검사해요 |
| `lib/services/restore.ts` | 검사 단계 판정: manifest 기록으로 풀기 **전에** 거부하고, 풀고 나서 DB 기록으로 다시 판정해요. 확정 단계 순서: 다시 판정 → 원본 ZIP 해시 재대조 → staging 검사 → (upgrade면) staging DB에만 한 트랜잭션 적용 → 전체 재검사 → T-006 정규화 → restore-info(구조 기록 포함) → 확정 직전 원본 ZIP 해시 재대조 → rename. 어느 단계든 실패하면 staging을 지우고 티켓을 failed로 둬요. DTO에 `compat`·`fromVersion`·`toVersion`·`appVersion`을 추가했어요. 시험용 `onStage`·`migrations` 옵션은 서비스 팩토리 인자로만 받고 route는 넘기지 않아요 |
| `components/settings-panel.tsx` | 검사 결과에 한 줄 추가: "데이터 구조 버전 맞음(n)" 또는 "이전 버전(데이터 구조 a)에서 만든 백업이에요. 복원하면서 지금 구조(b)로 바꿔요. 원래 백업 파일은 바꾸지 않아요." + "만든 앱 x". 저장된 검사 정보는 새 칸이 없어도 읽혀요(기본값) |
| `README.md` | `db:migrate` 스냅샷 안내, 이전 백업 호환 안내, s4 생성 규칙 |
| `tests/restore.test.ts` | 검사 DTO 키 허용 목록에 새 키 4개를 더하고 값을 확인해요 |
| `tests/fixtures/backups/s4-build.ts`, `s4-compare.ts` (새) | 생성기(라벨 → UUIDv7·시각, `S4_INPUTS`, 고정 PNG 바이트, 앱 함수로 조립)와 H3 논리 해시·프로파일·입력값 위치표 |
| `tests/fixtures/backups/s4.zip`·`s4.json`·`s4-inputs/export-r4.zip` (새) | 고정 가상 백업과 기록. s4.zip sha256 `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392`, 305,588바이트 |
| `tests/s4-fixture.test.ts`, `tests/k6-compat.test.ts` (새) | 아래 2장 |

## 2. 검증

| 명령 | 결과 |
|---|---|
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm test` | 28파일, 258검사 통과, 1건 skip(s4 생성 모드. `S4_WRITE=1`일 때만 돌아요) |
| `npm run build` | 종료 0, 경고 0, 로컬 데이터·비밀 추적 없음 |
| `db:migrate` 실제 명령 | OS 임시 `DREAM_DATA_ROOT`에서만 실행. 1~3단계 DB에 데이터 1줄을 넣고 실행했어요. "새 마이그레이션 1개"와 `backups/pre-migrate/…_s3-s4.db`가 생겼어요. 스냅샷은 integrity ok이고 기록 3줄과 데이터를 담고 있어요. 다시 실행하면 0개이고 새 스냅샷은 없어요. 임시 폴더는 삭제했어요 |
| 일부러 망가뜨린 확인 | 확정 직전 원본 재대조를 빼고 정규화의 `lease_until=NULL`을 빼면 A2·A3·D1 3검사가 실패했어요. 되돌리면 31검사 모두 통과해요 |

시험 목록 (T-034 4장 기준):
- **s4-fixture (4):**
  - A1 보관 원본(ZIP 해시·manifest·기록 4줄 = 0장 계산값·P_REGEN 논리·스키마·journal·입력값·묶음 입력 파일)
  - P_REGEN 재현(저장 파일·인벤토리·마이그레이션·논리·스키마 일치, 1~4 `applied_at`은 형식만)
  - 개인 경로·사용자 이름 검사(DB 글자 전부·manifest·ZIP 항목 이름)
  - 실제 `runClaimedBackup` ZIP과 형식 대조(항목 순서·store 방식·manifest 키·형식 번호·앱 버전)
- **k6-compat (31):**
  - 기록 판정 단위 시험
  - A2: P_RESTORE. D_R 조건 행 jobs 4·scene_versions 2·exports 1·backups 1, 삭제 settings 3. 조건 밖 행은 전체, 조건 행은 나머지 칸, 바뀐 칸은 기대값으로 대조해요. `job.*.startedAt`이 남는지, restore.info 필드와 backup.directory, activity 새 행 1개를 각각 확인해요. 입력값 위치표와 스키마 해시가 기록과 같은지, 저장 파일 전부와 묶음 ZIP 바이트=`exports.sha256`=기록인지, `verifyZip`과 묶음 manifest 의미 비교도 봐요. B0은 inherited·available=false예요
  - A3: 시험 전용 5단계로 올려서 복원해요. 기존 표는 보존하고, 새 표는 행마다 독립 대조해요. restore-info에 4→5와 적용 목록이 있는지 봐요
  - A4·A5: 올린 직후(정규화 전) DB가 직접 migrate한 DB와 정확히 같고 두 번 복원해도 같아요(P_MIGRATE). 정규화 뒤에는 실행별 값(V_RUN)을 각자 확인한 뒤 나머지가 같아요(P_POSTNORM)
  - B1~B4 거부(staging·목적지·티켓 없음, 원본 해시 불변), appVersion 0.2.0은 허용, 올리기 목록에서도 다른 5단계는 거부
  - C1·C3·C4 변조·파일·FK
  - D1: 올리기 트랜잭션 실패·단계 데이터 검사 실패·풀기 직후·올린 직후·정규화 직후·확정 직전 원본 변경·검사 뒤 원본 변경. 각각 staging 없음, 목적지 비어 있음, 티켓 failed, 지금 DB 업무 표 불변
  - D2: 모든 시험 뒤 커밋한 s4.zip 해시 불변(afterAll)
  - E1~E4: WAL에 있는 쓰기까지 담은 새 파일 스냅샷과 기록 1줄, 같은 이름 파일 보호, 폴더 생성 실패, 스냅샷 뒤 다른 연결 쓰기, 쓰기 잠금 대기 뒤 거부(반쪽 스냅샷 없음), 이관 실패 시 DB 그대로·스냅샷 유지, 같은 구조·새 DB·다른 기록

## 3. T-034 명세와 다르게 한 곳 (근거)

| 명세 | 실제 | 이유 |
|---|---|---|
| exports "취소 1개" | `status='failed'`, `error='CANCELED'`로 넣었어요(작업 행은 canceled) | exports 표 CHECK는 running·succeeded·failed만 받아요 |
| 메뉴 스냅샷은 생성 시점 menus.json | 고정 상수 JSON(`TEMPLATE`) | menus.json이 바뀌어도 재현(P_REGEN)이 깨지지 않게 했어요. 복원 경로는 이 칸을 해석하지 않아요 |
| A4 (b) "직접 migrate 뒤 같은 정규화" | (b)는 직접 migrate까지만 하고 정규화 전 DB로 비교해요(P_MIGRATE). 정규화 뒤 비교(P_POSTNORM)는 두 번 복원(A5)으로 했어요 | 정규화 함수는 서비스 내부라 따로 부르려면 범위 밖 구조 변경이 필요해요. 결정성 근거는 둘로 충분하다고 판단했어요 |
| ZIP 100KB 미만 목표 | 305,588바이트 | DB가 표·인덱스마다 4KB 페이지를 써서 약 300KB예요. 저장 파일은 수백 바이트예요 |
| E2 "폴더 쓰기 불가" | 스냅샷 폴더 자리에 파일이 있어 만들 수 없는 경우로 시험했어요 | Windows 권한 거부는 이식성 있게 재현하기 어려워요 |
| 스냅샷 방식 (K-6 ⑥ 코딩 단계에서 결정) | `VACUUM INTO` + `data_version` | 직접 확인한 결과: `VACUUM INTO`는 트랜잭션 안에서 못 돌고("cannot VACUUM from within a transaction"), 빈 파일에는 쓰지만 내용 있는 파일은 거부해요("output file already exists"). 다른 연결이 쓰기 잠금을 쥐어도 커밋된 내용만 복사해요. 그래서 이름 예약 → 복사 → 잠금 + 변경 없음 확인으로 동시 접근을 조정했어요. backup API는 대상을 덮을 수 있어 고르지 않았어요 |

## 4. 한계 (실행하지 않은 것)

- **브라우저 확인 안 함.** 설정 화면 호환 문구는 타입·빌드만 확인했어요. 1280·390 배치와 키보드 확인은 독립 검수 범위예요.
- **다른 플랫폼 재현 안 함.** Windows(Node 26, SQLite 3.54.1)에서만 P_REGEN 재현을 확인했어요. 기록 파일 `environment`는 판정에 쓰지 않아요.
- **실제 사용자 DB 이관은 하지 않았어요**(지시). 임시 가상 DB에서만 CLI를 돌렸어요.
- **시작 점검 화면 문구**(T-017 3.5 3번)는 바꾸지 않았어요. 실패 안내는 CLI 출력에만 있어요. 이관이 실패해도 DB는 그대로라 시작 점검은 지금처럼 기록 일치로 판단해요.
- **코드로 하는 이관 단계의 해시**(T-017 3.4)는 아직 없어요. `Migration.verify`는 검사 함수라 sha256에 들어가지 않아요. 코드 이관이 필요해지면 그 마일스톤에서 원문 해시를 묶어야 해요.
- 올리기 중 무결성 검사는 `integrity_check`(전체)예요. 큰 DB에서는 시간이 걸릴 수 있어요.
- 검사 뒤 앱이 업데이트되어 목록이 달라지면 확정 단계에서 RESTORE_INVALID로 멈추고 다시 검사하게 해요. 일부러 만든 시험은 없어요.

## 5. 수용 기준 대조 (T-034 8장)

| # | 결과 |
|---|---|
| 1 s4 커밋, A1, 생성 직후 A2·형식 대조 | 충족(A2는 커밋본으로 매번 실행) |
| 2 개인 경로·키·실데이터 0 | 충족(사용자 이름·임시 경로·Users·AppData·/home 검사) |
| 3 다른 폴더·플랫폼 재현 | 다른 임시 폴더는 충족, 다른 플랫폼은 미실행 |
| 4 행렬 전부 시험화 | A1~A5·B1~B4·C1·C3·C4·D1·D2·E1~E4 충족. C2(항목 누락·추가·이름)는 기존 `backup-archive` 시험이 맡아요 |
| 5 시험 뒤 s4.zip 해시 불변 | 충족(afterAll) |
| 6 표 전체 제외 없음, 조건마다 1행 이상 | 충족(matched 수를 정확히 assert) |
| 7 묶음 ZIP·exports.sha256 일치 | 충족 |
