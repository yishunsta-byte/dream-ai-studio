# T-111 이관 실패 원인 보존 (F110-1) — CC-DATA-01 보고

- 지시: Master msg_ede2adba1c5c (T-110 독립 검수의 게이트 FAIL F110-1)
- 상태: ready_review (자체 검수, 독립 검수 아님)
- 원칙: 0001~0007 원문, s4~s7 바이트 그대로. 공용 코드 `MIGRATION_FAILED`, 사용자 공통 문구, `migration-last.json` 형식 그대로. UI·API·package 변경 없음(T-108과 커밋 분리). 실제 사용자 DB 접근 없음.

## 1. 원인
`migrateLiveDatabase`가 알 수 없는 오류를 모두 `new LiveMigrationError("MIGRATION_FAILED",path)`로 바꾸면서 0007 데이터 확인이 던진 `RenderRowError`(렌더 id·이유)를 버렸어요. 그래서 실제 CLI에는 공용 문구만 남고 어떤 행이 왜 막혔는지 알 수 없었어요.

## 2. 고친 것
- `lib/db/render-data.ts`: `RenderRowError`에 형식 있는 칸을 둬요.
  - `subject`: `"render"` 또는 `"project"`(진행 중 2개는 프로젝트 기준)
  - `subjectId`: UUID 형식일 때만 남고, 아니면 null(메시지에도 넣지 않음)
  - `reason`: 정해진 문장 목록 `renderRowReasons`(17개) 중 하나. 저장된 글(입력 JSON·파일 경로·해시)은 오류에 들어가지 않아요.
- `lib/db/live-migrate.ts`
  - `LiveMigrationError`에 4번째 칸 `diagnostic`(`{kind:"render_row",subject,id,reason}`)을 추가했어요. `RenderRowError`일 때만 채우고, 공용 code·reason은 그대로예요.
  - `checkMigratedData`도 이관 뒤 `checkRenderRows`를 실행해요. 복원과 같은 확인이라, 다음 번호(0008…)가 생겨도 실제 이관에서 렌더 행 확인이 빠지지 않아요.
- `lib/db/migrate-command.ts`: 실패 시 공용 문구 두 줄 뒤에 진단 한 줄을 stderr로 내요. 형식 있는 칸으로만 만들어요.
  - `원인 진단: 렌더 기록 <UUID> — <정해진 이유>`
  - 진단이 없는 실패(알 수 없는 SQL 오류 등)는 이 줄이 없고, 오류 메시지·스택도 출력하지 않아요(기존 그대로).

## 3. 검증
- 새 시험 `tests/p2-4a-migrate-diagnostic.test.ts`(5개, 실제 `runMigrateCommand`, 고정 s6 사본)
  - 성공인데 sha256 NULL 행 → exit 1, stderr = 공용 문구 2줄 + `원인 진단: 렌더 기록 <id> — file fields are incomplete` + 복사본 줄(정확히 4줄). DB 파일 sha256 그대로, 기록 1~6, 0007 트리거 0, 복사본 1개 유지. 기록은 `MIGRATION_FAILED`·reason null 형식 그대로이고 렌더 id가 들어가지 않음. 출력에 파일 경로·입력 JSON·64자 해시·스택 없음.
  - 작업 kind가 바뀐 행 → `원인 진단: 렌더 기록 <id> — job differs`, 기록 6·트리거 0
  - 회귀: 정상 s6 → 1개 적용·진단 없음, 다시 실행 0개
  - 회귀: 행 확인이 아닌 실패(없는 표 SQL) → 진단 줄 없음, 공용 문구만, 표 이름·스택 출력 없음, 기록 6
  - `RenderRowError`: UUID가 아닌 id는 남기지 않음, 이유는 정해진 목록
- 관련 시험(k6 마이그레이션 두 파일·p2-4a 렌더·p2-1 타임라인 CLI·s7) 통과. 전체 vitest 43파일 500 통과 + 4 건너뜀. 실패 1건은 T-108 미커밋 package.json 때문인 패키지 기대값 시험으로 T-111과 무관해요(T-108 커밋에서 고쳐요).
- tsc·lint 통과, 운영 빌드 통과(빌드 복사본에 T-111 파일 반영)
- 실제 CLI `npm run db:migrate`(고정 s6을 OS 임시 폴더에 푼 가상 런타임, 증거 `tmp/t111-evidence/cli-migrate.log`)
  - 잘못된 행: exit 1, `원인 진단: 렌더 기록 019b8b82-be00-76c9-928d-d67503eacebb — file fields are incomplete`, DB 파일 sha256 전후 같음, 기록 6단계, 복사본 남김, 기록 파일 형식 그대로
  - 정상: 6→7 exit 0, 다시 실행 0개, renders·jobs 그대로, 이관 뒤 작업 kind 변경 거부
  - 증거에 PC 경로·이메일 0

## 4. 바꾼 파일
`lib/db/render-data.ts`, `lib/db/live-migrate.ts`, `lib/db/migrate-command.ts`, 새 `tests/p2-4a-migrate-diagnostic.test.ts`, 이 보고서

## 5. 남은 것
- 화면(앱 시작 점검)에 이 원인을 보여줄지는 Master 공용 정책 검토 대상이에요. 이번에는 CLI stderr에만 내요.
