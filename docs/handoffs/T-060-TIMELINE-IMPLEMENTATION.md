# T-060 · P2-1 타임라인 구현 설계 (구현자용 계약)

> **설계 문서예요. 제품 P2-1 착수가 아니에요.** 코드·SQL·0005·고정 fixture·PLAN·공용 문서는 바꾸지 않았어요.
> 이 문서의 "**추천**"은 Master 채택이 필요한 제안이고, "**정함**"은 기존 기준(PLAN·T-033·T-049·Master 결정)을 그대로 옮긴 것이에요.

| 항목 | 내용 |
|---|---|
| 작업 | T-060 · CC-DATA-01 · Master msg_e467ccd63cd0 (P2-1 준비) |
| 기준 HEAD | 424471d (제품 코드 94a13c2 동기 코드 이관 계약 — T-059 최종 PASS msg_1475656c6583) |
| 근거 | PLAN v2.4 7.1·7.2(T-002)·11.2·11.3·14장 K-6·18장 P2-1, T-033(2·5·6·7장), T-049(U-1·U-3·U-7 방향), `docs/spec/text-presets.json`(units·migration·presets) |
| 읽은 코드 | `lib/edit/schema.ts`, `lib/services/editing.ts`·`workflow.ts`·`exports.ts`·`review.ts`, `lib/repo/finishing.ts`, `lib/domain/stages.ts`, `lib/db/schema.ts`·`migrate.ts`·`code-migration.ts`·`migrate-command.ts`·`server.ts`·`migration-copy.ts`, `lib/db/migrations/0001~0004`, `lib/backup/compat.ts`, `app/api/projects/[id]/finishing/route.ts`, `next.config.ts`, 시험 5단계 fixture, `tests/fixtures/backups/s4.zip`(OS 임시 폴더에 복사해 읽기만 하고 삭제, 원본 해시 앞 16자리 `6e492c61799d0a87` 전후 같음) |
| 바꾼 파일 | 이 파일 하나 |

---

## 0. 한눈에

| 결정 | 내용 |
|---|---|
| 저장 단위 | `timeline_revisions` 행 하나 = 타임라인 버전 하나. **행은 고치거나 지우지 않음**(트리거로 강제). |
| 현재 버전 | `projects.current_timeline_rev_id`(0001부터 있는 칸) 하나만 바꿈. 새 settings 포인터를 만들지 않음. |
| 동시 저장 | 기존 `content_revision` CAS(`assertRevision`) + 기대 현재 버전 ID. 둘 중 하나라도 다르면 409 거절. |
| 내용 버전 | 저장·되돌리기는 `workflow.changeContent(..., "edit", ...)`로 내용 버전 +1, edit 이후 단계(검수·내보내기) 무효(U-7 정함). |
| 같은 내용 | 정규화 JSON의 sha256이 현재 버전과 같으면 새 행 없음, 내용 버전 그대로. |
| 되돌리기 | 옛 버전 내용으로 **새 행**(`source "restore-version"`), 옛 행 그대로. |
| 0005 | **코드 이관 단계 하나**(SQL은 `module.exports.sql`, 데이터는 `run`). P1 `edit.current`가 가리키는 스냅샷만 r1로 옮김. settings 스냅샷 행은 남김. 내용 버전·단계 상태는 바꾸지 않음. |
| 저장 API | P2-1은 **명시 저장 API만**. 자동 저장(U-4)은 같은 API를 부르는 화면 정책으로 P2-3에서 정함(추천). |

---

## 1. DB — 0005 `module.exports.sql`

### 1.1 표

```sql
CREATE TABLE timeline_revisions (
  id TEXT PRIMARY KEY NOT NULL,                 -- 사용자 저장은 UUIDv7, 0005 이관 행은 원래 키에서 만든 UUIDv8(2.3)
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL CHECK (revision >= 1), -- 프로젝트 안에서 1부터 1씩
  content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
  timeline_json TEXT NOT NULL CHECK (json_valid(timeline_json)),
  timeline_sha256 TEXT NOT NULL CHECK (length(timeline_sha256) = 64),
  source TEXT NOT NULL CHECK (source IN ('p1-migration','user','restore-version')),
  restored_from_id TEXT REFERENCES timeline_revisions(id),
  migrated_from_key TEXT,                       -- p1-migration 행만: 'project.<id>.edit.<snapshotId>'
  created_at TEXT NOT NULL,
  UNIQUE (project_id, revision),
  CHECK ((source = 'restore-version') = (restored_from_id IS NOT NULL)),
  CHECK ((source = 'p1-migration') = (migrated_from_key IS NOT NULL))
) STRICT;
CREATE INDEX timeline_revisions_project_idx ON timeline_revisions(project_id, revision);
```

