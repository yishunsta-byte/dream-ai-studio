# T-154 P2-6 계약안: VTT·재편집용 ZIP 연결

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_7add6acee3db · 기준 커밋: 이 문서 직전 HEAD(T153 수용 뒤)
- 이 문서는 **계약안과 구현 준비**예요. 제품 코드, 발행 migration 0001~0009, 고정 fixture, 사용자 DB, 공용 문서는 바꾸지 않았어요.
- 잠긴 최종 배포와 채널 게시(P5) 게이트는 열지 않아요. 이 단계의 결과물은 PLAN E-1의 **편집용 묶음**이에요. 완성 영상이나 게시용 패키지가 아니에요.
- 재편집 ZIP은 **혼자 실행되는 완성 앱이 아니에요**. 원본 파일과 편집 기록(JSON)을 함께 넘기는 형식이에요. 지금 이 앱에는 ZIP을 다시 불러오는 기능이 없어요(4.6 참고).

## 1. 현재 코드 근거

| 대상 | 현재 동작 | 근거 |
|---|---|---|
| 묶음 목록 | `bundleLayout()` 하나가 미리보기와 실제 ZIP의 순서를 정해요. P1 r1(`timelineJson` null)은 P1 배치를 바이트 그대로 유지해요. 사용자·복원 타임라인은 `edit/timeline.json`(저장된 바이트 그대로)과, 쓰인 글꼴 파일 + `LICENSES/{folder}-OFL.txt`를 더해요. | `lib/services/exports.ts:43-64` |
| SRT | `subtitles/manual.srt` = `srtText(editView.layers)`예요. P1 종류 중 `subtitle`만, `startSec` 순으로 정렬해요. 시간은 `framesToSeconds`(= `framesToMs`/1000, 반올림 ms)예요. 자막이 없으면 파일을 넣지 않아요. 편집 화면 미리보기는 같은 형식의 `timelineSrt`를 써요. | `lib/edit/schema.ts:10`, `lib/edit/timeline.ts:128,156,176` |
| manifest | `manifestSchema`는 strict이고 `manifestVersion:1`, `kind:"editing-bundle"`, files 1~1000개예요. `verifyZip`은 다시 열어 경로·크기·sha256·manifest JSON이 같은지 확인해요. | `lib/export/schema.ts`, `lib/export/zip.ts` |
| 불변 | 성공한 export 행은 트리거로 수정·삭제가 막혀 있어요. 파일은 `projects/{id}/exports/{exportId}.zip`에 link로만 확정해요(덮어쓰지 않음). 다시 시도하면 있는 파일을 `verifyZip`으로 이어받아요. | `0001_initial.sql:306`, `0004_audit_backups.sql:20`, `exports.ts:88-113` |
| 게이트 | 승인 기획, 현재 revision 검수 승인, 저장 타임라인, stale 없음, 모든 장면 결과와 해시를 서버 `context()`에서 다시 확인해요. | `exports.ts:71` |
| 소리 원본 확인(렌더) | v2 타임라인의 assetId마다 행, kind audio, 파일 존재, sha256·크기 일치, 원본 범위를 확인하고 아니면 `AUDIO_SOURCE_MISSING`(reason: file_missing / not_audio / file_changed / range)으로 막아요. | `lib/render/input.ts:150-170` |
| 글꼴 | `fontStatuses()`는 폴더마다 글꼴 파일 1개와 OFL 1.1 `OFL.txt`가 있어야 설치로 쳐요. | `lib/fonts/registry.ts` |
| 백업 | 저장소 전체 목록(`storageInventory`)을 담아요. 그래서 export ZIP도 백업에 들어가요. | `lib/backup/archive.ts:25` |
| 재시도 코드 | `PROVIDER_DOWN·RATE_LIMITED·TIMEOUT·STORAGE_FAILED`만 다시 시도할 수 있어요. | `lib/ui/errors.ts:5` |
| 고정 fixture | s4~s7만 있어요. 0008(s8)과 0009(s9)용은 없어요(T-136·T-137에서 만들지 않기로 결정). | `tests/fixtures/backups/` |

## 2. 바꾸지 않는 것 (불변 계약)

