# T-162 P2-6 S3: 소리 원본을 담은 재편집 ZIP

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_642be19f8a09 · 계약: T-154 4.1·4.3·4.5·4.6, D-6. 기반 T-158(manifest 2·0010), T-160(샘플 규칙), T-156(s9)
- 기준 `a21945b` + 이 변경이에요. 자체 구현·자체 확인이고 **독립 검수 전**이에요.
- 바꾸지 않은 것: DB, migration 1~10, 고정 fixture(s4~s7, s9 포함), Player·편집·렌더 화면, 공용 문서, 패키지, `.tools`, 사용자 DB
- **이번에 하지 않은 것(S4)**: 화면. 미리보기 DTO는 아래 5장처럼 준비만 해 두었어요.

## 1. 바뀐 파일
| 파일 | 내용 |
|---|---|
| `lib/media/audio-sources.ts`(신규, 순수) | 소리 원본 확인 규칙을 한곳에 모았어요(D-6). <br>· 원본 목록 순서: assetId 오름차순<br>· 확인 순서: 행 → 종류 → 저장 파일·기록 필드 → 바이트 → 사용 구간<br>· 사유: `file_missing`, `not_audio`, `file_changed`, `range` |
| `lib/render/input.ts` | 위 함수로 바꾸기만 했어요. 확인 순서, 사유, `AUDIO_SOURCE_MISSING` 값은 그대로예요. 렌더 기존 시험이 모두 통과했어요. |
| `lib/services/exports.ts` | `audioSources()`, `audioPath()`, `audioIssueMessage()`, `ExportSourceError`를 추가했어요. 그리고 다음을 바꿨어요.<br>· `bundleLayout`: 소리 파일과 `edit/audio_sources.json` 추가, README·rights 줄 추가<br>· `context`: 소리 원본 검사 추가<br>· `preview`: 소리 DTO 추가<br>· `runClaimedExport`: 원본 해시 재측정, manifest 2, 작성 중 변경 감지 |

## 2. 묶음 내용 (v2 타임라인 + 소리 ≥1일 때만)
- 기존 순서 맨 뒤(글꼴 다음)에 붙여요.
  - `audio/{nn}_{assetId}[_SAMPLE].{확장자}`: 원본 바이트 그대로예요. 잘라 내거나 다시 인코딩하지 않아요. 같은 원본은 여러 클립·역할이 써도 1번만 넣어요.
  - `edit/audio_sources.json`: `{schemaVersion:1, timelineRevisionId, timelineFile, fps:30, audioMixProfile, sources:[…], joins}`
    - sources 항목: `assetId, path(ZIP 안), title, mime, sizeBytes, sha256(원본), durationMs, isMock, archived, roles, clipIds, clips[{id,role,startFrame,sourceInFrame,durationFrames}], rights`
    - **계약 4.1의 "배열"을 객체로 넓혔어요.** Master가 지시한 trim·joins·profile을 읽기 쉽게 함께 넣기 위해서예요. 기준은 여전히 `edit/timeline.json`(저장 바이트 원형)이에요.
- `README.txt`: 줄만 더해요. 다른 묶음의 README는 그대로예요.
  - 소리 원본이 audio/에 원본 그대로 있다
  - 믹스·완성 MP4는 없다
  - 편집 설정은 timeline.json(30fps)에 있다
  - 다른 도구에서는 손으로 맞춰야 한다
  - ZIP을 다시 불러오는 기능은 없고, 앱 상태는 백업·복원으로 되돌린다
  - 권리 기록 ≠ 사용권 확인
  - 보관한 소리를 넣었다(해당할 때)
  - 샘플 소리가 있으면 기존 "샘플 포함" 줄을 써요.
- `provenance/rights.md`: `## 소리 원본 권리` 절을 더해요. 원본마다 출처·이용 계획·만든 날·메모를 적고, 기록이 모두 비면 "직접 확인 필요", 그리고 자료 메모를 적어요.
- manifest 2
  - 소리 파일 항목은 `audio:{assetId, roles, isMock}`이고 `durationMs`가 있어요.
  - 묶음 `isMock`은 장면 또는 소리 중 하나라도 샘플이면 참이에요(T-160 규칙과 같아요).
  - `timeline:{revisionId, schemaVersion:2, audioMixProfile}`가 있어요.
  - `manifest_version` 열은 2예요.
