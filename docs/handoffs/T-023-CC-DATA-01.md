# T-023 · F-016-1 장면 실패 안내 · F-016-2 내보내기 정보 (CC-DATA-01 임시 코딩 겸임)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-023 / R-016 F-016-1·F-016-2 (P1 종료 차단 항목) |
| 담당 / 플랫폼 | CC-DATA-01 · Claude Code CLI (Windows) · Orca `term_a0a6f98c-c4ca-405a-9a7e-9fb263d26390` |
| 지시 | Master `msg_08abf5babf64`, 수락·점유 회신 `msg_08992f1198d7` |
| 기준 | 시작 HEAD `29d93a2` |
| 입력 | `AI_TEAM_RULES.md`·`CLAUDE_ROLES`(이전 세션에서 읽음), REVIEW R-016, `P1-END-INDEPENDENT-REVIEW.md`, `T-013-CC-DESIGN-01.md` 3·4장, Next 16 로컬 문서(`building.md` 30행, `upgrading/version-16.md` 893행: dev는 `.next/dev`라 build와 동시 실행 가능) |
| 상태 | ready_review · **자체 검증만 했어요. 독립 검수와 브라우저 확인은 아직이에요** |
| 접근 안 함 | `claude-coding-p1-fixes` worktree·터미널, 실제 data/storage/backups, planner·공용 상태·lockfile·schema SQL |

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `lib/ui/errors.ts` (새) | 오류 코드 → 굵은 첫 문장·다음 행동·버튼·링크·작은 코드 줄을 한 곳에서 정해요(T-013 3.2 표). `RETRYABLE_JOB_CODES`·`isRetryableCode`, 이유 줄 정리 `safeReason`(경로·키·긴 토큰 모양은 버림), 내보내기용 `exportErrorCopy`가 있어요 |
| `lib/ui/format.ts` (새) | `formatBytes`("2.4MB"), `formatExactBytes`("2,431,872바이트") |
| `lib/services/production.ts` | 버전 DTO에 `job` 허용 목록을 추가했어요(아래 3장) |
| `lib/services/exports.ts` | 묶음 경로 목록 함수 `bundleLayout` 하나를 실제 ZIP 쓰기와 미리보기가 함께 써요. `bundleFileName`을 목록·다운로드가 함께 써요. 목록에 `preview`, 행에 `fileName`·`sizeBytes`·`errorCode`·`retryable`을 추가했어요 |
| `components/result-preview.tsx` | 자리 표시를 상태별로 나눴어요(아래 2.1). `placeholderText` export |
| `components/production-panel.tsx` (+`.module.css`) | 최근 시도 실패 상자·자동 재시도 대기 상자·대기/진행 줄과 취소를 넣었어요. 실패 버전의 "되돌리기" 버튼을 숨기고, 상태가 실패로 바뀌면 Toast를 한 번 띄워요 |
| `components/exports-panel.tsx` (+새 `exports-panel.module.css`) | "묶음에 들어갈 것" 미리보기 카드, 완료 행 `dl`, 실패 상자·다시 시도·새로 만들기, 진행 행 취소, "지금 내용과 다름"(R-e) |
| `tests/scene-export-info.test.ts` (새) | 14검사 (아래 4장) |

## 2. 동작

### 2.1 F-016-1 장면 실패
- **"결과를 기다리고 있어요."는 queued·running에서만 나와요.** 각 상태의 자리 표시는 아래와 같아요.
  - 실패: "만들지 못했어요." (빨간 경고 배경)
  - 취소: "취소했어요."
  - 버전 없음: "아직 만들지 않았어요."
  - 대기: "대기 중 · 작업 대기열 n번째"
  - 진행: "만드는 중 · n초 지남"
