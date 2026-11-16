# T-042 독립 검수 결함 F039-2·3·4 수정 — CC-DATA-01 보고

- 부모: T-035 · 근거: `T-039-K6-INDEPENDENT-REVIEW.md`, `F039-3-STARTUP-NOTICE-CC-DESIGN-01.md`(A안), Master 추가 조건(msg_7bc9e4f52e38)
- 시작 HEAD: 9c56033(T-041 다음) · 담당: CC-DATA-01 (임시 코딩 위임)
- 이번 완료는 **현재 SQL 이관 경로**만이에요. 코드로 데이터를 옮기는 이관의 해시 계약은 여전히 미구현이고 0005 전에 따로 풀어야 해요.

## 1. F039-2 기록 없는 기존 DB를 새 DB로 취급하던 문제 (필수)

| 파일 | 내용 |
|---|---|
| `lib/db/migrate.ts` | `databaseOrigin(sqlite)` → fresh / recorded / unrecorded. fresh는 사용자 객체(표·색인·보기·트리거)가 하나도 없고 user_version·application_id가 0일 때만이에요. **예외 하나**: 칸이 정확히 `version,name,sha256,applied_at`인 **빈 기록 표만** 있는 DB도 fresh예요(담긴 데이터가 없어서 잃을 것이 없음). 기록 표를 읽을 수 없거나(칸 모자람) 칸이 다르거나 다른 객체가 하나라도 있으면 unrecorded. `migrateDatabase`도 트랜잭션 안에서 같은 판정을 하고 unrecorded면 `UnrecordedDatabaseError`로 멈춰요(직접 호출도 같은 정책). |
| `lib/db/live-migrate.ts` | 맨 앞에서 unrecorded면 `SCHEMA_MISMATCH`(reason `unrecorded`)로 거부. 스냅샷 폴더도 만들지 않아요. `LiveMigrationError`에 `reason` 칸 추가(코드 집합은 그대로). |

## 2. F039-3 시작 점검의 이관 실패 안내 (디자인 A안 + Master 조건)

| 파일 | 내용 |
|---|---|
| `lib/db/migration-copy.ts` (새) | CLI와 시작 점검이 같이 쓰는 문장표. "복사본도 남겨 두었어요"는 확인된 복사본이 있을 때만 써요. 기록 없는 DB 문장, 준비 필요·올리기 필요 문장 포함. |
| `lib/db/migration-record.ts` (새) | `data/migration-last.json` 읽기·쓰기. 새 임시 파일(wx) → 이름 바꾸기. 읽을 때는 믿지 않는 입력으로 다뤄요: 일반 파일만(링크·폴더 거부), 4KB 이하, 엄격한 형식(모르는 칸·코드 거부), 복사본 경로는 `backups/pre-migrate/<시각>_s<n>-s<m>.db` 모양만. 이 기록이 **지금 DB 상태**(기록 표 행 전체+적용 시각, 모든 사용자 객체 정의의 해시)와 **지금 앱 이관 목록**(번호·이름·해시)의 지문과 둘 다 맞을 때만 써요. 복사본은 runtime 루트 아래 `backups`·`pre-migrate`가 링크가 아닌 진짜 폴더이고, 파일이 실제 경로 그대로 그 안에 있는 일반 파일이며, SQLite 머리글이 맞을 때만 "남아 있다"고 해요. 경로는 runtime 루트 기준 상대 경로(외부 `DREAM_DATA_ROOT` 그대로 지원). |
| `lib/db/migrate-command.ts` (새) | `db:migrate` 본체. DB 작업이 끝난 뒤 성공·실패 모두 기록을 남겨요. 기록을 못 써도 종료 코드·DB는 그대로이고 안내 한 줄만 더해요. SNAPSHOT_FAILED의 반쪽 파일은 복사본이라 부르지 않아요. |
| `scripts/db.ts` | migrate는 위 함수로. seed는 그대로. |
| `lib/db/server.ts` | `checkDatabase(root?, list?)`: DB 검사가 통과하면 기록을 보지 않아요. 실패하면 ① 지문이 맞는 실패 기록 → 같은 문장·복사본 상대 경로·다음 행동·코드 ② 아니면 DB 자체로 판단: 기록 없는 DB / 빈 DB·파일 없음(준비 필요) / 앞부분만 적용(올리기 필요) / 그 밖은 기존 문장. |
| `lib/domain/startup.ts`, `lib/services/startup.ts`, `components/setup-report.tsx` | 시작 점검 줄에 `detail`(복사본·다음 행동)과 `code`(작은 글씨 `코드 …`)를 더했어요. 위쪽 안내 상자는 폴더 실패일 때만 "저장할 수 없는 폴더"라고 하고, 그 밖은 "아래 실패한 항목 때문에…"로 바꿨어요. |
| `README.md` | db:migrate 줄에 두 문장 추가. |

## 3. F039-4 실행마다 다른 값의 검사 강화