- `created_at`은 항상 값으로 넣어요. `CURRENT_TIMESTAMP`·`'now'`는 SQL_RULES에 걸리므로 쓰지 않아요(K-6 결정성).
- `timeline_sha256` = 2.4의 정규화 JSON의 sha256이에요. 같은 내용인지 비교할 때와, 이관 결과를 검사할 때 써요.

### 1.2 불변·포인터 트리거 (추천)

```sql
CREATE TRIGGER timeline_revisions_update_guard BEFORE UPDATE ON timeline_revisions
BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;
CREATE TRIGGER timeline_revisions_delete_guard BEFORE DELETE ON timeline_revisions
BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;
CREATE TRIGGER projects_timeline_pointer_guard BEFORE UPDATE OF current_timeline_rev_id ON projects
WHEN NEW.current_timeline_rev_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM timeline_revisions t WHERE t.id = NEW.current_timeline_rev_id AND t.project_id = NEW.id)
BEGIN SELECT RAISE(ABORT,'timeline pointer must name a revision of the same project'); END;
```

- `current_timeline_rev_id`에는 FK가 없어요(0001 칸이고, SQLite는 표를 다시 만들지 않으면 FK를 더할 수 없어요). 그래서 **다른 프로젝트 행이나 없는 행을 가리키는 포인터**는 이 트리거로 막아요. 표를 다시 만드는 방법은 쓰지 않아요(0001 원문 불변, 위험 큼).
- 0003의 `edit_snapshot_*_guard`는 그대로 둬요. P2 코드는 `project.*.edit.*`를 **쓰지 않아요**(`.current` 포함). P1 스냅샷은 읽기 전용 기록으로만 남아요(PLAN 7.2 T-002 정함).

---

## 2. 타임라인 JSON (`lib/edit/timeline.ts` 새 zod 스키마)

### 2.1 모양 — PLAN 11.2·11.3 그대로, 아래 두 가지는 추천 보완

```jsonc
{
  "schemaVersion": 1, "fps": 30, "aspect": "9:16",
  "video": [ { "id": "…", "sceneId": "…", "sceneVersionId": "… | null", "assetId": "… | null",
               "durationFrames": 90, "trimInFrames": 0, "trimOutFrames": 0,
               "transition": { "type": "cut", "durationFrames": 0 } } ],
  "audio": [],
  "text":  [ /* TextLayer (PLAN 11.3) */ ]
}
```

| 보완(추천) | 이유 |
|---|---|
| `video[].durationFrames`(정수 ≥ 1) | 11.2 예시는 영상만 생각해 `trimIn/Out`만 있어요. 이미지 결과는 원래 길이가 없어서, U-3(기획 장면 초 × 30)을 담을 칸이 필요해요. 영상은 `durationFrames = 원본 프레임 − trimIn − trimOut`을 서버가 검사해요. |
| `sceneVersionId`·`assetId`가 `null`인 **빈 자리** | 선택한 결과가 없는 장면도 순서와 길이를 지켜야 해요. 실제 s4 프로젝트 1의 현재 스냅샷에 **선택 결과 없는 장면 1개(3번째)**가 있어요. 화면에는 "결과 선택 필요"로 보여요. 내보내기와 렌더(P2-4)에서는 거부해요. |

PLAN 11.2 예시를 바꾸는 일은 플래너(Claude design) 몫이에요. 채택되면 PLAN·DESIGN에 반영해 달라고 요청해요.

### 2.2 검사 규칙 (스키마 + 저장 서비스)

