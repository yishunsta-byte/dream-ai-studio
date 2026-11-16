# T163 실제 audio bundle writer 독립 검수 — FAIL

- 담당: 독립 Codex `term_c119e5660244577d9936493a735baba1`, task `task_c451ec1c6cf0`, dispatch `ctx_6ac82103b3f1`, 2026-11-17 KST.
- 기준: **`df62033a43d645e836a7ba796ffaab4d656ad761`**, T162 보고서 전문·T154 계약. 직접 비교한 구현 전 부모: `8333d107c5b3910b75c08f7389aecd796e6695c7`.
- 결론: 실제 ZIP/백업·복원, shared render helper, 기존 자료 보존·원자적 재시도는 아래 범위에서 통과했다. 그러나 **F163-1: ZIP 직렬화 이후 확정 전 같은 크기 소리 변경을 성공으로 확정**하는 경계가 재현되어 전체 writer 수용은 보류한다.
- 작성자 자체691/19skip·build 보고와 아래 독립 실행은 별개다. 제품 수정 없이 이 고유 보고서만 선택 커밋한다.

## F163-1 — 작성 후반 같은 크기 source 변경을 확정 전 재측정하지 않음 (P1, 필수 수정)

**계약 근거:** T154 S3 완료 조건의 작성 중 파일 변경 거절·임시 정리, 이번 검수 요청의 작성 중 변경/확정 전 실패 확인. 새 `audioSources` 주석도 writer가 fresh hash를 “before and after writing” 측정한다고 설명한다. 요청 단계의 동기 크기 한계와는 별개다.

**재현:** 고정 s9 사본에서 정상 승인·export request 후 실제 `writeZip`이 반환한 바로 다음에 voice PCM의 마지막 1바이트만 바꿨다. 이 지점은 ZIP 검증·최종 source context·link/DB 성공 확정보다 앞이다. 검수용 wrapper는 실제 ZIP 작성은 그대로 호출하고 그 뒤 **소리 원본 파일만** 변경했다. mock 성공 ZIP이나 변경된 예상값을 사용하지 않았다.

| 관찰 | 실제 값 |
|---|---|
| 등록 원본 SHA-256 | `2492f0d9e7f6ed53ce8aa20e13ba3e472971c407ebc8851f528cdf97fa4bb941` |
| 확정 전 현재 원본 SHA-256 | `2f9298263288fb2daef35355c220fad3e4f04eedd432714bdca744bd9de134d1` |
| 등록/현재 크기 | 둘 다 **384,078바이트** |
| job/export 상태 | 둘 다 **succeeded**, errorCode=null |
| 성공 파일 | 실제로 확정됨 |
| ZIP 내부 voice SHA-256 | 등록 원본 SHA와 같음, `verifyZip` 통과 |

`expect(finalPublished).toBe(false)` regression은 실제 exit1로 실패했다. 증거는 ROOT/F163-1.json, late-same-size.log, 임시 독립 시험의 F163-1 case, `ROOT/run-1794873134971/late-same-size`다.

**범위를 구분한다:** 이 재현의 ZIP은 손상되지 않았고, 이미 읽어 둔 등록 원본 바이트를 올바르게 담고 있다. “변경된 잘못된 소리를 ZIP에 넣었다”는 결함이 아니다. **작성 작업 진행 중 등록 원본이 바뀌었는데도 변경 거절 계약을 충족하지 못하는 경우**다. 요청 전 같은 크기 변경은 worker의 fresh hash가 실제로 거절했고 그 경로는 통과다.

**원인:** `lib/services/exports.ts`의 `changedSource()` 재측정은 writeZip/verifyZip이 **실패한 catch 안에서만** 실행된다. ZIP이 원래 바이트를 이미 읽었다면 verifyZip이 성공하므로 그 재측정은 실행되지 않는다. 최종 트랜잭션의 context→audioSources는 stat 크기까지만 보며 같은 크기 변경을 놓친다.