- **I-1. P1 경로(`timelineJson` null)**: 파일 목록, 순서, 내용, manifest가 바이트 그대로예요. VTT·소리를 더하지 않아요.
- **I-2. 이미 만든 export**: 행과 ZIP은 트리거와 link 확정으로 그대로예요. 다시 만들지 않고 이전 것도 고치지 않아요.
- **I-3. `subtitles/manual.srt`**: 함수(`srtText`), 대상(`subtitle`), 시간 규칙을 바꾸지 않아요. 같은 타임라인이면 SRT 바이트도 같아요.
- **I-4. 권한과 게이트**: 요청, 다운로드, 검수 게이트, 시작 점검, `canCreate`를 바꾸지 않아요. 새 승인 단계를 만들지 않고 P5 게시도 열지 않아요.
- **I-5. 다른 파일의 바이트**: `README.txt`, `provenance/rights.md`는 **소리 원본이 있는 v2 묶음에서만** 줄이 더해져요. v1 타임라인 묶음에서 바뀌는 것은 VTT 파일이 하나 더해지는 것뿐이에요(4.1).

## 3. VTT 계약

- **경로·형식**: `subtitles/timeline.vtt`, mime `text/vtt`, UTF-8(BOM 없음), 줄바꿈 LF, 첫 줄 `WEBVTT`, 그다음 빈 줄.
- **대상**:
  - 타임라인(v1·v2)이 있는 묶음에서만 만들어요(P1 경로 제외).
  - `timeline.text` 중 `kind==="subtitle"`만 써요(SRT와 같은 cue 집합).
  - subtitle이 없으면 파일을 넣지 않아요(SRT와 같은 규칙).
  - lyric 등 다른 종류는 P4-4 범위예요.
- **시간**:
  - `framesToMs(startFrame)` / `framesToMs(endFrame)`를 `HH:MM:SS.mmm`으로 적어요.
  - 30fps 프레임 경계에서 오차는 0.5ms 이하예요(PLAN 기준 0.2초보다 훨씬 작아요).
  - 끝은 시작보다 1프레임 이상 뒤예요(스키마 refine으로 보장).
- **cue**:
  - id는 layer id(uuidv7)예요.
  - 순서는 startFrame, endFrame, id 순으로 정해요(결정적).
  - 겹치는 자막도 그대로 두어요(VTT는 동시 표시를 허용해요).
  - 위치·스타일 설정(cue setting)은 넣지 않아요. 위치와 모양은 `edit/timeline.json`이 기준이에요.
- **본문 처리**(순수 함수 `timelineVtt(text)`):
  1. `trim()`(SRT와 같아요)
  2. CRLF·CR을 LF로 바꿔요.
  3. 빈 줄을 지워요. 빈 줄은 cue를 끝내기 때문이에요.
  4. `&`를 `&amp;`, `<`를 `&lt;`, `>`를 `&gt;`로 바꿔요. 이렇게 하면 본문 안의 `-->`도 `--&gt;`가 돼요.
  - 한글, 이모지, 특수문자는 그대로 UTF-8이에요.
- **알려진 차이**: SRT는 본문 escape를 하지 않고 빈 줄도 지우지 않아요(I-3으로 유지). 문구에 빈 줄이 있으면 SRT 쪽만 cue가 끊길 수 있어요. 고칠지는 Master가 판단해요(6장 D-4).

## 4. 재편집용 ZIP 계약 (v2 소리 포함)

### 4.1 경로 (기존 순서 뒤에 이어 붙임)
| 경로 | 언제 | 내용 |
|---|---|---|
| `subtitles/timeline.vtt` | 타임라인 묶음 + subtitle ≥1 | 3장 |
| `audio/{nn}_{assetId}[_SAMPLE].{ext}` | v2 + audio ≥1 | 원본 파일 바이트 그대로예요(잘라 내지 않고 다시 인코딩하지 않음). `nn`은 assetId 정렬 순서(01부터), ext는 저장 파일의 확장자예요. 같은 파일을 여러 클립이 써도 한 번만 넣어요. |
| `edit/audio_sources.json` | v2 + audio ≥1 | `[{assetId,path,title,mime,sizeBytes,sha256,durationMs,isMock,archived,clipIds[],rights}]`. rights는 `timeline.audioRights` 행 그대로예요(빈 값 = null, 직접 확인 필요). |
| `edit/timeline.json` | 기존 그대로 | 저장된 바이트예요. trim(`sourceInFrame`·`durationFrames`), gain, fade, duck, `audioJoins`, `audioRights`, `audioMixProfile`가 이미 들어 있어요. 따로 복제하지 않아요. |
| `README.txt`·`provenance/rights.md` | v2 + audio ≥1일 때만 줄 추가 | README에는 소리 원본 위치, "합친 소리(믹스)·완성 영상이 아니에요", 복원 방법과 한계(4.6)를 적어요. rights.md에는 소리 권리 절을 더해요. |
| `fonts/…`, `LICENSES/…` | 기존 그대로 | 쓰인 글꼴 파일과 OFL. 없는 글꼴은 README에 기존 문구로 적어요. 새 글꼴 라이선스 종류는 만들지 않아요(OFL-1.1만). |

