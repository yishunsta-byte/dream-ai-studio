# T159 manifest2·0010 독립 검수 — FAIL

- 담당: 독립 Codex 작업자 `term_bfaf2378e8367a7ab698ced76163d70c`, task `task_d4cf096e60f3`, dispatch `ctx_b234432713c9`, 2026-11-17 KST.
- 구현 기준: **`2c79ee999f65416150424fe663e793bc6706c338`**, T158 보고서 전문과 T154/Master 채택 계약. 실제 구9 기준: **`f24a0bcd761d9923084b49004e2dc6f3ff397f1a`**.
- 결론: 0010 호환 게이트·일반 행/ZIP 정합성·기존 데이터 보존은 아래 범위에서 통과했다. 그러나 **F159-1: 샘플 소리를 포함한 manifest2가 비샘플 묶음으로 수용·복원·다운로드되는 결함** 때문에 S2 전체 수용은 보류한다.
- 이 검수자는 T158 구현·자체 시험 또는 T156 제작에 참여하지 않았다. 작성자668/17skip·build 보고와 아래 독립 실행은 별개다. 제품 파일은 수정하지 않았다.

## F159-1 — 소리 샘플 표시와 묶음 표시 불일치를 수용 (P1, 필수 수정)

**기대:** T154 4.3에 따라 소리 원본 중 하나라도 `audio.isMock:true`이면 묶음 `isMock:true`가 필요하다. 모순된 manifest2는 schema/행 검사에서 거절해야 하며, 샘플을 표시하지 않는 목록·다운로드로 이어지면 안 된다.

**실제 재현:** 유효한 manifest2에서 최상위 `isMock`만 false로 바꿨다. 소리 항목의 `audio.isMock:true`, `_SAMPLE.wav` 경로, 실제 합성 PCM 바이트, files 크기·해시·timeline·roles는 그대로 뒀다. 바뀐 manifest로 새 실제 ZIP을 만들고 ZIP 해시까지 맞춰 새 성공 행을 INSERT했다. 트리거를 제거하지 않은 정상 0010 DB다.

1. `manifestSchema.safeParse` 수용.
2. DB INSERT와 `checkExportRows` 수용, `verifyZip` 통과.
3. 실제 `backupService.request → runClaimedBackup` 성공.
4. 실제 `restoreService.inspect → finish` 성공.
5. **복원된 DB**의 `exportService.list`가 `isMock:false`, `available:true`를 반환했다.
6. 복원된 DB에서 실행한 `exportDownload`가 `editing-01a1e6a5-7a35-7250-ad9e-ba229296c234.zip`을 반환했다. `_SAMPLE`이 없다.

검수 regression의 `expect(download.title).toContain('_SAMPLE.zip')`는 실제 exit 1로 실패했다. 재현 ZIP은 33,779바이트, SHA-256 `b62a7adf85dc8c4e4b20322b1fd91e532c695cbe3bc8e28bc037203b5ff3eea6`이다.

**위치/원인:** `2c79ee9:lib/export/schema.ts:12–22`의 v2 `superRefine`은 소리 존재·경로·중복 asset·roles를 검사하지만 소리 샘플과 최상위 샘플의 관계를 검사하지 않는다. `lib/db/export-data.ts:17`도 이 schema를 신뢰한다. 목록·다운로드는 최상위 `isMock`으로 파일 이름을 결정하므로 잘못된 상태가 유지된다. ZIP/외부 백업의 해시가 모두 일치해도 의미상 모순을 막지 못한다.

**수정 요청:** v1 원형을 유지하면서 v2에 `files.some(audio.isMock===true) && !manifest.isMock` 거절 규칙을 추가하고, 행 검사·실제 백업/복원에서 같은 모순을 거절하는 회귀를 추가한다. 모든 소리가 비샘플이어도 장면 때문에 묶음은 샘플일 수 있으므로 반대 방향 동치 조건을 강제하지 않는다. 그 유효 조합은 독립 metadata matrix에서 통과했다. 0010 SQL은 보조 검사가 가능한 범위만 담당하고, 트리거 없는 사본에서도 코드 검사로 거절해야 한다.

**영향 한계:** 현 제품 writer가 만드는 것은 여전히 manifest1이다. 이번 재현은 S2가 지원한다고 선언한 가짜 v2 성공 행·실제 ZIP의 저장/복원/읽기 경로이며, 현 UI가 이런 v2 묶음을 생성한다고 주장하지 않는다. S3를 연결하기 전에 신뢰 경계를 닫아야 한다.

## 저장원·작업 범위·증거 위치

