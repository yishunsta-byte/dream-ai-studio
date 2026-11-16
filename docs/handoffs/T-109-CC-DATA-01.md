# T-109 렌더 기록 계약 보강 (0007) — CC-DATA-01 보고

- 지시: Master msg_606c46d535ff (T-107 독립 검수 FAIL F107-1·2·3 수정)
- 상태: ready_review (자체 검수, 독립 검수 아님)
- 원칙 지킴: 0001~0006 원문, 고정 s4·s5·s6의 zip·json·입력 파일 바이트 그대로. 표 다시 만들기 없음. 실제 사용자 DB·data·storage·backups 열지 않음. API·UI·package·도구 변경 없음(T-108과 커밋 분리).

## 1. 원인

| 번호 | 무엇이 새었나 | 원인 |
|---|---|---|
| F107-1 | 렌더가 가리키는 작업의 kind·ref_type·ref_id·project_id를 나중에 바꿀 수 있었어요 | 0006은 렌더를 **넣을 때**만 작업 계약을 확인했어요. jobs 쪽 UPDATE를 막는 규칙이 없었어요 |
| F107-2 | 성공 행에 파일 경로는 있고 sha256이 NULL이어도 저장됐어요 | SQLite CHECK는 결과가 NULL이면 통과로 봐요. 0006의 파일 칸 CHECK가 `IS NULL`/`IS NOT NULL`을 명시하지 않은 비교를 써서 NULL 틈이 생겼어요 |
| F107-3 | 타임라인 번호를 999로 바꾸고 입력·해시를 다시 계산해 재포장한 백업이 복원됐어요 | 복원 확인(checkRenderRows)이 입력 해시와 작업만 보고, **저장된 타임라인과의 연결**은 보지 않았어요. 트리거는 백업 안의 행을 다시 확인하지 않아요 |

## 2. 고친 것

### 새 마이그레이션 `lib/db/migrations/0007_render_guards.sql` (트리거 3개 추가만, 표 재생성 없음)
- `render_job_identity_guard`: 렌더가 가리키는 작업의 kind·ref_type·ref_id·project_id UPDATE 거부. 상태·시도·임대·취소·끝 칸은 그대로 바뀜(정상 작업과 복원 정리 허용). 렌더가 아직 없는 작업은 잠그지 않음.
- `render_file_tuple_insert_guard` / `_update_guard`: 파일 칸 셋(경로·sha256·크기)은 **모두 NULL**이거나 **모두 있고 형식이 맞고 verify_json도 있음**. NULL을 명시적으로 검사해 틈이 없어요.

### 등록 `lib/db/migrate.ts`
- `LATER_SQL_STEPS`에 `{version:7,name:"0007_render_guards.sql"}` 추가. 제품 목록 = 1~5 + 0006 + 0007, 정확한 앞부분 관계 그대로(6단계 기록 → upgrade, 7단계 기록을 6단계 앱 → too_new, 0007 원문 다름 → mismatch).
- 7단계에 데이터 확인(verify = checkRenderRows)을 붙였어요. 0006 아래 이미 저장된 행이 새 규칙을 어기면 **렌더 id와 이유를 담은 오류로 멈추고 전체를 되돌려요**(기록 6단계, 행·트리거 그대로). 조용히 고치지 않아요.

### 행 확인 `lib/db/render-data.ts` (checkRenderRow / checkRenderRows, RenderRowError)
저장된 행을 트리거를 믿지 않고 의미로 다시 읽어요. 실패하면 `Render row <id>: <이유>`.
- 입력: 해시 일치, JSON, schemaVersion 1, 입력의 프로젝트·타임라인 id·번호·내용 버전 = 행
- 저장된 타임라인(F107-3): 같은 id의 timeline_revisions 행이 있고, 프로젝트·번호·내용 버전이 같고, 입력의 timelineSha256 = 저장된 timeline_sha256
- 작업(F107-1): kind render, ref render, ref_id = 렌더 id, 같은 프로젝트
- 파일 칸(F107-2): 모두 없음 또는 모두 있음(정해진 경로·소문자 64자 해시·1 이상 정수·확인 기록 객체). 성공은 파일 필수, 파일은 성공 또는 취소 뒤 끝남만, 실패는 오류 코드 필수, 끝 시각은 상태와 맞음
- 프로젝트당 진행 중 렌더 1개

### 복원 경계 `lib/backup/archive.ts` (설명만 보강, 동작은 기존 호출 그대로)
- 직접 복원(same): checkRenderRows 실행
- 이전 버전 복원(upgrade): staging에서 올리는 중 0007 데이터 확인 → 올린 직후 지금 구조로 다시 읽으며(same) checkRenderRows 한 번 더. 나중에 0008이 생겨도 이 두 번째 확인은 빠지지 않아요.