### 4.2 manifest
- v2 묶음에 소리 원본이 있을 때만 `manifestVersion:2`를 써요. 그 밖에는 v1 바이트 그대로예요(I-1·I-5).
- `manifestSchema = union(v1 그대로, v2)` 구조예요. v2 = v1 필드 + 아래 두 가지예요.
  - `timeline:{revisionId,schemaVersion:2,audioMixProfile}`
  - files 항목의 선택 필드 `audio:{assetId,roles:("voice"|"music"|"effect")[],isMock:boolean}`
- strict는 유지하고, `kind`는 여전히 `editing-bundle`이에요.
- `exports.manifest_version` 열(0001에 이미 있고 기본값 1)에 2를 같이 기록해요. 성공으로 바꾸는 갱신 때 같이 써요. 트리거는 OLD가 succeeded일 때만 막아서 문제없어요. **migration은 필요 없어요.**
- 목록·다운로드는 union으로 읽어요. v1 행을 읽는 방식은 그대로예요.

### 4.3 샘플·실패·누락 원본·재시도·hash
- **샘플**: 원본의 `isMock`이 참이면 파일 이름에 `_SAMPLE`을 붙여요. manifest `isMock`은 장면 **또는** 소리 중 하나라도 샘플이면 참이에요(ZIP 이름 `_SAMPLE`과 같은 함수).
- **누락·변경**:
  - `context()`(요청 시)와 `runClaimedExport`(작성 시) 모두에서, 렌더와 같은 규칙으로 막아요. 행 없음, kind≠audio, 파일 없음, sha256·크기 다름, 원본 범위 초과면 export를 만들지 않아요.
  - 코드는 `EXPORT_INVALID`(409)이고, 다시 시도할 수 없는 코드예요. 사유는 쉬운 말로 적어요. 예: "소리 파일 '…'을 찾을 수 없어요. 편집 화면에서 확인해 주세요."
  - 보관(archived)했지만 파일이 있는 원본은 넣어요(저장본이 참조하므로). `archived:true`로 표시해요.
  - 미리보기(`preview`)는 장면과 같은 방식으로 누락 목록을 보여 줘요. 소리 행은 `missing`/`sample`로 표시해요.
- **해시**: 장면과 같아요. 작성 중 `fileDigest`가 행의 sha256·크기와 다르면 409예요. 그 뒤 ZIP을 다시 열어 `verifyZip`으로 전체를 확인한 다음에만 성공으로 바꿔요(E-3).
- **재시도**: 기존 그대로예요. 저장 실패(`STORAGE_FAILED`)나 시간 초과(`TIMEOUT`)만 다시 시도할 수 있어요. 같은 exportId 파일이 이미 있으면 `verifyZip`으로 이어받아요. 원본이 바뀌어서 생긴 실패는 다시 시도할 수 없어요(새 요청 필요).

### 4.4 용량
- 원본은 압축하지 않은 stored ZIP64로 담아요. `estimateZipBytes`는 소리 행도 포함해서 미리보기에 보여 줘요(기존 ±10% 시험 방식).
- 상한: v2 타임라인은 audio 100개 이하, 원본 하나는 업로드 상한(기본 2GiB) 이하예요. manifest files는 1000개 이하라서 장면 100 + 소리 100 + 고정 파일이면 들어가요.
- **묶음 전체 상한은 새로 두지 않는 것을 추천해요**(D-3). 대신 미리보기에 예상 크기를 보여 주고, 같은 크기만큼 백업도 커진다는 점을 안내해요. export ZIP은 저장소 안에 있어서 백업에 원본이 한 번 더 들어가요.
- 작성 시간 10분 제한(`exports.ts:90`)은 그대로예요. 큰 원본이 이 제한에 걸리면 `TIMEOUT`(다시 시도 가능)이 돼요.

