# T167 원 F163-1 집중 독립 재검수 — bounded PASS

- 검수자: Codex `term_a5c56c5bbfed7c31af4b89a69146de7c`, task `task_b800375592cd`, dispatch `ctx_0c3361e5779b`, 2026-11-17 KST.
- 대상: **`48380174ba9ad0e4cd2a635c7cf11be2993e2bc7`**, T166 보고서 전문·F163-1. T165 보고서와 시험 diff도 읽었다.
- 수정 전 대조 소스: **`8a46abc452b4ff0ae9e09a24804373923701fb75`의 exports.ts**. 이 모듈의 writer는 T166 이전 경로이며 별도 사본 모듈로 직접 실행했다.
- 판정: **원 F163-1 및 지정된 늦은 source/재시도 경계는 PASS. 새 필수 결함 없음.** Master가 승인한 local-trust/ABA 한계를 유지하며 완전한 OS 격리나 전체 제품 완료를 주장하지 않는다.
- 구현·저자 자체703/19skip 확인과 이번 독립 실행은 별개다. 제품 파일과 UI WIP는 수정하지 않았고 이 고유 보고서만 선택 커밋한다.

## 저장원·범위

공유 작업트리의 착수 HEAD는 `13bd2a9`, 선행 T157 보고서만 미추적이었다. 정확한 4838017을 git archive로 추출하여 검사했다. 사용자 DB·3013·기존 fixture·설치 도구·디자인 WIP를 열거나 바꾸지 않았다. 공용 문서도 수정하지 않았다.

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t167-late-cf0b37cc1f5e405199900b92dc3f8504`
- `ROOT/app`: 고정 추적 소스와 node_modules junction. lint/type는 임시 검수 모듈을 추가하기 전 추적 소스에 실행했다.
- `ROOT/app/tests/t167-independent.test.ts`: 독립 재현3시험.
- `ROOT/app/lib/services/exports-pre166.ts`: 부모 커밋의 exports.ts 그대로. 제품 원본을 고치거나 현재 writer에서 재측정 줄을 제거하지 않았다.
- **RUN:** `ROOT/run-1794873976427`: 가짜 s9의 각각 분리된 pre/fixed/orphan/정상 백업·복원 자료.

고정 s9 ZIP을 OS-temp로 추출하고9→10을 올린 가짜 사본만 사용했다. PCM은 고정 s9의 합성 원본이다. 바이너리 실행이 필요한 시험이 없어 미디어 도구를 실행하거나 물리 복사하지 않았고 설치 경로에도 쓰지 않았다. 의존성은 기존 `D:/starwork/dream-ai-studio/node_modules`를 읽는 junction 하나다. 도구 사본을 통한 native 작업을 수행했다는 주장은 하지 않는다.

## 독립 실행

```text
node node_modules/vitest/vitest.mjs run tests/t166-late-source-change.test.ts tests/t162-audio-bundle.test.ts tests/restore.test.ts tests/t158-export-manifest.test.ts tests/t160-sample-consistency.test.ts
npm.cmd run lint
npm.cmd run typecheck
node node_modules/vitest/vitest.mjs run tests/t167-independent.test.ts
```

| 실행 | 실제 결과 | 증거 |
|---|---|---|
| T166 새6 + writer8 + restore/manifest/sample 관련 baseline | **5파일/48시험 PASS**, exit0 | ROOT/related.log |
| lint | PASS, exit0 | ROOT/lint.log |
| typecheck | `next typegen && tsc --noEmit` PASS, exit0 | ROOT/type.log |
| 원재현 대조·삭제/orphan·정상 백업/복원/DTO 독립3시험 | **3/3 PASS**, exit0 | ROOT/independent.log, independent-evidence.json |

전체703·기존132를 반복하지 않았고 이번에 build도 다시 실행하지 않았다. T166 저자의 격리 build와 T163의 선행 독립 build는 별도 증거다. 최신 코드의 새 독립 build PASS로 합산하지 않는다.

## F163-1 원재현: 같은 크기·동일 mtime에서도 성공 경로 full hash로 거절

실제 writeZip이 반환한 직후 voice PCM 마지막1바이트를 바꿨다. 원래 mtime을 정수 ms로 먼저 맞춘 뒤 변경 후 같은 값으로 복원하여 **이번 독립 실행에서는 관찰된 mtimeMs 자체가 정확히 같았다**. wrapper는 실제 writeZip/fileDigest/verifyZip을 호출하고 hook에서 source만 변경했다. hook 안에 단언을 넣어 작성 오류로 우회 통과시키지 않았다.

| 항목 | 실제 관찰 |
|---|---|
| source 크기 전/후 | **384078 / 384078** |
| mtimeMs 전/후 | **1794873976630 / 1794873976630** |
| 1차 full digest | `2492f0d9e7f6ed53ce8aa20e13ba3e472971c407ebc8851f528cdf97fa4bb941` |
| 2차 full digest | `2f9298263288fb2daef35355c220fad3e4f04eedd432714bdca744bd9de134d1` |
| 수정 후 job | **failed / EXPORT_INVALID**, “저장할 때와 달라요” |
| export 행 | failed, file_path=null, manifest_json=null |
| 새 성공 파일·part | 둘 다 없음 |

fileDigest wrapper는 결과를 기록하고 **실제 full fileDigest로 전달**했다. 해당 voice는 초기와 성공 경로 후반에 실제 두 번 읽혔고 두 SHA가 달랐다. size/mtime 캐시 때문에 같은 것으로 취급하지 않았다. 실제 작성된 유효 ZIP은 변경 직전 복사한 `RUN/original-valid-written.zip`에 재현 증거로 남겼다. 이는 검수 보존본이며 제품이 확정한 성공 파일이 아니다.

동일한 s9·주입 시점·같은 size/mtime 조건으로 수정 전 exports.ts를 실행하면 **succeeded**였다. 그 writer의 해당 source digest 호출은 한 번뿐이었다. 원결함이 대조 코드에서 실제 발생하고 고정 코드에서 거절되는 것을 확인했으므로 단순히 다른 오류로 막힌 통과가 아니다.

## verify 이후 삭제·orphan 이어받기

- 실제 verifyZip이 성공한 직후 voice 파일을 `.away`로 옮겼다. fixed writer는 **EXPORT_INVALID**, “찾을 수 없어요”로 실패했고 행 file_path=null, part0이었다. 새6시험에서는 같은 조건의 성공 final 부재도 확인했다.
- 실제 writeZip 결과를 final 경로에 복사하고 저장 중단을 주입하여 **유효 orphan**과 STORAGE_FAILED 대기를 만들었다.
- 재시도는 그 기존 final 파일의 verifyZip을 실제 통과했다. 그 직후 같은 size/mtime으로 source를 바꾸자 **EXPORT_INVALID**로 실패했다. 행 file_path=null, part0, **orphan Buffer 전체는 전후 동일**했다.
- 이때 final 경로에 orphan은 남는다. “새 성공 파일을 확정하지 않음”과 “기존 orphan 파일도 삭제함”을 혼동하지 않는다. 원래 파일을 보존하는 정책을 확인했다.

## no-replace·DB 확정 실패·과거 성공 파일

T166 새6시험을 독립 재실행하여 다음을 확인했다.

1. verify 뒤 final 경로에 foreign 파일이 생기는 실제 filesystem 충돌: STORAGE_FAILED, 성공 행 없음, foreign Buffer 그대로, part0. 같은 작업 retry도 덮어쓰지 않았다.
2. link 뒤 DB 성공 갱신을 막는 **가짜 DB 전용 trigger**: STORAGE_FAILED 대기, 그 시도의 final/part 없음. trigger 제거 뒤 동일 작업 retry는 manifest2 성공.
3. 위 실패·retry 동안 **먼저 성공했던 다른 ZIP의 전체 Buffer는 그대로**였다.

이를 “DB commit이 성공한 후에도 임의 실패를 복구했다”는 의미로 표현하지 않는다. 실제 검증한 실패 지점은 **link 이후 성공 행 UPDATE/transaction commit 전**이다. commit 이후 모든 cleanup 오류·OS 장애를 일반적으로 검증한 것은 아니다.

## 정상 manifest2 baseline·T165·UI DTO

- 독립 정상 source는 manifest2 성공·verifyZip 통과 후 실제 backup 작업→inspect→finish로 복원했다.
- 복원 DB의 성공 export 행 전체는 원본과 같고 목록 `isMock:true,available:true`, `_SAMPLE.zip` 다운로드가 유지됐다. 복원 ZIP SHA-256은 `e902301f08b425ffeedefc5ec8b05f4575ca625e187c3660da5bb23f7a3defc4`로 원본과 같았다.
- 같은 가짜 DB의 `exportService.preview`를 수정 전/후 모듈로 읽어 **DTO 전체 deep equality**를 확인했다. audio/audioBlocked/backupGrowthBytes/entries/estimatedBytes/manifestVersion 등 키·값이 같다. T166의 제품 diff도 writer 내부뿐이다. 이는 UI DTO 보존이며 디자인 WIP 화면을 검증했다는 뜻이 아니다.
- T165는 시험의 cast를 `manifest2` 단언+타입 좁히기와 `isAudioFile` 타입가드로 바꿨다. 원래 paths/roles/샘플/바이트 단언은 유지되고 skip/expect 제거가 없다. 해당8시험과 고정 snapshot typecheck가 독립 통과했다. 작성자가 언급한 환경별 TS2352 원인을 이번에 별도로 재현·확정하지 않았다.
- `git diff --exit-code 4838017^ 4838017 -- components lib/export/schema.ts lib/db/migrations tests/fixtures`는0이었다. UI·schema·발행 SQL·기존 fixture는 이번 수정에서 불변이며 manifest/sample/restore baseline도 위48시험에 포함된다.

## 승인된 한계·미검증·잔존

성공 경로의 순서는 ZIP verify/ZIP digest → 비동기 source full digest → 동기 소유권/취소/context → link·행 확정이다. **마지막 source digest가 끝난 뒤 link까지의 local-trust/ABA 한계는 남는다.** Master가 승인한 범위로 유지하며, 이 재검수가 OS 파일 잠금·불변 filesystem snapshot·다른 프로세스 차단을 입증했다고 주장하지 않는다. 그 조건을 새 필수 요구로 추가하지 않았다.

요청/preview는 여전히 size까지만 보며 “문제 없음”은 source SHA 검증 PASS가 아니다. UI/S4, 실제 사용자 DB/3013, 기기/청취, native 렌더, 대용량 성능·timeout/cancel 행렬·모든 OS cleanup 오류는 이번 범위 밖이다. 비동기 재측정에 AbortSignal을 전달하고 마지막 동기 작업 소유권/취소 검사가 유지됨은 코드로 확인했지만 전체 고장 행렬을 실행하지 않았다.

서버·브라우저·worker 상주 프로세스를 시작하지 않았다. 시험은 종료됐고 ROOT를 명령줄에 가진 node/ffmpeg/ffprobe 최종 조회는0건이었다. ROOT의 소스/junction·가짜 DB·변경 원본·orphan·보존 ZIP·정상 복원본·로그는 재현 증거로 남겼다. 이번 경로의 재귀 삭제를 제출하지 않았으므로 **새 정책 거절이나 완전 정리를 주장하지 않는다**. 선행 T163의 정책 거절 BUILD/ROOT 잔존은 변경하지 않았다. 후속 정리 시 junction의 실제 공유 의존성 대상을 보호해야 한다.

## Master/플래너 복사 전달문

T167은 4838017의 원 F163-1 수정에 대해 **bounded PASS**입니다. 새6 포함48개 회귀·추가 독립3개·lint/type가 통과했고, 실제 writeZip 뒤 같은 size와 정확히 같은 mtime의 변경이 두 번째 full digest에서 EXPORT_INVALID로 거절됐습니다. 수정 전 writer에서는 같은 재현이 성공했습니다. verify 뒤 삭제·orphan 변경 거절/보존, foreign no-replace·link 후 DB 실패 retry·기존 성공 ZIP·정상 manifest2 백업/복원·UI DTO 불변도 확인했습니다. 승인된 local-trust/ABA 한계와 UI/build/전체703 미재실행 범위는 유지하며 ROOT 증거는 보존했습니다.