| 규칙 | 내용 |
|---|---|
| 시간 | 모든 시간은 정수 프레임이에요. `fps`는 30 고정이에요. `aspect`는 프로젝트 `aspect`와 같아야 해요(비율 바꾸기는 U-2 그대로 P2-3 이후 별도). |
| 장면 | `video[]`에 **지금 보관되지 않은 장면이 빠짐없이 한 번씩** 있어야 해요(P1 `save`의 sceneOrder 검사와 같아요). |
| 장면 결과 | `sceneVersionId`가 있으면 그 장면의 `selected_version_id`와 같아야 하고 status는 `succeeded`여야 해요. `assetId`는 그 버전의 `result_asset_id`여야 해요. 이 둘은 서버가 맞춰 넣고, 화면이 보낸 값은 검사만 해요. |
| 글자 | P1 저장 검사를 프레임으로 옮겨요. id가 겹치지 않아야 하고, 끝 ≥ 시작 + 1, 필수 표기(`requiredDisclosures`)는 문구·잠금·크기·색·전체 길이가 같아야 해요(위치만 바뀔 수 있음). |
| 글자 끝 상한 | **추천:** `endFrame ≤ max(영상 줄 합계 프레임, 프로젝트 length_sec × 30)`. s4 프로젝트 1은 장면 합 9초인데 표기 글자가 0~30초예요(프로젝트 길이 30초). P1 화면 검사(장면 합 이하)를 그대로 쓰면 옮긴 r1을 다시 저장할 수 없어요. 이관 때는 자르지 않고 그대로 옮기고, 화면에 "영상보다 긴 글자" 경고만 보여요(spec `migration.fromP1` "조용히 바꾸지 않음"). |
| 크기 | `video` 100개, `text` 100개 이하(P1 상한과 같음). JSON 1MB 이하. |

### 2.3 ID

- 사용자 저장 행·새 클립·새 글자는 UUIDv7이에요.
- **0005 이관 행**:
  - 행 id = `derivedUuid("dream-0005:row:" + 원래 settings 키)`
  - 클립 id = `derivedUuid("dream-0005:clip:" + 원래 키 + "#" + sceneId)`
  - 글자 id는 P1 id 그대로예요(T-033 6장).
- `derivedUuid`는 시험 5단계 `test5-ids.cjs`와 같은 방식이에요(sha256 → UUIDv8 모양). 접두어만 `dream-0005:`로 달라요.
- zod: 행 id·클립 id는 `z.uuid()`(v7·v8 모두 허용)이에요. 글자 id는 P1과 같이 `z.uuidv7()`이에요.

### 2.4 정규화와 같은 내용 판정

- **정규화** = 2.2를 통과한 값을 **키 사전순 정렬**한 `JSON.stringify`(공백 없음, 배열 순서 유지)예요. `timeline_sha256` = 그 문자열의 sha256(hex)이에요.
- 호스트 쪽(TS)과 0005 원문(.cjs)이 같은 정규화를 각자 구현해요. 0005의 `verify`(호스트, 읽기 전용)가 이관한 모든 행을 다시 zod로 읽고 정규화해, 해시가 저장 값과 같은지 확인해요. 두 구현이 달라지면 이관이 실패하고 전부 되돌아가요.

---

## 3. 저장·버전 서비스 (`lib/services/timeline.ts` 새 파일, `lib/repo/timeline.ts`)

모든 쓰기는 `handle.sqlite.transaction(...).immediate()` 하나 안에서 해요. 단계 게이트는 P1 편집과 같아요: `assertPreviousApproved("edit")`, 시작 점검 실패면 503.