### 4.5 v1 타임라인
- 소리가 있는 예전 v1(`audio:[{assetId,…}]`)은 렌더에서 쓰지 않는 기록이라 원본을 넣지 않아요. README에 "예전 소리 기록은 원본을 넣지 않았어요"라고 한 줄 적어요.
- v1이면 manifest는 v1 그대로이고, 더해지는 것은 VTT뿐이에요.

### 4.6 복원 방법과 한계 (README와 화면에 그대로 적을 내용)
- 이 ZIP은 **편집 자료 묶음**이에요. 완성 영상, 합친 소리, 실행 프로그램이 들어 있지 않아요.
- 다시 편집하려면 `edit/timeline.json`(프레임 30fps 기준)과 `scenes/`·`audio/` 원본을 다른 편집 도구에서 손으로 맞춰야 해요.
- 지금 이 앱에는 ZIP을 프로젝트로 다시 불러오는 기능이 없어요. 앱 상태를 되돌리는 것은 **백업·복원**이 맡아요.
- 소리 믹스 설정(`audioMixProfile:"p2-5-local-v1"`)은 이 앱의 렌더 규칙 이름이에요. 다른 도구에서는 같은 소리가 되지 않을 수 있어요.
- 권리 기록이 비어 있으면 "직접 확인 필요"예요. 묶음을 만들었다고 사용권이 확인된 것은 아니에요.

## 5. 수정 파일·최소 구현 분할·완료 기준

| 단계 | 수정 파일 | 내용 | 완료 기준(시험) |
|---|---|---|---|
| S1 VTT | `lib/edit/timeline.ts`(`timelineVtt` 순수 함수), `lib/services/exports.ts`(layout에 1줄), `components/editing-panel.tsx`(선택: 저장 자막 VTT 미리보기) | 3장 | 새 `tests/p2-6-vtt.test.ts`: escape(`& < > -->`), CRLF·빈 줄, 한글·이모지 UTF-8 바이트, ms 경계(1프레임 = 00:00:00.033, 29·30·899프레임), 겹침 순서, subtitle 없음 → 파일 없음, 같은 입력 → 같은 바이트. **P1 r1 묶음 바이트 불변**(기존 `jobs`/`p2-1`/`p2-3` export 시험 통과 + s4 고정 묶음 비교). |
| S2 manifest v2 | `lib/export/schema.ts`(union), `lib/services/exports.ts`(목록·다운로드 union 읽기), `lib/repo/finishing.ts` 사용처(manifest_version 기록) | 4.2 | v1 manifest 문자열이 기존과 같음. v2 strict 거절(모르는 필드). verifyZip 왕복. 기존 성공 행 목록·다운로드가 그대로. |
| S3 소리 원본 | `lib/services/exports.ts`(context·preview·layout·run), 필요하면 공용 소리 원본 확인 함수(`lib/render/input.ts`의 확인을 순수 helper로 빼서 공유, 동작 불변) | 4.1·4.3·4.5 | 가상 s5 사본 + 합성 소리: v2 묶음에 원본 바이트·sha256 일치, `audio_sources.json`·timeline.json 바이트 = 저장 행, 같은 원본 1회, 샘플 이름·isMock, 보관 파일 포함, 누락·바뀐 바이트·범위 초과 → 409와 쉬운 사유(요청·작성 둘 다), 작성 중 파일 바뀜 → 실패·임시 파일 정리, STORAGE_FAILED 재시도 시 기존 파일 이어받기, 예상 크기 ±10%. 렌더 쪽 기존 시험 불변. |
| S4 README·권리·화면 | `lib/services/exports.ts`(문구), export 화면 컴포넌트(목록에 소리 원본·예상 크기·누락 표시; 디자인 담당 범위 확인 필요) | 4.6 | 문구 스냅숏, 1280·390 넘침 0, 44px, "완성 영상 아님" 표시. |
| S5 브라우저 확인 | (제품 파일 없음) | 아래 | 증거 보고서 |

