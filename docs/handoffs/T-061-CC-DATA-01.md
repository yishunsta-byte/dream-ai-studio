# T-061 P2-1 편집 타임라인 구현 — CC-DATA-01 보고

- 담당: CC-DATA-01 (Claude Code)
- 기준: `docs/handoffs/T-060-TIMELINE-IMPLEMENTATION.md`, spec 2026-11-16.1 `migration.fromP1Values`
- Master 지시: msg_625a4340dc1e, 추가 요구 msg_c446cf2996c3, T-064 반영 msg_b20d69118b29

## 1. 한 일

| 묶음 | 파일 |
|---|---|
| 타임라인 값·변환(순수 모듈) | `lib/edit/timeline.ts` |
| 제품 코드 단계 0005 | `lib/db/migrations/0005_timeline_revisions.cjs`, `0005_timeline_shared.cjs`, `lib/db/migrate.ts`(PRODUCT_CODE_STEPS, productSqlMigrations) |
| 행 검사·이관 검증 | `lib/db/timeline-data.ts`, `lib/db/schema.ts`, `lib/repo/timeline.ts` |
| 서비스·API | `lib/services/timeline.ts`(새), `editing.ts`, `review.ts`, `exports.ts`, `workflow.ts`, `app/api/projects/[id]/timeline/route.ts`(새), `finishing/route.ts`(save-edit 410) |
| 오류 코드 | `migration-copy.ts`, `live-migrate.ts`, `migrate-command.ts`, `server.ts`(MIGRATION_SOURCE·MIGRATION_TIMEOUT), `lib/backup/archive.ts`(복원 검사에 타임라인 행 검사) |
| 화면 | `components/editing-panel.tsx`, `review-panel.tsx`, `exports-panel.tsx` |
| 시험 | `tests/p2-1-timeline.test.ts`, `tests/p2-1-timeline-api.test.ts`, `tests/s5-fixture.test.ts`, `tests/fixtures/backups/s5-build.ts`, `s5.zip`, `s5.json` |
| 문서 | `README.md`(수정·조립, 코드 단계, s5 단락) |

0005 선언 해시 `6a012009fd045439d6d3af8ad2021043fec475aadf10fd942b6585c9e88f0061` = 최종 원문 해시(시험 "선언 해시는 지금 원문과 같고"로 고정). lint 때문에 원문 한 곳(`catch (error)` → `catch`)을 고쳐 해시가 바뀌었고, 그 뒤 s5를 새로 만들었어요.

## 2. 검증 — 코드 작성과 실제 검증을 나눠 적어요

**코드·타입**: `npm.cmd run typecheck` 통과, `npm.cmd run lint` 0건.

**실제 전체 검증** (모두 OS 임시 폴더의 가상 사본, 실제 사용자 데이터 없음)
- `npm.cmd test`: 34개 파일, 407 통과 / 2 건너뜀(S4_WRITE·S5_WRITE 생성 전용).
- `npm.cmd run build`: 통과. `.next` 추적 목록에 0001~0004 SQL과 0005 원문이 들어가는 것 확인.
- CLI(`db:migrate`, 임시 DREAM_DATA_ROOT): 빈 폴더 0→5 "5개", 다시 "0개" / s4 사본 4→5 "1개"+복사본 `s4-s5.db`, 다시 "0개" / s5 사본 "0개".
- CLI 원문 오류: 다른 폴더에서 실행, 0005 원문 한 글자 수정, 도우미 파일 누락 — 셋 다 MIGRATION_SOURCE 문장 2줄, exit 1, DB 해시 그대로, 복사본·기록 파일 없음. 작업 처리기도 다른 폴더에서 시작 거부.
- production(`next start`, 포트 3061, 임시 데이터): 타임라인 GET 200(r1, p1-migration), 옛 save-edit 410, 편집·검수·내보내기 화면 200.
- 브라우저(ego-browser, 1280/390): 가로 넘침 0. 키보드 Tab 순서에 모든 입력·버튼, 초점 테두리 있음. 키보드로 글자 3을 고쳐 Enter 저장 → r2. stale 상태에서 검수·내보내기 안내와 편집 링크(Tab 도달), 검수 승인 비활성 + 이유.

## 3. Master 추가 요구별 근거