| 동작 | 순서 |
|---|---|
| `get(projectId)` | 단계 게이트 → 현재 행(포인터) → 없으면 **저장하지 않은 초안**을 계산해서 돌려줘요(P1 `get`처럼 장면·필수 표기로 만든 기본값). **읽기는 아무것도 쓰지 않아요**(T-033 "처음 열 때 만든다"를 바꾸는 추천: 열기만 해도 내용 버전이 오르고 검수가 무효가 되는 일을 막아요). 돌려주는 값: `contentRevision`, `current{ id, revision, source, createdAt, timeline }`·`null`, `draft`(current 없을 때), 버전 목록(최근 50개: id·revision·source·createdAt·요약), 경고(선택 결과가 바뀐 장면, 영상보다 긴 글자, 빈 자리). |
| `save(projectId, expectedRevision, expectedTimelineId, timeline)` | ① `assertRevision(expectedRevision, project.contentRevision)` ② `expectedTimelineId !== project.currentTimelineRevId`이면 CONFLICT ③ 2.2 검사·서버 값 채우기 ④ 정규화 해시가 현재 행과 같으면 `{created:false}`를 돌려주고 끝(내용 버전 그대로) ⑤ `workflow.changeContent(projectId, expectedRevision, "edit", "timeline.save", …)` 안에서: 새 행(`revision = max+1`, `content_revision = 이전+1`, `source "user"`, `created_at = 지금`) → `current_timeline_rev_id` 갱신 → `scenes.position`을 `video[]` 순서로 맞춤(P1 save와 같음) ⑥ `{revision:새 내용 버전, timelineId, timelineRevision, created:true}` |
| `restore(projectId, expectedRevision, expectedTimelineId, fromId)` | ①② 같음 ③ `fromId`가 같은 프로젝트 행인지 확인 ④ 그 JSON을 **지금 규칙으로 다시 검사**해요. 장면이 바뀌어 통과하지 못하면 거부하고 "그 버전 이후 장면이 바뀌어 그대로 되돌릴 수 없어요"라고 알려요. ⑤ 해시가 현재와 같으면 생략 ⑥ `changeContent(..., "timeline.restore", …)` 안에서 새 행(`source "restore-version"`, `restored_from_id = fromId`) + 포인터 |
| 활동 기록 | `changeContent`가 이미 `{previousRevision, contentRevision, origin}`을 남겨요. 추가 detail로 `timelineRevision`·`timelineId`(restore는 `restoredFromId`)를 남겨요(추천: `changeContent`에 detail 확장 인자 하나). |
| 완료(edit 단계) | 기존 `complete-edit` 그대로이고, 조건만 "현재 타임라인 행이 있음"으로 바꿔요(P1 `savedId` 대신). |

P1 `editingService.save`는 P2-1 이후 쓰지 않아요(엔드포인트 `save-edit`은 410 또는 제거, 2.5 결정 필요 항목 D-3).

### 3.1 검수·내보내기 읽기 경로

- `review.ts`와 `exports.ts`는 지금 `editingService(handle).current()`(P1 스냅샷)를 읽어요. **P2-1부터는 현재 타임라인을 읽어요.** 현재 타임라인이 없을 때만 P1 스냅샷을 읽는 대체 경로를 둬요(0005 뒤에는 P1 current가 있는 프로젝트는 모두 r1이 있으므로, 이 대체 경로는 사실상 "저장 전" 상태예요).
- SRT(`srtText`)는 프레임에서 만들어요: 시작 ms = `floor((frame × 1000 + 15) / 30)`처럼 **정수 반올림 한 규칙**으로 정해요. 옮긴 프로젝트의 SRT 바이트는 P1 ms 값과 최대 16.7ms 다를 수 있어요(프레임 반올림). 이 차이는 P2 종료 기준 0.2초 안이고, 내보내기 manifest 버전은 P2-6에서 다뤄요. P2-1은 manifest 형식을 바꾸지 않아요.

---

## 4. API (`app/api/projects/[id]/timeline/route.ts` 새 파일)

| 요청 | 본문 | 응답 |
|---|---|---|
| `GET` | — | 200 `{ result: get() }` |
| `POST` | `{ action:"save", revision, timelineId:string\|null, timeline }` | 200 `{ result:{ revision, timelineId, timelineRevision, created } }` |
| `POST` | `{ action:"restore", revision, timelineId, fromId }` | 200 같은 모양 |

- 오류 모양과 문구는 finishing route와 같아요.
  - `WorkflowError` → status·문구
  - zod·JSON 오류 → 400 "타임라인 값을 확인해 주세요."
  - 나머지 → 503