- **"최근 시도"는 version 번호가 가장 큰 버전이에요.** 그 버전이 실패면 장면 카드 기본 화면에 실패 상자를 보여 줘요. 상자 순서는 굵은 첫 문장 → 제공자 이유 → 다음 행동 → 링크 → 작은 코드 줄이에요.
  - 선택한 성공 결과가 있으면 카드는 기본 모양이고, 썸네일도 선택 결과 그대로예요. 상자 위에 "선택한 v{n}은 그대로예요."가 나와요.
  - 선택한 성공 결과가 없으면 카드를 `tone=danger`로 바꿔요.
- **거절(CONTENT_REJECTED):** 다시 시도 버튼이 없어요. "기획 고치기"·"자료 바꾸기" 링크를 보여 주고, 코드 줄에 "자동 재시도 안 함 · 청구 없음(샘플)"이 나와요.
- **저장 실패(STORAGE_FAILED, 시도 다 씀):** "결과는 받았지만 저장하지 못했어요." + 버튼 "저장 다시 시도"를 보여 줘요. 이 버튼은 기존 `/api/jobs` retry를 그대로 써요. 같은 job과 같은 제공자 ID로 이어지고 새로 생성하지 않아요(테스트로 확인).
- **일시 오류로 자동 재시도를 기다릴 때:** "{시각}쯤 자동으로 다시 시도해요."와 취소 버튼만 보여 줘요.
- **버전 비교 안:** 실패 버전은 점선 빨간 테두리에 작은 실패 상자를 붙여요(링크 없음, 코드 줄 있음). 완료가 아닌 버전에는 "이 버전으로 되돌리기" 버튼을 렌더링하지 않아요.
- **접근성:**
  - 상자는 `section aria-labelledby`예요. 늘 보이는 정보라 `role=alert`는 쓰지 않아요.
  - 버튼 접근 이름에 장면 번호를 넣었어요(예: "장면 1 저장 다시 시도", "장면 1 작업 취소").
  - 상자 제목에 "실패 ·" 글자를 넣어 색만으로 구분하지 않아요.
  - 폴링 중 상태가 실패로 바뀌면 Toast(error)를 한 번 띄워요.

### 2.2 F-016-2 내보내기
- **미리보기 카드:** 검수 승인 전에도 보여 줘요. 기획 승인 전에는 이유 한 줄만 보여 줘요.
  - 내용: "예상 약 {크기} · 파일 {n}개", "샘플 포함" Badge, 폴더 나무 요약(mono·sunken). `manifest.json`은 나무에 줄로 보이지만, 파일 수는 완료 행 기준과 맞춰 세지 않아요.
  - 펼침 "파일 이름 모두 보기": 전체 경로와 파일별 크기를 보여 줘요. 이 부분만 안쪽 가로 스크롤이에요.
- **경로는 한 함수에서 나와요.** `bundleLayout`이 실제 ZIP 순서 그대로 entry 목록을 만들고, `runClaimedExport`는 이 목록대로 파일을 써요. 원래 코드와 텍스트 내용·manifest 필드 순서는 같아요. 그래서 이어받기 검증(`verifyZip` existing)도 바뀌지 않았어요. `subtitles/`는 자막이 있을 때만 생겨요.
- **예상 크기:** 장면 `size_bytes` + 글꼴 실제 크기 + 텍스트 실제 바이트 + ZIP64 헤더·manifest 추정이에요. 묶음은 압축하지 않고 저장(store)해서 압축 전 합계가 거의 그대로예요.
- **파일이 없을 때:** 장면 결과 파일이 없으면 미리보기 줄에 "파일 없음"을 표시하고, 만들기 버튼은 "장면 n의 결과 파일을 찾을 수 없어요."로 잠가요. 기존 검수 게이트 문구가 먼저예요.
- **완료 행:** 파일 이름(mono, `overflow-wrap:anywhere`), 크기("2.4MB (2,431,872바이트)"), 만든 시각 · 파일 수, "검증된 해시" 앞 8자리 + "전체 복사"를 보여 줘요. 복사가 안 되면 전체 해시를 선택할 수 있는 글자로 펼쳐요.
  - 내려받기 링크: "내려받기 · {크기}(· 샘플 포함)".
  - 이름은 `bundleFileName`(다운로드 응답과 같은 함수), 크기는 저장된 파일의 `stat` 크기예요. 목록을 열 때 해시를 다시 계산하지 않아요.
