# T-223 t164 내보내기 화면 시험 시계 일치

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-222 진단 수용) · 상태: **ready_review** · 로컬 커밋만
- 고정 SHA: **`234806b11ec07d1033267673572e5967f314f409`** (부모 `364ea1e`, 이 보고서 커밋은 별도예요)
- 마지막 확인 시각: 2026-11-17T12:20:25Z (21:20 +0900)

## 바뀐 것(`tests/t164-export-ui.test.ts`만, +3/-1)
- `beforeEach`: `time` 고정 바로 뒤에 `vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(time-1000);`를 넣었어요(T-204와 같은 방식). Date만 가짜로 바꾸고 타이머는 실제 그대로 둬요.
- `afterEach`: 맨 앞에 `vi.useRealTimers();`를 넣었어요.
- 제품 코드·기대값·fixture·timeout은 바꾸지 않았어요. 시간 주입 API도 추가하지 않았어요.

## 검증(깨끗한 사본)
- 사본: `git archive be0e304`(당시 HEAD) + 제 t164 하나만 얹었어요.
  - node_modules와 `.tools/{ffmpeg,remotion-browser}`는 연결이 아니라 실제 복사했어요(robocopy).
  - Backend B15 작업 파일(`lib/repo/postgres/project-create.ts`, `project-create-storage*` 등)과 T-220 검수 중 소스는 섞지 않았어요.
  - be0e304 → 커밋 부모 364ea1e 차이는 `docs/TEAM.md`, `B14-R` 보고서뿐이에요(문서 2개).
- t164 시각별 결과
  - 실제 시각(12:14Z): `Tests 7 passed (7)`
  - 11:00Z로 조정: `Tests 7 passed (7)`
  - 12:30Z로 조정: `Tests 7 passed (7)`
  - 조정은 T-222와 같은 진단용 Date shim이에요(`NODE_OPTIONS=--import`, OS 시계는 그대로).
  - 수정 전에는 12:00Z 이후 `2 failed | 5 passed (7)`였어요(T-222).
- 관련 t164·t162·t166·backup-service → `Test Files 4 passed (4)`, `Tests 42 passed (42)`
- 전체 suite 1회(복사 의존성 사본) → `Test Files 89 passed | 8 skipped (97)`, **`Tests 1356 passed | 84 skipped (1440)`**
  - 참고: 의존성을 복사하기 전 첫 실행에서는 사본에 ffmpeg·node_modules가 없어 11개 파일이 환경 실패했어요(`spawnSync ffmpeg ENOENT`, `remotion/package.json` 없음 등). 제 변경과 무관해서, 실제 복사 뒤 다시 돌린 위 결과를 근거로 써요.
- 같은 사본에서 `tsc --noEmit`, `eslint . --max-warnings 0` 모두 exit 0이에요.
- 환경: Windows 11, node v26.13.0, vitest 5.1.0

## 같은 유형 감사(읽기 + 시각 대조, 다른 파일 수정 없음)
- 대상: 고정 `Date.parse("20…T…")` 시각과 실행기·`now` 주입을 함께 쓰는데 Date를 가짜로 바꾸지 않는 시험 10개
  - `backup-origin`, `backup-service`, `p2-3-text-editor`, `p2-4-render-jobs`, `p2-4-render-t120-jobs`, `p2-5a-audio`, `restore`, `s4-fixture`, `t158-export-manifest`, `t160-sample-consistency`
- 사본에서 Date를 2026-11-01Z(과거)와 2027-06-01Z(미래)로 옮겨 돌렸어요. 두 경우 모두 `Test Files 10 passed (10)`, `Tests 121 passed | 1 skipped (122)`였어요.
- 따라서 이 두 시각에서 시계 때문에 결과가 바뀌는 시험은 찾지 못했어요. 모든 시각을 증명한 것은 아니에요. 후속 후보로 확정한 파일은 없어요.
- t162·t166은 T-204에서 이미 같은 처리가 되어 있어요.

## 정리·보호
- `tmp/t223` 사본은 지웠어요.
- 3013, 공유 .next, OS 시계, 실제 DB, 배포는 건드리지 않았어요. T-220 경로3 문서 이동 원인은 계속 미확인이에요.
