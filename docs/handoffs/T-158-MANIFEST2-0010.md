# T-158 P2-6 S2: manifest 2와 0010 호환성 기반

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_1ef281feeb43 · 계약: `T-154-DELIVERY-CONTRACT.md` 4.2, D-2(Master 결정: 9단계 앱의 잘못 읽기는 받아들이지 않고 0010으로 막음)
- 기준 `f24a0bc` + 이 변경만이에요. 자체 구현·자체 확인이고 **독립 검수 전**이에요.
- 이번 범위 밖: 소리 원본을 묶는 기능(S3)과 화면(S4). 지금 제품은 여전히 manifest 1만 만들어요. manifest 2 행은 시험용 유효 행(`tests/export-row-helpers.ts`)으로만 만들었어요.
- 바꾸지 않은 것: 발행된 0001~0009, 고정 s4~s7, T156 s9, 공용 문서, UI, DSP, 렌더 계약, 패키지, 사용자 DB

## 1. 먼저 확인한 근거 (추정 없음)
- 현재 `manifestSchema`(strict)는 `manifestVersion:1`, project, menu, templateVersion, contentRevision, planId, exportedAt, isMock, `kind:"editing-bundle"`, files 1~1000이에요.
- `exports.manifest_version` 열은 0001부터 있어요. `INTEGER NOT NULL DEFAULT 1`이고 정수 ≥1을 CHECK해요. 코드는 이 열을 쓰지 않았어요(항상 기본값 1).
- 고정 s4~s7을 OS 임시 폴더에 풀어 읽기만 했어요(`tmp/t158/inspect.ts`). 결과는 네 백업 모두 같아요.
  - export 4행(성공 1, 실패 2, 진행 1)이고 모두 `manifest_version` 정수 1이에요.
  - 성공 행의 manifest는 지금 스키마로 읽혀요. 키는 위 10개이고, 파일 키는 path, sha256, sizeBytes, mime, sceneId, versionId, width, height예요.
  - manifest가 없는 행은 실패·진행 행뿐이에요. export 트리거는 `completed_export_immutable`과 `completed_export_delete_guard` 둘뿐이에요.

## 2. 바꾼 파일
| 파일 | 내용 |
|---|---|
| `lib/export/schema.ts` | `manifestV1Schema`는 기존과 같은 정의이고, 키 순서와 바이트도 그대로예요. `manifestV2Schema`는 v1 필드에 아래를 더했어요. 마지막 줄은 그 밖의 확인 규칙이에요. <br>· `manifestVersion:2`<br>· `timeline:{revisionId, schemaVersion:2, audioMixProfile:"p2-5-local-v1"}`<br>· files 항목의 선택 필드 `audio:{assetId, roles(1~3, 중복 없음), isMock}`<br>· 소리 파일 1개 이상, `audio/` 아래, 장면 필드 없음, 같은 소리는 1번, `audio/` 아래 파일은 반드시 소리 원본, 모르는 필드는 거절(strict)<br>`manifestSchema = union(v1, v2)`예요. |
| `lib/db/migrations/0010_export_manifest.sql`(신규) | 열·표 변경은 없어요. 기능 게이트 역할이고, 이 단계의 journal 기록이 있으면 1~9단계 앱이 DB와 백업을 too_new로 거부해요. `export_manifest_insert_guard`·`update_guard` 트리거를 넣었어요. <br>· 버전 열이 정수 1·2이고 manifestVersion(정수 타입)과 같아야 해요.<br>· kind, project.id = 행, contentRevision = 행, files ≥1이어야 해요.<br>· v1에는 timeline이 없어야 하고, v2에는 timeline 객체, schemaVersion 2, 고정 프로필이 있어야 해요.<br>· 완료 행은 64자리 소문자 hex 해시와 `projects/{project}/exports/{id}.zip` 경로가 있어야 해요.<br>· manifest가 없는 행은 미완료이고 버전 1이어야 해요.<br>모든 비교는 `IS`와 `COALESCE(…,0)`로 해서, 값이 비어도 조건이 NULL이 되어 통과하는 일이 없어요. |
| `lib/db/export-data.ts`(신규) | `checkExportRows`는 모든 행을 union 스키마로 다시 읽어요. 트리거와 같은 규칙에 더해, SQL로는 못 보는 manifest 전체 형식과 완료 시각까지 봐요. 트리거가 있다고 가정하지 않아요. `exportManifests`는 완료 행의 경로와 manifest를 돌려줘요. |
| `lib/db/migrate.ts` | `LATER_SQL_STEPS`에 `{10,"0010_export_manifest.sql"}`를 넣고, 검증을 `checkExportRows`로 했어요(읽기 전용). |
| `lib/db/live-migrate.ts` | `checkMigratedData`(실사용 DB 업그레이드 뒤)에 `checkExportRows`를 추가했어요. |
| `lib/backup/archive.ts` | `verifyRestoredDatabase`(직접 복원과 staging 업그레이드 직후 모두)에서 `checkExportRows`를 돌린 뒤, **완료된 export ZIP마다 `verifyZip`(저장된 manifest = ZIP 안 manifest, 모든 파일 해시)**를 해요. 백업 만들기도 같은 검사를 거쳐요. |
| `lib/services/exports.ts` | 성공으로 바꿀 때 `manifestVersion: manifest.manifestVersion`도 기록해요. 목록·다운로드·verifyZip은 union으로 읽어요. v1 행을 읽는 방식은 그대로예요. |