**요청:** ZIP 작성·검증 뒤, 성공 확정 전에 등록 소리와의 fresh hash 재검증을 정상 성공 경로에도 연결하고, 이 시점의 불일치를 `EXPORT_INVALID`·성공 파일 미확정·임시 정리로 검증한다. async 재측정과 마지막 동기 소유권/취소/기한 확인을 구분하여 기존 no-replace·실패 롤백을 유지한다. 외부 동시 변경의 절대적 ABA 방지까지 입증한 것처럼 주장할 필요는 없다. Master가 “유효한 ZIP에 핀된 원래 바이트만 맞으면 현재 원본 변경도 허용”하는 다른 계약을 채택하려면 이 차이를 명시적으로 조정해야 하며, 검수자가 기존 변경 거절 조건을 임의 완화하지 않았다.

## 저장원·격리·소유 범위

공유 작업트리는 착수 시 HEAD `9fd4084`, 선행 T157 보고서만 미추적이었다. 이를 건드리지 않고 정확한 대상 SHA를 `git archive`로 추출했다. 사용자 DB/storage/backups/비밀 파일·3013·기존 fixture·설치 도구는 변경하지 않았다. T154·T162를 포함한 기준과 코드를 읽었으며 공용 TEAM/REVIEW/PROGRESS는 수정하지 않았다.

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t163-audio-6a30d43fd0be41d19c4a25f9e27f2299`
- `ROOT/app`: 고정 소스 사본, 새 `tests/t163-independent.test.ts`, 부모 소스 그대로의 `lib/render/input-pre162.ts`, `lib/services/exports-pre162.ts`는 **사본에만** 추가했다.
- **RUN:** `ROOT/run-1794873093494`: 최종 통과4시험의 가짜 s9 사본·직접 해제 ZIP·정상 백업/복원·경쟁 재시도 자료. 실패 case와 추가 확정 실패 case는 별도 run 디렉터리다.
- **BUILD:** `D:/starwork/t163-build-6a30d43fd0be41d19c4a25f9e27f2299`: 같은 SHA의 추적 파일만 별도 추출한 build 사본.
- 사본의 node_modules는 기존 `D:/starwork/dream-ai-studio/node_modules`로 향하는 junction이다. 설치·`.tools` 물리 복사·변경을 하지 않았다.

고정 s9 ZIP은 `50e850aec0c2c8a3137c4280943e3de295d32e6bad9b998f0e02cf20af41ca95`, 1,304,161바이트다. 실제 검증은 s9를 OS-temp로 추출하고 9→10을 적용한 복사본에서 수행했다. 사용자 자료가 아닌 fixture의 sine/pink-noise PCM을 사용했고 새 실제 렌더·사람 음성·청취 결과로 표현하지 않는다. s9 generator가 설치 도구 복사를 요구하는 코드는 실행하지 않았다.

## 실제 실행 결과

사본 app에서 기존 설치 ffmpeg/ffprobe 경로를 직접 지정해 필요한 합성자료 회귀를 실행했다.

```text
node node_modules/vitest/vitest.mjs run tests/t162-audio-bundle.test.ts tests/jobs.test.ts tests/restore.test.ts tests/p2-5c-render-audio.test.ts tests/p2-5c-restore-integrity.test.ts tests/t158-export-manifest.test.ts tests/t160-sample-consistency.test.ts tests/p2-6-vtt.test.ts tests/p2-1-timeline.test.ts tests/p2-3-text-editor.test.ts
```

| 실행 | 결과 | 증거 |
|---|---|---|
| 위 관련 회귀 (T162 새8 포함) | **10파일/132시험 PASS**, exit0 | ROOT/related.log |
| `npm.cmd run lint` | PASS, exit0 | ROOT/lint.log |
| `npm.cmd run typecheck` | `next typegen && tsc --noEmit` PASS, exit0 | ROOT/type.log |
| BUILD에서 `node node_modules/next/dist/bin/next build --webpack`, 이어 `node scripts/verify-build.mjs` | **PASS**, exit0, 비밀/로컬데이터/렌더도구 trace 없음 | ROOT/build.log |
| 독립4시험: 복합 actual ZIP/restore, render 전후 비교, size-only/orphan/foreign, 부모 layout 비교 | **4/4 PASS**, exit0 | ROOT/independent-final.log, independent-evidence.json |
| 추가 link 후 DB 성공 갱신 실패·재시도 | **1/1 PASS**, exit0 | ROOT/publication-failure.log, publication-failure.json |
| 추가 F163-1 | **FAIL**, exit1 | ROOT/late-same-size.log, F163-1.json |

전체 suite를 반복하지 않았다. lint/type와 BUILD는 검수 임시 모듈을 추가하기 전의 추적 소스 사본에 대한 결과다. 독립 harness의 첫 render-parity 실행은 검수자의 malformed-row 준비가 기존 asset immutable/CHECK에 막혀 실패했다. 그 **가짜 render 사본에서만** 해당 guard를 제거하고 CHECK를 일시 무시해 잘못된 hash-field 경우를 준비한 후 정상 복구했으며 최종4시험 PASS로 확인했다. 제품 검사를 끄거나 기대값을 바꿔 통과시킨 결과가 아니다. 도중 PowerShell 문자열 편집의 parse 오류도 있었고 실행되지 않은 명령은 검증 성과로 세지 않았다.

## 실제 writer ZIP·메타데이터·백업/복원

새 복합 사본에서 실제 timelineService.save로 nonempty equalPower join15프레임, 같은 music 원본의 두 클립(서로 다른 sourceIn·start), voice+effect의 동일 원본 두 역할, gain/trim, subtitle의 escape·여러 줄을 저장했다. voice는 샘플/권리 기록 있음, music은 비샘플/archived/빈 권리 기록으로 설정했다. 장면 isMock은 false로 두어 **소리 샘플만으로 묶음 샘플이 되는 경로**를 확인했다.

실제 request→runNextJob의 결과는 manifest_version2·manifest2이며 verifyZip/checkExportRows가 통과했다. yauzl로 **manifest에 기재된 모든 entry를 읽어 ROOT/RUN/unzipped에 실제 파일로 해제**하고 각 manifest 항목의 길이·SHA와 원본 Buffer를 대조했다.

- 최종 ZIP: **2,849,910바이트**, SHA-256 `c2a3f53f430516968d8cd4ba3495a13730471590ca22449ee0cdb30cbfb3d3cc`.
- audio 파일은 assetId 순으로 원본당1회, 총2개다. voice에는 roles `[voice,effect]`·clipIds2·`isMock:true`와 SAMPLE 경로, music에는 roles `[music]`·clipIds2·`archived:true`·`isMock:false`가 들어갔다.
- 각 audio entry Buffer=저장 원본 Buffer, SHA=asset 행=고정 s9 record의 원본 SHA. 자르거나 재인코딩하지 않았다.
- `edit/timeline.json`은 저장 timeline_json 문자열과 바이트 그대로다. gain/fade/duck 등의 상세 설정은 여기에서 보존된다.
- `audio_sources.json`의 source별 clips(id/role/start/sourceIn/duration), rights(채운 기록과 null 기록), joins15/equalPower, profile은 저장 timeline과 같았다. profile은 `p2-5-local-v1`, fps30이다. empty rights의 “직접 확인 필요”도 rights.md에 있었다.
- SRT/VTT가 실제 ZIP에 있고 final/ 영상은 없었다. raw source 파일은 바뀌지 않았다.
- 같은 사본을 실제 backup 작업→inspect(10→10)→finish로 복원했다. **복원 DB**의 export 행 전체와 ZIP hash가 원본과 같고 목록 `available:true,isMock:true`, 다운로드 `_SAMPLE.zip`을 확인했다.

T154 4.1의 audio_sources 배열은 T162에서 joins/profile 등을 담는 `schemaVersion:1` 객체로 확장됐다. 실제 내용 보존은 확인했지만 원래 문서와의 구조 차이는 S4/후속 소비자에게 명시적으로 전달해야 한다. 새 importer나 다른 편집 도구와의 호환성 검증은 아니다.

## 오류·재시도·확정 원자성

- 새8시험을 독립 실행해 source 행 없음·kind 오류·파일 없음·크기 변경·range 초과의 요청409, 변경 감지 worker `EXPORT_INVALID`, 작성 중 ZIP에 바뀐 bytes가 들어가는 경우의 재검증 실패, 작성 뒤 파일 소실, 성공 파일/part 없음, STORAGE_FAILED 재시도를 확인했다.
- 별도 size-only 재현에서는 원본 마지막1바이트를 **요청 전** 같은 크기로 바꿨다. preview는 `audioBlocked:false`이고 request도 받았다. worker는 fresh SHA로 **failed EXPORT_INVALID**, 성공 경로 null이었다. 따라서 preview의 `ready:true`/문제없음은 해시 검증 PASS가 아니다. T162가 명시한 동기 크기 검사의 한계이며 이 경로에서는 허위 성공 ZIP이 없었다.
- 실제 valid orphan ZIP을 write 직후 final 위치에 만들고 중단을 주입했다. 첫 시도는 STORAGE_FAILED 대기, 재시도는 **같은 파일 inode·Buffer hash**를 유지한 채 manifest2 성공으로 이어받았다.
- existing 탐색 뒤 link 전에 foreign test 파일을 final 경로에 넣었다. link의 no-replace 충돌과 다음 retry의 verify 실패 모두 foreign bytes를 보존했고 성공 행을 만들지 않았다. 해당 export의 part도 없었다.
- 별도 DB trigger로 **link 이후** 성공 행 갱신을 실패시켰다. 최종 파일·part 없음, 행 file_path=null, job STORAGE_FAILED 대기였다. trigger 제거 후 같은 작업의 retry는 성공했다. 이 trigger는 검수 가짜 DB에만 추가했다.
- 위 정상 실패 경로와 별개로 **F163-1의 ZIP 읽기 완료 후 같은 크기 변경은 놓친다.** 이를 요청 전 size-only 허용과 동일한 검증 결과로 묶지 않는다.

## shared helper의 렌더 회귀

부모 input.ts와 새 input.ts를 **같은 사본·같은 deps·실제 파일**로 각각 실행했다. 설치 도구를 바꾸지 않고 browser/tool identity 입력만 test deps로 고정했으며, fileSha256 wrapper는 실함수로 전달했다.

8조건: 정상, 두 source 동시에 잘못된 kind, kind+파일소실+range, 파일소실, 같은 크기 bytes 변경+range, range만, 기록 hash 없음(손상 DB 시뮬레이션), source 행 없음.

- 전체 prepare 결과를 deep equality로 비교해 input/audioPlan/source hash 전달과 blockers가 같았다.
- 다중 source는 assetId 오름차순, kind는 파일·range보다 먼저, bytes 변경은 range보다 먼저, 각 사유의 assetId/clipId도 같았다.
- 오디오 source의 실 `fileSha256` 호출 인자와 순서도 전후 같고 **`fresh:true`**였다. hash 캐시 정책이 size-only로 바뀌지 않았다.
- 이 결과는 렌더 **입력 준비** 회귀다. 새 native rendering/DSP/음질 PASS로 확대하지 않는다. 관련 기존 렌더/복원 회귀는 위132시험에 포함된다.

## 기존 P1/v1/VTT/SRT·호환성·게이트

- 같은 입력의 현재/부모 bundleLayout을 직접 비교했다. P1(timelineJson null), 소리 없는 v1, 소리 없는 v2는 **전체 entry·순서·텍스트·파일 경로가 동일**했다. 기존 VTT/SRT 회귀와 실제 writer의 subtitle entry도 통과했다.
- legacy v1 audio 기록은 audio 파일을 넣지 않으며 **README 설명 한 줄만 추가**, 나머지 entry는 부모와 같다. 이는 T154 4.5 예외이며 v1 모두 바이트 불변이라고 표현하지 않는다.
- 승인 전 실제 export request는 거절됐다. 기존 jobs의 승인·stale·취소/lease·기존 ZIP 보존 회귀도 통과했다. final 영상/게시 게이트를 여는 변경은 없고 실제 ZIP에도 final/은 없다.
- `git diff --exit-code df62033^ df62033 -- lib/db/migrations lib/export/schema.ts lib/export/zip.ts lib/backup tests/fixtures`는0이었다. 0010·v2 strict/샘플 규칙·ZIP/backup hash 연결·고정 fixture는 이번 커밋에서 불변이다. 복원된 writer DB의 journal10을9 목록과 비교하면 too_new였다.
- T159에서 실제 구9 소스로 확인한 startup/inspect/finish 거부는 선행 증거다. 이번에는 구9 프로세스를 다시 실행하지 않았고 단순 compare 결과를 실제 구앱 재실행으로 주장하지 않는다.

## 비용·용량·미검증·정리

외부 생성·네트워크·유료 도구 호출은 없었다. 이번 실제 ZIP은 약2.85MB이고 preview 예상2,851,051바이트로 차이1,141바이트(약0.04%)였다. backupGrowthBytes=예상 ZIP 크기는 원본과 별도로 새 export ZIP이 다음 백업에 추가된다는 설명이다. 대용량/100 source/2GiB 파일·10분 timeout·누적 수많은 export의 검사 시간/디스크 예산은 직접 측정하지 않았다. 기존 상한을 낮추거나 시간 제한을 늘리지 않았다.

사용자 UI(S4)·390/1280 화면·기기/청취·다른 편집 도구의 재조립·새 native render·사용자 DB 이관은 미검증이다. 오디오 목록에 내부 PC 경로가 없다는 DTO 시험은 통과했으나 화면 검증을 대신하지 않는다. 요청 route의 오류 body는 기존 message/status 형식이며 code 필드 추가는 구현하지 않았다.

서버/브라우저/worker 상주 프로세스를 시작하지 않았고 검사·build·합성자료 회귀 프로세스는 종료됐다. ROOT/BUILD를 명령줄에 가진 node/ffmpeg/ffprobe 최종 조회는0건이었다. 설치 도구 hash는 기존 값과 같았다.

- ffmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

BUILD의 정확한 절대 경계·junction 대상을 가드하고 junction을 먼저 끊은 뒤 사본만 삭제하는 명령을 제출했으나 **자동 승인 검토가 프로세스 생성 자체를 `blocked by policy`로 거절했다.** 삭제는 실행되지 않았고 우회하지 않았다. BUILD/junction이 남으며 ROOT의 가짜 DB·ZIP·해제본·소스·실패 재현자료는 보존했다. 이전 검수 잔존도 건드리지 않았다. 정리 완료를 주장하지 않으며 후속 삭제 시 junction 대상의 공유 의존성을 보호해야 한다.

## Master/플래너 복사 전달문

T163 독립검수는 df62033의 실제 audio writer에 대해 **FAIL**입니다. 새8 포함132개 회귀·추가5개 시험·lint/type·격리 Webpack build/verify-build는 통과했고 실제 ZIP 해제/원본SHA·nonempty joins·권리·역할·샘플·archived·복원 다운로드·렌더 helper 전후8조건을 확인했습니다. F163-1은 ZIP 직렬화 직후 확정 전 같은 크기 source를 바꾸면 source SHA가 달라져도 성공으로 확정되는 재현입니다. ZIP 내부 원래 바이트는 정상이지만 작성 중 변경 거절 계약을 충족하지 못하므로 성공 경로의 post-write fresh 검사와 회귀를 요청합니다. 제품은 수정하지 않았고 보고서만 선택 커밋하며 BUILD 삭제는 자동 승인 검토 거절로 미실행되어 재현 자료가 남습니다.