- 충돌 문구는 T-033 그대로예요: "다른 창에서 먼저 저장했어요. 새로고침한 뒤 다시 고쳐 주세요."
- 프로젝트 id는 `z.uuidv7()` 확인이에요(기존과 같음). `timelineId`·`fromId`는 `z.uuid()`예요.
- **U-4(자동 저장) — 추천:** P2-1은 이 명시 저장 API만 만들어요. "2초 쉼·칸 벗어남·Ctrl+S 중 먼저"는 P2-3 화면이 같은 API를 부르는 방식으로 정해요. 서버는 같은 내용 생략(2.4)과 CAS만 보장해요. 그래서 자동 저장 빈도가 바뀌어도 서버 계약은 그대로예요.

---

## 5. 0005 코드 이관 (P1 current 스냅샷 → r1)

### 5.1 파일·등록

| 항목 | 내용 |
|---|---|
| 원문 | `lib/db/migrations/0005_timeline_revisions.cjs`(entry) + `lib/db/migrations/0005_timeline_shared.cjs`(derivedUuid·정규화·초→프레임) — 목록 순서 고정 |
| 등록 | `productMigrations()`에 `codeMigration({version:5, name:"0005_timeline_revisions.cjs", files:[…], sha256:"…", verify: timeline0005Verify})`를 넣어요. 해시는 원문을 확정한 뒤 계산해 적고, 원문 바이트는 그 뒤로 고치지 않아요. |
| 동기 전용 계약(T-058) | 원문 **어디에도** 단어 `async`·`await`·`import`가 있으면 안 돼요(주석·문자열 포함). 주석에 "import"라고 쓰는 것도 거부돼요. SQL_RULES 때문에 원문 안에 `'now'`·`CURRENT_*`·`random(`도 쓰지 않아요. `require`는 목록의 두 파일과 `node:crypto`의 `createHash("sha256").update(문자열).digest("hex")`만 돼요. |
| 결정성 | 시각·난수 없음. `created_at` = 스냅샷의 `created_at`, ID는 2.3, 정렬은 키 사전순이에요. 시험: 같은 입력을 다른 시각에 두 번 올려 결과가 같은지 확인해요(기존 `sameAcrossClocks` 방식). |

### 5.2 `run(sqlite)` 규칙

1. `projects` 전체를 `id` 순으로 읽어요. **보관한 프로젝트도 똑같이** 옮겨요(데이터 보존. 보관 여부는 이관에 영향을 주지 않아요).
2. `project.<id>.edit.current`가 없으면 → 행을 만들지 않아요. 포인터는 null 그대로예요(미완성 프로젝트: 화면은 3장 `get`의 초안을 써요).
3. 있으면 그 값(UUID 문자열)이 가리키는 `project.<id>.edit.<snapshotId>`를 읽어요. **추천 — 아래 경우는 이관 전체를 실패시켜요**(MIGRATION_FAILED, DB 그대로, 복사본 남음). P1 코드도 이 상태를 "저장한 글자 설정을 확인해 주세요"로 막고 있었고, 조용히 건너뛰면 사용자가 모르는 사이에 글자가 사라지기 때문이에요.
   - 포인터 JSON이 깨졌거나, 가리키는 행이 없거나
   - 스냅샷 JSON이 깨졌거나, `schema_version !== 1`이거나
   - 필수 칸 모양이 다른 경우
4. `video[]`
   - **순서:** 스냅샷 `sceneOrder` 중 지금 보관되지 않은 장면을 그 순서대로 넣고, 그다음 순서에 없는 활성 장면을 `position`·`id` 순으로 붙여요. 보관된 장면은 빼요.
   - **결과:** 장면의 `selected_version_id` → 버전 status가 `succeeded`이고 `result_asset_id`의 asset이 있으면 채우고, 아니면 빈 자리(null)예요.
   - **길이:** 이미지·빈 자리 = `duration_sec × 30`(U-3). 영상 = `min(round(asset.duration_ms × 30 / 1000), duration_sec × 30)`, `trimOutFrames = 원본 프레임 − durationFrames`, `trimInFrames = 0`이에요.
   - **speech:** speech 결과가 선택돼 있으면 빈 자리로 두고 `audio`는 비워요(P2-5).
   - `transition {type:"cut", durationFrames:0}`