**브라우저 textTrack 확인 계획(S5)** — ego-browser, 안전 사본 + 가상 데이터로 해요.
1. 합성 30fps 영상(FFmpeg lavfi, 가상)과 실제 export에서 꺼낸 `timeline.vtt`를 Blob URL로 `<video><track kind="subtitles" default>`에 붙여요.
2. `track.mode="showing"`, `readyState` 2를 확인해요. `cues.length` = subtitle 수예요.
3. 각 cue의 `startTime`/`endTime`와 frame/30의 차이가 0.001초 이하예요. `id`는 layer id예요.
4. `cue.text`가 원문(trim·빈 줄 제거 뒤)과 같아요. `&<>`, `-->`, 한글·이모지가 그대로 보여요(`getCueAsHTML().textContent`).
5. 겹치는 구간의 `currentTime`에서 `activeCues`가 2개예요.
6. 자막이 없는 프로젝트의 묶음에는 VTT가 없어요.
7. 렌더된 영상 위 실제 표시 시각(번인 글자)과의 0.2초 비교는 P2 종료 기준이라 이 단계 증거와 따로 적어요. 휴대폰 재생은 실제 기기에서만 인정해요.

## 6. 정해야 할 것(추천안)
- **D-1 VTT 대상**: subtitle만(SRT와 같은 집합). **추천.** lyric은 P4-4에서 정해요.
- **D-2 manifest**: 소리 원본이 있을 때만 v2, 그 밖에는 v1 바이트 유지. **추천.** 대안으로 모든 타임라인 묶음을 v2로 올리면 v1 바이트 불변이 깨져요.
  - 한계: v2 행을 가진 백업을 T154 이전 앱(0009)에 복원하면 그 행의 목록·다운로드를 읽지 못해요(strict 스키마). migration을 더하지 않으므로 복원 자체는 막히지 않아요. 이 한계를 문서로 받아들이는 것을 추천해요. 막아야 한다면 0010 표지 migration이 필요하고, 이는 Master·사용자가 결정해요.
- **D-3 용량 상한**: 새 상한 없이 예상 크기와 백업 증가를 안내하는 것을 추천해요.
- **D-4 SRT 빈 줄**: I-3 불변을 유지하는 것을 추천해요(P1 바이트 보호). 바로잡는다면 새 버전 경로에서만 해야 하는데, 이 경우 같은 타임라인이라도 SRT 바이트가 달라지는 것을 받아들여야 해요.
- **D-5 `final/` 완성 영상**: PLAN 트리에는 P2부터라고 적혀 있지만, 이번 범위에서는 **넣지 않는 것을 추천해요**. 렌더 결과의 검수·revision 연결과 게시 게이트에 닿기 때문이에요. 넣는다면 같은 timeline revision의 성공 렌더만, 별도 작업에서 정해요.
- **D-6 소리 원본 확인 공유**: 렌더의 확인 로직을 순수 helper로 빼서 export도 쓰게 하는 것을 추천해요. 렌더 동작은 그대로 두고, 렌더 회귀 시험으로 확인해요.

## 7. 0009 고정 fixture (읽기 기준 우선순위안)
- 지금 고정 fixture는 s4~s7(0001~0007 무렵)까지예요. 0008(timeline audio)과 0009(render audio)에는 고정 백업이 없어요. 시험은 가짜 승격 사본으로만 했어요(T-137·T-144).
- P2-6은 v2 소리 참조를 읽어서 묶음에 넣어요. 그래서 **S3 전에 s9(0009, v2 타임라인 + 소리 원본 + 렌더 B 행) 고정 fixture를 만드는 작업을 따로 배정하는 것을 추천해요.**
  - s4~s7과 같은 build/compare 방식으로 새 파일만 만들어요. 기존 fixture와 발행 migration의 바이트는 바꾸지 않아요.
  - 그다음 "s9 복원 → export v2 묶음 → verifyZip" 회귀를 S3 완료 기준에 넣어요.
- s8은 s9에 포함되는 변화라 우선순위가 낮아요(추천: s9만).

## 8. 확인하지 않은 것
- 이 문서는 코드 읽기만으로 썼어요. 시험, 빌드, 브라우저 실행은 하지 않았어요.
- 예상 크기 상수가 큰 소리 원본에서도 ±10% 안에 드는지는 S3에서 재야 해요.
- export 화면 컴포넌트 담당(디자인 범위)과 미리보기 문구는 Master가 배정해 주세요.
