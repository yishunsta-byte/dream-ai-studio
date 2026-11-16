# T-105 · P2-4a 렌더 기록 표 · 마이그레이션 0006 · 백업/복원 (CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 지시 | Master `msg_f121f3328b05`(T-101 결정 D-1~D-9 확정, 범위), `msg_db483c0fec60`(재시도 분류), 디자인 `msg_a6168d9e7d39`(T-106) |
| 대상 | 15eaaa0 위 새 커밋 (이 보고서와 같은 커밋) |
| 상태 | ready_review (자체 확인, 독립 검수 아님) |
| 범위 밖(안 함) | renderer·bundler·브라우저 설치, 렌더 worker, 컴포지션, API 라우트, 제품 화면, package/lockfile, 사용자 실제 DB 이관 |
| 바꾸지 않은 것 | `0001`~`0004` SQL, `0005` .cjs 두 파일과 그 해시, `s4.zip`/`s4.json`/`s5.zip`/`s5.json`/`s4-inputs` 바이트, 공용 문서 |

## 1. 바꾼 것

| 파일 | 내용 |
|---|---|
| `lib/db/migrations/0006_renders.sql` (새) | `renders` 표, 인덱스 3개, 트리거 7개 (2장) |
| `lib/db/migrate.ts` | `LATER_SQL_STEPS=[{version:6,name:"0006_renders.sql"}]`, `productLaterSqlMigrations()`. 제품 목록 = SQL 1~4 → 코드 5 → SQL 6. 목록 번호가 1..n이 아니면 `MigrationSourceError`. `productSqlMigrations()`(1~4)와 `PRODUCT_CODE_STEPS`는 그대로 |
| `lib/db/schema.ts` | Drizzle `renders` 정의(표 18개) |
| `lib/repo/renders.ts` (새) | `row`/`byJob`/`list`/`active`/`nextNameSeq`/`insert`(항상 queued)/`progress`/`finish`/`recordCleanup` |
| `lib/db/render-data.ts` (새) | `renderInputSha256`(저장된 `input_json` 원문의 sha256), `checkRenderRows`(입력 해시·작업 계약), `renderFileReferences`. 표가 없으면 아무것도 안 함(이전 구조 목록) |
| `lib/repo/maintenance.ts` | `fileReferences()`에 렌더 파일(통과·취소 뒤 끝남)을 더함 → 백업 생성과 복원 확인이 같은 참조 검사를 해요 |
| `lib/backup/archive.ts` | 같은 구조 복원 확인에서 `checkRenderRows` 실행 |
| `lib/services/restore.ts` | 정규화: `queued`/`running` 렌더 → `failed`, `RESTORE_INTERRUPTED`(작업은 기존대로 `canceled`/`RESTORED_NOT_RESUMED`). 끝난 행과 파일은 그대로 |
| `tests/fixtures/backups/s6-build.ts`, `s6.zip`, `s6.json`, `s6-inputs/*.mp4` (새) | 고정 가상 백업 s6 (3장) |
| `tests/fixtures/backups/s5-build.ts` | s5 생성기를 `productMigrations().slice(0,5)`(`s5Migrations`)로 고정. s5 바이트·기록은 그대로 |
| 시험 | 새 `tests/p2-4a-renders-db.test.ts`(8), `tests/s6-fixture.test.ts`(8+생성 1 skip). 기존 시험 기대값 갱신: `database`(표 18), `backup-service`(manifest 6줄), `restore`(6→6), `s5-fixture`(5단계 앱 기준), `p2-1-timeline`(0005 시험은 5단계, 실제 CLI는 4→6·빈 폴더 6단계), `p2-1-f065`(5단계=inspect에서 `RESTORE_INVALID`, 제품 목록=올린 뒤 재검사에서 `BACKUP_UPGRADE_FAILED`, 둘 다 목적지 없음) |

## 2. `renders` 표 (T-101 2.6 초안 대비)

- 열은 T-101 초안과 같아요. 다른 점은 아래와 같아요.
  - `job_id` 필수(UNIQUE)
  - `progress_permille` 기본 0
  - `display_name`은 5~120자, `.mp4`로 끝남, `/ \ : * ? " < > |` 금지
- **작업 계약**(`render_job_guard`)
  - jobs 행을 먼저 넣어요: `kind='render'`, `ref_type='render'`, `ref_id=렌더 id`, 같은 `project_id`.
  - 그다음 렌더 행을 `job_id`로 넣어요. 순서가 다르거나 값이 다르면 거부해요.
  - jobs 쪽 `idempotency_key`는 T-101대로 `render:{프로젝트}:{inputSha256}:{name_seq}`예요(s6 fixture가 이 형식).