- **그 밖의 묶음은 그대로예요**: P1 r1, v1 타임라인, 소리 없는 v2는 manifest 1이에요. 예전 v1 소리 기록이 있으면 README에 "원본을 넣지 않았어요" 한 줄만 더해요(계약 4.5). SRT·VTT 함수와 순서도 바꾸지 않았어요.

## 3. 막는 경우와 다시 시도
- 요청(`context`, 동기)
  - 확인하는 것: 행, `kind`, 저장 파일, 기록 필드(sha·크기·길이), **실제 파일 크기**, 사용 구간
  - 하나라도 어긋나면 `ExportSourceError`를 던져요. HTTP 409이고 문장을 함께 보내요. `exportCode` 값은 "EXPORT_INVALID"예요. export 행과 작업은 만들지 않아요.
  - API 응답 body에는 code 필드가 없어요. 기존 route가 WorkflowError의 문장과 status만 보내기 때문이에요. 공용 오류 타입은 바꾸지 않았어요.
- 작성(`runClaimedExport`)
  - 같은 `context`를 거쳐요. 소리 문제는 같은 문장으로 `MediaError EXPORT_INVALID 409`가 돼요. 이 코드는 다시 시도할 수 없어요.
  - 원본마다 **fresh sha256**을 다시 재요. 크기는 같고 바이트만 바뀐 경우는 여기서 막아요.
  - 요청 단계는 동기 트랜잭션이라 큰 파일 전체 해시를 하지 않고 크기까지만 봐요. 이 한계는 작성 단계의 재측정이 메워요.
- 작성 중 원본이 바뀌면 ZIP 재검증(`verifyZip`)이 실패해요. 이때 원본을 다시 재서 바뀐 것이 확인되면 `STORAGE_FAILED`가 아니라 `EXPORT_INVALID`(문장 포함)로 실패해요. 임시 `.part`는 지워요.
- 확정 트랜잭션에서 `context`를 다시 보므로, 작성 뒤 원본이 사라져도 확정하지 않아요(link 전, 성공 파일 없음).
- 다른 경로로 대신 만드는 일(silent fallback)은 없어요. 문제가 있으면 소리 없는 v1 묶음을 만들지 않고 실패해요.
- 보관(archived) 원본도 파일이 맞으면 넣고, `archived:true`와 README 줄로 표시해요.
- 재시도
  - 기존과 같아요. `STORAGE_FAILED`는 같은 작업을 다시 시도해요. 이때 원본을 다시 재서 같은 manifest 2로 확정해요.
  - 같은 exportId 파일이 이미 있으면 `verifyZip`(전체 파일 해시와 manifest)으로 이어받아요.
  - 확정은 link만 해요. 덮어쓰지 않아요(noreplace).
  - 성공 행은 0010 트리거와 행 검사를 통과해요.

## 4. 시험 (`tests/t162-audio-bundle.test.ts`, 8개)
- **환경**
  - 모든 시험은 고정 s9 ZIP을 OS 임시 폴더에 풀고 9→10으로 올린 사본에서 해요. s9 ZIP의 SHA는 기록값과 같다는 것을 단언해요.
  - 사본에서만 하는 준비: 장면 2의 `needs_recheck` 해제, 검수 통과 처리, 백업 순간 남은 작업 정리
1. **실제 소리 ZIP**
   - manifest 2이고, `verifyZip`과 `checkExportRows`를 통과해요.
   - ZIP을 풀어 manifest의 **모든 파일 SHA가 실제 바이트와 같은지** 확인했어요. 파일 목록 = manifest + manifest.json이에요.
   - 소리 2개(assetId 순, 경로 규칙, roles, isMock): ZIP 안 바이트 SHA = 등록 sha = 저장 파일이에요.
   - `edit/timeline.json` = 저장 행 문자열이에요. `audio_sources.json`의 clips·rights·joins·profile은 타임라인과 같아요.
   - README·rights 문구가 들어 있어요.
   - 미리보기: 예상 크기 ±10%, 저장 경로·드라이브 문자 없음, manifestVersion 2
   - 목록·다운로드는 `_SAMPLE.zip`이에요(s9 장면이 샘플이라서). 원본 파일은 바뀌지 않았어요.