## 3. 새 버전 정책
- 0006은 발행된 원문 그대로 두고, 빈틈은 **뒤 번호 마이그레이션으로만** 막아요(이번 0007).
- 새 규칙을 어기는 이전 행은 자동 수정하지 않아요. 이관은 원인(렌더 id·이유)을 밝혀 실패하고, 바꾸기 전 복사본과 원래 DB를 그대로 둬요. 고칠지 버릴지는 사람이 정해요.
- 고정 백업은 기록한 단계 그대로 둬요. s6은 6단계 백업으로 남고(s6Migrations = 제품 목록 앞 6개), 7단계 기준은 새 s7이에요.

## 4. 새 고정 백업 s7
- `tests/fixtures/backups/s7-build.ts`, `s7.zip`(555,424B, sha256 b861d214187bbade08136be9a36a4a8f6909ac900e52bd113ed12e46ec5e503b), `s7.json`
- 만드는 법: s6 런타임 + 0007(고정 시각), 행 추가 없음. `S7_WRITE=1`로 한 번만 생성(있으면 거부).
- `tests/s7-fixture.test.ts`(7개 통과)
  - 보관 원본: ZIP 해시·7줄 기록(1~6 = s6)·렌더 5행 = s6·논리 내용·스키마 = 기록, 다시 만들어도 같음
  - s6 → 제품 목록(0007, 행 확인 통과) = s7 구조·내용, 0006 행 불변
  - 직접 s7 복원(same 7→7): 끝난 렌더·파일 그대로, 진행 중은 RESTORE_INTERRUPTED, 복원본에서도 0007 트리거 동작
  - s6(6→7)·s5(5→7) 올려서 복원: staging 올린 직후 구조 = s7, 원본 ZIP 그대로
  - 거부(해시·manifest까지 맞춘 재포장, 실제 inspect·finish): s7 위조 타임라인 999·작업 kind·작업 프로젝트·NULL sha256 → RESTORE_INVALID / 같은 위조 s6: 6단계 앱 RESTORE_INVALID, 제품 앱 BACKUP_UPGRADE_FAILED / 6단계 앱에 s7 → BACKUP_TOO_NEW / 0007 원문 다른 앱 → BACKUP_SCHEMA_MISMATCH. 모두 목적지 없음, ZIP 바이트 그대로
  - 끝에 s4·s5·s6·s7 ZIP 해시 불변 확인

## 5. 바꾼 파일
- 새: `lib/db/migrations/0007_render_guards.sql`, `tests/fixtures/backups/s7-build.ts`, `s7.zip`, `s7.json`, `tests/s7-fixture.test.ts`, 이 보고서
- 수정: `lib/db/migrate.ts`, `lib/db/render-data.ts`, `lib/backup/archive.ts`(설명), `tests/fixtures/backups/s6-build.ts`(6단계 고정, 바이트 불변), `tests/s6-fixture.test.ts`(6단계 앱 기준), `tests/p2-4a-renders-db.test.ts`, 기대값 6→7: `tests/backup-service.test.ts`, `tests/restore.test.ts`, `tests/p2-1-timeline.test.ts`

## 6. 실제 검증
- 시험: p2-4a-renders-db 12개 — F107-1(제품 연결에서 4종 UPDATE 거부, 상태·진행·취소 허용, 렌더 없는 작업 허용, 복원 정리 UPDATE 허용), F107-2(부분 tuple·형식 오류 거부, 정상 성공·취소 뒤 끝남 허용), F107-3(위조 8가지 거부), 0006 아래 잘못된 행 → 0007 원인 담은 실패, 기록 6·행·트리거 그대로
- 전체: T-108 패키지 변경을 빼면 vitest 42파일 496 통과 + 4 건너뜀. T-108의 package.json이 있으면 "패키지는 remotion·@remotion/player 두 개만" 1건이 실패하는데, T-108 커밋에서 그 기대값을 고쳐요(T-109와 무관)
- tsc·lint 통과, 운영 빌드 통과(빌드 복사본에 T-109 파일만 반영)
- 실제 CLI(`npm run db:migrate`, 고정 s6을 OS 임시 폴더에 푼 가상 런타임, 증거 `tmp/t109-evidence/cli-migrate.log`)
  - A) 6→7: "새 마이그레이션 1개", 다시 실행 0개, 바꾸기 전 복사본 = 바꾸기 전 내용, renders·jobs 그대로(바뀐 표는 기존 db.migrated 기록의 activity_log뿐), 1~6 기록 그대로, 무결성 ok·외래키 0, 이관 뒤 작업 kind 변경 거부
  - B) 0006 아래 성공인데 sha256 NULL 행: exit 1, DB 파일 sha256 전후 같음, 기록 6단계, 복사본 남김
- 비밀·경로 검사: 증거·커밋에 PC 경로·이메일 0

## 7. 남은 것 / 판단 필요
- CLI 실패 기록(`migration-last.json`)에는 코드 `MIGRATION_FAILED`만 남고 렌더 id·이유는 없어요. reason 칸이 공용 문구·화면과 묶인 고정 목록이라 T-109 범위에서 넓히지 않았어요(0005 타임라인 확인과 같은 방식). 원인은 오류 메시지와 시험에서 확인돼요. 화면에 원인을 보여줄지는 Master 판단이에요.
- 사용자 실제 DB의 이관 시점은 Master·사용자 결정이에요.