- **타임라인 계약**(`render_timeline_guard`): 같은 프로젝트의 `timeline_revisions` 행과 `revision`·`content_revision`이 같아야 해요.
- **입력 기록 CHECK**
  - `input_json`은 객체예요. `schemaVersion=1`이고, `projectId`·`timelineRevId`·`timelineRevision`·`contentRevision`이 행 값과 같아야 해요.
  - `input_sha256`은 64자리 소문자 hex예요. 원문 해시가 맞는지는 SQL로 못 보니 `checkRenderRows`가 복원 때 봐요.
- **시작**(`render_insert_guard`): `queued`이고 진행·파일·오류·정리 기록이 비어 있어야 해요.
- **상태 전이**(`render_status_guard`)
  - `queued→running|failed|canceled`
  - `running→queued(재시도·회수)|succeeded|failed|canceled`
  - 끝난 상태에서는 바뀌지 않아요.
- **파일 CHECK**
  - 파일 3필드(`file_path`·`sha256`·`size_bytes`)는 함께 있어야 해요.
  - 경로는 정확히 `projects/{project_id}/renders/{id}.mp4`(storage 기준 상대경로)이고, `verify_json`이 필요해요.
  - 파일이 있는 것은 `succeeded` 또는 `canceled + canceled_late=1`뿐이에요.
  - `succeeded`는 파일 필수, `error_code` 없음이에요.
  - `failed`는 `error_code` 필수예요.
  - `finished_at`은 끝난 상태일 때만 있어요.
- **불변**
  - 입력 칸(`render_input_immutable`)은 진행 중에도 바뀌지 않아요.
  - 끝난 행(`render_finished_immutable`)은 `cleanup_left_json`(JSON 배열)만 바꿀 수 있어요.
  - 삭제는 모두 금지예요(`render_delete_guard`).
- **유일**
  - `renders_one_active`: 프로젝트당 queued/running 1개(Master 결정)
  - `UNIQUE(project_id, timeline_rev_id, name_seq)`: `-2` 번호
  - `file_path` UNIQUE
- 결정 반영
  - D-4: 새 표예요.
  - D-7: 통과 MP4와 취소 뒤 끝난 MP4는 백업 inventory와 참조 검사에 들어가요. 확인 실패·취소 행은 파일 없이 그대로 복원돼요(파일 없음 오류가 아니에요).
  - 나머지 D-1/2/3/5/6/8/9는 다음 단계(worker·설치·화면)에서 적용해요. T-101 2.7의 재시도 분류는 Master 지시대로 고쳤어요. 원인으로 판단하고, `DISK_FULL`과 권한·경로·입력 위반은 재시도하지 않아요.

## 3. 고정 가상 백업 s6

- 만드는 법(`S6_WRITE=1`, 이미 있으면 거부)
  1. s5 런타임(s4 생성기 + 5단계)에 제품 목록을 고정 시각으로 적용해요(0006).
  2. main 프로젝트의 저장된 타임라인 r1에 렌더 5행과 작업 5행을 넣어요.
  3. 파일 2개를 storage에 두고, 실제 백업과 같은 순서로 묶어요.
- 렌더 5행 (모두 `name_seq` 1~5, 표시 이름 `가상 텀블러 소개_9x16_r1_SAMPLE[-N].mp4`)

  | # | 상태 | 파일 | 뜻 |
  |---|---|---|---|
  | 1 | succeeded | `render-passed.mp4` | 확인 통과 |
  | 2 | canceled, `canceled_late=1` | `render-late.mp4` | 취소 뒤 끝남(보관) |
  | 3 | failed `RENDER_VERIFY_FAILED` | 없음 | 확인 실패(899/900) |
  | 4 | canceled | 없음 | 정리 못 한 임시 경로 1개 기록 |
  | 5 | running | 없음 | 백업할 때 진행 중이었음 |

- MP4 두 개는 앱 ffmpeg(9.0.2)로 한 번 만든 **실제 작은 H.264 영상**이에요.
  - 1080×1920, 30/1, 900프레임, 30.000초, 오디오 없음. 각 약 73KB이고, 단색(파랑/회색)이에요.
  - bitexact 옵션으로 두 번 만들어 sha256이 같은 것을 확인했어요.
  - 타임라인에서 렌더한 것이 아니에요. r1의 세 번째 장면은 빈 자리여서 실제 렌더는 거부될 입력이에요. 백업·복원용 기록으로만 써요.
- `s6.json`
  - ZIP sha256·크기, 마이그레이션 6줄(1~5줄은 `s5.json`과 같음), 표별 논리 해시, 스키마 해시, 렌더 5행 요약, 렌더 파일 2개 해시
  - ZIP 551,206 bytes

