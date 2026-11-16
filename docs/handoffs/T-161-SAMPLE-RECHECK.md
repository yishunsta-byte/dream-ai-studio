# T161 F159-1 한정 독립 재검수 — bounded PASS

- 담당: 독립 Codex `term_ef0dd51f2700f0a0555fde2575af4fc8`, task `task_13dacf55647b`, dispatch `ctx_1283b9a58928`, 2026-11-17 KST.
- 수정 기준: **`440d1f4ca078e9618e333e55ec498f3a2810e8fa`**, T160 보고서 전문·F159-1·T154 단방향 샘플 계약.
- 실제 수정 전 코드: **`2c79ee999f65416150424fe663e793bc6706c338`**. 2c79ee9로 실제 발급한 ticket을 440d1f4로 확정하는 검증도 수행했다.
- 결론: **F159-1 수정은 확인 범위에서 PASS. 새 필수 제품 결함 없음.** 기존168회귀 전체나 S2/S3 전체 기능을 새로 통과시킨 결과는 아니다. 구현자 자체 확인과 아래 독립 실행은 별개다.

## 저장원·작업 범위

공유 작업트리의 착수 HEAD는 `bc034b6`이며 선행 T157 미추적 문서가 있었다. 이를 변경하지 않고 `git archive`로 정확한 수정 SHA와 수정 전 SHA를 각각 추출했다. 제품 파일은 수정하지 않았고 이 고유 보고서만 선택 커밋한다. 공용 문서·사용자 DB·3013·기존 fixture·설치 도구는 변경하지 않았다.

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t161-sample-3294307fa45247b88ebcc3cf27598326`
- `ROOT/fixed`: 440d1f4 추적 파일 사본 + 검수자 임시 `tests/t161-independent.test.ts`.
- `ROOT/pre`: 2c79ee9 추적 파일 사본 + 검수자 임시 `t161-pre-inspect.ts`.
- **RUN:** `ROOT/run-1794871718830`: 복사된 가짜 source DB/storage, 원본 외부 백업 추출본, 9단계 사본, 정상 PCM 백업·복원 자료.
- 두 사본은 기존 `D:/starwork/dream-ai-studio/node_modules`를 junction으로 읽는다. 패키지 설치나 `.tools` 물리 복사·내용 수정은 없다.

원재현 자료는 T159가 남긴 `C:/Users/Administrator/AppData/Local/Temp/t159-manifest-492e3085d8424f2580f34bc0386f407c/run-1794870964393/runtime10`의 **가짜 DB·합성 PCM**이다. 원본 DB는 read-only로 열어 SQLite backup으로 새 source DB를 만들었고 합성 storage만 복사했다. 원래 가짜 DB/문제 ZIP/바깥 백업의 hash가 검수 전후 같음을 확인했다. 실제 사용자 자료는 사용하지 않았다.

## 독립 실행 결과

사본 fixed에서 실행했다. lint/type는 독립 임시 시험을 추가하기 전의 추적 소스에 대해 수행했다.

| 실행 | 실제 결과 | 증거 |
|---|---|---|
| `node node_modules/vitest/vitest.mjs run tests/t160-sample-consistency.test.ts` | **6/6 PASS**, exit 0 | ROOT/t160.log |
| `npm.cmd run lint` | PASS, exit 0 | ROOT/lint.log |
| `npm.cmd run typecheck` | `next typegen && tsc --noEmit` PASS, exit 0 | ROOT/type.log |
| `node node_modules/vitest/vitest.mjs run tests/t161-independent.test.ts` | **추가 독립 통합1/1 PASS**, exit 0 | ROOT/independent.log, independent-evidence.json |

새6시험에는 schema의 단방향·혼합 소리·v1, 모순 행과 trigger-free 코드 검사, 9→10 rollback, 정상 `_SAMPLE` 및 모순 DB backup 실패, 재해시 모순 외부백업 inspect 거절, 이전 규칙 ticket finish 거절이 들어 있다. 저자의 finish 시험은 schema wrapper로 이전 규칙을 흉내 낸다. 아래 추가 독립 시험은 **실제 2c79ee9 모듈 별도 프로세스**로 발급하여 그 간극을 보완했다.

이번 제품 diff는 v2 schema 의미 검사 3줄이며 v1·서비스·발행 SQL은 그대로다. 요청한 범위에 맞춰 이전168전체·운영 build는 반복하지 않았다. T159의 2c79ee9 독립 build/verify-build PASS와 T160 작성자 전체674/17skip은 선행 증거이며 이번 실행으로 합산하지 않는다.

## 원래 실제 PCM 모순 ZIP·행·바깥 metadata로 재현

T159 F159-1의 **동일한 원본**을 다시 사용했다.

| 대상 | 식별 및 hash |
|---|---|
| 모순 export | `01a1e6a5-7a35-7250-ad9e-ba229296c234`, 33,779바이트, SHA-256 `b62a7adf85dc8c4e4b20322b1fd91e532c695cbe3bc8e28bc037203b5ff3eea6` |
| 이를 포함한 실제 백업 | `01a1e6a5-7a3c-7387-a67a-945fac1286bf`, 460,903바이트, SHA-256 `4465481af8fdb9d00cc0ab6a38353d0923dcc8d3288d8a3a48c89c65d6d010ac` |

이 자료의 `audio.isMock:true`·묶음 `isMock:false`와 실제 16kHz mono 1초 440Hz PCM을 유지했다. export 파일 hash=행 sha256, 바깥 ZIP hash/크기=등록 meta, 외부 inventory/DB hash가 일치했다. 실제 외부 ZIP을 `verifyBackupArchive`로 추출하고 그 DB의 해당 성공 행 전체=원재현 행, 추출된 내부 export ZIP hash=원본 hash도 확인했다. 따라서 단순 파일 누락이나 hash 불일치로 실패하는 재현이 아니다.

440d1f4의 결과:

- `checkExportRows`: `ExportRowError`, `manifest is not a known version`으로 거절.
- `verifyZip`: `isMock` 경로의 `a sample sound source needs a sample bundle` ZodError로 거절.
- 목록: **`available:true, isMock:null, fileName:null`**. available은 파일 존재를 뜻한다. 유효한 다운로드나 비샘플 수용으로 해석하지 않는다.
- `exportDownload`: 동일한 샘플 정합성 ZodError로 거절. 이전의 샘플 표시 없는 다운로드가 더 이상 반환되지 않았다.
- 실제 바깥 백업의 새 `restoreService.inspect`: **RESTORE_INVALID**, 목적지 없음.
- copied source DB에서 0010의 insert/update trigger를 제거한 뒤에도 `checkExportRows`는 같은 이유로 거절했다. 발행0010 SQL을 고쳐서만 막는 방식이 아니다.

이는 API/service 수준 실행이며 브라우저 오류 문구·다운로드 버튼 상태의 개선을 확인한 것은 아니다. null·available 표현은 S4의 별도 UI 과제이며 이번 범위의 신규 필수 결함으로 세지 않았다.

## 실제 이전 코드가 발급한 ticket의 finish 거절

pre 사본에서 다음을 별도 프로세스로 실행했다.

```text
node --conditions=react-server --import tsx t161-pre-inspect.ts <RUN/pre-input.json>
```

스크립트는 실제 2c79ee9 공개 wrapper `inspectRestore`를 호출했다. schema mock·변형·현재 코드에 옛 migration 목록 주입을 사용하지 않았다. 원래 모순 외부백업은 이 코드에서 검사를 통과했고, 실제 product 목록 `[1..10]`, `compat:same`, from/to10인 ready ticket `01a1e6b0-f6ab-706a-83ef-90524f789362`가 복사 source DB에 저장됐다.

그 DB를 440d1f4의 `restoreService`로 열어 **같은 ticket**의 finish를 호출했다. staging 재판독에서 **RESTORE_INVALID**로 거절했고 `RUN/old-issued-destination`이 생기지 않았다. 발급 이후 바깥 ZIP/metadata를 바꾸지 않았다. RUN/pre-result.json과 ROOT/independent-evidence.json에 실제 ticket·거부 결과가 남는다. T159의 구9 호환성 검수를 반복한 것은 아니며, 이번 비교는 **같은10 구조에서 의미 규칙이 바뀐 경우**다.

## 9→10 rollback·정상 샘플·반대 방향·v1

- 별도 고정 s4 사본을9까지 올리고 **동일한 원재현 모순 행**을 INSERT했다. 440d1f4로 9→10 승격 시 거절됐으며 export 행 전체·journal9·export_manifest guard 없음이 전후 동일했다. 잘못된 행을 고치거나 journal10만 남기는 동작은 없었다.
- 정상10 사본에 helper가 만든 실제 짧은 PCM으로 다음 세 유효 v2 행을 저장했다: 샘플 소리+샘플 묶음, 비샘플 소리+샘플 묶음, 비샘플 소리+비샘플 묶음. `checkExportRows`가 모두 수용했다.
- 이 DB를 실제 backup 작업→inspect→finish로 복원하고 **복원된 runtime**에서 다운로드했다. 정상 샘플은 `editing-01a1e6b0-f7e1-73ef-bda5-f63c82d2cb4f_SAMPLE.zip`, 비샘플 소리+샘플 묶음도 `_SAMPLE.zip`, 비샘플+비샘플은 `_SAMPLE` 없이 반환됐다. 반대 방향을 부당하게 강제하지 않는다.
- 고정 s4의 기존 성공 v1 행 전체와 ZIP Buffer가 정상 백업·복원 뒤에도 같았다. v1 schema는 `isMock:true/false` 모두 parse 후 JSON 바이트가 같았다. v2 수정이 v1에 새 의미 규칙을 적용하지 않음을 확인했다.
- `git diff --exit-code 2c79ee9 440d1f4 -- lib/db/migrations tests/fixtures/backups`는 0이었다. 발행0010 포함 SQL·고정 fixture 바이트는 바뀌지 않았다. T156 fixture 전체 수용을 의미하지 않는다.

## 정리·미검증·다음 조건

HTTP 서버·브라우저·worker를 시작하지 않았다. 테스트/이전 코드 probe 프로세스는 종료됐고 ROOT를 명령줄에 가진 node/ffmpeg/ffprobe 최종 조회는0건이었다. 설치 미디어 도구는 실행·복사하지 않았으며 hash는 기존 값과 같았다.

- ffmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

ROOT의 소스 사본/junction·가짜 DB·외부/내부 ZIP·정상 복원본·로그를 재현 증거로 보존했다. 이번 작업에서는 이 증거 경로의 재귀 삭제를 제출하지 않았으므로 **새 삭제 거절이나 정리 완료를 주장하지 않는다**. 선행 T159 ROOT/BUILD의 삭제 거절 잔존도 건드리지 않았다. 후속 정리는 junction의 공유 의존성 대상을 보호하며 수행해야 한다.

실제 사용자 DB 이관, Next/HTTP/UI 오류 표시, 전체 suite/build 재실행, 실제 기기/음질/렌더, S3 소리 수집 writer는 미검증이다. **현 writer는 여전히 manifest1만 생성하며 S3는 미구현**이다. 이번 결과는 F159-1의 의미 검사와 저장/복원/다운로드 차단을 수용할 근거이며, 이 범위에서 수정 후 재검수 조건을 충족했다. Master의 통합과 후속 범위 결정은 별도다.

## Master/플래너 복사 전달문

T161은 440d1f4의 F159-1 수정에 한정하여 bounded PASS입니다. 새6시험·추가 독립1시험·lint/type가 통과했고, T159의 동일 실제 PCM 모순 백업 및 실제2c79ee9 발급 ticket의 현재 inspect/finish 거절을 확인했습니다. 정상 샘플 다운로드, 반대 방향 허용, v1 바이트·trigger-free 검사·9→10 rollback도 유지됩니다. available:true는 존재 표시이며 isMock/fileName은 null이고 다운로드는 거절됩니다. S3 writer·UI·전체168/build는 이번 재검수 범위 밖이며 ROOT 재현 자료는 보존했습니다.