2. **실제 백업 → 복원**: 백업 작업이 성공하고(행 검사와 ZIP 재검증 통과), inspect(10→10)·finish를 거쳐요. 복원본의 export 행은 같고 ZIP sha256도 같아요.
3. **요청 거절**
   - 파일 없음, 크기 바뀜, kind≠audio, 구간 초과(duration 줄임), 등록 행 없음을 모두 409 `ExportSourceError`와 쉬운 문장으로 거절해요. export 행 수는 늘지 않아요.
   - 미리보기에는 `audioBlocked`, `problem.reason`, `missing`이 표시돼요.
4. **작성 거절(같은 크기, 바이트 1개 바뀜)**: 작업은 failed `EXPORT_INVALID`이고 다시 시도할 수 없어요. 행은 failed이고 성공 ZIP과 `.part`가 없어요.
5. **작성 중·작성 뒤 변경**
   - 시험 안에서만 `writeZip`을 감싸, 쓰는 동안 바이트를 바꿨어요. 결과는 `EXPORT_INVALID`(저장할 때와 달라요)예요.
   - 작성 직후 원본을 옮겼어요. 확정 단계에서 `EXPORT_INVALID`(찾을 수 없어요)가 되고 성공 파일이 생기지 않아요.
   - 두 경우 모두 `.part`가 0개예요.
6. **저장 실패 재시도**: 내보내기 폴더를 막으면 `STORAGE_FAILED`로 다시 대기해요. 막힌 것을 풀고 다시 하면 manifest 2로 성공하고 `verifyZip`을 통과해요.
7. **한 원본 여러 역할·보관·샘플**
   - voice 원본을 effect 클립에도 썼어요. 파일은 1번이고, roles는 `[voice, effect]`, clipIds는 2개예요.
   - 보관한 music도 넣었고 `archived:true`와 README 줄이 있어요.
   - 샘플 voice는 `_SAMPLE` 경로이고 `audio.isMock`이에요. 실제 music은 둘 다 아니에요. 묶음 isMock은 true예요.
8. **소리 없는 v2**: manifest 1이고, audio/·목록·추가 문구가 없어요.
- **결과**
  - `eslint .`, `tsc` 통과
  - vitest 전체: **63파일 통과·2 skip, 691 통과·19 skip**. 기존 jobs·p2-3·p2-1·VTT·렌더·T158·T160·s9 시험이 모두 통과했어요.
  - 운영 `next build` + `verify-build`: 안전 사본에서 exit 0이에요(공유 `.next`는 다른 세션 dev 3013이 쓰고 있어요).
  - 빌드 사본과 임시 폴더는 지웠어요. 원본 node_modules 266개, `.tools`, s9는 그대로예요.

## 5. 화면(S4)에 넘길 미리보기 DTO
`exportService.preview()`가 `ready:true`일 때 지금 계약은 다음과 같아요.
- `manifestVersion: 1|2`
- `audioBlocked: boolean`: 하나라도 문제가 있으면 만들기가 거절돼요.
- `backupGrowthBytes`: = estimatedBytes. 묶음은 저장소 안에 있어서 백업도 그만큼 커져요.
- `audio[]`: 원본마다 아래 값이 있어요. **저장 경로나 PC 경로는 넣지 않아요.**
  - `{assetId, title, path(ZIP 안 경로), sizeBytes, isMock, archived, roles, clipCount, rightsRecorded, problem:{reason, message}|null}`
- `entries[]`: 소리 행은 `missing`(문제 있음)과 `sample`로 표시해요.
- `isMock`, `fileNameExample`, `estimatedBytes`: 소리까지 포함한 값이에요.
- 화면 문구 후보(README와 같은 뜻)
  - "합친 소리와 완성 영상은 들어 있지 않아요"
  - "다른 편집 도구에서 손으로 맞춰야 해요"
  - "이 앱으로 다시 불러오는 기능은 없어요"
  - "묶음 크기만큼 백업도 커져요"
  - "권리 기록은 사용권 확인이 아니에요"

## 6. 남은 점
- 요청 단계에서는 크기까지만 확인해요. 같은 크기로 바뀐 바이트는 작업에서 실패해요(다시 시도할 수 없음, 새 요청 필요).
- API 응답에 오류 code 필드가 없어요(기존 route 형식).
- 큰 원본의 예상 크기 정확도(±10%)는 s9 크기(수백 KB)에서만 쟀어요. 10분 제한에 걸리면 `TIMEOUT`이 되고 다시 시도할 수 있어요(기존과 같음).
- 실제 화면, 기기, 청취, 다른 편집 도구로 다시 맞춰 보는 일, 실사용 DB는 확인하지 않았어요.