## 3. 시험
- **새 `tests/t158-export-manifest.test.ts`(7개)**
  - v1 원형 그대로(파싱 후 JSON 바이트 동일). 거절: v1에 timeline, 버전 3, 문자열 "1".
  - v2 규칙 9가지 거절과 정상 v2 통과.
  - 0010 트리거: 버전 3, 열 2·manifest 1, manifestVersion 없음(NULL), 문자열, kind 없음, 다른 프로젝트, revision 없음·다름, 파일 0, v1에 timeline, v2에 timeline 없음·다른 프로필·`schemaVersion:null`, 대문자·짧은 해시·해시 없음, 다른 경로, 미완료 v2를 모두 거절해요. 텍스트 버전은 STRICT 열이 먼저 거절해요. 정상 v1·v2 삽입, 진행→성공 갱신(틀리면 거절), 진행→실패는 허용돼요.
  - **트리거를 지운 사본**에서도 `checkExportRows`가 이유와 함께 거절해요. `{}`처럼 SQL 조건은 비켜 가지만 형식이 틀린 manifest도 거절해요.
  - **9 → 10 승격·되돌림**
    - 9단계에서 쓴 틀린 행이 있으면 0010이 `ExportRowError`로 멈춰요. 그때 DB 행, journal(9), 트리거(없음)가 그대로예요.
    - 깨끗한 9단계 사본은 1단계만 적용돼요. export 행은 바이트 그대로, journal은 10, 트리거는 2개예요.
    - 예전 s4 ZIP의 `verifyZip`, 목록, 다운로드가 기존처럼 돼요.
  - **9단계 앱 거부와 현재 앱 복원**
    - 10단계 DB: 9단계 목록 기준 `too_new`, `checkDatabase(…,9단계)` 실패, 현재 앱은 통과해요.
    - 9단계 restoreService는 만들 때부터 거절해요("마이그레이션 기록이 맞지 않아요"). 그래서 검사도 확정도 못 하고 목적지도 생기지 않아요. 백업 manifest의 migrations도 9단계 기준 `too_new`예요.
    - 현재 앱은 v2 행을 inspect(10→10) → finish로 복원해요. 행이 바이트 그대로이고, 목록(fileCount 2, isMock, sha256)과 다운로드(`_SAMPLE.zip`)가 돼요.
  - **해시 묶음**
    - 행의 manifest 글자만 바꾼 경우(0010 규칙, 행 검사, ZIP 해시는 모두 맞음)를 만들었어요.
    - 풀어 놓은 백업 사본에서 그렇게 하면 복원 판독이 `ZIP manifest differs`로 거절해요.
    - 실사용 DB에서 그렇게 하면 백업 작업이 끝나지 않고 실패해요.
- **바꾼 기존 시험**: 기대값만 바꾸거나 시험 자료를 계약에 맞게 고쳤어요. 검사를 지우거나 약하게 하지 않았어요.
  - `restore.test`: 완료 export 행을 진짜 ZIP + v1 manifest로 바꿨어요(전에는 `manifest_json:"{}"`, 경로 `library/original.txt`). from/to 버전은 9→10이에요.
  - `backup-immutability`·`workflow`: 완료 행의 manifest를 계약에 맞는 최소 JSON과 고정 경로로 바꿨어요. REPLACE·게이트를 보는 내용은 그대로예요.
  - 버전 수 기대값: `backup-service`(9→10), `p2-1-timeline`(CLI 5→6, 9→10, `s4-s10` 사본 이름), `p2-4a`(목록과 LATER_SQL_STEPS에 10, 7→ 적용 수 3), `p2-5a`(journal 1~10, 적용 수 3, from/to 10), `p2-5c-render-audio`(8→ 적용 수 2, journal 1~10), `p2-5c-restore-integrity`(from/to 10).
- `eslint .` · `tsc` 통과. vitest 전체 **60파일 통과·2 skip, 668 통과·17 skip**. 운영 build + `verify-build`는 안전 사본에서 통과했어요(공유 `.next`는 다른 세션 dev 3013이 사용 중).

## 4. 완료 조건과 남은 점
- 완료(자체): 위 시험과 검증이 통과했어요. P1·v1 묶음, SRT, 예전 export 행·파일은 바이트 그대로예요. 0010은 열 변경 없이 기능 게이트, 트리거, 코드 행 검사, 복원 ZIP 묶음 검사로 이루어져요.
- **T156(s9)과 맞출 점**: s9가 9단계 백업이면 현재 앱에서는 upgrade(9→10) 경로가 돼요. T156 시험이 journal 1~9나 `compat:"same"`을 고정하면 이 커밋과 충돌할 수 있어요. 기대값을 정할 때 이 점을 함께 봐 주세요.
- 복원 시간: 이제 완료된 export ZIP을 하나씩 열어 해시를 확인해요. 큰 묶음이 많으면 검사 시간이 늘어나요. 재지는 않았어요.
- 실제 화면, 실사용 DB 이관, 실제 구버전 앱 실행은 하지 않았어요. 구버전 앱은 9단계 목록을 넣은 현재 코드로 대신했어요.
- 이번 작업으로 생긴 임시 폴더(fixture 확인, 빌드 사본)는 지웠어요.