- **실패 행:** "묶음을 만들지 못했어요." + 원인 한 줄 + 다음 행동 + 버튼을 보여 줘요.
  - 버튼은 retryable이면 "다시 시도"(기존 retry 게이트), `EXPORT_INVALID`나 그 밖은 "현재 내용으로 새로 만들기"(기존 검수 게이트)예요.
  - 반쯤 만든 파일과 내려받기 링크는 보이지 않아요. 취소된 행은 "만들기를 취소했어요."로 따로 보여 줘요.
- **390px:** `dl`은 1열로 쌓이고, 폴더 나무 설명은 다음 줄로 내려가요. 실패 상자 버튼은 꽉 찬 폭이에요. 코드 줄과 파일 이름은 줄바꿈돼요.

## 3. DTO 변경 계약 (새 route 없음)

**`readProduction()` → `scenes[].versions[].job`** (`version.jobId`가 없으면 `null`). 허용 목록은 아래 11개뿐이에요. 입력 스냅샷·제공자 작업 ID·경로는 넣지 않았어요.

| 필드 | 타입 | 뜻 |
|---|---|---|
| `id` | string | 작업 ID. retry·cancel PATCH에 써요 |
| `status` | jobs.status | |
| `errorCode` | string\|null | |
| `errorMessage` | string\|null | `safeReason`으로 정리한 제공자·처리기 문장 |
| `retryable` | boolean | `status==="failed"`이고 코드가 재시도 집합에 있음. `/jobs` 목록과 같은 판정 |
| `willRetryAt` | string\|null | queued이고 errorCode가 있을 때 `nextRunAt`(자동 재시도 대기) |
| `attempts` | number | |
| `queuePosition` | number\|null | queued일 때 대기열 순번 |
| `startedAt` / `elapsedSec` | string\|null / number\|null | running일 때만. 경과 초는 서버가 계산(hydration 불일치 방지) |
| `cancelRequested` | boolean | |

**`readExports()`**

- 최상위에 `preview`를 추가했어요. 형태는 두 가지예요.
  - `{ready:false, reason}`
  - `{ready:true, fileNameExample, isMock, fileCount, estimatedBytes, entries:[{path,sizeBytes,missing,sample}], missing:[{sceneNumber,title,reason}], subtitles, editSaved}`
- `rows[]`에 아래 필드를 추가했어요.
  - `fileName`: string|null (성공 행만, 다운로드 이름과 같음)
  - `sizeBytes`: number|null
  - `errorCode`: string|null (실패 행만)
  - `retryable`: boolean
- `available`은 이제 파일 `stat`까지 성공해야 true예요.

기존 필드·의미는 그대로예요. route mock 테스트도 모두 통과했어요.

## 4. 검증 (자체 검증, 독립 검수 아님)

| 명령 | 결과 |
|---|---|
| `npm run lint` | 통과 (경고 0) |
| `npm run typecheck` | 통과 |
| `npm test` | **25파일 221검사 통과** (기존 207 + 새 14). 기존 테스트 수정 없음 |
| `npm run build` | 종료 0, 경고 0, "로컬 데이터·비밀 설정 추적 없음". 다른 세션의 `next dev :3013`은 그대로 두고 빌드했어요(Next 16 문서 근거, `.next` 삭제·이동 없음) |
| 색 리터럴 검색 (`#hex`, 바꾼 components·lib/ui) | 0 |

새 테스트(`tests/scene-export-info.test.ts`, OS 임시 fixture·mock 제공자만 사용):