1. **옮긴 r1을 P1 스냅샷으로 읽는 경로가 stale·변조를 숨기지 않음**
   - r1을 P1 스냅샷으로 읽기 전에 r1 행 해시, 원래 P1 글자와의 일치, content_revision을 대조하고, 다르면 거부(시험 "변조는 숨기지 않는다": 트리거를 지운 사본에서 해시 불일치 → 거부, 해시를 맞춘 글자 변조 → "원래 글자 설정과 달라요").
   - stale은 P1 경로에서도 계산해 편집 완료·검수 승인·내보내기를 거부(시험 "선택이 바뀌면 stale").
   - ZIP 같음: 옮긴 r1의 묶음 글자 파일·`subtitles/manual.srt`가 P1 스냅샷으로 만든 것과 같음(시험 "옮긴 r1은 P1 스냅샷과 같은 묶음 글자·SRT"). 사용자가 고쳐 저장한 행은 프레임 기준이라 0.125초→0.133초가 됨(시험에 `00:00:00,133` 고정).
   - r1 해시 `711c8622…e226`, 행 id `b869b207-ae5f-8b36-8a9e-7709732e8344`, content_revision 5, created_at = P1 스냅샷 시각.
2. **공백 보존**: schema(`timelineSchema`)와 정규화(`canonicalJson`)는 trim하지 않음(단위 시험). 0005가 옮긴 r1과 다른 글자만 고쳐 저장한 r2 모두 `"  자막 하나 (0.125초 시작)  "` 바이트 그대로(서비스 시험 + 임시 DB 직접 조회). 화면·묶음·SRT는 P1 읽기처럼 앞뒤를 정리해 보여 줌(아래 4-②).
3. **productSqlMigrations 고정은 옛 fixture 시험에만**: k6-* 시험 5단계 계약과 s4 생성기만 P1 4단계 목록을 씀. 현재 제품 5단계는 별도 시험이 검증 — CLI 0→5/4→5, 시작 점검 통과, s5 직접 복원 same, s4 올려 복원 시 staging DB = s5 논리 해시, 0005 원문이 바뀐 앱은 s5를 BACKUP_SCHEMA_MISMATCH로 거부. 기대값을 낮춘 곳 없음(restore same 5/5, backup migrations 5줄로 올림).
4. **0005 원문 최종 해시 = 선언 해시**: 위 1장.

## 4. 이번에 고친 판단 (보고 필요)

1. **편집 화면 SRT 미리보기**: 옮긴 r1은 묶음이 P1 시간(0.125초)으로 만들어지는데 미리보기는 프레임 시간(0.133초)을 보여 줘 서로 달랐어요. 서버가 묶음과 같은 SRT(`savedSrt`)를 주고, 고치지 않은 동안은 그걸 보여 줘요. "P1에서 옮긴 시간 그대로 묶음에 들어가요. 바꿔서 저장하면 1/30초 단위로 맞춰요." 안내를 더했어요.
2. **앞뒤 공백**: P1은 읽을 때 앞뒤를 정리해서 묶음에 공백이 없었어요. 저장 행은 바이트를 그대로 두고, 화면·묶음 글자·SRT로 바꿀 때만 정리해요. 다른 글자를 고쳐도 묶음 결과가 P1과 달라지지 않아요.
3. T-064 반영: B1 초 표기를 `framesToSeconds`로(긴 소수 없음), B2 잠긴 필수 표기는 "저장한 시간 그대로 보존" 안내, B3 저장 시각 Asia/Seoul, A1 저장된 글자의 원래 끝 시간까지 입력 허용(서버 규칙은 그대로, 시험 `p2-1-timeline-api` A1), C1 검수·내보내기에 stale 이유 + 편집 링크.

## 5. 기존 시험을 고친 이유

- k6-code-migration·k6-compat·k6-migration-guard·k6-t044-guard·s4-fixture: 시험 전용 5단계 계약은 "P1 4단계 + 시험 단계"였는데, 제품 목록이 5단계가 되어 그 기준을 `productSqlMigrations()`로 고정했어요.
- restore·backup-service: 지금 제품이 5단계라 same 5/5, 기록 5줄로 올렸어요.
- database: 표 16→17(timeline_revisions).
- jobs: P1 settings 글자 행 시험을 timeline_revisions 불변 시험으로 바꿨어요.

## 6. 정리·남은 점

- `tests/tmp-t061`은 작업 중 만든 가상 시험 자원이었고 이미 지웠어요. 커밋에 없어요.
- s4 고정 백업의 프로젝트 템플릿 값은 자리표시(`{menuId,label,…}`)라 production에서 s4 프로젝트 화면이 500이 나요(이번 변경과 무관, s4 생성 때부터). 화면 확인은 임시 사본에서만 실제 템플릿 값으로 바꿔 했어요. s4.zip·s4.json은 그대로예요.
- 이관 전 화면(P1 빌드) 캡처는 따로 빌드하지 않았어요. 대신 이관 전후 위치·크기·시간이 같다는 것을 시험(P1 스냅샷 보기 = r1 보기)과 화면 값(글자 1 위·28·0~30초, 글자 2·3 아래·40)으로 확인했어요.
- 캡처는 작업 세션 임시 폴더에만 있어요(저장소에 넣지 않음).