공유 작업트리 HEAD는 `0c49bad`였으므로 이를 대상과 혼동하지 않고 `git archive`로 정확한 2c79ee9 및 f24a0bc를 각각 새 사본에 풀었다. 선행 T157의 미추적 보고서는 보존했다. 허용된 변경은 이 T159 보고서 한 파일이며, 공용 문서·제품 코드·패키지·기존 fixture·T156 작업은 수정하지 않았다.

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t159-manifest-492e3085d8424f2580f34bc0386f407c`
- `ROOT/new`: 2c79ee9 소스 + 임시 독립 시험 `tests/t159-independent.test.ts`.
- `ROOT/old`: f24a0bc 구9 소스 + 임시 `t159-old-probe.ts`. 별도 Node 프로세스에서 실행했다.
- **RUN:** `ROOT/run-1794870964393`: 최종 정상·거부·F159-1 재현 DB/ZIP와 JSON 증거. 이전 harness 실행의 사본도 ROOT에 남는다.
- **BUILD:** `D:/starwork/t159-build-492e3085d8424f2580f34bc0386f407c`: 동일 2c79ee9 추적 파일만 사용한 별도 운영 build 사본. C: 사본과 D: 의존성 사이 경로 문제를 피하도록 같은 드라이브에 만들었다. 사용자 runtime은 쓰지 않았다.
- 각 사본은 기존 `D:/starwork/dream-ai-studio/node_modules`로 향하는 junction만 사용했다. 설치나 `.tools` 물리 복사·내용 변경은 없다.

가짜 DB는 OS-temp에 고정 s4를 추출하여 사용했다. 독립 정상 v2 ZIP의 소리는 직접 만든 16kHz mono 1초 440Hz PCM WAV이며, 오디오 품질/렌더 확인은 아니다. 사용자 DB/storage/backups/비밀 파일과 3013은 열거나 변경하지 않았고 서버도 시작하지 않았다.

## 관련 시험·정적 검사·build

사본 new에서 실행한 최종 회귀:

```text
FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe
FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe
node node_modules/vitest/vitest.mjs run tests/t158-export-manifest.test.ts tests/backup-archive.test.ts tests/backup-service.test.ts tests/backup-immutability.test.ts tests/restore.test.ts tests/p2-1-timeline.test.ts tests/p2-4a-renders-db.test.ts tests/p2-5a-audio.test.ts tests/p2-5c-render-audio.test.ts tests/p2-5c-restore-integrity.test.ts tests/workflow.test.ts tests/jobs.test.ts
```

| 실행 | 독립 결과 | 증거 |
|---|---|---|
| 위 관련 회귀 (새 T158 7시험 포함) | **12파일/168시험 PASS**, exit 0 | ROOT/related-final.log |
| `npm.cmd run lint` | PASS, exit 0 | ROOT/lint.log |
| `npm.cmd run typecheck` | `next typegen && tsc --noEmit` PASS, exit 0 | ROOT/type.log |
| BUILD에서 `node node_modules/next/dist/bin/next build --webpack`, 성공 뒤 `node scripts/verify-build.mjs` | **PASS**, exit 0; trace에 로컬 데이터·비밀·렌더 도구 없음 | ROOT/build.log |
| 추가 독립 실제 구9/v2/변조 통합 시험 | PASS | ROOT/independent-with-sample.log, RUN/independent-evidence.json |
| 추가 roles/sample 타입/strict matrix | PASS | ROOT/schema-matrix.log, schema-matrix.json |
| 추가 UPDATE 19가지 거부 matrix | PASS | ROOT/update-matrix.log, update-matrix.json |
| F159-1 기대값 regression | **FAIL**, exit 1 | ROOT/independent-with-sample.log, RUN/F159-1.json |

추가 독립 시험은 통과 3개·제품 실패 1개다. `-t` 필터 실행의 다른 시험 제외는 제품 skip으로 세지 않았다. 처음 회귀는 설치 도구 경로가 없어 두 오디오 파일의 setup이 ENOENT로 실패했고 후속 단언 하나도 연쇄 실패했다. 기존 바이너리를 직접 지정한 두 파일 재실행 12/12와 최종 전체 관련 회귀 168/168로 해소했다. 독립 harness의 첫 실행은 검수자가 `created_at`을 INSERT에서 빠뜨려 실패했으며 이를 보완한 이후 결과만 제품 판정에 사용했다. 전체 suite·기본 Turbopack·실제 오디오 렌더는 이번에 실행하지 않았다.

## 통과한 계약·행 검사·승격/rollback

- v1 정의는 변수명 분리 외 기존 strict 필드·순서를 유지한다. 고정 v1 manifest의 parse 후 JSON 바이트가 같고 v1에 timeline, 알 수 없는 version, 문자열 version은 거절된다.
- 정상 v2의 audio/timeline/profile을 수용하고, audio 없음·잘못된 경로·scene/version 필드·중복 asset·roles 중복·audio/ 아래 metadata 없음·추가 필드·timeline 누락/다른 profile을 거절했다. 추가 matrix로 빈 roles·알 수 없는 role·중복·문자열/null sample·audio/file 추가 필드 거절과 voice/music/effect 3역할 허용을 확인했다. **샘플 boolean 타입 검사는 통과하지만 의미 정합성 F159-1은 실패다.**
- 원본 새7시험에서 INSERT의 NULL/누락·문자열 version·알 수 없는 version/kind·project/revision 불일치·files0·v1 timeline/v2 timeline 오류·대문자/짧은/없는 hash·틀린 path·manifest 없는 미완료 v2를 거절했다. 정수 열은 STRICT도 함께 검사한다.
- UPDATE는 별도 19변형으로 NULL/소수/문자열/미지원 버전 열, manifestVersion 누락/null/문자열/소수, kind null/다른 종류, revision null/다름, project null, files0, hash null/대문자/짧음, path null/다름을 각각 거절하고 원래 running 행을 유지했다.
- 0010 트리거를 제거한 가짜 사본에서도 `checkExportRows`가 전체 manifest 형식·행 버전/정체성/path 오류를 거절했다. 이 검사 호출이 0010 verify, 실사용 upgrade의 checkMigratedData, 직접 복원과 staging upgrade 직후에 들어감을 코드로 확인했다.
- 잘못된9 행의 9→10은 `ExportRowError`로 중단되고 export 행·journal9·0010 트리거 없음이 그대로였다. 정상9→10은 적용1, journal10·트리거2개가 생기며 기존 export 행 전체와 기존 ZIP verify/list/download가 유지됐다. DB 전체 파일은 migration으로 바뀌므로 행/내용 보존과 파일 전체 동일성을 혼동하지 않는다.
- 발행0001~0009와 기존 backups fixture의 `git diff --exit-code f24a0bc 2c79ee9 -- 'lib/db/migrations/000*' tests/fixtures/backups`는 0이었다. T156 신작의 품질 수용은 범위 밖이다.

## 실제 구9 소스 실행 — 저자 비교함수 대체를 보완

구9 사본에서 다음 방식으로 **실제 옛 모듈**을 별도 프로세스에 로드했다. 현재 모듈에 nine 목록을 주입한 시험이 아니다.

```text
node --conditions=react-server --import tsx scripts/db.ts migrate
node --conditions=react-server --import tsx t159-old-probe.ts <OS-temp 입력 JSON>
```

probe는 옛 `checkStartup`, 공개 wrapper `inspectRestore`, `finishRestore`를 호출하며 productMigrations가 실제로 `[1..9]`임을 저장했다. HTTP/Next 서버를 구동한 검증은 아니다.

1. **새10 DB를 구9 앱 runtime으로 지정:** startup.canStart=false, inspect/finish 모두 `STAGE_LOCKED`, 목적지 없음. 별도 닫힌 DB의 구9 재실행 전후 SHA-256도 `cbc57ca1059d2081596dc672fa1ef4dbc4081f147980b34db4c468629f59c36f`로 같았다. ROOT/old-bytecheck-hash.json 및 RUN/old-on-new.json.
2. **정상9 DB는 구9 CLI로 준비:** startup.canStart=true. 새10 앱이 실제 생성한 백업의 행/meta를 이 가짜9 DB에 등록하여 실제 ZIP을 inspect했다. **BACKUP_TOO_NEW**로 거절했다.
3. 새10 inspect가 만든 실제 ready ticket을 가짜9 DB에 옮겨 구9 `finishRestore`를 실행했다. **RESTORE_INVALID**로 거절하고 목적지가 생기지 않았다. 구9이 자기 정상 DB에서 finish 본문까지 실행한 검증이며, 서비스 생성 단계 거부만 확인한 저자 증거를 보완한다. RUN/old-valid9.json.

## 정상 v2 실제 백업·복원·목록/다운로드와 변조

검수자가 만든 실제 PCM 포함 v2 ZIP을 유효 성공 행으로 저장한 뒤 제품 백업 작업을 실행했다. 생성된 실제 백업은 migrations10이고 inspect(10→10 same)·finish로 복원됐다. 복원 성공 행 전체가 원본과 같고, 복원된 DB의 목록은 `fileCount:2,isMock:true,available:true`였다. **복원된 runtime**에서 다운로드한 ZIP은 원본과 같은 33,778바이트 / SHA-256 `e6837496e17090f2c94c2d3d464bc8bc69571977196ba0edba6925f93e614363`, 이름은 `_SAMPLE.zip`이었다.

또한 가짜 snapshot에서 다음 세 가지를 각각 바꾼 실제 백업을 다시 작성했다. 바꾼 DB 해시·외부 inventory·외부 ZIP 해시와 등록 meta를 모두 다시 맞췄으므로 단순 바깥 hash mismatch에만 기대지 않았다.

| 변조 | 별도 사전 검사 | 실제 restore.inspect |
|---|---|---|
| DB의 v2 manifest 제목만 변경, 내부 export ZIP은 원래 manifest | checkExportRows는 통과 | RESTORE_INVALID, 목적지 없음 |
| DB manifest_version=3 (가짜 사본에서만 guard 제거) | checkExportRows 거절 | RESTORE_INVALID, 목적지 없음 |
| 내부 export ZIP의 PCM을 같은 크기 다른 바이트로 바꾸되 내부 manifest의 files hash 유지; row의 ZIP hash와 바깥 inventory는 새 파일로 일치 | checkExportRows 통과 | RESTORE_INVALID, 목적지 없음 |

T158 원본 시험의 직접 `verifyRestoredDatabase → ZIP manifest differs`, 실제 live backup 거절도 독립 통과했다. 반면 F159-1은 schema 자체가 의미 모순을 허용하므로 이 정합성 경로를 모두 통과한다.

## 기존 시험 수정 검토

- 버전 수·적용 수·from/to·pre-migrate 파일명 기대값은 실제 추가0010에 맞춘 변경이다. 이미 발행한 migration 해시나 기존 fixture 기대 바이트를 바꾸지 않았다.
- restore fixture의 성공 export를 `{}`/library 텍스트 경로에서 실제 v1 ZIP으로 바꾼 것은 검증 강화에 필요한 자료 교체이며, 완료 내용·원본·해시·trigger·staging·source 보호 단언은 유지됐다.
- backup-immutability/workflow의 소형 JSON은 SQL의 최소 행 조건을 충족시키기 위한 자료다. `p/e`, files:[{}] 등은 **완전한 manifestSchema 유효 자료가 아니므로** 이 시험만으로 전체 export 형식 검증을 주장할 수 없다. 해당 시험의 REPLACE/게이트 단언은 유지되어 약화로 보지 않는다. 완전 형식은 새7시험과 독립 실제 ZIP 시험이 별도 담당한다.
- export-row-helpers의 소리는 임의 문자열 바이트다. 기존7시험은 ZIP/metadata 시험이고 오디오 포맷·렌더 증거가 아니다. 이번 독립 v2 왕복은 합성 PCM으로 보완했다.

## 정리·제한·다음 진입 조건

서버/브라우저/worker를 시작하지 않았고 검사·구9 probe·합성 소리용 도구·build 프로세스는 종료됐다. 전용 ROOT/BUILD를 명령줄에 가진 node/ffmpeg/ffprobe 프로세스 최종 조회는 0건이었다. 설치 ffmpeg/ffprobe 전후 hash는 다음 값으로 유지됐다.

- ffmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

BUILD의 절대 경계와 node_modules junction 대상을 확인하고 junction만 먼저 끊은 뒤 사본을 지우는 명령을 제출했으나 **자동 승인 검토가 프로세스 생성 자체를 `blocked by policy`로 거절했다.** 어떤 삭제도 실행되지 않았고 우회·재시도하지 않았다. BUILD와 junction이 그대로 남는다. ROOT의 가짜 DB/백업/재현 소스/실패 증거는 결함 재현용으로 보존했으며 이 경로의 별도 삭제 시도는 하지 않았다. 정리 완료를 주장하지 않는다. 후속 삭제 시 junction의 실제 공유 의존성 대상으로 재귀 진입하지 않아야 한다.

UI/기기/브라우저·사용자 DB 이관·실제 렌더·소리 품질·S3 원본 수집/중복제거·T156 새 s9의 독립 수용은 미검증이다. 정상 v2 성공 행은 검수자가 직접 구성한 S2 시험 자료이며 현 writer가 생성한 audio ZIP으로 표현하지 않는다. 실사용 migration의 새 검사 연결은 코드와 관련 회귀로 확인했고, F159-1 수정 후에는 schema/행/백업 및 기존 v1 보호를 다시 검수해야 한다. 그 전 S2 전체 PASS를 선언하지 않는다.

## Master/플래너 복사 전달문

T159는 2c79ee9 독립검수 **FAIL**입니다. 새7시험 포함168개 회귀, lint/type, 격리 Webpack build/verify-build 및 확정 구9 소스의 실제 startup/ZIP inspect/이관 ticket finish 거부는 통과했습니다. F159-1은 audio.isMock=true·bundle.isMock=false인 v2가 schema/DB/행/ZIP/실제 백업·복원을 통과해 목록과 다운로드에서 샘플 표시를 잃는 재현입니다. v1을 유지하고 v2의 단방향 샘플 일관성 규칙과 저장/복원 회귀를 추가한 뒤 재검수가 필요합니다. 제품은 수정하지 않았고 보고서만 선택 커밋하며, BUILD 삭제는 자동 승인 검토 거절로 미실행되어 ROOT/BUILD 재현 자료가 남습니다.