## 4. 시험

- `tsc --noEmit` 통과, `npm run lint`(max-warnings 0) 통과
- `vitest run` **41파일 485 통과 / 3 skip** (skip은 s5·s6 생성 1회용과 기존 1개)
- `p2-4a-renders-db` (s5 사본을 제품 목록으로 올린 DB)
  - 제품 목록 1~6, 0006 해시 = 파일 원문 해시, 1~5 = `s5.json`
  - s5 기록 → `upgrade`, 6줄 기록을 5단계 앱으로 → `too_new`, 5번 자리에 0006 → `mismatch`
  - 작업 계약 3종·타임라인 2종 거부, 입력 CHECK·시작 상태·이름 금지 문자
  - 진행 중 1개, `-N` 번호, 저장소 `nextNameSeq`/`active`/`list`
  - 상태 전이, 성공 파일·경로·확인 기록, `running→queued→running`
  - 취소 뒤 끝남/확인 실패 규칙, 백업 참조에 렌더 파일 1개만
  - 입력 불변, 끝난 행은 정리 기록만, 삭제 금지
  - `checkRenderRows`가 해시·작업 계약 어긋남을 잡음
- `s6-fixture`
  - 보관 바이트·기록 일치, 다시 만들어도 같음
  - s5 → 제품 목록 = s6 스키마이고, 렌더와 무관한 표는 s5·s6와 같음
  - **s6 직접 복원(same 6→6)**
    - 1~4행이 그대로예요.
    - 파일 2개가 복원 위치에 같은 sha256으로 있어요.
    - 3·4·5행은 파일이 없고, 5행은 `failed`/`RESTORE_INTERRUPTED`, 그 작업은 `canceled`/`RESTORED_NOT_RESUMED`예요.
    - 정리 기록이 유지돼요.
    - 원본 ZIP은 그대로예요.
  - **s5 올려서 복원(upgrade 5→6)**: staging에서 올린 직후 스키마 = s6, renders 0행, 원본 s5 ZIP 그대로
  - **거부**
    - 통과 파일을 다른 영상으로 바꾸고 manifest까지 맞춘 백업 → `RESTORE_INVALID`
    - 입력 해시를 바꾼 행 → `RESTORE_INVALID`
    - 5단계 앱 → `BACKUP_TOO_NEW`
    - 0006 원문이 다른 앱 → `BACKUP_SCHEMA_MISMATCH`
    - 모두 목적지가 생기지 않고 ZIP 바이트가 그대로예요.
- s4·s5 ZIP 해시는 s5·s6 시험 시작과 끝에 확인해요.
- **실제 CLI** (`tmp/t105-evidence/cli-migrate.log`): 기존 가상 런타임(5단계)을 OS 임시 폴더에 복사해서 `npm run db:migrate`를 두 번 실행했어요.
  - 1회째 "새 마이그레이션 1개" + 바꾸기 전 복사본 `…_s5-s6.db`, 2회째 0개
  - 복사본 내용(기록·표별 해시·스키마) = 바꾸기 전과 같아요.
  - 이관 뒤 바뀐 기존 표는 `activity_log`(`db.migrated` 기록 1줄)뿐이고, 새 표는 `renders`예요.
  - 1~5 기록 그대로, 무결성 ok, 외래키 문제 0
  - 원본 가상 런타임 `app.db` sha256은 전후가 같아요.
- 운영 빌드(임시 복사본, 바꾼 파일 바이트 동일 확인) 통과. "로컬 데이터·비밀 설정 추적 없음"

## 5. 남은 점·알릴 것

- **이 커밋이 들어가면 5단계 DB는 "구조를 올려야 해요" 상태가 돼요.** 시작 점검이 `db:migrate` 안내를 보여요. 사용자 실제 DB 이관은 하지 않았어요. 실행 시점은 Master·사용자가 정해 주세요. 바꾸기 전 복사본이 자동으로 남아요.
- 다른 세션이 쓰는 가상 런타임도 `db:migrate`가 필요해요. 예: 제 `dream-t071` fixture는 손대지 않고 사본만 이관했어요.
- s6의 MP4는 단색 가상 영상이라 화면 R-15 검수(복원 뒤 경로·해시)에는 쓸 수 있어요. 자막 오차 측정에는 쓸 수 없어요.
- jobs 쪽(`claim`/runner/list/recover/cancel/retry)의 `render` 처리, 렌더 서비스·worker·라우트·화면은 다음 배정 범위예요. 지금 `claim`은 `render` 작업을 여전히 미지원 kind로 거부해요. 이번에 넣는 경로가 없어서 영향이 없어요.