5. `text[]` = 스냅샷 `layers` 순서 그대로, T-033 6장 표를 따라요.
   - `box`: U-1 정함 — x 0.44, y top 0.16 · middle 0.50 · bottom 0.74, `anchor "center"`, `widthRatio 0.76`, `rotation 0`
   - `style`: `fontWeight 700`, stroke·shadow·background `null`, `align "center"`, `letterSpacing 0`, `lineHeight 1.3`(tokens `--lh-tight`), `maxLines` = 그 kind의 spec 프리셋 값(subtitle 2, hook 2, emphasis 1, title 2, ending 2, disclosure 1)
   - `animation`: in·out `none`, emphasis `none`, `durationFrames 0`, easing `"ease-out"`
   - 나머지 칸(id·kind·content·fontSize·color·locked)은 그대로예요.
6. **초 → 프레임 (spec `secondsToFrames` 정함, 계산 방법 추천):** P1 값은 0.001초 단위가 보장돼요. `ms = Math.round(sec × 1000)` → `frame = Math.floor((ms × 30 + 500) / 1000)`처럼 **정수만으로 반올림**(0.5는 올림)해요. 끝 = `max(끝, 시작 + 1)`. 부동소수 곱셈(`0.05 × 30 = 1.5000000000000002`) 문제를 피하는 방법이에요.
   - s4 실측 예: 0.125초 → 3.75 → **4**, 2.5초 → **75**, 5.25초 → 157.5 → **158**, 30초 → **900**
7. 행 넣기: `revision 1`, `content_revision` = 스냅샷 값(T-033 2.2 정함, 출처 기록), `source "p1-migration"`, `migrated_from_key` = 원래 키, `timeline_sha256` = 2.4, `created_at` = 스냅샷 값.
8. `projects.current_timeline_rev_id` = 그 행이에요(트리거 통과). **`content_revision`·`updated_at`·`stage_states`·검수·내보내기는 바꾸지 않아요**(추천: 이관은 보이는 내용을 바꾸지 않으므로, 이미 승인한 검수를 무효로 만들지 않아요). 활동 기록도 쓰지 않아요(시각이 필요해서 결정성이 깨져요). 이관 사실은 `migrated_from_key`가 증거예요.
9. P1 settings 스냅샷·포인터 행은 그대로예요(0003 트리거가 지켜요).

### 5.3 `verify(sqlite)` (호스트, 읽기 전용)

| 검사 | 내용 |
|---|---|
| 개수 | `edit.current`가 있는 프로젝트 수 = `source 'p1-migration'` 행 수, 프로젝트마다 r1 하나 |
| 포인터 | 그 프로젝트들의 `current_timeline_rev_id` = 그 행. 다른 프로젝트는 null 그대로 |
| 내용 | 행마다 `timelineSchema.parse` 통과, 정규화 해시 = `timeline_sha256`, 글자 수·문구·kind·잠금·크기·색이 스냅샷과 같음, 프레임 = 5.2-6 계산과 같음 |
| 보존 | settings `project.*.edit.*` 행 수·내용이 이관 전과 같음 — verify는 이관 전 값을 모르므로 이 검사는 시험(6장)에서 행 해시를 전후로 비교해요 |

---

## 6. 시험·통합 완료 조건 (T-061 구현자용)

### 6.1 단위·서비스 시험 (새 `tests/p2-1-timeline.test.ts` 등)

1. 스키마: 정상, 프레임 정수·끝 ≥ 시작+1, `durationFrames`, 빈 자리, aspect 불일치 거부, 2.2 각 규칙
2. 저장: 새 행 + 포인터 + 내용 버전 +1 + 검수·내보내기 단계 무효(같은 트랜잭션), 옛 행 해시 불변
3. 같은 내용 저장 → 새 행 없음, 내용 버전 그대로
4. CAS: 내용 버전 불일치, 기대 타임라인 ID 불일치 → 409 문구. 두 창 동시 저장 → 하나만 성공
5. 되돌리기: 새 행 `restore-version` + `restored_from_id`, 옛 행 그대로. 지금 장면과 맞지 않으면 거부
6. 불변 트리거: 행 UPDATE/DELETE 거부, 다른 프로젝트 행·없는 행을 가리키는 포인터 거부
7. 필수 표기: 지우기·문구 바꾸기·잠금 풀기 거부, 위치만 바꾸기는 허용
8. 검수·내보내기가 타임라인을 읽음. SRT를 프레임에서 만들고 ms 반올림 규칙 확인