| 장면 | 확인한 것 |
|---|---|
| 오류 문장 | 재시도 코드 집합 = `jobs.ts` `retryable` 집합(소스 대조). 코드별 첫 문장·행동·버튼·링크. 경로·키·64자 해시 모양 이유는 버림. 실패·취소·없음 자리 표시에 "기다리" 없음. 크기 표시 |
| CONTENT_REJECTED | 버전 failed·asset null. job은 failed·시도1·retryable false·willRetryAt null, 이유에 샘플 문장. DTO 키 11개 허용 목록. 기존 선택 그대로. 1시간 뒤에도 자동 실행 없음, 수동 retry 거절 |
| PROVIDER_DOWN | 첫 시도 후 queued + willRetryAt + 순번1 → 자동 대기 문구. 성공하면 오류 정보 사라짐 |
| STORAGE_FAILED(장면) | 시도를 다 쓰면 failed·retryable → "저장 다시 시도". retry 후 성공, generations 1개, 제공자 작업 ID 그대로 |
| 미리보기 = 실제 ZIP | 검수 전에도 preview. 승인 후 만든 ZIP의 manifest 경로·순서·파일별 크기·파일 수와 미리보기가 같음. 자막 있음/없음 둘 다. **예상 크기 오차 < 10%** |
| 완료 행 = 다운로드 | `fileName`·`sizeBytes` = `exportDownload` 결과 = 실제 `stat`. 실제 route `GET /api/exports/[id]` 응답의 Content-Length·filename*·본문 길이·SHA256이 같음. 목록 응답에 경로 없음. 목록 조회 전후 완료 ZIP 해시·DB 행 그대로 |
| 파일 변조/누락 | 변조하면 EXPORT_INVALID 실패 행(내려받기 없음, "새로 만들기"). 파일을 옮기면 미리보기에 "장면 1의 결과 파일을 찾을 수 없어요."·missing 표시 |
| STORAGE_FAILED(내보내기) | 시도를 다 쓰면 failed·retryable → "다시 시도". 복구 후 retry → 성공·available |
| 기획 미승인 | preview `{ready:false, reason}` |

## 5. 미검증·한계

- **브라우저 확인은 하지 않았어요**(Master 후속 검증 범위). 아래 항목을 화면에서 직접 확인하지 않았어요. 코드와 CSS 규칙으로만 맞췄어요.
  - 1280/390 가로 넘침 0
  - 390에서 긴 파일 이름·해시 줄바꿈
  - 폴더 나무 배치
  - Toast 한 번만 뜨는지
  - 키보드 순서
- **`/jobs` 오류 줄 순서(T-013 R-a)는 바꾸지 않았어요.** `components/jobs-panel.tsx`가 허용 파일이 아니에요. `lib/ui/errors.ts`를 그대로 붙이면 되는 상태예요.
- **R-b(모델 내부 이름)·R-c(시험 시나리오 접기)·R-d(버튼 3개)는 범위 밖이라 그대로예요.**
- **진행 중 "n초"는 첫 실행 시작 시각 기준이에요.** `job.<id>.startedAt` 설정을 쓰고, 없으면 heartbeat 시각을 써요. 2초마다 새로 그려질 때 갱신돼요.
- **예상 크기의 ZIP 헤더·manifest 상수는 실제 묶음과 비교한 근사치예요.** 테스트에서 ±10% 안을 확인했어요. 장면이 매우 많거나 파일이 아주 작으면 오차 비율이 달라질 수 있어요.
- **장면 STORAGE_FAILED는 대기 중 자동 재시도가 먼저 돌아요.** "저장 다시 시도" 버튼은 시도를 다 써서 failed가 된 뒤에만 나와요. 대기 중에는 자동 재시도 안내만 보여요.
- **V13 남은 범위는 이번 작업에서 실행하지 않았어요.** 작성 가능한 검수표의 390px 확인, 등록부터 끝까지 이어지는 키보드 흐름이에요.