`tests/k6-compat.test.ts` `expectRestoreRows`
- `protectedRoots`를 이번 실행의 원본 경계와 정확히 비교해요: runtime 루트, data, storage, backups(DB 폴더는 data와 같음).
- 새 활동 행 `created_at`: ISO 모양만 보던 것을 이번 finish 앞뒤에 잰 시계 범위 안인지 확인해요.
- **발견**: 복원본의 `restore.completed` 활동 시각은 주입한 시계(`now`)가 아니라 시스템 시계로 써져요(`jobsRepository.log`). `restoredAt`은 주입 시계라 두 값의 기준이 달라요. 데이터 손실은 아니고, 고치려면 `restore.ts`(T-035 범위)를 바꿔야 해서 손대지 않았어요. 필요하면 별도 배정 부탁해요.

## 4. 시험

새 `tests/k6-migration-guard.test.ts` 19개
- F039-2: 기록 없는 9가지(알 수 없는 표+값, 빈 기록 표+표, 기록 없는 제품 표, 보기만, 표+트리거, 빈 기록 표+색인, 칸 모자란 기록 표, 칸 다른 빈 기록 표, user_version만) → 지금 DB 이관·직접 migrate 모두 거부, 스냅샷 폴더 없음, DB 파일 해시 그대로. 진짜 빈 DB·정확한 빈 기록 표만 → 4단계 적용. 정상 제품 DB의 upgrade(스냅샷)·같은 구조 no-op 통과.
- F039-3: 기록 없음 안내 → 성공 기록·통과 / 이관 실패 → CLI와 시작 점검 같은 문장·복사본 상대 경로·코드, 기록에 절대 경로 없음, DB 해시 그대로 / 복사본을 가짜 파일로 바꾸거나 지우면 "복사본 남김" 문장 안 씀 / 복사본 폴더를 junction으로 바꾸면 안 씀 / 기록 쓰기 실패 → 종료 코드 1·DB 그대로·기본 안내, 성공 때도 종료 코드 0 / 옛 기록: 같은 개수 다른 앱 목록, 같은 개수 다른 DB, 성공 뒤 늦게 쓴 실패 기록(동시 실행), no-op 성공이 실패 기록을 덮음 / 깨진 JSON·모르는 칸·4KB 초과·경로 탈출·절대 경로·모르는 코드·폴더로 바뀐 기록 → 무시, 멈추지 않음 / 기록 없는 DB의 CLI·시작 점검 같은 문장 / SNAPSHOT_FAILED·SNAPSHOT_EXISTS(있던 파일 보존) + 외부 DREAM_DATA_ROOT.
- 일부러 되돌려 보기: 거부 판정을 빼면 10개 실패, DB 지문 대조를 빼면 1개 실패, 링크 검사를 빼면 1개 실패 → 원래대로 돌려 19개 통과.

전체: lint 통과 · typecheck 통과 · test 29파일 280 통과(+1 건너뜀, s4 생성 모드) · build 경고 0.

## 5. 실제 실행 (임시 가상 폴더만, 끝난 뒤 삭제)

- **s3 + 0004 충돌**: 제품 1~3 SQL과 정확한 기록에, 0004가 만드는 트리거 이름을 미리 만들어 둔 DB → 실제 `npm run db:migrate`: 종료 1, 문장 3줄(복사본 `backups/pre-migrate/<시각>_s3-s4.db`), 기록 파일 생성(절대 경로 없음), DB 파일 해시 그대로.
- **기록 없는 DB**: 표+행만 있는 DB → 실제 CLI 종료 1, unrecorded 문장, 스냅샷 폴더 없음, DB 해시 그대로.
- 두 폴더로 `next start`(127.0.0.1:3042)를 띄워 ego lite로 /setup 확인: 1280·390 모두 같은 첫 문장(굵게)·복사본 상대 경로·다음 행동·`코드 …` 줄, 가로 넘침 없음(1280: 1265/1280, 390: 390/390), 화면에 절대 경로 없음. 앱이 연 뒤에도 DB 해시 그대로. 화면 사진: `C:/Users/Administrator/ego/t041/t042-*.png`(저장소에 넣지 않음).

## 6. 남은 것·한계

- 코드 데이터 이관 해시 계약: 미구현(0005 전 진입 조건 그대로).
- 위 3장의 활동 시각 기준 차이(restore.ts) — 별도 판단 필요.
- 시작 점검 화면은 서버가 그리는 정적 화면이라 키보드로 할 동작이 없어요(새로고침뿐).
- 같은 권한의 다른 프로그램이 확인과 사용 사이에 파일을 바꾸는 경쟁은 막지 못해요(안내 문장만 영향, DB는 영향 없음).
- DATABASE_BUSY는 기존 E3 시험으로만 확인했고 CLI 기록 흐름으로는 따로 주입하지 않았어요(같은 코드 경로).