### 6.2 이관(K-6) 시험

1. 가상 DB: current 있음·없음, 보관 프로젝트, 보관 장면, 선택 없음, 영상 결과(duration_ms), speech 선택, 깨진 포인터·스냅샷(이관 전체 실패 + DB 그대로 + 복사본)
2. **s4 회귀**
   - s4 → 직접 migrate = staging 올려서 복원 결과(K-6 ⑧)
   - 프로젝트 1의 r1: 장면 3개(3번째 빈 자리), 글자 3개, 프레임 0–900 / 4–75 / 75–158, `content_revision 5`
   - 프로젝트 2·3(보관): 행 없음
   - s4.zip 해시 그대로
3. 결정성: 같은 입력을 다른 시각에 두 번 → 행·해시 같음
4. settings 스냅샷 행 해시 전후 같음, 내용 버전·단계 상태 전후 같음
5. 0005 원문 해시 계약: 원문 한 글자 수정·파일 누락 → 선언 해시 불일치로 거부, 어떤 단계도 적용 안 됨(T-051 계약 시험 재사용)
6. **고정 s5 (추천):** s4를 올린 결과로 새 고정 백업 `s5.zip`(manifest의 migrations에 0005 코드 해시 포함)을 만드는 생성 스크립트와 고정 파일을 추가해요. 시험 내용:
   - s5 직접 복원 → 같은 버전(`same`)
   - s5 → 0005 원문이 바뀐 앱 → `BACKUP_SCHEMA_MISMATCH`
   - s4 → 올려서 복원 결과 = s5 내용

   s4는 고치지 않아요.

### 6.3 진입점 통합 (Master msg_1475656c6583 조건)

| 진입점 | 확인 |
|---|---|
| 원문 동봉·cwd | `productMigrations()`는 `process.cwd()/lib/db/migrations`를 읽어요. `next start`·`db:migrate`·작업기를 **저장소 루트에서** 실행할 때 0005 원문 두 파일이 그 경로에 있어야 해요. `next.config.ts`의 `outputFileTracingExcludes`가 이 경로를 빼지 않는지, standalone 출력을 쓰지 않는지 확인해요. 원문이 없거나 바뀌면 `MigrationSourceError`예요. |
| CLI `db:migrate` | 빈 DB 5개 / s4 사본 4→5 / 이미 5 → 0개. 0005 원문 누락·수정 → 실패 기록 + 안내 문구 |
| 시작 점검·앱 | `checkDatabase`가 0005 원문 오류를 "앱 파일 확인 필요"로 보여 줘요(지금 `migration-copy.ts`에는 원문·시간 초과 전용 코드가 없어요). **추천:** `MigrationSourceError`는 `MIGRATION_SOURCE`, `MigrationTimeoutError`는 `MIGRATION_TIMEOUT`이라는 새 코드와 쉬운 문구로 연결해요. 예: "앱의 데이터 이관 파일이 빠졌거나 바뀌었어요. 지금 데이터는 그대로예요. 앱을 다시 설치하거나 받은 파일을 확인해 주세요." 기록 파일(`migration-record`)에도 같은 코드가 남아요. |
| 프로덕션 Next | `npm.cmd run build` 뒤 `next start`로 같은 코드 단계를 실행해요(개발 서버만으로는 통과가 아님). 시작 점검 화면에서 정상·원문 누락 두 경우를 확인해요. |
| DB 접근 전 검증 | 앱(`withDatabase`)·작업기·복원 staging·CLI 모두 DB를 쓰기 전에 `verifyMigrations`(0005 원문 해시 포함)를 거쳐요. 원문이 바뀌면 어떤 쓰기도 하지 않아요. |
| 화면 | `/projects/[id]/edit` 머리에 "저장됨 · 타임라인 r{n} · {시각}"을 보여요. 1280·390 가로 넘침 0. 옮긴 글자의 위치·크기·색이 P1 미리보기와 같은지 캡처로 비교해요(T-033 2.4-3). |

### 6.4 바꿀 파일 범위 (T-061 예상)

- 새 파일
  - `lib/db/migrations/0005_timeline_revisions.cjs`, `0005_timeline_shared.cjs`
  - `lib/edit/timeline.ts`
  - `lib/repo/timeline.ts`, `lib/services/timeline.ts`
  - `app/api/projects/[id]/timeline/route.ts`
  - 시험 파일들
  - `tests/fixtures/backups/s5.zip`와 생성 스크립트
- 고칠 파일
  - `lib/db/migrate.ts`(productMigrations 등록·verify)
  - `lib/db/schema.ts`(drizzle 표 정의)
  - `lib/services/review.ts`·`exports.ts`(읽기 경로), `lib/services/editing.ts`(P1 저장 중단·완료 조건)
  - `lib/db/migration-copy.ts`·`live-migrate.ts`·`server.ts`(원문·시간 초과 코드 연결)
  - 편집 화면 머리, README
- 바꾸지 않을 것: 0001~0004 원문, s4, `code-migration.ts` 계약(필요하면 별도 배정), PLAN(플래너 몫)

### 6.5 명령

`npm.cmd run lint` · `npm.cmd run typecheck` · `npm.cmd test` · `npm.cmd run build` · 빈 폴더 `DREAM_DATA_ROOT=<임시> npm.cmd run db:migrate` 두 번 · s4 사본 올리기 · `next start` 시작 점검(정상·원문 누락) · 1280/390 화면 확인

---

## 7. 결정 필요 (Master)

| # | 내용 | 추천 |
|---|---|---|
| D-1 | `video[].durationFrames`와 빈 자리(null) 보완 | 채택. PLAN 11.2 예시 보완은 플래너에게 요청해요 |
| D-2 | 글자 끝 상한 | `max(영상 합계, length_sec × 30)`. 이관 때는 자르지 않고 경고만 보여요 |
| D-3 | P1 `save-edit` 엔드포인트 | P2-1에서 410 "편집 화면이 새로 바뀌었어요. 새로고침해 주세요."를 돌려주고, P2-2에서 제거해요 |
| D-4 | 열기만 해도 r1이 생기는지 | 아니요. 저장할 때만 생겨요(읽기는 쓰지 않음) |
| D-5 | 깨진 P1 포인터·스냅샷 | 이관 전체 실패(조용히 건너뛰지 않음) |
| D-6 | 이관이 내용 버전·검수를 바꾸는지 | 바꾸지 않아요 |
| D-7 | r1의 `content_revision` | 스냅샷 값(T-033 그대로). 프로젝트 내용 버전과 다를 수 있어요(s4: 둘 다 5) |
| D-8 | 원문·시간 초과 오류 코드 | `MIGRATION_SOURCE`·`MIGRATION_TIMEOUT` 새 코드와 문구 |
| D-9 | 고정 s5 | 추가해요(s4 불변) |
| D-10 | U-4 자동 저장 | P2-1은 명시 저장 API만, 자동 저장 정책은 P2-3 화면에서 정해요 |

이미 정해진 것(유지): U-1 화면 좌표 그대로, U-3 이미지 = 기획 초 × 30, U-7 저장 = 내용 버전 증가 + 검수 무효, U-2 비율 전환은 미리보기 전용, U-5 사용자 프리셋은 후속, U-6 Remotion 조건 확인은 P2-2 착수 전.

## 8. 하지 않은 것

- 코드·SQL·0005·fixture·PLAN·공용 문서를 바꾸지 않았어요.
- 앱·화면·Remotion은 띄우지 않았어요.
- s4는 사본만 읽었어요. 확인한 내용:
  - 프로젝트 3개(그중 1개 보관), P1 스냅샷 2개와 current 1개(프로젝트 1의 content_revision 5 스냅샷)
  - 프로젝트 1의 활성 장면 3개(3번째는 선택 결과 없음), 보관 장면 1개
  - 선택된 결과는 모두 이미지(duration_ms 없음), 프로젝트 1의 inputs `isAd: true`
- 시험 5단계 fixture(`test5-*`)는 모양 참고만 했어요. 제품 0005는 이와 별개로 새로 써야 해요(표 이름·ID 접두어·정규화가 달라요).
